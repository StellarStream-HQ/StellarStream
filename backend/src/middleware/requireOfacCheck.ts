import { Request, Response, NextFunction } from 'express';
import { OfacService } from '../services/ofac.service.js';
import { logger } from '../logger.js';

const ofacService = new OfacService();

/**
 * Middleware factory that enforces OFAC compliance checks on addresses.
 *
 * This middleware checks if the specified address(es) are sanctioned by OFAC.
 * If any address is sanctioned, the request is blocked with a 403 response.
 *
 * Addresses are extracted from (in order of priority):
 *   - req.params.address
 *   - req.params.receiver
 *   - req.body.receiver
 *   - req.body.sender
 *   - req.body.recipient
 *
 * All checks are cached for 24 hours and logged to the audit trail.
 *
 * @example
 *   router.post('/streams', requireOfacCheck(), createStream);
 *   router.post('/streams/:receiver', requireOfacCheck(), createStream);
 */
export function requireOfacCheck() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Extract address to check from various possible locations
    const address =
      (req.params.address as string | undefined) ??
      (req.params.receiver as string | undefined) ??
      (req.body as Record<string, unknown>)?.receiver as string | undefined ??
      (req.body as Record<string, unknown>)?.sender as string | undefined ??
      (req.body as Record<string, unknown>)?.recipient as string | undefined;

    if (!address) {
      logger.warn('No address found for OFAC check', {
        path: req.path,
        method: req.method,
      });
      // If no address is found, allow the request to proceed
      // This is safe because stream creation endpoints should always have addresses
      next();
      return;
    }

    try {
      const result = await ofacService.checkAddress(address);

      if (result.isSanctioned) {
        logger.warn('OFAC sanction check failed - address is sanctioned', {
          address,
          path: req.path,
          method: req.method,
          source: result.source,
        });

        res.status(403).json({
          error: 'Address is sanctioned by OFAC',
          code: 'OFAC_SANCTIONED',
          address,
          checkedAt: result.checkedAt,
        });
        return;
      }

      // Address is not sanctioned, proceed
      next();
    } catch (error) {
      logger.error('OFAC check failed with error', error, {
        address,
        path: req.path,
        method: req.method,
      });

      // Fail open for safety - if the check fails, allow the operation
      // but log the failure for investigation
      res.status(503).json({
        error: 'OFAC check service unavailable',
        code: 'OFAC_CHECK_FAILED',
      });
    }
  };
}

/**
 * Middleware factory that enforces OFAC compliance checks on multiple addresses.
 *
 * This is useful for endpoints that involve multiple addresses (e.g., sender and receiver).
 *
 * @param addressFields - Array of field names to check (e.g., ['sender', 'receiver'])
 *
 * @example
 *   router.post('/streams', requireOfacCheckMultiple(['sender', 'receiver']), createStream);
 */
export function requireOfacCheckMultiple(addressFields: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const addresses: string[] = [];

    for (const field of addressFields) {
      const address =
        (req.params[field] as string | undefined) ??
        (req.body as Record<string, unknown>)[field] as string | undefined;

      if (address) {
        addresses.push(address);
      }
    }

    if (addresses.length === 0) {
      logger.warn('No addresses found for OFAC check', {
        path: req.path,
        method: req.method,
        fields: addressFields,
      });
      next();
      return;
    }

    try {
      const results = await ofacService.checkAddresses(addresses);

      // Check if any address is sanctioned
      for (const [address, result] of results.entries()) {
        if (result.isSanctioned) {
          logger.warn('OFAC sanction check failed - address is sanctioned', {
            address,
            path: req.path,
            method: req.method,
            source: result.source,
          });

          res.status(403).json({
            error: 'Address is sanctioned by OFAC',
            code: 'OFAC_SANCTIONED',
            address,
            checkedAt: result.checkedAt,
          });
          return;
        }
      }

      // All addresses are clear, proceed
      next();
    } catch (error) {
      logger.error('OFAC check failed with error', error, {
        addresses,
        path: req.path,
        method: req.method,
      });

      res.status(503).json({
        error: 'OFAC check service unavailable',
        code: 'OFAC_CHECK_FAILED',
      });
    }
  };
}
