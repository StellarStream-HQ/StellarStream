import { prisma } from "../lib/db.js";
import { computeEventHash } from "../lib/event-hash-chain.js";
import { logger } from "../logger.js";

export interface EventData {
  streamId: string;
  eventType: string;
  payload: Record<string, unknown>;
  timestamp?: Date;
}

export interface EventChainEntry {
  id: string;
  eventId: string;
  streamId: string;
  eventType: string;
  payload: Record<string, unknown>;
  timestamp: Date;
  hash: string;
  previousHash: string | null;
}

export class EventSourceService {
  /**
   * Append a new event to the immutable event log
   */
  async appendEvent(event: EventData): Promise<string> {
    try {
      // Get the last event to chain from
      const lastEvent = await prisma.event.findFirst({
        orderBy: { timestamp: "desc" },
        select: { hash: true },
      });

      const eventId = `${event.streamId}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const timestamp = event.timestamp || new Date();
      const previousHash = lastEvent?.hash || null;

      // Compute hash for this event
      const hash = computeEventHash({
        eventId,
        streamId: event.streamId,
        eventType: event.eventType,
        payload: event.payload,
        timestamp: timestamp.toISOString(),
        previousHash,
      });

      // Store the event
      await prisma.event.create({
        data: {
          eventId,
          streamId: event.streamId,
          eventType: event.eventType,
          payload: event.payload as any,
          timestamp,
          hash,
          previousHash,
        },
      });

      logger.info("Event appended to event store", {
        eventId,
        eventType: event.eventType,
        streamId: event.streamId,
      });

      return eventId;
    } catch (error) {
      logger.error("Failed to append event to event store", error, {
        streamId: event.streamId,
        eventType: event.eventType,
      });
      throw error;
    }
  }

  /**
   * Get all events for a specific stream
   */
  async getStreamEvents(streamId: string): Promise<EventChainEntry[]> {
    try {
      const events = await prisma.event.findMany({
        where: { streamId },
        orderBy: { timestamp: "asc" },
      });

      return events.map((event) => ({
        id: event.id,
        eventId: event.eventId,
        streamId: event.streamId,
        eventType: event.eventType,
        payload: event.payload as Record<string, unknown>,
        timestamp: event.timestamp,
        hash: event.hash,
        previousHash: event.previousHash,
      }));
    } catch (error) {
      logger.error("Failed to retrieve stream events", error, { streamId });
      throw error;
    }
  }

  /**
   * Get events by type
   */
  async getEventsByType(eventType: string, limit: number = 100): Promise<EventChainEntry[]> {
    try {
      const events = await prisma.event.findMany({
        where: { eventType },
        orderBy: { timestamp: "desc" },
        take: limit,
      });

      return events.map((event) => ({
        id: event.id,
        eventId: event.eventId,
        streamId: event.streamId,
        eventType: event.eventType,
        payload: event.payload as Record<string, unknown>,
        timestamp: event.timestamp,
        hash: event.hash,
        previousHash: event.previousHash,
      }));
    } catch (error) {
      logger.error("Failed to retrieve events by type", error, { eventType });
      throw error;
    }
  }

  /**
   * Get recent events from the event store
   */
  async getRecentEvents(limit: number = 50): Promise<EventChainEntry[]> {
    try {
      const events = await prisma.event.findMany({
        orderBy: { timestamp: "desc" },
        take: limit,
      });

      return events.map((event) => ({
        id: event.id,
        eventId: event.eventId,
        streamId: event.streamId,
        eventType: event.eventType,
        payload: event.payload as Record<string, unknown>,
        timestamp: event.timestamp,
        hash: event.hash,
        previousHash: event.previousHash,
      }));
    } catch (error) {
      logger.error("Failed to retrieve recent events", error);
      throw error;
    }
  }
}
