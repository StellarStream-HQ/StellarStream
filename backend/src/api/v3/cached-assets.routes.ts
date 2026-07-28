import { Router, Request, Response } from 'express';
import { prisma } from '../../lib/db.js';
import { logger } from '../../logger.js';

const router = Router();

interface StellarExpertAsset {
  code: string;
  issuer: string;
  name?: string;
  description?: string;
  image?: string;
  verified?: boolean;
  decimals?: number;
}

// Fetch top 100 assets from Stellar-Expert API
async function fetchStellarExpertAssets(): Promise<StellarExpertAsset[]> {
  try {
    const response = await fetch('https://api.stellar.expert/v2/assets?limit=100&sort=volume_7d');
    if (!response.ok) {
      throw new Error(`Stellar-Expert API error: ${response.statusText}`);
    }
    const data = await response.json();
    return data._embedded?.records || [];
  } catch (error) {
    logger.error('Error fetching from Stellar-Expert:', error);
    return [];
  }
}

// Sync cached assets from Stellar-Expert
async function syncCachedAssets(): Promise<number> {
  try {
    const assets = await fetchStellarExpertAssets();
    let syncedCount = 0;

    for (const asset of assets) {
      const tokenAddress = `${asset.code}:${asset.issuer}`;

      await prisma.cachedAsset.upsert({
        where: { tokenAddress: tokenAddress },
        update: {
          name: asset.name,
          description: asset.description,
          imageUrl: asset.image,
          isVerified: asset.verified || false,
          decimals: asset.decimals || 7,
          lastSyncedAt: new Date(),
        },
        create: {
          tokenAddress: tokenAddress,
          code: asset.code,
          issuer: asset.issuer,
          name: asset.name,
          description: asset.description,
          imageUrl: asset.image,
          isVerified: asset.verified || false,
          decimals: asset.decimals || 7,
          lastSyncedAt: new Date(),
        },
      });

      syncedCount++;
    }

    logger.info(`Synced ${syncedCount} assets from Stellar-Expert`);
    return syncedCount;
  } catch (error) {
    logger.error('Error syncing cached assets:', error);
    return 0;
  }
}

// GET /api/v3/assets/cached - Get cached assets
router.get('/assets/cached', async (req: Request, res: Response) => {
  try {
    const { verified, limit = '100', offset = '0' } = req.query;

    const where = verified === 'true' ? { isVerified: true } : {};
    const assets = await prisma.cachedAsset.findMany({
      where,
      take: Math.min(parseInt(limit as string) || 100, 1000),
      skip: parseInt(offset as string) || 0,
      orderBy: { lastSyncedAt: 'desc' },
    });

    return res.status(200).json(assets);
  } catch (error) {
    logger.error('Error fetching cached assets:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v3/assets/cached/:tokenAddress - Get specific cached asset
router.get('/assets/cached/:tokenAddress', async (req: Request<{ tokenAddress: string }>, res: Response) => {
  try {
    const { tokenAddress } = req.params;

    const asset = await prisma.cachedAsset.findUnique({
      where: { tokenAddress: tokenAddress },
    });

    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    return res.status(200).json(asset);
  } catch (error) {
    logger.error('Error fetching cached asset:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v3/assets/sync - Manually trigger sync (admin only)
router.post('/assets/sync', async (req: Request, res: Response) => {
  try {
    // Verify admin API key
    const apiKey = req.headers['x-admin-key'];
    if (apiKey !== process.env.ADMIN_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const syncedCount = await syncCachedAssets();
    return res.status(200).json({ syncedCount, message: 'Sync completed' });
  } catch (error) {
    logger.error('Error syncing assets:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
export { syncCachedAssets };
