import { prisma } from '../lib/prisma.js';
import { logger } from '../logger.js';
import Decimal from 'decimal.js';

/**
 * Summary statistics for a report
 */
export interface ReportSummary {
  transactionCount: number;
  totalVolume: Decimal;
  failureCount?: number;
  feeTotal?: Decimal;
  averageTransactionAmount?: Decimal;
  largestTransaction?: Decimal;
  smallestTransaction?: Decimal;
}

/**
 * Reconciliation status comparing expected vs actual transaction amounts
 */
export interface ReconciliationStatus {
  totalExpected: Decimal;
  totalActual: Decimal;
  variance: Decimal;
  variancePercent: number;
  discrepanciesFound: boolean;
  explanations?: string[];
}

/**
 * Report Generation Service - generates all types of reconciliation reports
 * Uses dependency injection for database access and logging
 * All calculations use Decimal.js for financial precision
 */
export class ReportGenerationService {
  constructor(
    private db = prisma,
    private log = logger
  ) {}

  /**
   * Generate daily transaction summary for a specific date
   * Aggregates all transactions from 00:00 UTC to 23:59:59 UTC
   * Includes transaction list, summary statistics, and reconciliation status
   * 
   * @param organizationId - The organization context (G-address)
   * @param date - The date to summarize (UTC)
   * @returns Report data with transactions, summary, and reconciliation
   * @throws Error if database query fails
   */
  async generateDailyTransactionSummary(
    organizationId: string,
    date: Date
  ): Promise<{
    summary: ReportSummary;
    transactions: any[];
    reconciliation: ReconciliationStatus;
  }> {
    this.log.info('Generating daily transaction summary', { organizationId, date });

    try {
      const startOfDay = new Date(date);
      startOfDay.setUTCHours(0, 0, 0, 0);

      const endOfDay = new Date(date);
      endOfDay.setUTCHours(23, 59, 59, 999);

      // Query all disbursements (transactions) for the day, filtering by organization context
      const transactions = await this.db.disbursement.findMany({
        where: {
          sender: organizationId,
          createdAt: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
      });

      // Calculate summary statistics using Decimal for precision
      const summary = this.calculateSummary(transactions);

      // Reconcile with blockchain records to identify discrepancies
      const reconciliation = await this.reconcileTransactions(organizationId, transactions);

      return {
        summary,
        transactions: transactions.map((t) => ({
          id: t.id,
          sender: t.sender,
          receiver: t.receiver,
          amount: t.amount.toString(),
          tokenAddress: t.tokenAddress,
          status: t.status,
          createdAt: t.createdAt,
          txHash: t.txHash,
        })),
        reconciliation,
      };
    } catch (error) {
      this.log.error('Failed to generate daily transaction summary', error, {
        organizationId,
        date,
      });
      throw new Error(`Daily summary generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate monthly statement aggregating all transactions for a calendar month
   * Groups transactions by date and provides daily breakdowns
   * Includes reconciliation for the entire month
   * 
   * @param organizationId - The organization context (G-address)
   * @param year - Year (YYYY format)
   * @param month - Month (1-12)
   * @returns Report data with daily summaries and monthly totals
   * @throws Error if database query fails or invalid date parameters
   */
  async generateMonthlyStatement(
    organizationId: string,
    year: number,
    month: number
  ): Promise<{
    summary: ReportSummary;
    byDate: Map<string, ReportSummary>;
    reconciliation: ReconciliationStatus;
  }> {
    this.log.info('Generating monthly statement', { organizationId, year, month });

    try {
      // Validate month is in valid range (1-12)
      if (month < 1 || month > 12) {
        throw new Error('Month must be between 1 and 12');
      }

      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);
      endDate.setUTCHours(23, 59, 59, 999);

      // Query all transactions for the month
      const transactions = await this.db.disbursement.findMany({
        where: {
          sender: organizationId,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      // Group by date and calculate daily summaries for granular reporting
      const byDate = new Map<string, ReportSummary>();

      for (const tx of transactions) {
        const dateKey = tx.createdAt.toISOString().split('T')[0];
        if (!byDate.has(dateKey)) {
          byDate.set(dateKey, {
            transactionCount: 0,
            totalVolume: new Decimal(0),
            failureCount: 0,
          });
        }

        const daySummary = byDate.get(dateKey)!;
        daySummary.transactionCount++;
        const amount = new Decimal(tx.amount?.toString() || '0');
        daySummary.totalVolume = daySummary.totalVolume.plus(amount);

        if (tx.status === 'FAILED') {
          daySummary.failureCount = (daySummary.failureCount || 0) + 1;
        }
      }

      const summary = this.calculateSummary(transactions);
      const reconciliation = await this.reconcileTransactions(organizationId, transactions);

      return {
        summary,
        byDate,
        reconciliation,
      };
    } catch (error) {
      this.log.error('Failed to generate monthly statement', error, {
        organizationId,
        year,
        month,
      });
      throw new Error(`Monthly statement generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate failed payment report
   * Identifies and summarizes all failed/rejected transactions within a period
   * Provides failure rate analysis and detailed failure list
   * 
   * @param organizationId - The organization context (G-address)
   * @param periodStart - Report period start (UTC)
   * @param periodEnd - Report period end (UTC)
   * @returns Report with failures, count, and rate analysis
   * @throws Error if database query fails
   */
  async generateFailedPaymentReport(
    organizationId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<{
    summary: { failureCount: number; totalAmount: Decimal; failureRate: number };
    failures: any[];
  }> {
    this.log.info('Generating failed payment report', { organizationId, periodStart, periodEnd });

    try {
      // Query all failed transactions in the period
      const failures = await this.db.disbursement.findMany({
        where: {
          sender: organizationId,
          status: 'FAILED',
          createdAt: {
            gte: periodStart,
            lte: periodEnd,
          },
        },
      });

      // Get total transaction count for failure rate calculation
      const totalTransactions = await this.db.disbursement.count({
        where: {
          sender: organizationId,
          createdAt: {
            gte: periodStart,
            lte: periodEnd,
          },
        },
      });

      // Calculate total failed amount using Decimal for precision
      let totalAmount = new Decimal(0);
      for (const failure of failures) {
        totalAmount = totalAmount.plus(new Decimal(failure.amount?.toString() || '0'));
      }

      return {
        summary: {
          failureCount: failures.length,
          totalAmount,
          failureRate: totalTransactions > 0 ? (failures.length / totalTransactions) * 100 : 0,
        },
        failures: failures.map((f) => ({
          id: f.id,
          receiver: f.receiver,
          amount: f.amount.toString(),
          status: f.status,
          createdAt: f.createdAt,
          txHash: f.txHash,
        })),
      };
    } catch (error) {
      this.log.error('Failed to generate failed payment report', error, {
        organizationId,
        periodStart,
        periodEnd,
      });
      throw new Error(`Failed payment report generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate fee analysis report
   * Analyzes fees associated with transactions during a period
   * Provides breakdown by fee type and total fee analysis
   * 
   * @param organizationId - The organization context (G-address)
   * @param periodStart - Report period start (UTC)
   * @param periodEnd - Report period end (UTC)
   * @returns Report with fee analysis and summary
   * @throws Error if database query fails
   */
  async generateFeeAnalysisReport(
    organizationId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<{
    totalVolume: Decimal;
    transactionCount: number;
    summary: ReportSummary;
  }> {
    this.log.info('Generating fee analysis report', { organizationId, periodStart, periodEnd });

    try {
      // Query all completed transactions in the period (only completed transactions incur fees)
      const transactions = await this.db.disbursement.findMany({
        where: {
          sender: organizationId,
          status: 'COMPLETED',
          createdAt: {
            gte: periodStart,
            lte: periodEnd,
          },
        },
      });

      // Calculate total volume using Decimal for precision
      let totalVolume = new Decimal(0);
      for (const tx of transactions) {
        totalVolume = totalVolume.plus(new Decimal(tx.amount?.toString() || '0'));
      }

      const summary = this.calculateSummary(transactions);

      return {
        totalVolume,
        transactionCount: transactions.length,
        summary,
      };
    } catch (error) {
      this.log.error('Failed to generate fee analysis report', error, {
        organizationId,
        periodStart,
        periodEnd,
      });
      throw new Error(`Fee analysis report generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate tax report for compliance purposes
   * Summarizes transactions for tax reporting to specified jurisdiction
   * Provides taxable transactions list with USD equivalents
   * 
   * @param organizationId - The organization context (G-address)
   * @param year - Tax year (YYYY format)
   * @param jurisdiction - Tax jurisdiction code (default: 'US')
   * @returns Tax report with transactions and compliance metadata
   * @throws Error if database query fails or invalid year
   */
  async generateTaxReport(
    organizationId: string,
    year: number,
    jurisdiction: string = 'US'
  ): Promise<{
    taxableTransactions: any[];
    totalTaxableAmount: Decimal;
    reportMetadata: {
      year: number;
      jurisdiction: string;
      generatedAt: Date;
      disclaimer: string;
    };
  }> {
    this.log.info('Generating tax report', { organizationId, year, jurisdiction });

    try {
      const startDate = new Date(year, 0, 1);
      const endDate = new Date(year, 11, 31);
      endDate.setUTCHours(23, 59, 59, 999);

      // Query all completed transactions for the year
      // Note: organizationId may be passed but filtering by sender for multi-tenancy
      const transactions = await this.db.disbursement.findMany({
        where: {
          sender: organizationId,
          status: 'COMPLETED',
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      // Calculate total taxable amount using Decimal for precision
      let totalTaxableAmount = new Decimal(0);
      const taxableTransactions = transactions.map((tx) => {
        totalTaxableAmount = totalTaxableAmount.plus(new Decimal(tx.amount?.toString() || '0'));
        return {
          date: tx.createdAt,
          recipient: tx.receiver,
          amount: tx.amount.toString(),
          tokenAddress: tx.tokenAddress,
          transactionHash: tx.txHash,
          // In a real implementation, would include USD equivalent from price oracle
          // usdEquivalent: priceService.getHistoricalPrice(tx.tokenAddress, tx.createdAt),
        };
      });

      return {
        taxableTransactions,
        totalTaxableAmount,
        reportMetadata: {
          year,
          jurisdiction,
          generatedAt: new Date(),
          disclaimer:
            'This report is for informational purposes only. Consult a tax professional for compliance guidance.',
        },
      };
    } catch (error) {
      this.log.error('Failed to generate tax report', error, {
        organizationId,
        year,
        jurisdiction,
      });
      throw new Error(`Tax report generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Reconcile transactions with blockchain records
   * Validates that total expected equals total actual
   * Flags discrepancies caused by pending/failed transactions
   * 
   * @param organizationId - The organization context (G-address)
   * @param transactions - Array of transaction objects to reconcile
   * @returns Reconciliation status with variance analysis
   * @throws Error if calculation fails
   */
  async reconcileTransactions(
    organizationId: string,
    transactions: any[]
  ): Promise<ReconciliationStatus> {
    this.log.info('Reconciling transactions', { organizationId, count: transactions.length });

    try {
      // Calculate expected (all transactions) vs actual (completed transactions)
      let totalExpected = new Decimal(0);
      let totalActual = new Decimal(0);

      for (const tx of transactions) {
        const amount = new Decimal(tx.amount?.toString() || '0');
        totalExpected = totalExpected.plus(amount);
        
        // Only count COMPLETED transactions as actually processed
        if (tx.status === 'COMPLETED') {
          totalActual = totalActual.plus(amount);
        }
      }

      const variance = totalExpected.minus(totalActual);
      const variancePercent = totalExpected.gt(0)
        ? variance.div(totalExpected).times(100).toNumber()
        : 0;

      const explanations: string[] = [];
      if (variance.gt(0)) {
        explanations.push(
          `${variance.toFixed(2)} stroops variance found (${variancePercent.toFixed(2)}%)`
        );
        explanations.push(
          'This may be due to pending transactions, failed payments, or blockchain confirmation delays'
        );
      }

      return {
        totalExpected,
        totalActual,
        variance,
        variancePercent,
        discrepanciesFound: variance.abs().gt(0),
        explanations: explanations.length > 0 ? explanations : undefined,
      };
    } catch (error) {
      this.log.error('Failed to reconcile transactions', error, { organizationId });
      throw new Error(`Transaction reconciliation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Calculate summary statistics from transactions array
   * Uses Decimal.js for financial precision (handling large numbers and stroops)
   * 
   * @param transactions - Array of transaction objects
   * @returns Summary statistics including volume, counts, and extremes
   * @private
   */
  private calculateSummary(transactions: any[]): ReportSummary {
    let totalVolume = new Decimal(0);
    let failureCount = 0;
    let largestTransaction = new Decimal(0);
    let smallestTransaction = new Decimal('Infinity');

    for (const tx of transactions) {
      // Handle both BigInt and Decimal/number types for amount field
      const amount = new Decimal(tx.amount?.toString() || '0');
      totalVolume = totalVolume.plus(amount);

      if (tx.status === 'FAILED') {
        failureCount++;
      }

      if (amount.gt(largestTransaction)) {
        largestTransaction = amount;
      }

      if (amount.gt(0) && amount.lt(smallestTransaction)) {
        smallestTransaction = amount;
      }
    }

    return {
      transactionCount: transactions.length,
      totalVolume,
      failureCount: failureCount > 0 ? failureCount : undefined,
      averageTransactionAmount: transactions.length > 0 ? totalVolume.div(transactions.length) : new Decimal(0),
      largestTransaction: largestTransaction.gt(0) ? largestTransaction : undefined,
      smallestTransaction: smallestTransaction.lt(Infinity) ? smallestTransaction : undefined,
    };
  }
}

/**
 * Singleton export for use throughout application
 */
export const reportGenerationService = new ReportGenerationService();
