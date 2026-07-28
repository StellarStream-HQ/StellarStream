import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/db.js';
import { logger } from '../logger.js';

declare global {
  namespace Express {
    interface Request {
      organizationId?: string;
      gAddress?: string;
    }
  }
}

/**
 * Middleware that extracts organization context from route parameters
 * and injects organizationId into the request object.
 * 
 * Supports:
 * - /api/v1/orgs/:gAddress/... routes (extracts gAddress and resolves to organizationId)
 * 
 * Sets:
 * - req.organizationId: The resolved organization ID
 * - req.gAddress: The G-address from the route parameter
 * 
 * Returns 404 if organization not found (to avoid leaking org existence)
 */
export async function requireOrgContext(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { gAddress } = req.params;

    if (!gAddress) {
      logger.warn('Organization context middleware: no gAddress in route', { path: req.path });
      res.status(400).json({
        success: false,
        error: 'Missing organization address',
      });
      return;
    }

    // Validate G-address format
    if (!gAddress.match(/^G[A-Z0-9]{55}$/)) {
      logger.warn('Organization context middleware: invalid gAddress format', { gAddress });
      res.status(404).json({
        success: false,
        error: 'Not found',
      });
      return;
    }

    // Resolve organization ID from G-address
    const organization = await prisma.organization.findUnique({
      where: { gAddress },
      select: { id: true, isActive: true },
    });

    if (!organization || !organization.isActive) {
      logger.warn('Organization context middleware: organization not found or inactive', { gAddress });
      res.status(404).json({
        success: false,
        error: 'Not found',
      });
      return;
    }

    // Inject organization context
    req.organizationId = organization.id;
    req.gAddress = gAddress;

    logger.debug('Organization context resolved', {
      gAddress,
      organizationId: organization.id,
      path: req.path,
    });

    next();
  } catch (error) {
    logger.error('Organization context middleware error', error, { path: req.path });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
}
