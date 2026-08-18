/**
 * Base class for all StellarStream SDK errors.
 */
export class StellarStreamError extends Error {
  public code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.name = "StellarStreamError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotInitializedError extends StellarStreamError {
  constructor() {
    super("Protocol contract is not initialized", 1);
    this.name = "NotInitializedError";
  }
}

export class AlreadyInitializedError extends StellarStreamError {
  constructor() {
    super("Protocol contract is already initialized", 2);
    this.name = "AlreadyInitializedError";
  }
}

export class UnauthorizedError extends StellarStreamError {
  constructor() {
    super("Caller is unauthorized to perform this operation", 3);
    this.name = "UnauthorizedError";
  }
}

export class StreamNotFoundError extends StellarStreamError {
  constructor(streamId?: bigint | number | string) {
    super(`Stream with ID ${streamId ?? "unknown"} was not found`, 4);
    this.name = "StreamNotFoundError";
  }
}

export class StreamNotActiveError extends StellarStreamError {
  constructor() {
    super("Stream is not currently in an active state", 5);
    this.name = "StreamNotActiveError";
  }
}

export class StreamPausedError extends StellarStreamError {
  constructor() {
    super("Stream is currently paused", 6);
    this.name = "StreamPausedError";
  }
}

export class StreamAlreadyFinishedError extends StellarStreamError {
  constructor() {
    super("Stream has already completed or been cancelled", 7);
    this.name = "StreamAlreadyFinishedError";
  }
}

export class InvalidTimeRangeError extends StellarStreamError {
  constructor() {
    super("End time must be strictly greater than start time", 8);
    this.name = "InvalidTimeRangeError";
  }
}

export class InvalidAmountError extends StellarStreamError {
  constructor() {
    super("Amount must be strictly positive and within valid balance constraints", 9);
    this.name = "InvalidAmountError";
  }
}

export class ZeroDurationError extends StellarStreamError {
  constructor() {
    super("Effective stream duration cannot be zero", 10);
    this.name = "ZeroDurationError";
  }
}

export class CalculationOverflowError extends StellarStreamError {
  constructor() {
    super("Mathematical operation resulted in integer overflow", 11);
    this.name = "CalculationOverflowError";
  }
}

export class LimitExceededError extends StellarStreamError {
  constructor() {
    super("Query limit exceeded maximum allowed threshold (50)", 12);
    this.name = "LimitExceededError";
  }
}

/**
 * Maps on-chain Soroban contract error codes to typed SDK errors.
 */
export function mapContractError(errorCode: number): StellarStreamError {
  switch (errorCode) {
    case 1:
      return new NotInitializedError();
    case 2:
      return new AlreadyInitializedError();
    case 3:
      return new UnauthorizedError();
    case 4:
      return new StreamNotFoundError();
    case 5:
      return new StreamNotActiveError();
    case 6:
      return new StreamPausedError();
    case 7:
      return new StreamAlreadyFinishedError();
    case 8:
      return new InvalidTimeRangeError();
    case 9:
      return new InvalidAmountError();
    case 10:
      return new ZeroDurationError();
    case 11:
      return new CalculationOverflowError();
    case 12:
      return new LimitExceededError();
    default:
      return new StellarStreamError(`Contract execution failed with code ${errorCode}`, errorCode);
  }
}
