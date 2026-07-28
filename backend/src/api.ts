import { Router, Request, Response, NextFunction } from 'express';
import { simulate, SimulationRpcError, SimulationNetworkError } from './simulation-service.js';
import { applyBuffer } from './fee-calculator.js';

// ---- Response types ----

interface FeeEstimateResponse {
  inclusion_fee_stroops: number;
  resource_fee_stroops: number;
  total_fee_stroops: number;
  buffered: true;
}

interface ErrorResponse {
  error: string;
  message: string;
}

// ---- XDR validation ----
// Accepts non-empty strings that are valid base64 (standard or URL-safe alphabet)

const BASE64_RE = /^[A-Za-z0-9+/\-_]+=*$/;

function isValidBase64(value: string): boolean {
  if (!value || value.trim().length === 0) return false;
  return BASE64_RE.test(value);
}

// ---- Router ----

export const router = Router();

// Request logging middleware
router.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      JSON.stringify({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: duration,
      }),
    );
  });
  next();
});

// GET /health
router.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// GET /api/v2/fees/estimate
router.get('/api/v2/fees/estimate', async (req: Request, res: Response) => {
  const { transaction_xdr } = req.query;

  // 400 — missing parameter
  if (transaction_xdr === undefined || transaction_xdr === '') {
    const body: ErrorResponse = {
      error: 'missing_parameter',
      message: 'Query parameter "transaction_xdr" is required.',
    };
    res.status(400).json(body);
    return;
  }

  const xdr = String(transaction_xdr);

  // 422 — invalid / malformed XDR (basic base64 check)
  if (!isValidBase64(xdr)) {
    const body: ErrorResponse = {
      error: 'invalid_xdr',
      message: 'The "transaction_xdr" parameter is not valid base64-encoded XDR.',
    };
    res.status(422).json(body);
    return;
  }

  try {
    const rawFees = await simulate(xdr);
    const buffered = applyBuffer(rawFees);

    const responseBody: FeeEstimateResponse = {
      inclusion_fee_stroops: buffered.inclusionFeeStroops,
      resource_fee_stroops: buffered.resourceFeeStroops,
      total_fee_stroops: buffered.totalFeeStroops,
      buffered: true,
    };
    res.status(200).json(responseBody);
  } catch (err: unknown) {
    // 502 — RPC or network error from Simulation Service
    if (err instanceof SimulationRpcError || err instanceof SimulationNetworkError) {
      const errorCode =
        err instanceof SimulationRpcError ? 'simulation_failed' : 'rpc_unreachable';
      const body: ErrorResponse = {
        error: errorCode,
        message: err.message,
      };
      res.status(502).json(body);
      return;
    }

    // 500 — unhandled exception
    const stack = err instanceof Error ? err.stack : String(err);
    console.error('[api] Unhandled exception:', stack);
    const body: ErrorResponse = {
      error: 'internal_error',
      message: 'An unexpected error occurred.',
    };
    res.status(500).json(body);
  }
});
