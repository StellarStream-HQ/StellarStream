import { AnalyticsDatabase } from "../db/storage.js";
import { UserRetentionMetricsResponse } from "./types.js";

export class RetentionCohortAnalyzer {
  private db: AnalyticsDatabase;

  constructor(db: AnalyticsDatabase) {
    this.db = db;
  }

  public getRetentionMetrics(): UserRetentionMetricsResponse {
    const streams = this.db.getStreams();
    const events = this.db.getEvents({ limit: 100000 }).events;

    const allSenders = new Set<string>();
    const allReceivers = new Set<string>();
    const allUsers = new Set<string>();

    for (const s of streams) {
      if (s.sender) {
        allSenders.add(s.sender);
        allUsers.add(s.sender);
      }
      if (s.receiver) {
        allReceivers.add(s.receiver);
        allUsers.add(s.receiver);
      }
    }

    if (allSenders.size === 0) {
      return {
        overallRepeatRatePercent: 0,
        totalUniqueUsers: 0,
        totalSenders: 0,
        totalReceivers: 0,
        senderToReceiverRatio: 0,
        cohorts: [],
      };
    }

    // Determine first active date for each sender
    const senderFirstSeen = new Map<string, Date>();
    const senderActivityTimestamps = new Map<string, number[]>();

    // Sort streams by creation time
    const sortedStreams = [...streams].sort(
      (a, b) => new Date(a.createdAtTime).getTime() - new Date(b.createdAtTime).getTime()
    );

    for (const s of sortedStreams) {
      const timeMs = new Date(s.createdAtTime).getTime();
      if (!senderFirstSeen.has(s.sender)) {
        senderFirstSeen.set(s.sender, new Date(s.createdAtTime));
        senderActivityTimestamps.set(s.sender, [timeMs]);
      } else {
        senderActivityTimestamps.get(s.sender)!.push(timeMs);
      }
    }

    // Count repeat streamers (senders with > 1 stream)
    let repeatSenders = 0;
    for (const timestamps of senderActivityTimestamps.values()) {
      if (timestamps.length > 1) {
        repeatSenders++;
      }
    }
    const repeatRate = allSenders.size > 0 ? (repeatSenders / allSenders.size) * 100 : 0;

    // Group senders into monthly cohorts
    const cohortMap = new Map<
      string,
      {
        senders: string[];
      }
    >();

    for (const [sender, firstDate] of senderFirstSeen.entries()) {
      const cohortMonth = `${firstDate.getFullYear()}-${String(firstDate.getMonth() + 1).padStart(2, "0")}`;
      if (!cohortMap.has(cohortMonth)) {
        cohortMap.set(cohortMonth, { senders: [] });
      }
      cohortMap.get(cohortMonth)!.senders.push(sender);
    }

    const sortedCohorts = Array.from(cohortMap.keys()).sort();
    const cohortResults = sortedCohorts.map((cohortMonth) => {
      const sendersInCohort = cohortMap.get(cohortMonth)!.senders;
      const size = sendersInCohort.length;

      let d1Count = 0;
      let d7Count = 0;
      let d14Count = 0;
      let d30Count = 0;
      let d60Count = 0;
      let d90Count = 0;
      let repeatCount = 0;
      let totalStreamsInCohort = 0;

      for (const sender of sendersInCohort) {
        const firstTime = senderFirstSeen.get(sender)!.getTime();
        const activities = senderActivityTimestamps.get(sender) || [];
        totalStreamsInCohort += activities.length;
        if (activities.length > 1) repeatCount++;

        let hasD1 = false;
        let hasD7 = false;
        let hasD14 = false;
        let hasD30 = false;
        let hasD60 = false;
        let hasD90 = false;

        for (const actTime of activities) {
          const diffDays = (actTime - firstTime) / (1000 * 86400);
          if (diffDays >= 1 && diffDays <= 2) hasD1 = true;
          if (diffDays >= 7 && diffDays <= 14) hasD7 = true;
          if (diffDays >= 14 && diffDays <= 30) hasD14 = true;
          if (diffDays >= 30 && diffDays <= 60) hasD30 = true;
          if (diffDays >= 60 && diffDays <= 90) hasD60 = true;
          if (diffDays >= 90) hasD90 = true;
        }

        if (hasD1) d1Count++;
        if (hasD7) d7Count++;
        if (hasD14) d14Count++;
        if (hasD30) d30Count++;
        if (hasD60) d60Count++;
        if (hasD90) d90Count++;
      }

      return {
        cohortMonth,
        cohortSize: size,
        day1: size > 0 ? Math.round((d1Count / size) * 10000) / 100 : 0,
        day7: size > 0 ? Math.round((d7Count / size) * 10000) / 100 : 0,
        day14: size > 0 ? Math.round((d14Count / size) * 10000) / 100 : 0,
        day30: size > 0 ? Math.round((d30Count / size) * 10000) / 100 : 0,
        day60: size > 0 ? Math.round((d60Count / size) * 10000) / 100 : 0,
        day90: size > 0 ? Math.round((d90Count / size) * 10000) / 100 : 0,
        repeatRate: size > 0 ? Math.round((repeatCount / size) * 10000) / 100 : 0,
        avgStreamsPerUser: size > 0 ? Math.round((totalStreamsInCohort / size) * 100) / 100 : 1,
      };
    });

    const ratio = allReceivers.size > 0 ? Math.round((allSenders.size / allReceivers.size) * 100) / 100 : 1;

    return {
      overallRepeatRatePercent: Math.round(repeatRate * 100) / 100,
      totalUniqueUsers: allUsers.size,
      totalSenders: allSenders.size,
      totalReceivers: allReceivers.size,
      senderToReceiverRatio: ratio,
      cohorts: cohortResults,
    };
  }
}
