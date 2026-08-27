/** Error raised when an RPC, simulation, or wallet invocation fails. */
export class StellarStreamError extends Error {
  constructor(message: string, public readonly method?: string, public readonly cause?: unknown) {
    super(message); this.name = "StellarStreamError";
  }
}

export function asSdkError(error: unknown, method: string): StellarStreamError {
  if (error instanceof StellarStreamError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new StellarStreamError(`StellarStream ${method} failed: ${message}`, method, error);
}
