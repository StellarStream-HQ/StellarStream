import { Router, Request, Response } from 'express';
import { prisma } from '../../lib/db.js';
import { createHash } from 'crypto';
import { logger } from '../../logger.js';

const router = Router();

// Base62 encoding for URL-friendly slugs
const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function encodeBase62(num: number): string {
  if (num === 0) return '0';
  let slug = '';
  while (num > 0) {
    slug = BASE62_CHARS[num % 62] + slug;
    num = Math.floor(num / 62);
  }
  return slug;
}

// Generate payload hash
function generatePayloadHash(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}

interface CreateSplitLinkRequest {
  fullUrl: string;
  creatorAddress: string;
  expiresAt?: string;
}

interface SplitLinkResponse {
  id: string;
  slug: string;
  fullUrl: string;
  shortUrl: string;
  creatorAddress: string;
  clickCount: number;
  createdAt: string;
  expiresAt?: string;
}

// POST /api/v3/split-links - Create shortened link
router.post('/split-links', async (req: Request<{}, {}, CreateSplitLinkRequest>, res: Response) => {
  try {
    const { fullUrl, creatorAddress, expiresAt } = req.body;

    if (!fullUrl || !creatorAddress) {
      return res.status(400).json({
        error: 'Missing required fields: fullUrl, creatorAddress',
      });
    }

    // Check if URL already shortened
    const payloadHash = generatePayloadHash(fullUrl);
    const existing = await prisma.splitLink.findUnique({
      where: { payloadHash: payloadHash },
    });

    if (existing) {
      const response: SplitLinkResponse = {
        id: existing.id,
        slug: existing.slug,
        fullUrl: existing.fullUrl,
        shortUrl: `${process.env.FRONTEND_URL || 'https://stellarstream.app'}/s/${existing.slug}`,
        creatorAddress: existing.creatorAddress,
        clickCount: existing.clickCount,
        createdAt: existing.createdAt.toISOString(),
        expiresAt: existing.expiresAt?.toISOString(),
      };
      return res.status(200).json(response);
    }

    // Generate unique slug
    let slug: string | null = null;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 100;

    while (!isUnique && attempts < maxAttempts) {
      const randomNum = Math.floor(Math.random() * 1000000000);
      slug = encodeBase62(randomNum);

      const existing = await prisma.splitLink.findUnique({
        where: { slug },
      });

      if (!existing) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique || !slug) {
      return res.status(500).json({ error: 'Failed to generate unique slug' });
    }

    const link = await prisma.splitLink.create({
      data: {
        slug,
        fullUrl: fullUrl,
        payloadHash: payloadHash,
        creatorAddress: creatorAddress,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    const response: SplitLinkResponse = {
      id: link.id,
      slug: link.slug,
      fullUrl: link.fullUrl,
      shortUrl: `${process.env.FRONTEND_URL || 'https://stellarstream.app'}/s/${link.slug}`,
      creatorAddress: link.creatorAddress,
      clickCount: link.clickCount,
      createdAt: link.createdAt.toISOString(),
      expiresAt: link.expiresAt?.toISOString(),
    };

    return res.status(201).json(response);
  } catch (error) {
    logger.error('Error creating split link:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /s/:slug - Redirect to full URL
router.get('/s/:slug', async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const { slug } = req.params;

    const link = await prisma.splitLink.findUnique({
      where: { slug },
    });

    if (!link) {
      return res.status(404).json({ error: 'Link not found' });
    }

    // Check expiration
    if (link.expiresAt && link.expiresAt < new Date()) {
      return res.status(410).json({ error: 'Link has expired' });
    }

    // Increment click count
    await prisma.splitLink.update({
      where: { id: link.id },
      data: {
        clickCount: link.clickCount + 1,
        lastClickedAt: new Date(),
      },
    });

    // Redirect to full URL
    return res.redirect(302, link.fullUrl);
  } catch (error) {
    logger.error('Error redirecting split link:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v3/split-links/:slug - Get link info (returns 401 if password-protected and no valid token)
router.get('/split-links/:slug', async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const { slug } = req.params;

    const link = await prisma.splitLink.findUnique({ where: { slug } });

    if (!link) {
      return res.status(404).json({ error: 'Link not found' });
    }

    // If password-protected, require a valid unlock token in the Authorization header
    if (link.passwordHash) {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const expectedToken = createHash('sha256')
        .update(`${link.id}:${link.passwordHash}:${process.env.JWT_SECRET ?? 'secret'}`)
        .digest('hex');

      if (token !== expectedToken) {
        return res.status(401).json({ error: 'Password required', passwordProtected: true });
      }
    }

    const response: SplitLinkResponse = {
      id: link.id,
      slug: link.slug,
      fullUrl: link.fullUrl,
      shortUrl: `${process.env.FRONTEND_URL || 'https://stellarstream.app'}/s/${link.slug}`,
      creatorAddress: link.creatorAddress,
      clickCount: link.clickCount,
      createdAt: link.createdAt.toISOString(),
      expiresAt: link.expiresAt?.toISOString(),
    };

    return res.status(200).json(response);
  } catch (error) {
    logger.error('Error fetching split link:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v3/split-links/:slug/unlock - Verify password, return access token
router.post('/split-links/:slug/unlock', async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const { slug } = req.params;
    const { password } = req.body as { password?: string };

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    const link = await prisma.splitLink.findUnique({ where: { slug } });

    if (!link) {
      return res.status(404).json({ error: 'Link not found' });
    }

    if (!link.passwordHash) {
      return res.status(400).json({ error: 'This link is not password-protected' });
    }

    const submittedHash = createHash('sha256').update(password).digest('hex');

    if (submittedHash !== link.passwordHash) {
      return res.status(403).json({ error: 'Incorrect password' });
    }

    // Derive a deterministic access token from the link id + stored hash + server secret
    const accessToken = createHash('sha256')
      .update(`${link.id}:${link.passwordHash}:${process.env.JWT_SECRET ?? 'secret'}`)
      .digest('hex');

    return res.status(200).json({ accessToken });
  } catch (error) {
    logger.error('Error unlocking split link:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
