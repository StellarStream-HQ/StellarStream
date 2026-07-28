import { createHash } from 'crypto';
import { prisma } from '../lib/db.js';
import { computeEventHash /* EventHashInput */ } from '../lib/event-hash-chain.js';
import { logger } from '../logger.js';

export interface VerificationResult {
  isValid: boolean;
  totalEvents: number;
  errors: string[];
}

/**
 * Represents a single tampered entry detected during verification
 */
export interface TamperedEntry {
  entryId: string;
  entryIndex: number;
  tamperedFields: string[];
  expectedHash: string;
  actualHash: string | null;
  chainBroken: boolean;
}

/**
 * Result of audit log integrity verification
 */
export interface AuditLogIntegrityResult {
  isValid: boolean;
  timestamp: Date;
  totalEntries: number;
  tamperedEntries: TamperedEntry[];
  verificationDetails: {
    firstEntryValid: boolean;
    chainContinuityErrors: number;
    hashMismatchErrors: number;
  };
}

/**
 * Audit log entry structure for integrity verification
 */
export interface AuditLogEntryForVerification {
  id: string;
  organizationId: string;
  actionType: string;
  actor: string;
  resourceId: string;
  resourceType: string;
  changes: any;
  entryHash: string | null;
  parentHash: string | null;
  createdAt: Date;
}

export class HashChainVerificationService {
  /**
   * Calculate the hash for an audit log entry
   * Uses SHA-256 with canonical JSON serialization
   * Format: SHA-256(JSON.stringify({ orgId, actionType, actor, resourceId, resourceType, changes, parentHash }))
   *
   * @param entry The audit log entry to hash
   * @param parentHash The parent entry's hash (for hash chain)
   * @returns The calculated SHA-256 hash
   */
  calculateEntryHash(entry: AuditLogEntryForVerification, parentHash: string | null = null): string {
    const canonical = JSON.stringify({
      organizationId: entry.organizationId,
      actionType: entry.actionType,
      actor: entry.actor,
      resourceId: entry.resourceId,
      resourceType: entry.resourceType,
      changes: entry.changes,
      parentHash: parentHash,
    });

    return createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  /**
   * Verify a single audit log entry's hash
   * 
   * @param entry The audit log entry to verify
   * @param previousEntry Optional previous entry for chain continuity check
   * @returns True if entry hash is valid and chain is continuous, false otherwise
   */
  verifyEntry(entry: AuditLogEntryForVerification, previousEntry?: AuditLogEntryForVerification): boolean {
    // Calculate what the entry hash should be
    const expectedHash = this.calculateEntryHash(entry, previousEntry?.entryHash ?? null);

    // Check if calculated hash matches stored hash
    if (expectedHash !== entry.entryHash) {
      return false;
    }

    // If previous entry provided, verify chain continuity
    if (previousEntry) {
      if (entry.parentHash !== previousEntry.entryHash) {
        return false;
      }
    }

    return true;
  }

  /**
   * Verify the integrity of the entire audit log chain for an organization
   * 
   * @param orgId Organization ID to verify logs for
   * @param startEntryId Optional entry ID to start verification from (for partial chain verification)
   * @returns AuditLogIntegrityResult with verification details and tampering information
   */
  async verifyIntegrity(orgId: string, startEntryId?: string): Promise<AuditLogIntegrityResult> {
    try {
      // Fetch all audit logs for organization ordered by createdAt ASC
      const entries = await prisma.auditLog.findMany({
        where: {
          organizationId: orgId,
          ...(startEntryId ? { id: { gte: startEntryId } } : {}),
        },
        orderBy: {
          createdAt: 'asc',
        },
        select: {
          id: true,
          organizationId: true,
          actionType: true,
          actor: true,
          resourceId: true,
          resourceType: true,
          changes: true,
          entryHash: true,
          parentHash: true,
          createdAt: true,
        },
      });

      const tamperedEntries: TamperedEntry[] = [];
      let firstEntryValid = true;
      let chainContinuityErrors = 0;
      let hashMismatchErrors = 0;

      // Verify first entry has correct parentHash (null or "ROOT")
      if (entries.length > 0 && !startEntryId) {
        const firstEntry = entries[0];
        if (firstEntry.parentHash !== null && firstEntry.parentHash !== 'ROOT') {
          firstEntryValid = false;
          logger.warn('First audit log entry has invalid parentHash', {
            organizationId: orgId,
            entryId: firstEntry.id,
            parentHash: firstEntry.parentHash,
          });
        }
      }

      // Verify each entry in the chain
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const previousEntry = i > 0 ? entries[i - 1] : undefined;
        const tamperedFields: string[] = [];

        // Calculate expected hash (using previous entry's hash as parent)
        const expectedHash = this.calculateEntryHash(
          entry,
          previousEntry?.entryHash ?? (startEntryId ? null : null)
        );

        // Check for hash mismatch
        if (expectedHash !== entry.entryHash) {
          hashMismatchErrors++;
          tamperedFields.push('entryHash');
        }

        // Check for chain continuity (except first entry or when startEntryId is specified)
        let chainBroken = false;
        if (previousEntry) {
          if (entry.parentHash !== previousEntry.entryHash) {
            chainContinuityErrors++;
            chainBroken = true;
            tamperedFields.push('parentHash', 'chainIntegrity');
          }
        }

        // If tampering detected, add to tamperedEntries
        if (tamperedFields.length > 0) {
          tamperedEntries.push({
            entryId: entry.id,
            entryIndex: i,
            tamperedFields,
            expectedHash,
            actualHash: entry.entryHash,
            chainBroken,
          });
        }
      }

      const result: AuditLogIntegrityResult = {
        isValid: tamperedEntries.length === 0 && firstEntryValid,
        timestamp: new Date(),
        totalEntries: entries.length,
        tamperedEntries,
        verificationDetails: {
          firstEntryValid,
          chainContinuityErrors,
          hashMismatchErrors,
        },
      };

      if (result.isValid) {
        logger.info('Audit log chain verification successful', {
          organizationId: orgId,
          totalEntries: result.totalEntries,
        });
      } else {
        logger.warn('Audit log chain verification failed', {
          organizationId: orgId,
          totalEntries: result.totalEntries,
          tamperedCount: tamperedEntries.length,
          chainContinuityErrors,
          hashMismatchErrors,
        });
      }

      return result;
    } catch (error) {
      logger.error('Audit log integrity verification error', error, {
        organizationId: orgId,
        startEntryId,
      });
      throw error;
    }
  }

  /**
   * Verify the integrity of the entire event chain
   */
  async verifyEventChain(): Promise<VerificationResult> {
    try {
      const events = await prisma.event.findMany({
        orderBy: { timestamp: 'asc' },
        select: {
          eventId: true,
          streamId: true,
          eventType: true,
          payload: true,
          timestamp: true,
          hash: true,
          previousHash: true,
        },
      });

      const errors: string[] = [];
      let previousHash: string | null = null;

      for (const event of events) {
        // Verify the previous hash chain
        if (event.previousHash !== previousHash) {
          errors.push(
            `Hash chain broken at event ${event.eventId}: expected previousHash ${previousHash}, got ${event.previousHash}`
          );
        }

        // Recompute the hash and verify it matches
        const expectedHash = computeEventHash({
          eventId: event.eventId,
          streamId: event.streamId,
          eventType: event.eventType,
          payload: event.payload as Record<string, unknown>,
          timestamp: event.timestamp.toISOString(),
          previousHash: event.previousHash,
        });

        if (expectedHash !== event.hash) {
          errors.push(
            `Hash mismatch at event ${event.eventId}: expected ${expectedHash}, got ${event.hash}`
          );
        }

        previousHash = event.hash;
      }

      const result: VerificationResult = {
        isValid: errors.length === 0,
        totalEvents: events.length,
        errors,
      };

      if (result.isValid) {
        logger.info('Event chain verification successful', {
          totalEvents: result.totalEvents,
        });
      } else {
        logger.warn('Event chain verification failed', {
          totalEvents: result.totalEvents,
          errorCount: errors.length,
        });
      }

      return result;
    } catch (error) {
      logger.error('Event chain verification error', error);
      throw error;
    }
  }

  /**
   * Verify a specific range of events in the chain
   */
  async verifyEventRange(
    startEventId: string,
    endEventId: string
  ): Promise<VerificationResult> {
    try {
      const events = await prisma.event.findMany({
        where: {
          AND: [{ eventId: { gte: startEventId } }, { eventId: { lte: endEventId } }],
        },
        orderBy: { timestamp: 'asc' },
      });

      if (events.length === 0) {
        return {
          isValid: true,
          totalEvents: 0,
          errors: [],
        };
      }

      const errors: string[] = [];

      // Get the previous hash for the first event in range
      let previousHash: string | null = null;
      if (events.length > 0) {
        const beforeFirst = await prisma.event.findFirst({
          where: {
            timestamp: { lt: events[0].timestamp },
          },
          orderBy: { timestamp: 'desc' },
          select: { hash: true },
        });
        previousHash = beforeFirst?.hash || null;
      }

      for (const event of events) {
        if (event.previousHash !== previousHash) {
          errors.push(
            `Hash chain broken at event ${event.eventId}: expected previousHash ${previousHash}, got ${event.previousHash}`
          );
        }

        const expectedHash = computeEventHash({
          eventId: event.eventId,
          streamId: event.streamId,
          eventType: event.eventType,
          payload: event.payload as Record<string, unknown>,
          timestamp: event.timestamp.toISOString(),
          previousHash: event.previousHash,
        });

        if (expectedHash !== event.hash) {
          errors.push(
            `Hash mismatch at event ${event.eventId}: expected ${expectedHash}, got ${event.hash}`
          );
        }

        previousHash = event.hash;
      }

      return {
        isValid: errors.length === 0,
        totalEvents: events.length,
        errors,
      };
    } catch (error) {
      logger.error('Event range verification error', error);
      throw error;
    }
  }
}
