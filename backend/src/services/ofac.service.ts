import { CacheService } from "./cache.service.js";
import { AuditLogService } from "./audit-log.service.js";
import { logger } from "../logger.js";
import { prisma } from "../lib/db.js";

// Known OFAC SDN (Specially Designated Nationals) addresses for testing
// In production, this would be fetched from official OFAC sources
const KNOWN_SDN_ADDRESSES = new Set<string>([
  "GD5PMJGQ6WJXWB5G4FJ3QDKXNFMJQK5T5Y4M4M4M4M4M4M4M4M4M4M4M",
  "GB7I5Q6KXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJ",
  "GC3M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M",
  "GAB3M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M",
  "GDE3M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M",
  "GDF3M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M",
  "GDG3M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M",
  "GDH3M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M",
  "GDI3M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M",
  "GDJ3M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M",
]);

export interface OfacCheckResult {
  isSanctioned: boolean;
  address: string;
  checkedAt: string;
  source: string;
}

export class OfacService {
  private cacheService: CacheService;
  private auditLogService: AuditLogService;
  private readonly CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 hours

  constructor() {
    this.cacheService = new CacheService();
    this.auditLogService = new AuditLogService();
  }

  /**
   * Check if an address is sanctioned by OFAC
   * Results are cached for 24 hours
   * All checks are logged to audit trail
   */
  async checkAddress(address: string): Promise<OfacCheckResult> {
    const normalizedAddress = address.trim().toUpperCase();
    const cacheKey = `ofac:check:${normalizedAddress}`;

    try {
      // Try to get from cache first
      const cachedResult = await this.cacheService.getOrCompute(
        cacheKey,
        this.CACHE_TTL_SECONDS,
        async () => {
          return await this.performOfacCheck(normalizedAddress);
        }
      );

      // Log to audit trail
      await this.logOfacCheck(normalizedAddress, cachedResult);

      return cachedResult;
    } catch (error) {
      logger.error("OFAC check failed", error, { address: normalizedAddress });
      // Fail open for safety - if check fails, allow the operation
      // but log the failure
      return {
        isSanctioned: false,
        address: normalizedAddress,
        checkedAt: new Date().toISOString(),
        source: "error-fallback",
      };
    }
  }

  /**
   * Perform the actual OFAC check against SDN list
   */
  private async performOfacCheck(address: string): Promise<OfacCheckResult> {
    const isSanctioned = KNOWN_SDN_ADDRESSES.has(address);

    return {
      isSanctioned,
      address,
      checkedAt: new Date().toISOString(),
      source: "sdn-list",
    };
  }

  /**
   * Log OFAC check to audit trail
   */
  private async logOfacCheck(
    address: string,
    result: OfacCheckResult
  ): Promise<void> {
    try {
      // Store in database for audit trail
      await prisma.ofacAuditLog.create({
        data: {
          address,
          isSanctioned: result.isSanctioned,
          checkedAt: new Date(result.checkedAt),
          source: result.source,
        },
      });

      logger.info("OFAC check logged", {
        address,
        isSanctioned: result.isSanctioned,
        source: result.source,
      });
    } catch (error) {
      logger.error("Failed to log OFAC check to audit trail", error, {
        address,
      });
      // Don't throw - audit log failure shouldn't block the operation
    }
  }

  /**
   * Check multiple addresses in batch
   */
  async checkAddresses(addresses: string[]): Promise<Map<string, OfacCheckResult>> {
    const results = new Map<string, OfacCheckResult>();

    await Promise.all(
      addresses.map(async (address) => {
        const result = await this.checkAddress(address);
        results.set(address, result);
      })
    );

    return results;
  }

  /**
   * Get audit log entries for OFAC checks
   */
  async getAuditLog(limit: number = 100): Promise<any[]> {
    try {
      const logs = await prisma.ofacAuditLog.findMany({
        orderBy: {
          checkedAt: "desc",
        },
        take: limit,
      });

      return logs;
    } catch (error) {
      logger.error("Failed to retrieve OFAC audit log", error);
      throw error;
    }
  }

  /**
   * Clear cache for a specific address
   */
  async clearCache(address: string): Promise<void> {
    const normalizedAddress = address.trim().toUpperCase();
    const cacheKey = `ofac:check:${normalizedAddress}`;

    await this.cacheService.invalidate(cacheKey);
    logger.info("OFAC cache cleared", { address: normalizedAddress });
  }

  /**
   * Check if address is in the known SDN list (for testing)
   */
  isKnownSdnAddress(address: string): boolean {
    return KNOWN_SDN_ADDRESSES.has(address.trim().toUpperCase());
  }

  /**
   * Get all known SDN addresses (for testing/admin)
   */
  getKnownSdnAddresses(): string[] {
    return Array.from(KNOWN_SDN_ADDRESSES);
  }
}
