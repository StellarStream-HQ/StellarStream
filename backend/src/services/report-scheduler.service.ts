import { prisma } from '../lib/prisma.js';
import { logger } from '../logger.js';
import { reportGenerationService } from './report-generation.service.js';
import { reportFormatterService } from './report-formatter.service.js';
import { reportStorageService } from './report-storage.service.js';

/**
 * Scheduled Report Configuration
 */
interface ScheduledReportConfig {
  organizationId: string;
  reportType: string;
  frequency: 'daily' | 'monthly' | 'weekly' | 'on_failure';
  timeUtc?: string; // HH:MM format for daily/weekly/monthly
  dayOfMonth?: number; // For monthly (default: last day)
  dayOfWeek?: number; // 0-6, Monday is 1 (for weekly)
  enabled: boolean;
}

/**
 * Report Scheduler Service - manages scheduled report generation
 * Integrates with generation, formatting, and storage services
 * Supports daily, monthly, weekly, and event-triggered scheduling
 */
export class ReportSchedulerService {
  /**
   * Map to track active scheduler timers/intervals
   * Allows graceful shutdown and reconfiguration
   */
  private schedulers: Map<string, NodeJS.Timer> = new Map();

  constructor(
    private db = prisma,
    private log = logger,
    private generationService = reportGenerationService,
    private formatterService = reportFormatterService,
    private storageService = reportStorageService
  ) {}

  /**
   * Initialize and start all scheduled reports for an organization
   * Called on startup to activate all enabled report schedules
   * 
   * @param organizationId - Organization to initialize schedules for
   * @throws Error if scheduler initialization fails
   */
  async initializeSchedulers(organizationId: string): Promise<void> {
    this.log.info('Initializing report schedulers', { organizationId });

    try {
      // Fetch all enabled report configurations for the organization
      const configurations = await this.db.reportConfiguration.findMany({
        where: {
          organizationId,
          enabled: true,
        },
      });

      this.log.info(`Found ${configurations.length} enabled report configurations`, {
        organizationId,
      });

      // Schedule each enabled report type
      for (const config of configurations) {
        const schedule = config.schedule as any;
        
        switch (schedule.frequency) {
          case 'daily':
            await this.scheduleDailyReport(organizationId, config.reportType, schedule.timeUtc || '00:00');
            break;
          case 'monthly':
            await this.scheduleMonthlyReport(
              organizationId,
              config.reportType,
              schedule.dayOfMonth || 1,
              schedule.timeUtc || '00:00'
            );
            break;
          case 'weekly':
            await this.scheduleWeeklyReport(
              organizationId,
              config.reportType,
              schedule.dayOfWeek || 1,
              schedule.timeUtc || '00:00'
            );
            break;
          case 'on_failure':
            this.log.info('Event-triggered report (on_failure) configured - manual triggering required', {
              organizationId,
              reportType: config.reportType,
            });
            break;
        }
      }
    } catch (error) {
      this.log.error('Failed to initialize schedulers', error, { organizationId });
      throw new Error(
        `Scheduler initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Schedule daily report generation at specified UTC time
   * 
   * @param organizationId - Organization for this report
   * @param reportType - Type of report to generate
   * @param timeUtc - Time in HH:MM format (UTC timezone)
   * @throws Error if scheduling fails or time format is invalid
   */
  async scheduleDailyReport(organizationId: string, reportType: string, timeUtc: string): Promise<void> {
    this.log.info('Scheduling daily report', { organizationId, reportType, timeUtc });

    try {
      const [hour, minute] = timeUtc.split(':').map(Number);
      if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        throw new Error(`Invalid time format: ${timeUtc}. Expected HH:MM`);
      }

      const schedulerKey = `daily-${organizationId}-${reportType}`;

      // Clear existing scheduler if present
      if (this.schedulers.has(schedulerKey)) {
        clearInterval(this.schedulers.get(schedulerKey));
      }

      // Calculate initial delay until next scheduled time
      const now = new Date();
      const nextRun = new Date(now);
      nextRun.setUTCHours(hour, minute, 0, 0);

      if (nextRun <= now) {
        nextRun.setUTCDate(nextRun.getUTCDate() + 1);
      }

      const initialDelay = nextRun.getTime() - now.getTime();

      // Schedule first execution
      const timeout = setTimeout(() => {
        this.processScheduledReport(organizationId, reportType);
        
        // Then schedule recurring daily execution
        const interval = setInterval(() => {
          this.processScheduledReport(organizationId, reportType);
        }, 24 * 60 * 60 * 1000); // 24 hours

        this.schedulers.set(schedulerKey, interval);
      }, initialDelay);

      this.log.info('Daily report scheduled', {
        organizationId,
        reportType,
        nextRun: nextRun.toISOString(),
        initialDelayMs: initialDelay,
      });
    } catch (error) {
      this.log.error('Failed to schedule daily report', error, { organizationId, reportType });
      throw new Error(
        `Daily report scheduling failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Schedule monthly report generation on specified day and time
   * 
   * @param organizationId - Organization for this report
   * @param reportType - Type of report to generate
   * @param dayOfMonth - Day of month (1-31), use 0 or 32 for last day
   * @param timeUtc - Time in HH:MM format (UTC timezone)
   * @throws Error if scheduling fails
   */
  async scheduleMonthlyReport(
    organizationId: string,
    reportType: string,
    dayOfMonth: number,
    timeUtc: string
  ): Promise<void> {
    this.log.info('Scheduling monthly report', { organizationId, reportType, dayOfMonth, timeUtc });

    try {
      const [hour, minute] = timeUtc.split(':').map(Number);
      if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        throw new Error(`Invalid time format: ${timeUtc}. Expected HH:MM`);
      }

      const schedulerKey = `monthly-${organizationId}-${reportType}`;

      // Clear existing scheduler if present
      if (this.schedulers.has(schedulerKey)) {
        clearInterval(this.schedulers.get(schedulerKey));
      }

      // Check and run every hour to catch the target day/time
      // (simpler than trying to calculate exact month boundaries)
      const interval = setInterval(async () => {
        const now = new Date();
        const year = now.getUTCFullYear();
        const month = now.getUTCMonth() + 1;

        // Determine target day (last day of month if day >= 32)
        let targetDay = dayOfMonth;
        if (dayOfMonth === 0 || dayOfMonth > 28) {
          // Get last day of month
          const nextMonth = new Date(year, month, 1);
          const lastDayOfMonth = new Date(nextMonth.getTime() - 1).getUTCDate();
          targetDay = lastDayOfMonth;
        }

        // Check if today is the target day and time
        if (
          now.getUTCDate() === targetDay &&
          now.getUTCHours() === hour &&
          now.getUTCMinutes() === minute
        ) {
          this.log.info('Monthly report scheduled time reached', {
            organizationId,
            reportType,
            targetDay,
            now: now.toISOString(),
          });
          await this.processScheduledReport(organizationId, reportType);
        }
      }, 60 * 1000); // Check every minute

      this.schedulers.set(schedulerKey, interval);

      this.log.info('Monthly report scheduler initialized', {
        organizationId,
        reportType,
        dayOfMonth,
        timeUtc,
      });
    } catch (error) {
      this.log.error('Failed to schedule monthly report', error, { organizationId, reportType });
      throw new Error(
        `Monthly report scheduling failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Schedule weekly report generation on specified day and time
   * 
   * @param organizationId - Organization for this report
   * @param reportType - Type of report to generate
   * @param dayOfWeek - Day of week (0=Sunday, 1=Monday, ..., 6=Saturday)
   * @param timeUtc - Time in HH:MM format (UTC timezone)
   * @throws Error if scheduling fails
   */
  async scheduleWeeklyReport(
    organizationId: string,
    reportType: string,
    dayOfWeek: number,
    timeUtc: string
  ): Promise<void> {
    this.log.info('Scheduling weekly report', { organizationId, reportType, dayOfWeek, timeUtc });

    try {
      const [hour, minute] = timeUtc.split(':').map(Number);
      if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        throw new Error(`Invalid time format: ${timeUtc}. Expected HH:MM`);
      }

      if (dayOfWeek < 0 || dayOfWeek > 6) {
        throw new Error(`Invalid day of week: ${dayOfWeek}. Expected 0-6`);
      }

      const schedulerKey = `weekly-${organizationId}-${reportType}`;

      // Clear existing scheduler if present
      if (this.schedulers.has(schedulerKey)) {
        clearInterval(this.schedulers.get(schedulerKey));
      }

      // Check every hour for the target day/time
      const interval = setInterval(async () => {
        const now = new Date();

        if (
          now.getUTCDay() === dayOfWeek &&
          now.getUTCHours() === hour &&
          now.getUTCMinutes() === minute
        ) {
          this.log.info('Weekly report scheduled time reached', {
            organizationId,
            reportType,
            dayOfWeek,
            now: now.toISOString(),
          });
          await this.processScheduledReport(organizationId, reportType);
        }
      }, 60 * 1000); // Check every minute

      this.schedulers.set(schedulerKey, interval);

      this.log.info('Weekly report scheduler initialized', {
        organizationId,
        reportType,
        dayOfWeek,
        timeUtc,
      });
    } catch (error) {
      this.log.error('Failed to schedule weekly report', error, { organizationId, reportType });
      throw new Error(
        `Weekly report scheduling failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get all scheduled reports for an organization
   * 
   * @param organizationId - Organization to query
   * @returns Array of scheduled report configurations
   * @throws Error if database query fails
   */
  async getScheduledReports(organizationId: string): Promise<any[]> {
    this.log.info('Fetching scheduled reports', { organizationId });

    try {
      const configurations = await this.db.reportConfiguration.findMany({
        where: { organizationId },
      });

      return configurations;
    } catch (error) {
      this.log.error('Failed to fetch scheduled reports', error, { organizationId });
      throw new Error(
        `Failed to fetch scheduled reports: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Update schedule for a report type
   * Removes old scheduler and initializes new one
   * 
   * @param organizationId - Organization for this report
   * @param reportType - Type of report to update
   * @param newConfig - New schedule configuration
   * @throws Error if update fails
   */
  async updateSchedule(
    organizationId: string,
    reportType: string,
    newConfig: Partial<ScheduledReportConfig>
  ): Promise<void> {
    this.log.info('Updating report schedule', { organizationId, reportType });

    try {
      // Update database configuration
      await this.db.reportConfiguration.updateMany({
        where: { organizationId, reportType },
        data: {
          schedule: newConfig,
          updatedAt: new Date(),
        },
      });

      // Clear old schedulers for this report type
      this.disableSchedule(organizationId, reportType);

      // Re-initialize if still enabled
      const updatedConfig = await this.db.reportConfiguration.findFirst({
        where: { organizationId, reportType },
      });

      if (updatedConfig?.enabled) {
        await this.initializeSchedulers(organizationId);
      }

      this.log.info('Report schedule updated', { organizationId, reportType });
    } catch (error) {
      this.log.error('Failed to update report schedule', error, { organizationId, reportType });
      throw new Error(
        `Schedule update failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Disable and remove scheduler for a report type
   * Stops report generation for the specified report type
   * 
   * @param organizationId - Organization for this report
   * @param reportType - Type of report to disable
   */
  async disableSchedule(organizationId: string, reportType: string): Promise<void> {
    this.log.info('Disabling report schedule', { organizationId, reportType });

    try {
      // Remove all schedulers for this report type
      const keysToDelete = Array.from(this.schedulers.keys()).filter(
        (key) => key.includes(`${organizationId}-${reportType}`)
      );

      for (const key of keysToDelete) {
        clearInterval(this.schedulers.get(key));
        this.schedulers.delete(key);
      }

      this.log.info('Report schedule disabled', { organizationId, reportType, removedSchedulers: keysToDelete.length });
    } catch (error) {
      this.log.error('Failed to disable schedule', error, { organizationId, reportType });
      throw new Error(
        `Failed to disable schedule: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Process a scheduled report - main execution logic
   * Generates report in background with retry logic
   * Stores result and handles failures
   * 
   * @param organizationId - Organization for this report
   * @param reportType - Type of report to generate
   * @private
   */
  private async processScheduledReport(organizationId: string, reportType: string): Promise<void> {
    this.log.info('Processing scheduled report', { organizationId, reportType });

    let retries = 0;
    const maxRetries = 3;
    let lastError: Error | null = null;

    while (retries < maxRetries) {
      try {
        // Generate report based on type
        let reportData: any;
        const now = new Date();

        switch (reportType) {
          case 'daily_summary':
            reportData = await this.generationService.generateDailyTransactionSummary(organizationId, now);
            break;
          case 'monthly_statement':
            reportData = await this.generationService.generateMonthlyStatement(
              organizationId,
              now.getUTCFullYear(),
              now.getUTCMonth() + 1
            );
            break;
          case 'failed_payment':
            const monthStart = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);
            reportData = await this.generationService.generateFailedPaymentReport(
              organizationId,
              monthStart,
              now
            );
            break;
          case 'fee_analysis':
            const yearStart = new Date(now.getUTCFullYear(), 0, 1);
            reportData = await this.generationService.generateFeeAnalysisReport(
              organizationId,
              yearStart,
              now
            );
            break;
          case 'tax_report':
            reportData = await this.generationService.generateTaxReport(
              organizationId,
              now.getUTCFullYear()
            );
            break;
          default:
            throw new Error(`Unknown report type: ${reportType}`);
        }

        // Format and store report
        await this.formatAndStoreReport(organizationId, reportType, reportData, now);

        // Log success and break retry loop
        this.log.info('Scheduled report processed successfully', {
          organizationId,
          reportType,
          retries,
        });
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        retries++;

        this.log.warn('Scheduled report processing failed, retrying...', {
          organizationId,
          reportType,
          attempt: retries,
          maxRetries,
          error: lastError.message,
        });

        if (retries < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const backoffMs = Math.pow(2, retries - 1) * 1000;
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }

    if (retries === maxRetries && lastError) {
      this.log.error('Scheduled report processing failed after max retries', {
        organizationId,
        reportType,
        maxRetries,
        error: lastError.message,
      });
    }
  }

  /**
   * Format report in multiple formats and store in cloud storage
   * 
   * @param organizationId - Organization for this report
   * @param reportType - Type of report
   * @param reportData - Report data to format and store
   * @param generatedAt - Generation timestamp
   * @private
   */
  private async formatAndStoreReport(
    organizationId: string,
    reportType: string,
    reportData: any,
    generatedAt: Date
  ): Promise<void> {
    try {
      const formats = ['pdf', 'xlsx', 'json', 'csv'];
      const fileUrls: Record<string, string> = {};

      for (const format of formats) {
        try {
          let buffer: Buffer;

          switch (format) {
            case 'pdf':
              buffer = await this.formatterService.formatAsPDF({
                title: `${reportType.toUpperCase()} Report`,
                organizationName: organizationId,
                generatedAt,
                summary: reportData.summary,
                data: reportData.transactions || reportData.failures || [],
              });
              break;
            case 'xlsx':
              buffer = await this.formatterService.formatAsExcel({
                title: `${reportType.toUpperCase()} Report`,
                organizationName: organizationId,
                generatedAt,
                summary: reportData.summary,
                data: reportData.transactions || reportData.failures || [],
              });
              break;
            case 'json':
              buffer = await this.formatterService.formatAsJSON(reportData);
              break;
            case 'csv':
              buffer = await this.formatterService.formatAsCSV({
                title: `${reportType.toUpperCase()} Report`,
                organizationName: organizationId,
                generatedAt,
                data: reportData.transactions || reportData.failures || [],
              });
              break;
            default:
              continue;
          }

          // Store formatted report
          const urls = await this.storageService.storeReport(organizationId, reportType, {
            [format]: buffer,
          });

          fileUrls[format] = urls[format];
        } catch (error) {
          this.log.warn(`Failed to format/store ${format} report`, error, {
            organizationId,
            reportType,
          });
        }
      }

      // Create report record in database
      const { v4: uuidv4 } = await import('uuid');
      await this.db.report.create({
        data: {
          id: uuidv4(),
          organizationId,
          reportType: reportType as any,
          periodStart: new Date(generatedAt.getUTCFullYear(), generatedAt.getUTCMonth(), 1),
          periodEnd: generatedAt,
          generatedAt,
          generatedBy: 'system',
          status: 'generated',
          fileUrls,
          summary: reportData.summary,
          reconciliationStatus: reportData.reconciliation || null,
        },
      });
    } catch (error) {
      this.log.error('Failed to format and store report', error, { organizationId, reportType });
      throw error;
    }
  }

  /**
   * Gracefully shutdown all schedulers
   * Called on application shutdown
   */
  async shutdown(): Promise<void> {
    this.log.info('Shutting down report schedulers');

    for (const [key, timer] of this.schedulers.entries()) {
      clearInterval(timer);
      this.log.debug('Cleared scheduler', { key });
    }

    this.schedulers.clear();
    this.log.info('All report schedulers shut down');
  }
}

/**
 * Singleton export for use throughout application
 */
export const reportSchedulerService = new ReportSchedulerService();
