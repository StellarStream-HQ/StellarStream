import express, { type Request, type Response } from "express";
import { config } from "../config";
import { v1DeprecationWarning } from "../src/middleware/deprecationWarning";
import streamsRouter from "./streams";

const app = express();
app.use(express.json());

// ── V1 deprecation notice ─────────────────────────────────────────────────────
app.use("/api", v1DeprecationWarning);

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Stream list API ───────────────────────────────────────────────────────────
app.use("/api/streams", streamsRouter);

// ── 404 fallback ──────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

export function startServer(): void {
  app.listen(config.apiPort, () => {
    console.log(`[API] Listening on http://localhost:${config.apiPort}`);
    console.log(`[API] GET /api/streams?limit=20&after=<cursor>`);
    console.log(`[API] GET /api/streams/:id`);
  });
}

export default app;
