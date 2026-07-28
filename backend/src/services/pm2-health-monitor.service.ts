// import pm2 from "pm2";
import { logger } from "../logger.js";

/**
 * PM2 Health Monitor - Tracks process health and auto-restarts on memory spikes
 */
export class PM2HealthMonitor {
  private memoryThreshold: number = 500 * 1024 * 1024; // 500MB
  private checkInterval: number = 30000; // 30 seconds
  private intervalId: NodeJS.Timeout | null = null;

  constructor(memoryThresholdMB: number = 500) {
    this.memoryThreshold = memoryThresholdMB * 1024 * 1024;
  }

  /**
   * Start monitoring PM2 processes
   */
  start(): void {
    pm2.connect((err: any) => {
      if (err) {
        logger.error("Failed to connect to PM2:", err);
        return;
      }

      logger.info("PM2 Health Monitor started");

      this.intervalId = setInterval(() => {
        this.checkProcessHealth();
      }, this.checkInterval);
    });
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    pm2.disconnect();
    logger.info("PM2 Health Monitor stopped");
  }

  /**
   * Check health of all processes
   */
  private checkProcessHealth(): void {
    pm2.list((err: any, processes: any) => {
      if (err) {
        logger.error("Failed to list PM2 processes:", err);
        return;
      }

      processes.forEach((proc: any) => {
        const memoryUsage = proc.monit?.memory || 0;
        const cpuUsage = proc.monit?.cpu || 0;

        // Log memory usage
        logger.debug(`Process ${proc.name}: Memory=${(memoryUsage / 1024 / 1024).toFixed(2)}MB, CPU=${cpuUsage}%`);

        // Restart if memory exceeds threshold
        if (memoryUsage > this.memoryThreshold) {
          logger.warn(
            `Memory spike detected for ${proc.name}: ${(memoryUsage / 1024 / 1024).toFixed(2)}MB > ${(this.memoryThreshold / 1024 / 1024).toFixed(2)}MB`,
          );
          this.restartProcess(proc.name);
        }

        // Alert on high CPU
        if (cpuUsage > 90) {
          logger.warn(`High CPU usage for ${proc.name}: ${cpuUsage}%`);
        }
      });
    });
  }

  /**
   * Restart a process gracefully
   */
  private restartProcess(processName: string): void {
    pm2.restart(processName, (err: any) => {
      if (err) {
        logger.error(`Failed to restart ${processName}:`, err);
      } else {
        logger.info(`Process ${processName} restarted due to memory spike`);
      }
    });
  }
}

export const pm2Monitor = new PM2HealthMonitor();
