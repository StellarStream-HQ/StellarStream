import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { storeNonce } from '../lib/signatureAuth.js';

const NONCE_BYTES = 32;

/**
 * @swagger
 * /api/v1/auth/nonce:
 *   get:
 *     summary: Get a one-time authentication nonce
 *     description: Issues a one-time nonce for challenge-response wallet authentication. The client must sign this nonce with their Stellar private key and include it in subsequent authenticated requests.
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Nonce issued successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *             example:
 *               nonce: a3f8c2e1d4b7...
 *       503:
 *         description: Unable to issue nonce
 *         content:
 *           application/json:
 *             example:
 *               error: Service Unavailable
 *               message: Unable to issue nonce. Try again later.
 */
export async function getNonce(_req: Request, res: Response): Promise<void> {
  try {
    const nonce = randomBytes(NONCE_BYTES).toString('hex');
    await storeNonce(nonce);
    res.json({ nonce });
  } catch {
    res.status(503).json({
      error: 'Service Unavailable',
      message: 'Unable to issue nonce. Try again later.',
    });
  }
}

/**
 * @swagger
 * /api/v1/auth/me:
 *   get:
 *     summary: Get authenticated wallet address
 *     description: Returns the Stellar address of the currently authenticated wallet. Requires `X-Stellar-Address`, `X-Auth-Nonce`, and `X-Auth-Signature` request headers.
 *     tags: [Auth]
 *     security:
 *       - walletAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Stellar-Address
 *         required: true
 *         schema:
 *           type: string
 *           example: GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
 *       - in: header
 *         name: X-Auth-Nonce
 *         required: true
 *         schema:
 *           type: string
 *           example: a3f8c2e1d4b7...
 *       - in: header
 *         name: X-Auth-Signature
 *         required: true
 *         schema:
 *           type: string
 *           example: base64-encoded-signature
 *     responses:
 *       200:
 *         description: Authenticated address returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *             example:
 *               address: GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
 *       401:
 *         description: Unauthorized — missing or invalid authentication headers
 *         content:
 *           application/json:
 *             example:
 *               error: Unauthorized
 *               message: Invalid or expired signature
 */
export function getMe(req: Request, res: Response): void {
  res.json({ address: req.walletAddress });
}
