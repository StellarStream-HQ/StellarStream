/**
 * Wallet-Signed JWT Authentication Routes (Issue #483)
 *
 * POST /api/v1/auth/challenge  — issue a one-time nonce
 * POST /api/v1/auth/verify     — verify signed nonce, return JWT
 */

import { Router, Request, Response } from "express";
import { randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import { storeNonce, getStoredNonce, consumeNonce, verifyStellarSignature } from "../lib/signatureAuth.js";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET ?? "change-me-in-production";
const JWT_EXPIRES_IN = "24h";

import { authExponentialBackoffRateLimit } from "../middleware/rateLimit.js";

// ── POST /auth/challenge ──────────────────────────────────────────────────────

const signupLimiter = authExponentialBackoffRateLimit({

  // Signup: 3 attempts / 1 hour
  // then exponential backoff up to 1 hour lockout (max)
  redisKeyBase: 'auth:signup',
  maxAttempts: 3,
  windowSec: 60 * 60,
  baseBackoffSec: 60 * 60, // first backoff = 1 hour when threshold exceeded
  maxBackoffSec: 60 * 60,
});

const loginLimiter = authExponentialBackoffRateLimit({
  // Login: 5 attempts / 15 minutes
  // then exponential backoff starting at 1 hour (max 1 hour)
  redisKeyBase: 'auth:login',
  maxAttempts: 5,
  windowSec: 15 * 60,
  baseBackoffSec: 60 * 60,
  maxBackoffSec: 60 * 60,
});

router.post(
  "/challenge",
  signupLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const { address } = req.body as { address?: string };

    if (!address || !address.startsWith("G") || address.length < 56) {
      res.status(400).json({ error: "Valid Stellar address required" });
      return;
    }

    const nonce = randomBytes(32).toString("hex");
    await storeNonce(nonce);

    res.json({ nonce });
  },
);


// ── POST /auth/verify ─────────────────────────────────────────────────────────

router.post(
  "/verify",
  loginLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const { address, nonce, signature } = req.body as {
      address?: string;
      nonce?: string;
      signature?: string;
    };


    if (!address || !nonce || !signature) {
      res.status(400).json({ error: "address, nonce, and signature are required" });
      return;
    }

    // Ensure nonce exists then consume it (one-time use)
    const stored = await getStoredNonce(nonce);
    const consumed = await consumeNonce(nonce);

    if (!stored || !consumed) {
      res.status(401).json({ error: "Invalid or expired nonce" });
      return;
    }

    const valid = verifyStellarSignature({ address, nonce, signatureBase64: signature });
    if (!valid) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    const token = jwt.sign({ sub: address }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    res.json({ token });
  });

export default router;
