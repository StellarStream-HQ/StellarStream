import { logger } from '../logger.js';

interface RpcProvider {
  url: string;
  name: string;
}

interface CircuitBreakerState {
  status: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureCount: number;
  lastFailureTime?: number;
  successCount: number;
}

interface RpcLoadBalancerConfig {
  providers: RpcProvider[];
  failureThreshold?: number;
  resetTimeout?: number;
  successThreshold?: number;
}

export class RpcLoadBalancer {
  private providers: RpcProvider[];
  private circuitBreakers: Map<string, CircuitBreakerState>;
  private failureThreshold: number;
  private resetTimeout: number;
  private successThreshold: number;
  private currentProviderIndex: number;

  constructor(config: RpcLoadBalancerConfig) {
    this.providers = config.providers;
    this.failureThreshold = config.failureThreshold || 5;
    this.resetTimeout = config.resetTimeout || 60000; // 1 minute
    this.successThreshold = config.successThreshold || 2;
    this.currentProviderIndex = 0;

    // Initialize circuit breakers for each provider
    this.circuitBreakers = new Map();
    for (const provider of this.providers) {
      this.circuitBreakers.set(provider.name, {
        status: 'CLOSED',
        failureCount: 0,
        successCount: 0,
      });
    }
  }

  private getCircuitBreaker(providerName: string): CircuitBreakerState {
    let breaker = this.circuitBreakers.get(providerName);
    if (!breaker) {
      breaker = {
        status: 'CLOSED',
        failureCount: 0,
        successCount: 0,
      };
      this.circuitBreakers.set(providerName, breaker);
    }
    return breaker;
  }

  private recordSuccess(providerName: string): void {
    const breaker = this.getCircuitBreaker(providerName);

    if (breaker.status === 'HALF_OPEN') {
      breaker.successCount++;
      if (breaker.successCount >= this.successThreshold) {
        breaker.status = 'CLOSED';
        breaker.failureCount = 0;
        breaker.successCount = 0;
        logger.info(`Circuit breaker for ${providerName} closed`);
      }
    } else if (breaker.status === 'CLOSED') {
      breaker.failureCount = 0;
    }
  }

  private recordFailure(providerName: string): void {
    const breaker = this.getCircuitBreaker(providerName);
    breaker.failureCount++;
    breaker.lastFailureTime = Date.now();

    if (breaker.failureCount >= this.failureThreshold) {
      breaker.status = 'OPEN';
      logger.warn(`Circuit breaker for ${providerName} opened after ${breaker.failureCount} failures`);
    }
  }

  private shouldAttemptProvider(providerName: string): boolean {
    const breaker = this.getCircuitBreaker(providerName);

    if (breaker.status === 'CLOSED') {
      return true;
    }

    if (breaker.status === 'OPEN') {
      // Check if reset timeout has passed
      if (breaker.lastFailureTime && Date.now() - breaker.lastFailureTime > this.resetTimeout) {
        breaker.status = 'HALF_OPEN';
        breaker.successCount = 0;
        logger.info(`Circuit breaker for ${providerName} entering HALF_OPEN state`);
        return true;
      }
      return false;
    }

    // HALF_OPEN state - allow attempt
    return true;
  }

  private getNextAvailableProvider(): RpcProvider | null {
    const availableProviders = this.providers.filter((p) => this.shouldAttemptProvider(p.name));

    if (availableProviders.length === 0) {
      logger.error('No available RPC providers');
      return null;
    }

    // Round-robin selection among available providers
    const provider = availableProviders[this.currentProviderIndex % availableProviders.length];
    this.currentProviderIndex++;
    return provider;
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const maxAttempts = this.providers.length;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const provider = this.getNextAvailableProvider();

      if (!provider) {
        throw new Error('All RPC providers are unavailable');
      }

      try {
        logger.debug(`Attempting RPC call to ${provider.name}: ${method}`);
        const result = await this.makeRpcCall<T>(provider.url, method, params);
        this.recordSuccess(provider.name);
        return result;
      } catch (error) {
        lastError = error as Error;
        this.recordFailure(provider.name);
        logger.warn(`RPC call failed on ${provider.name}: ${lastError.message}`);
      }
    }

    throw lastError || new Error('All RPC providers failed');
  }

  private async makeRpcCall<T>(url: string, method: string, params: unknown[]): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as any;

    if ((data as any).error) {
      throw new Error(`RPC Error: ${(data as any).error.message}`);
    }

    return (data as any).result as T;
  }

  getStatus(): Record<string, CircuitBreakerState> {
    const status: Record<string, CircuitBreakerState> = {};
    for (const [name, breaker] of this.circuitBreakers) {
      status[name] = { ...breaker };
    }
    return status;
  }

  resetProvider(providerName: string): void {
    const breaker = this.getCircuitBreaker(providerName);
    breaker.status = 'CLOSED';
    breaker.failureCount = 0;
    breaker.successCount = 0;
    logger.info(`Circuit breaker for ${providerName} manually reset`);
  }
}

// Singleton instance
let loadBalancer: RpcLoadBalancer | null = null;

export function initializeRpcLoadBalancer(config: RpcLoadBalancerConfig): RpcLoadBalancer {
  loadBalancer = new RpcLoadBalancer(config);
  logger.info(`RPC Load Balancer initialized with ${config.providers.length} providers`);
  return loadBalancer;
}

export function getRpcLoadBalancer(): RpcLoadBalancer {
  if (!loadBalancer) {
    throw new Error('RPC Load Balancer not initialized');
  }
  return loadBalancer;
}
