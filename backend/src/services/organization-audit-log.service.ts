import { prisma } from '../lib/db.js';
import { logger } from '../logger.js';
import { createHmac } from 'crypto';
import { parse } from 'json2csv';

/**
 * Filters for audit log queries
 * All filter fields are optional for flexible querying
 */
export interface AuditLogFilters {
  actionType?: string; // e.g., "MEMBER_ADDED", "POLICY_UPDATED"
  actor?: string; // Member address who performed the action
  resourceId?: string; // ID of the resource being acted upon
  resourceType?: string; // e.g., "organization", "member", "policy"
  dateFrom?: string; // ISO-8601 date string
  dateTo?: string; // ISO-8601 date string
  limit?: number; // Max 1000, default 100
  offset?: number; // For pagination, default 0
}

/**
 * Audit log entry DTO returned from queries
 */
export interface AuditLogEntry {
  id: string;
  organizationId: string;
  actionType: string;
  actor: string;
  resourceId: string;
  resourceType: string;
  changes: Record<string, any> | null;
  entryHash: string | null;
  parentHash: string | null;
  verified: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export class OrganizationAuditLogService {
  /**
   * Query audit logs with optional filtering
   * 
   * Key features:
   * - CRITICAL: Always enforces organizationId filter (multi-tenant security)
   * - Supports filtering by actionType, actor, resourceId, resourceType
   * - Supports date range filtering (dateFrom, dateTo in ISO-8601 format)
   * - Supports pagination with limit and offset
   * - Results sorted by createdAt DESC (most recent first)
   * 
   * @param orgId Organization ID to query logs for (REQUIRED - enforced for multi-tenancy)
   * @param filters Optional filters for querying
   * @returns Promise resolving to array of audit log entries
   * @throws Error if database query fails
   */
  async queryLogs(
    orgId: string,
    filters?: AuditLogFilters
  ): Promise<AuditLogEntry[]> {
    try {
      // Validate organizationId (critical for multi-tenancy)
      if (!orgId || typeof orgId !== 'string' || orgId.trim().length === 0) {
        throw new Error('Invalid organizationId provided to queryLogs');
      }

      // Set defaults for pagination
      const limit = Math.min(filters?.limit ?? 100, 1000); // Max 1000
      const offset = filters?.offset ?? 0;

      // Build where clause with organization context (critical for multi-tenancy)
      const where: Record<string, any> = {
        organizationId: orgId, // ALWAYS filter by organization - CRITICAL for multi-tenancy
      };

      // Add optional filters
      if (filters?.actionType) {
        where.actionType = filters.actionType;
      }

      if (filters?.actor) {
        where.actor = filters.actor;
      }

      if (filters?.resourceId) {
        where.resourceId = filters.resourceId;
      }

      if (filters?.resourceType) {
        where.resourceType = filters.resourceType;
      }

      // Handle date range filtering
      if (filters?.dateFrom || filters?.dateTo) {
        where.createdAt = {};

        if (filters.dateFrom) {
          const dateFrom = new Date(filters.dateFrom);
          if (isNaN(dateFrom.getTime())) {
            throw new Error(`Invalid dateFrom format: ${filters.dateFrom}. Use ISO-8601 format.`);
          }
          where.createdAt.gte = dateFrom;
        }

        if (filters.dateTo) {
          const dateTo = new Date(filters.dateTo);
          if (isNaN(dateTo.getTime())) {
            throw new Error(`Invalid dateTo format: ${filters.dateTo}. Use ISO-8601 format.`);
          }
          // Set to end of day for dateTo
          dateTo.setHours(23, 59, 59, 999);
          where.createdAt.lte = dateTo;
        }
      }

      // Query logs with filters and pagination
      const logs = await prisma.auditLog.findMany({
        where,
        orderBy: {
          createdAt: 'desc', // Most recent first
        },
        skip: offset,
        take: limit,
      });

      logger.debug('Audit logs queried successfully', {
        organizationId: orgId,
        resultsCount: logs.length,
        filters: {
          hasActionType: !!filters?.actionType,
          hasActor: !!filters?.actor,
          hasResourceId: !!filters?.resourceId,
          hasResourceType: !!filters?.resourceType,
          hasDateRange: !!(filters?.dateFrom || filters?.dateTo),
        },
      });

      return logs.map(this.mapToDTO);
    } catch (error) {
      logger.error('Failed to query audit logs', error, {
        organizationId: orgId,
        filters,
      });
      throw error;
    }
  }

  /**
   * Get all audit logs for an organization with simplified interface
   * 
   * This is a convenience method that returns all logs for an org sorted by createdAt DESC
   * without requiring filter objects.
   * 
   * @param orgId Organization ID to retrieve logs for
   * @param limit Maximum number of logs to return (default 100, max 1000)
   * @param offset Offset for pagination (default 0)
   * @returns Promise resolving to array of audit log entries
   * @throws Error if database query fails or organizationId is invalid
   */
  async getOrgLogs(
    orgId: string,
    limit?: number,
    offset?: number
  ): Promise<AuditLogEntry[]> {
    // Delegate to queryLogs with pagination parameters
    return this.queryLogs(orgId, {
      limit,
      offset,
    });
  }

  /**
   * Helper method to map Prisma AuditLog record to DTO
   */
  private mapToDTO(log: any): AuditLogEntry {
    return {
      id: log.id,
      organizationId: log.organizationId,
      actionType: log.actionType,
      actor: log.actor,
      resourceId: log.resourceId,
      resourceType: log.resourceType,
      changes: log.changes ? (typeof log.changes === 'string' ? JSON.parse(log.changes) : log.changes) : null,
      entryHash: log.entryHash,
      parentHash: log.parentHash,
      verified: log.verified,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      createdAt: log.createdAt,
    };
  }

  /**
   * Export audit logs in CSV or JSON format with digital signature
   *
   * Key features:
   * - Exports all audit logs matching the filters
   * - Supports CSV and JSON formats
   * - Includes all available fields in export
   * - Generates HMAC-SHA256 digital signature for verification
   * - For CSV: includes signature as final row and metadata section
   * - For JSON: wraps logs in object with _metadata containing signature and export timestamp
   * - UTF-8 encoding with BOM for CSV (Excel compatibility)
   * - Pretty-printed JSON with 2-space indentation
   * - CRITICAL: Always enforces organizationId filter (multi-tenant security)
   *
   * @param orgId Organization ID to export logs for (REQUIRED, enforced for multi-tenancy)
   * @param format Export format: 'csv' or 'json'
   * @param filters Optional filters to apply (date range, action type, etc.)
   * @returns Promise<Buffer> containing exported data with signature
   * @throws Error if database query fails, invalid format, or signing disabled
   */
  async exportLogs(
    orgId: string,
    format: 'csv' | 'json',
    filters?: AuditLogFilters
  ): Promise<Buffer> {
    try {
      // Validate organizationId (critical for multi-tenancy)
      if (!orgId || typeof orgId !== 'string' || orgId.trim().length === 0) {
        throw new Error('Invalid organizationId provided to exportLogs');
      }

      // Validate format
      if (format !== 'csv' && format !== 'json') {
        throw new Error(`Invalid export format: ${format}. Must be 'csv' or 'json'.`);
      }

      // Query logs using existing method (includes org-scope enforcement)
      const logs = await this.queryLogs(orgId, {
        ...filters,
        limit: 10000, // Allow up to 10k logs per export
        offset: filters?.offset || 0,
      });

      logger.debug('Audit logs retrieved for export', {
        organizationId: orgId,
        format,
        logsCount: logs.length,
      });

      // Generate export signature
      let signature: string;
      const includeSignature = this.shouldIncludeSignature();

      if (includeSignature) {
        // Create a deterministic representation of the data for signing
        const dataToSign = format === 'csv'
          ? this.formatLogsAsCSV(logs)
          : JSON.stringify(logs.map(this.formatLogForExport));
        signature = this.generateExportSignature(Buffer.from(dataToSign, 'utf-8'));
      } else {
        signature = '';
      }

      // Format and export
      let exportBuffer: Buffer;

      if (format === 'csv') {
        exportBuffer = this.exportAsCSV(logs, signature, orgId);
      } else {
        exportBuffer = this.exportAsJSON(logs, signature, orgId);
      }

      logger.debug('Audit logs exported successfully', {
        organizationId: orgId,
        format,
        bufferSize: exportBuffer.length,
      });

      return exportBuffer;
    } catch (error) {
      logger.error('Failed to export audit logs', error, {
        organizationId: orgId,
        format,
        filters,
      });
      throw error;
    }
  }

  /**
   * Generate HMAC-SHA256 digital signature for exported data
   *
   * Key features:
   * - Uses HMAC-SHA256 for cryptographic signing
   * - Secret key retrieved from AUDIT_EXPORT_KEY environment variable
   * - Returns hex-encoded signature string
   * - Used for verification that exported data hasn't been tampered with
   *
   * @param data Buffer containing the data to sign
   * @returns Hex-encoded signature string
   * @throws Error if AUDIT_EXPORT_KEY not configured
   */
  generateExportSignature(data: Buffer): string {
    try {
      const exportKey = process.env.AUDIT_EXPORT_KEY;

      if (!exportKey || exportKey.trim().length === 0) {
        throw new Error('AUDIT_EXPORT_KEY environment variable not configured');
      }

      const hmac = createHmac('sha256', exportKey);
      hmac.update(data);
      const signature = hmac.digest('hex');

      logger.debug('Export signature generated', {
        dataSize: data.length,
        signatureLength: signature.length,
      });

      return signature;
    } catch (error) {
      logger.error('Failed to generate export signature', error);
      throw error;
    }
  }

  /**
   * Verify exported data hasn't been tampered with
   *
   * Key features:
   * - Validates signature using HMAC-SHA256
   * - Secret key retrieved from AUDIT_EXPORT_KEY environment variable
   * - Returns true if signature matches, false otherwise
   * - Used by recipients to verify export integrity
   *
   * @param data Buffer containing the exported data (without signature)
   * @param signature Hex-encoded signature string to verify
   * @returns boolean True if signature is valid, false otherwise
   * @throws Error if AUDIT_EXPORT_KEY not configured
   */
  verifyExportSignature(data: Buffer, signature: string): boolean {
    try {
      const exportKey = process.env.AUDIT_EXPORT_KEY;

      if (!exportKey || exportKey.trim().length === 0) {
        logger.error('Cannot verify export signature: AUDIT_EXPORT_KEY not configured');
        return false;
      }

      const expectedSignature = this.generateExportSignature(data);
      const isValid = expectedSignature === signature;

      logger.debug('Export signature verified', {
        isValid,
        signatureLength: signature.length,
      });

      return isValid;
    } catch (error) {
      logger.error('Failed to verify export signature', error);
      return false;
    }
  }

  /**
   * Export logs as CSV format
   *
   * Format:
   * - UTF-8 with BOM (for Excel compatibility)
   * - Header row with all field names
   * - One log entry per row
   * - Proper CSV escaping for special characters (quotes, commas, newlines)
   * - Fields in order: id, organizationId, actionType, actor, resourceId, resourceType,
   *   changes, entryHash, parentHash, verified, ipAddress, userAgent, createdAt
   * - Metadata section at end (signature, export timestamp)
   * - Metadata rows start with "#" to avoid parsing as data rows
   *
   * @param logs Array of AuditLogEntry to export
   * @param signature Digital signature for verification
   * @param orgId Organization ID (for metadata)
   * @returns Buffer containing CSV data with BOM
   */
  private exportAsCSV(logs: AuditLogEntry[], signature: string, orgId: string): Buffer {
    try {
      // Flatten logs for CSV export
      const csvLogs = logs.map(this.formatLogForExport);

      // Convert to CSV using json2csv
      const csv = parse(csvLogs, {
        fields: [
          'id',
          'organizationId',
          'actionType',
          'actor',
          'resourceId',
          'resourceType',
          'changes',
          'entryHash',
          'parentHash',
          'verified',
          'ipAddress',
          'userAgent',
          'createdAt',
        ],
      });

      // Build metadata section
      const exportTimestamp = new Date().toISOString();
      const metadata = [
        '',
        '# Export Metadata',
        `# Organization: ${orgId}`,
        `# Export Date: ${exportTimestamp}`,
        `# Records: ${logs.length}`,
        `# Signature: ${signature}`,
        '',
      ].join('\n');

      // Combine CSV with metadata
      const fullContent = csv + '\n' + metadata;

      // Add UTF-8 BOM for Excel compatibility
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      const csvBuffer = Buffer.from(fullContent, 'utf-8');

      return Buffer.concat([bom, csvBuffer]);
    } catch (error) {
      logger.error('Failed to export logs as CSV', error);
      throw error;
    }
  }

  /**
   * Export logs as JSON format
   *
   * Format:
   * - Array of audit log objects
   * - Include all fields from AuditLogEntry
   * - Pretty-printed with 2-space indentation for readability
   * - UTF-8 encoding
   * - Wraps logs in object with _metadata containing:
   *   - signature: Digital signature for verification
   *   - exportDate: ISO-8601 timestamp of export
   *   - organizationId: ID of organization being exported
   *   - recordCount: Number of records in export
   *
   * @param logs Array of AuditLogEntry to export
   * @param signature Digital signature for verification
   * @param orgId Organization ID
   * @returns Buffer containing JSON data
   */
  private exportAsJSON(logs: AuditLogEntry[], signature: string, orgId: string): Buffer {
    try {
      const exportTimestamp = new Date().toISOString();

      const exportData = {
        _metadata: {
          organizationId: orgId,
          exportDate: exportTimestamp,
          recordCount: logs.length,
          signature,
        },
        logs: logs.map(this.formatLogForExport),
      };

      const jsonString = JSON.stringify(exportData, null, 2);
      return Buffer.from(jsonString, 'utf-8');
    } catch (error) {
      logger.error('Failed to export logs as JSON', error);
      throw error;
    }
  }

  /**
   * Format a single log entry for export (flattens nested objects)
   *
   * Converts changes object to JSON string for CSV compatibility
   * Ensures all fields are serializable
   *
   * @param log AuditLogEntry to format
   * @returns Flattened object suitable for CSV/JSON export
   */
  private formatLogForExport(log: AuditLogEntry): Record<string, any> {
    return {
      id: log.id,
      organizationId: log.organizationId,
      actionType: log.actionType,
      actor: log.actor,
      resourceId: log.resourceId,
      resourceType: log.resourceType,
      changes: log.changes ? JSON.stringify(log.changes) : null,
      entryHash: log.entryHash,
      parentHash: log.parentHash,
      verified: log.verified,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      createdAt: log.createdAt?.toISOString() || '',
    };
  }

  /**
   * Format logs as CSV string for signing purposes
   *
   * Creates a deterministic string representation of logs for consistent signing
   *
   * @param logs Array of logs to format
   * @returns CSV string
   */
  private formatLogsAsCSV(logs: AuditLogEntry[]): string {
    try {
      const csvLogs = logs.map(this.formatLogForExport);
      return parse(csvLogs, {
        fields: [
          'id',
          'organizationId',
          'actionType',
          'actor',
          'resourceId',
          'resourceType',
          'changes',
          'entryHash',
          'parentHash',
          'verified',
          'ipAddress',
          'userAgent',
          'createdAt',
        ],
      });
    } catch (error) {
      logger.error('Failed to format logs as CSV', error);
      throw error;
    }
  }

  /**
   * Check if export signatures should be included
   *
   * Reads AUDIT_EXPORT_INCLUDE_SIGNATURE environment variable
   * Defaults to true if not specified
   *
   * @returns boolean True if signatures should be included, false otherwise
   */
  private shouldIncludeSignature(): boolean {
    const includeSignatureEnv = process.env.AUDIT_EXPORT_INCLUDE_SIGNATURE;

    if (includeSignatureEnv === undefined) {
      return true; // Default to true
    }

    return includeSignatureEnv.toLowerCase() === 'true';
  }
}

// Export singleton instance
export const organizationAuditLogService = new OrganizationAuditLogService();
