import { Router } from "express";
import { Horizon } from "@stellar/stellar-sdk";
import { logger } from "../../logger.js";

const router = Router();
const horizonUrl = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const server = new Horizon.Server(horizonUrl);

interface RecipientValidation {
  index: number;
  address: string;
  exists: boolean;
  hasTrustline: boolean;
  error?: string;
}

/**
 * POST /api/v3/validate-split
 * 
 * Validates a list of up to 120 recipients before transaction submission.
 * Checks:
 * 1. If recipient addresses exist on the network
 * 2. If recipients have trustlines for the specified asset
 * 
 * Returns detailed error object specifying which row indices are invalid.
 */
router.post("/validate-split", async (req: Request, res: Response): Promise<void> => {
  try {
    const { recipients, asset } = req.body;

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: "recipients array is required" });
    }

    if (recipients.length > 120) {
      return res.status(400).json({ error: "Maximum 120 recipients allowed" });
    }

    if (!asset || typeof asset !== "string") {
      return res.status(400).json({ error: "asset is required" });
    }

    const results: RecipientValidation[] = [];
    const invalidIndices: number[] = [];

    // Batch validate all recipients
    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const address = typeof recipient === "string" ? recipient : recipient.address;

      if (!address) {
        results.push({
          index: i,
          address: "",
          exists: false,
          hasTrustline: false,
          error: "Missing address",
        });
        invalidIndices.push(i);
        continue;
      }

      try {
        const account = await server.loadAccount(address);
        
        // Check trustline for non-native assets
        let hasTrustline = true;
        if (asset !== "native") {
          const [code, issuer] = asset.split(":");
          hasTrustline = account.balances.some(
            (b) => {
              if (b.asset_type === "native") return false;
              if (b.asset_type === "liquidity_pool_shares") return false;
              const creditBalance = b as any;
              return creditBalance.asset_code === code && creditBalance.asset_issuer === issuer;
            }
          );
        }

        results.push({
          index: i,
          address,
          exists: true,
          hasTrustline,
        });

        if (!hasTrustline) {
          invalidIndices.push(i);
        }
      } catch (err: any) {
        const notFound = err?.response?.status === 404;
        results.push({
          index: i,
          address,
          exists: !notFound,
          hasTrustline: false,
          error: notFound ? "Account not found" : err.message,
        });
        invalidIndices.push(i);
      }
    }

    const isValid = invalidIndices.length === 0;

    return res.json({
      valid: isValid,
      totalRecipients: recipients.length,
      validCount: recipients.length - invalidIndices.length,
      invalidCount: invalidIndices.length,
      invalidIndices,
      results,
    });
  } catch (err) {
    logger.error("[ValidateSplit] Error", { err });
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
