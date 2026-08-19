import { WebhookDispatcherService } from "./services/webhook-dispatcher.service.js";
import { logger } from "./logger.js";

const webhookService = new WebhookDispatcherService();

const DEFAULT_POLL_INTERVAL_MS = 10_000;

let timer: NodeJS.Timeout | null = null;
let running = false;

function resolvePollIntervalMs(): number {
  const configured = Number(process.env.WEBHOOK_WORKER_INTERVAL_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_POLL_INTERVAL_MS;
}

/**
 * Background worker that drains the webhook delivery queue, applying
 * exponential backoff and dead lettering exhausted deliveries.
 *
 * Ticks are guarded by a re-entrancy flag: a slow batch never overlaps with the
 * next interval, which would otherwise let two ticks contend for the same rows.
 */
export async function startWebhookWorker(): Promise<void> {
  const intervalMs = resolvePollIntervalMs();

  logger.info(`Starting webhook dispatcher worker (every ${intervalMs}ms)`);

  timer = setInterval(async () => {
    if (running) {
      logger.debug("Webhook dispatcher tick skipped, previous run still active");
      return;
    }

    running = true;
    try {
      await webhookService.processDeliveries();
    } catch (error) {
      logger.error("Error in webhook dispatcher worker", error);
    } finally {
      running = false;
    }
  }, intervalMs);

  // Do not hold the event loop open on shutdown.
  timer.unref?.();
}

export function stopWebhookWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info("Webhook dispatcher worker stopped");
  }
}
