import { startServer } from "./api/server.js";
import { getDatabase } from "./db/storage.js";
import { EventIndexer } from "./indexer/event-indexer.js";
import { MetricsProcessor } from "./processor/metrics-processor.js";
import { RetentionManager } from "./db/retention.js";

export {
  getDatabase,
  EventIndexer,
  MetricsProcessor,
  RetentionManager,
  startServer,
};

// If run directly via node or tsx
if (process.argv[1] && (process.argv[1].endsWith("index.ts") || process.argv[1].endsWith("index.js"))) {
  const port = parseInt(process.env.PORT || "4000", 10);
  startServer(port);
}
