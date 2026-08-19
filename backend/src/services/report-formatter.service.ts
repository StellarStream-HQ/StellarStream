import * as pdfLib from 'pdf-lib';
import * as XLSX from 'xlsx';
import { logger } from '../logger.js';

/**
 * Report Formatter Service - converts report data to multiple export formats
 * Supports PDF, Excel, JSON, and CSV formats
 * Uses industry-standard libraries for maximum compatibility
 */
export class ReportFormatterService {
  constructor(private log = logger) {}

  /**
   * Format report data as PDF document
   * Creates a professional PDF with headers, summary statistics, and signature line
   * Uses pdf-lib for cross-platform PDF generation
   * 
   * @param reportData - Report data including title, org name, summary, and data rows
   * @returns PDF file as Buffer for download/storage
   * @throws Error if PDF generation fails
   */
  async formatAsPDF(reportData: {
    title: string;
    organizationName: string;
    generatedAt: Date;
    summary: any;
    data: any[];
    sections?: { title: string; content: any }[];
  }): Promise<Buffer> {
    this.log.info('Formatting report as PDF', { title: reportData.title });

    try {
      const { PDFDocument, rgb } = pdfLib;
      const pdfDoc = await PDFDocument.create();

      // Create first page (letter size: 8.5" x 11")
      const page = pdfDoc.addPage([8.5 * 72, 11 * 72]);
      const { height } = page.getSize();

      let yPosition = height - 50;
      const margin = 50;
      const lineHeight = 15;

      // ─ Report Header ─────────────────────────────────────────────────────────
      page.drawText(reportData.title, {
        x: margin,
        y: yPosition,
        size: 24,
        color: rgb(0, 0, 0),
      });
      yPosition -= 40;

      page.drawText(`Organization: ${reportData.organizationName}`, {
        x: margin,
        y: yPosition,
        size: 12,
        color: rgb(0.5, 0.5, 0.5),
      });
      yPosition -= 20;

      page.drawText(`Generated: ${reportData.generatedAt.toISOString()}`, {
        x: margin,
        y: yPosition,
        size: 10,
        color: rgb(0.5, 0.5, 0.5),
      });
      yPosition -= 30;

      // ─ Summary Section ────────────────────────────────────────────────────────
      page.drawText('Summary', {
        x: margin,
        y: yPosition,
        size: 14,
        color: rgb(0, 0, 0),
      });
      yPosition -= 20;

      if (reportData.summary) {
        const summaryLines = Object.entries(reportData.summary)
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n')
          .split('\n');

        for (const line of summaryLines) {
          // Check if we need a new page
          if (yPosition < 100) {
            const newPage = pdfDoc.addPage([8.5 * 72, 11 * 72]);
            yPosition = height - 50;
            page.drawText(line, { x: margin, y: yPosition, size: 10 });
          } else {
            page.drawText(line, { x: margin, y: yPosition, size: 10 });
          }
          yPosition -= lineHeight;
        }
      }

      // ─ Additional Sections ────────────────────────────────────────────────────
      if (reportData.sections && reportData.sections.length > 0) {
        for (const section of reportData.sections) {
          yPosition -= 15; // Extra space between sections
          
          page.drawText(section.title, {
            x: margin,
            y: yPosition,
            size: 12,
            color: rgb(0, 0, 0),
          });
          yPosition -= 15;

          const contentText = typeof section.content === 'string' 
            ? section.content 
            : JSON.stringify(section.content, null, 2);

          const contentLines = contentText.split('\n');
          for (const line of contentLines) {
            if (yPosition < 50) {
              const newPage = pdfDoc.addPage([8.5 * 72, 11 * 72]);
              yPosition = height - 50;
            }
            page.drawText(line, { x: margin, y: yPosition, size: 9 });
            yPosition -= lineHeight;
          }
        }
      }

      // ─ Footer with Signature Line ─────────────────────────────────────────────
      page.drawText('_________________', {
        x: margin,
        y: 30,
        size: 10,
      });
      page.drawText('Authorized Signature', {
        x: margin,
        y: 15,
        size: 9,
        color: rgb(0.5, 0.5, 0.5),
      });

      const pdfBytes = await pdfDoc.save();
      return Buffer.from(pdfBytes);
    } catch (error) {
      this.log.error('Failed to format PDF', error);
      throw new Error(`PDF formatting failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Format report data as Excel workbook (.xlsx)
   * Creates multiple sheets: Summary, Transactions, and custom sections
   * Applies formatting for readability and professional appearance
   * 
   * @param reportData - Report data with title, org, summary, and data rows
   * @returns Excel file as Buffer for download/storage
   * @throws Error if Excel generation fails
   */
  async formatAsExcel(reportData: {
    title: string;
    organizationName: string;
    generatedAt: Date;
    summary: any;
    data: any[];
    sections?: { title: string; rows: any[] }[];
  }): Promise<Buffer> {
    this.log.info('Formatting report as Excel', { title: reportData.title });

    try {
      const workbook = XLSX.utils.book_new();

      // ─ Summary Sheet ──────────────────────────────────────────────────────────
      const summaryRows = [
        { Metric: 'Report Title', Value: reportData.title },
        { Metric: 'Organization', Value: reportData.organizationName },
        { Metric: 'Generated', Value: reportData.generatedAt.toISOString() },
        {}, // Empty row for spacing
        ...Object.entries(reportData.summary || {}).map(([key, value]) => ({
          Metric: key,
          Value: String(value),
        })),
      ];

      const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

      // ─ Transactions Sheet ─────────────────────────────────────────────────────
      if (reportData.data && reportData.data.length > 0) {
        const dataSheet = XLSX.utils.json_to_sheet(reportData.data);
        
        // Auto-fit column widths
        const colWidths = Object.keys(reportData.data[0]).map(() => 15);
        dataSheet['!cols'] = colWidths.map((width) => ({ wch: width }));
        
        XLSX.utils.book_append_sheet(workbook, dataSheet, 'Transactions');
      }

      // ─ Additional Sections ────────────────────────────────────────────────────
      if (reportData.sections && reportData.sections.length > 0) {
        for (const section of reportData.sections) {
          const sectionSheet = XLSX.utils.json_to_sheet(section.rows);
          const sheetName = section.title.substring(0, 31); // Excel sheet name limit
          XLSX.utils.book_append_sheet(workbook, sectionSheet, sheetName);
        }
      }

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      return buffer as Buffer;
    } catch (error) {
      this.log.error('Failed to format Excel', error);
      throw new Error(`Excel formatting failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Format report data as JSON for data integration and APIs
   * Handles Decimal objects by converting to strings for JSON serialization
   * Suitable for programmatic consumption and webhooks
   * 
   * @param reportData - Complete report data object
   * @returns JSON formatted as Buffer for storage/download
   * @throws Error if JSON serialization fails
   */
  async formatAsJSON(reportData: any): Promise<Buffer> {
    this.log.info('Formatting report as JSON');

    try {
      // Custom serialization to handle Decimal objects and special types
      const jsonString = JSON.stringify(reportData, (key, value) => {
        // Convert Decimal objects to string representation
        if (value && typeof value === 'object' && value.constructor?.name === 'Decimal') {
          return value.toString();
        }
        // Convert BigInt to string
        if (typeof value === 'bigint') {
          return value.toString();
        }
        return value;
      }, 2);

      return Buffer.from(jsonString, 'utf-8');
    } catch (error) {
      this.log.error('Failed to format JSON', error);
      throw new Error(`JSON formatting failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Format report data as CSV for spreadsheet compatibility
   * Includes report metadata header and properly escaped data rows
   * Suitable for import into Excel, Google Sheets, or other tools
   * 
   * @param reportData - Report data with title, org, generated date, and rows
   * @returns CSV formatted as Buffer for download/storage
   * @throws Error if CSV generation fails
   */
  async formatAsCSV(reportData: {
    title: string;
    organizationName: string;
    generatedAt: Date;
    data: any[];
  }): Promise<Buffer> {
    this.log.info('Formatting report as CSV');

    try {
      const lines: string[] = [];

      // ─ CSV Header with Report Metadata ────────────────────────────────────────
      lines.push(`"${reportData.title}"`);
      lines.push(`"Organization","${reportData.organizationName}"`);
      lines.push(`"Generated","${reportData.generatedAt.toISOString()}"`);
      lines.push(''); // Empty line for readability

      // ─ CSV Data Rows ──────────────────────────────────────────────────────────
      if (reportData.data && reportData.data.length > 0) {
        // Extract headers from first row
        const headers = Object.keys(reportData.data[0]);
        lines.push(headers.map((h) => `"${h}"`).join(','));

        // Add data rows with proper CSV escaping
        for (const row of reportData.data) {
          const values = headers.map((h) => {
            const value = row[h];
            const stringValue = String(value || '');
            // Escape quotes in CSV values
            return `"${stringValue.replace(/"/g, '""')}"`;
          });
          lines.push(values.join(','));
        }
      }

      const csv = lines.join('\n');
      return Buffer.from(csv, 'utf-8');
    } catch (error) {
      this.log.error('Failed to format CSV', error);
      throw new Error(`CSV formatting failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate digital HMAC signature for report integrity verification
   * Uses SHA-256 algorithm with provided private key
   * Allows recipients to verify report has not been tampered with
   * 
   * @param reportBuffer - Report file buffer to sign
   * @param privateKey - Private key for HMAC signature generation
   * @returns Hex-encoded signature string
   * @throws Error if signature generation fails
   */
  async generateSignature(reportBuffer: Buffer, privateKey: string): Promise<string> {
    this.log.info('Generating digital signature for report');

    try {
      const crypto = await import('crypto');
      const signature = crypto
        .createHmac('sha256', privateKey)
        .update(reportBuffer)
        .digest('hex');
      return signature;
    } catch (error) {
      this.log.error('Failed to generate signature', error);
      throw new Error(`Signature generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Verify report signature for authenticity
   * Regenerates signature and compares with provided value
   * Returns false if signature does not match (potential tampering)
   * 
   * @param reportBuffer - Report file buffer to verify
   * @param signature - Provided signature to verify against
   * @param publicKey - Public key for signature verification (same as private for HMAC)
   * @returns true if signature is valid, false otherwise
   */
  async verifySignature(reportBuffer: Buffer, signature: string, publicKey: string): Promise<boolean> {
    this.log.info('Verifying report signature');

    try {
      const expectedSignature = await this.generateSignature(reportBuffer, publicKey);
      return signature === expectedSignature;
    } catch (error) {
      this.log.error('Failed to verify signature', error);
      return false;
    }
  }
}

/**
 * Singleton export for use throughout application
 */
export const reportFormatterService = new ReportFormatterService();
