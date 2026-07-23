import { AnomalyType, AnomalySeverity } from '../generated/client/index.js';
import { logger } from '../logger.js';
import { prisma } from '../lib/db.js';
import { kmeans } from 'ml-kmeans';

export interface TransactionData {
  amount: number;
  senderAddress: string;
  receiverAddress: string;
  timestamp: Date;
  streamId?: string;
  disbursementId?: string;
  // For geographic detection (we'll need to infer from available data)
  metadata?: {
    ipAddress?: string;
    location?: { lat: number; lon: number };
    deviceId?: string;
  };
}

export class AnomalyDetectionService {
  // Calculate mean and standard deviation
  private static calculateStats(values: number[]): { mean: number; stdDev: number } {
    if (values.length === 0) return { mean: 0, stdDev: 0 };
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    return { mean, stdDev };
  }

  // 1. Detect unusual amount (using Z-score)
  public static async detectUnusualAmount(transaction: TransactionData): Promise<boolean> {
    try {
      // Get historical transactions from the same sender (using SplitLog first since that's available)
      const historicalSplits = await prisma.splitLog.findMany({
        where: { sender: transaction.senderAddress },
        select: { amount: true }
      });
      const historicalAmounts = historicalSplits.map(d => Number(d.amount));
      
      if (historicalAmounts.length < 5) return false; // Not enough data

      const { mean, stdDev } = this.calculateStats(historicalAmounts);
      const zScore = (transaction.amount - mean) / (stdDev || 1); // Avoid division by zero
      
      if (Math.abs(zScore) > 3) { // 3 sigma rule
        await this.createAnomaly(
          AnomalyType.UNUSUAL_AMOUNT,
          AnomalySeverity.HIGH,
          `Unusual amount detected: ${transaction.amount} (z-score: ${zScore.toFixed(2)})`,
          Math.min(Math.abs(zScore) / 5, 1), // Confidence 0-1
          { mean, stdDev, zScore },
          transaction
        );
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Error detecting unusual amount:', error);
      return false;
    }
  }

  // 2. Detect velocity anomalies (too many transactions in short time)
  public static async detectVelocityAnomaly(transaction: TransactionData): Promise<boolean> {
    try {
      const oneHourAgo = new Date(transaction.timestamp.getTime() - 60 * 60 * 1000);
      
      const recentCount = await prisma.splitLog.count({
        where: { 
          sender: transaction.senderAddress,
          executedAt: { gte: oneHourAgo }
        }
      });

      if (recentCount > 10) { // Threshold: more than 10 transactions per hour
        await this.createAnomaly(
          AnomalyType.VELOCITY,
          AnomalySeverity.MEDIUM,
          `High transaction velocity: ${recentCount} transactions in last hour`,
          Math.min(recentCount / 30, 1),
          { recentCount, timeWindow: '1h' },
          transaction
        );
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Error detecting velocity anomaly:', error);
      return false;
    }
  }

  // 3. Detect suspicious patterns (e.g., sending to many new addresses quickly)
  public static async detectSuspiciousPattern(transaction: TransactionData): Promise<boolean> {
    try {
      const oneDayAgo = new Date(transaction.timestamp.getTime() - 24 * 60 * 60 * 1000);
      
      const recentReceivers = await prisma.splitLog.findMany({
        where: { 
          sender: transaction.senderAddress,
          executedAt: { gte: oneDayAgo }
        },
        select: { receiver: true },
        distinct: ['receiver']
      });

      const newReceiversCount = recentReceivers.length;
      if (newReceiversCount > 5) { // Threshold: more than 5 new receivers in a day
        await this.createAnomaly(
          AnomalyType.SUSPICIOUS_PATTERN,
          AnomalySeverity.HIGH,
          `Suspicious pattern: ${newReceiversCount} new receivers in last 24 hours`,
          Math.min(newReceiversCount / 15, 1),
          { newReceiversCount },
          transaction
        );
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Error detecting suspicious pattern:', error);
      return false;
    }
  }

  // 4. Detect geographic anomalies using KMeans clustering
  public static async detectGeographicAnomaly(transaction: TransactionData): Promise<boolean> {
    try {
      // Get historical transaction locations for this sender
      const historicalTransactions = await prisma.splitLog.findMany({
        where: { sender: transaction.senderAddress },
        select: { executedAt: true }
        // Note: In a real-world scenario, we'd store location data (lat/lon or country)
        // For this implementation, we'll use time-based patterns (since we don't have location yet)
      });

      if (historicalTransactions.length < 10) return false; // Not enough data for clustering

      // For demonstration: extract hour of day as a feature
      const features = historicalTransactions.map(tx => {
        const hour = tx.executedAt.getHours();
        return [hour]; // Univariate feature for KMeans
      });

      // Train KMeans with 2 clusters (normal and potentially anomalous)
      const { centroids } = kmeans(features, 2, { initialization: 'random' });

      // Get current transaction's feature
      const currentHour = transaction.timestamp.getHours();
      const currentFeature = [currentHour];

      // Find the closest centroid
      let closestCentroidIndex = 0;
      let minDistance = Infinity;
      for (let i = 0; i < centroids.length; i++) {
        const distance = Math.abs(currentFeature[0] - centroids[i][0]);
        if (distance < minDistance) {
          minDistance = distance;
          closestCentroidIndex = i;
        }
      }

      const centroid = centroids[closestCentroidIndex];
      const distance = minDistance;

      // If distance is more than 6 hours, flag as geographic/time anomaly
      if (distance > 6) {
        await this.createAnomaly(
          AnomalyType.GEOGRAPHIC,
          AnomalySeverity.MEDIUM,
          `Unusual transaction time/hour: ${currentHour} (distance from normal: ${distance.toFixed(1)} hours)`,
          Math.min(distance / 12, 1),
          { currentHour, centroidHour: centroid[0], distance },
          transaction
        );
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Error detecting geographic anomaly', error);
      return false;
    }
  }

  // 5. Detect account takeover anomalies
  public static async detectAccountTakeover(transaction: TransactionData): Promise<boolean> {
    try {
      const oneWeekAgo = new Date(transaction.timestamp.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Get historical sender activity
      const recentActivity = await prisma.splitLog.findMany({
        where: {
          sender: transaction.senderAddress,
          executedAt: { gte: oneWeekAgo }
        },
        select: { amount: true, receiver: true, executedAt: true }
      });

      if (recentActivity.length < 5) return false;

      // Check for multiple red flags that indicate potential takeover
      let flags = 0;

      // Flag 1: Amount is much larger than historical average
      const avgAmount = recentActivity.reduce((sum, tx) => sum + Number(tx.amount), 0) / recentActivity.length;
      if (transaction.amount > avgAmount * 5) {
        flags++;
      }

      // Flag 2: Sending to a brand new receiver
      const hasReceiver = recentActivity.some(tx => tx.receiver === transaction.receiverAddress);
      if (!hasReceiver && transaction.receiverAddress) {
        flags++;
      }

      // Flag 3: Unusual time since last activity (sudden activity after long pause)
      const sortedActivity = recentActivity.sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime());
      const lastActivity = sortedActivity[0];
      const timeSinceLastActivity = (transaction.timestamp.getTime() - lastActivity.executedAt.getTime()) / (1000 * 60 * 60); // Hours
      if (timeSinceLastActivity > 48) { // More than 2 days of inactivity before sudden transaction
        flags++;
      }

      // If 2 or more flags, flag as account takeover
      if (flags >= 2) {
        await this.createAnomaly(
          AnomalyType.ACCOUNT_TAKEOVER,
          AnomalySeverity.CRITICAL,
          `Potential account takeover detected: ${flags} red flags triggered`,
          Math.min(flags / 3, 1),
          { flags, avgAmount, transactionAmount: transaction.amount, newReceiver: !hasReceiver, timeSinceLastActivity },
          transaction
        );
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Error detecting account takeover', error);
      return false;
    }
  }

  // Create anomaly record and alert
  private static async createAnomaly(
    type: AnomalyType,
    severity: AnomalySeverity,
    description: string,
    confidence: number,
    metadata: Record<string, any>,
    transaction: TransactionData
  ): Promise<void> {
    try {
      const anomaly = await prisma.anomaly.create({
        data: {
          type,
          severity,
          description,
          confidence,
          metadata,
          streamId: transaction.streamId,
          disbursementId: transaction.disbursementId,
          senderAddress: transaction.senderAddress,
          receiverAddress: transaction.receiverAddress,
        }
      });

      await prisma.alert.create({
        data: {
          anomalyId: anomaly.id
        }
      });

      logger.info(`Anomaly detected and alert created: ${type} - ${description}`);
    } catch (error) {
      logger.error('Error creating anomaly and alert:', error);
    }
  }

  // Run all detectors on a transaction
  public static async analyzeTransaction(transaction: TransactionData): Promise<void> {
    await Promise.all([
      this.detectUnusualAmount(transaction),
      this.detectVelocityAnomaly(transaction),
      this.detectSuspiciousPattern(transaction),
      this.detectGeographicAnomaly(transaction),
      this.detectAccountTakeover(transaction),
    ]);
  }

  // Get all anomalies
  public static async getAnomalies(params: {
    skip?: number;
    take?: number;
    type?: AnomalyType;
    severity?: AnomalySeverity;
  }) {
    const { skip = 0, take = 50, type, severity } = params;
    return prisma.anomaly.findMany({
      where: { type, severity },
      skip,
      take,
      orderBy: { detectedAt: 'desc' },
      include: { alerts: true }
    });
  }

  // Get all alerts
  public static async getAlerts(params: {
    skip?: number;
    take?: number;
    status?: string;
  }) {
    const { skip = 0, take = 50, status } = params;
    return prisma.alert.findMany({
      where: status ? { status } : {},
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: { anomaly: true }
    });
  }

  // Update alert status
  public static async updateAlertStatus(
    alertId: string,
    status: string,
    resolvedBy?: string,
    notes?: string
  ) {
    const data: any = { status };
    if (status === 'ACKNOWLEDGED') data.acknowledgedAt = new Date();
    if (status === 'RESOLVED') {
      data.resolvedAt = new Date();
      data.resolvedBy = resolvedBy;
    }
    if (notes) data.notes = notes;

    return prisma.alert.update({
      where: { id: alertId },
      data
    });
  }
}
