import { Router, Request, Response } from "express";
import { Horizon } from "@stellar/stellar-sdk";
import { executeDb, checkDbConnection, getDbHealthState } from "../lib/database-health.js";

const router = Router();

router.get("/health/sync", async (req: Request, res: Response) => {
  const correlationId = req.id;

  const horizonUrl =
    process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
  const server = new Horizon.Server(horizonUrl);

  try {
    // Horizon read is independent of DB.
    const ledgerResponse = await server.ledgers().order("desc").limit(1).call();
    const currentNetworkLedger = ledgerResponse.records[0]?.sequence ?? 0;

    const dbOk = await checkDbConnection(correlationId);
    if (!dbOk) {
      const { state } = getDbHealthState();
      return res.status(503).json({
        current_network_ledger: currentNetworkLedger,
        indexed_ledger: null,
        difference: null,
        database: "disconnected",
        mode: "read-only",
        circuit: state,
      });
    }

    const syncState = await executeDb(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require("../lib/db.js").prisma.syncState.findUnique({
          where: { id: 1 },
        });
      },
      correlationId,
    );

    const indexedLedger = syncState?.lastLedgerSequence ?? 0;

    const difference = currentNetworkLedger - indexedLedger;

    return res.json({
      current_network_ledger: currentNetworkLedger,
      indexed_ledger: indexedLedger,
      difference,
      database: "connected",
    });
  } catch {
    return res.status(500).json({ error: "Failed to fetch sync status" });
  }
});

export default router;

