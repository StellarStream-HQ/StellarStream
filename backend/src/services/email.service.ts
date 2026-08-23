/**
 * Email Notification Service
 *
 * Sends transactional emails for payment confirmations, stream status updates,
 * security alerts, and weekly summaries. Tracks delivery status in the
 * EmailDelivery table for auditing and monitoring.
 *
 * Uses nodemailer (already in dependencies) for SMTP transport.
 * Configure via environment variables:
 *   - SMTP_HOST       (default: smtp.mailtrap.io)
 *   - SMTP_PORT       (default: 587)
 *   - SMTP_USER       (default: "")
 *   - SMTP_PASS       (default: "")
 *   - EMAIL_FROM      (default: "noreply@stellarstream.io")
 *   - EMAIL_FROM_NAME (default: "StellarStream")
 */

import nodemailer from "nodemailer";
import { prisma } from "../lib/db.js";
import { logger } from "../logger.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PaymentConfirmationData {
    txHash: string;
    amount: string;
    asset: string;
    sender: string;
    receiver: string;
    streamId?: string;
    timestamp: string;
}

export interface StreamStatusData {
    streamId: string;
    previousStatus: string;
    newStatus: string;
    sender: string;
    receiver: string;
    amount: string;
    asset: string;
    timestamp: string;
}

export interface SecurityAlertData {
    alertType: "login_new_device" | "permission_change" | "suspicious_activity" | "wallet_disconnected";
    device?: string;
    location?: string;
    ipAddress?: string;
    timestamp: string;
    details?: string;
}

export interface WeeklySummaryData {
    stellarAddress: string;
    periodStart: string;
    periodEnd: string;
    totalStreamed: string;
    activeStreams: number;
    newStreams: number;
    completedStreams: number;
    totalFees: string;
    topStreams: Array<{ streamId: string; amount: string; asset: string; receiver: string }>;
}

type EmailTemplateData =
    | { template: "payment_confirmation"; data: PaymentConfirmationData }
    | { template: "stream_status"; data: StreamStatusData }
    | { template: "security_alert"; data: SecurityAlertData }
    | { template: "weekly_summary"; data: WeeklySummaryData };

// ── Transporter ───────────────────────────────────────────────────────────────

function createTransporter() {
    const host = process.env.SMTP_HOST || "smtp.mailtrap.io";
    const port = parseInt(process.env.SMTP_PORT || "587", 10);
    const user = process.env.SMTP_USER || "";
    const pass = process.env.SMTP_PASS || "";

    // In test mode, use a JSON logger instead of real SMTP
    if (process.env.NODE_ENV === "test") {
        return nodemailer.createTransport({ jsonTransport: true });
    }

    // If no SMTP credentials, log emails instead of sending
    if (!user || !pass) {
        logger.warn("[EmailService] No SMTP credentials configured. Emails will be logged only.");
        return nodemailer.createTransport({ jsonTransport: true });
    }

    return nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
    });
}

let transporter = createTransporter();

// Reset transporter (useful in tests)
export function resetTransporter(): void {
    transporter = createTransporter();
}

// ─── Email Template Builders ─────────────────────────────────────────────────

function buildSubject(template: string, data: unknown): string {
    switch (template) {
        case "payment_confirmation": {
            const d = data as PaymentConfirmationData;
            return `✅ Payment Confirmed — ${d.amount} ${d.asset}`;
        }
        case "stream_status": {
            const d = data as StreamStatusData;
            const statusLabels: Record<string, string> = {
                ACTIVE: "Active",
                PAUSED: "Paused",
                COMPLETED: "Completed",
                CANCELED: "Cancelled",
            };
            return `🔄 Stream ${statusLabels[d.newStatus] || d.newStatus} — ${d.streamId}`;
        }
        case "security_alert": {
            const d = data as SecurityAlertData;
            const alertLabels: Record<string, string> = {
                login_new_device: "New Device Login",
                permission_change: "Permission Changed",
                suspicious_activity: "Suspicious Activity Detected",
                wallet_disconnected: "Wallet Disconnected",
            };
            return `🔒 Security Alert — ${alertLabels[d.alertType] || "Alert"}`;
        }
        case "weekly_summary": {
            return `📊 Your Weekly StellarStream Summary`;
        }
        default:
            return "Notification from StellarStream";
    }
}

function buildHtml(template: string, data: unknown): string {
    switch (template) {
        case "payment_confirmation":
            return buildPaymentConfirmationHtml(data as PaymentConfirmationData);
        case "stream_status":
            return buildStreamStatusHtml(data as StreamStatusData);
        case "security_alert":
            return buildSecurityAlertHtml(data as SecurityAlertData);
        case "weekly_summary":
            return buildWeeklySummaryHtml(data as WeeklySummaryData);
        default:
            return "<p>Notification from StellarStream</p>";
    }
}

// ── Email Template HTML Builders ──────────────────────────────────────────────

const BASE_STYLES = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 0; }
  .container { max-width: 600px; margin: 0 auto; padding: 32px 24px; }
  .header { text-align: center; padding: 24px 0; border-bottom: 1px solid rgba(255,255,255,0.1); }
  .header h1 { font-size: 24px; font-weight: 700; color: #00f5ff; margin: 0; }
  .header p { font-size: 12px; color: rgba(255,255,255,0.4); margin: 4px 0 0; }
  .body { padding: 24px 0; }
  .footer { text-align: center; padding: 24px 0; border-top: 1px solid rgba(255,255,255,0.1); font-size: 12px; color: rgba(255,255,255,0.3); }
  .card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
  .label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: rgba(255,255,255,0.3); margin-bottom: 4px; }
  .value { font-size: 14px; font-weight: 600; color: #e2e8f0; margin-bottom: 12px; }
  .value.mono { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 13px; }
  .badge { display: inline-block; padding: 4px 12px; border-radius: 99px; font-size: 12px; font-weight: 600; }
  .badge.success { background: rgba(52,211,153,0.15); color: #34d399; border: 1px solid rgba(52,211,153,0.3); }
  .badge.warning { background: rgba(251,191,36,0.15); color: #fbbf24; border: 1px solid rgba(251,191,36,0.3); }
  .badge.error { background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }
  .badge.info { background: rgba(0,245,255,0.15); color: #00f5ff; border: 1px solid rgba(0,245,255,0.3); }
  .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .row:last-child { border-bottom: none; }
  .highlight { color: #00f5ff; }
  .btn { display: inline-block; padding: 12px 24px; background: #00f5ff; color: #0f172a; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 14px; margin-top: 16px; }
  .btn:hover { background: #00d4dd; }
  a { color: #00f5ff; text-decoration: underline; }
  .tx-hash { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; color: rgba(255,255,255,0.5); word-break: break-all; }
`;

function buildPaymentConfirmationHtml(data: PaymentConfirmationData): string {
    return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><style>${BASE_STYLES}</style></head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✅ Payment Confirmed</h1>
          <p>Your transaction has been processed successfully</p>
        </div>
        <div class="body">
          <div class="card">
            <div class="label">Amount</div>
            <div class="value" style="font-size: 28px; color: #34d399;">${data.amount} ${data.asset}</div>

            <div class="row">
              <div><div class="label">From</div><div class="value mono" style="font-size: 12px;">${data.sender}</div></div>
              <div><div class="label">To</div><div class="value mono" style="font-size: 12px;">${data.receiver}</div></div>
            </div>

            <div class="label" style="margin-top: 12px;">Transaction Hash</div>
            <div class="tx-hash">${data.txHash}</div>

            ${data.streamId ? `<div class="label" style="margin-top: 12px;">Stream ID</div><div class="value mono" style="font-size: 12px;">${data.streamId}</div>` : ""}

            <div class="label" style="margin-top: 12px;">Timestamp</div>
            <div class="value" style="font-size: 12px;">${new Date(data.timestamp).toLocaleString()}</div>
          </div>
          <div style="text-align: center;">
            <a href="https://stellar.expert/explorer/testnet/tx/${data.txHash}" class="btn">View on Stellar Expert</a>
          </div>
        </div>
        <div class="footer">
          <p>StellarStream — Real-time asset streaming on Stellar</p>
          <p>If you did not make this transaction, please contact support immediately.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function buildStreamStatusHtml(data: StreamStatusData): string {
    const statusBadge = (status: string): string => {
        const map: Record<string, string> = {
            ACTIVE: "success",
            PAUSED: "warning",
            COMPLETED: "info",
            CANCELED: "error",
        };
        const cls = map[status] || "info";
        return `<span class="badge ${cls}">${status}</span>`;
    };

    return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><style>${BASE_STYLES}</style></head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🔄 Stream Status Update</h1>
          <p>A stream in your wallet has changed status</p>
        </div>
        <div class="body">
          <div class="card">
            <div class="row">
              <div><div class="label">Stream ID</div><div class="value mono">${data.streamId}</div></div>
              <div>
                <div class="label">Status</div>
                <div>${statusBadge(data.newStatus)}</div>
              </div>
            </div>

            <div class="label" style="margin-top: 12px;">Previous Status</div>
            <div>${statusBadge(data.previousStatus)}</div>

            <div class="row" style="margin-top: 12px;">
              <div><div class="label">From</div><div class="value mono" style="font-size: 12px;">${data.sender}</div></div>
              <div><div class="label">To</div><div class="value mono" style="font-size: 12px;">${data.receiver}</div></div>
            </div>

            <div class="label" style="margin-top: 12px;">Amount</div>
            <div class="value">${data.amount} ${data.asset}</div>

            <div class="label" style="margin-top: 12px;">Timestamp</div>
            <div class="value" style="font-size: 12px;">${new Date(data.timestamp).toLocaleString()}</div>
          </div>
          <div style="text-align: center;">
            <a href="${process.env.FRONTEND_URL || "http://localhost:5173"}/dashboard/streams" class="btn">View in Dashboard</a>
          </div>
        </div>
        <div class="footer">
          <p>StellarStream — Real-time asset streaming on Stellar</p>
          <p>Manage your notification preferences in Settings.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function buildSecurityAlertHtml(data: SecurityAlertData): string {
    const alertIcons: Record<string, string> = {
        login_new_device: "🔐",
        permission_change: "⚙️",
        suspicious_activity: "⚠️",
        wallet_disconnected: "🔌",
    };

    const alertTitles: Record<string, string> = {
        login_new_device: "New Device Login",
        permission_change: "Permission Changed",
        suspicious_activity: "Suspicious Activity Detected",
        wallet_disconnected: "Wallet Disconnected",
    };

    return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><style>${BASE_STYLES}</style></head>
    <body>
      <div class="container">
        <div class="header">
          <h1>${alertIcons[data.alertType] || "🔒"} Security Alert</h1>
          <p>${alertTitles[data.alertType] || "Security Event"}</p>
        </div>
        <div class="body">
          <div class="card" style="border-color: rgba(239,68,68,0.3);">
            <div class="label">Alert Type</div>
            <div class="value"><span class="badge error">${alertTitles[data.alertType] || data.alertType}</span></div>

            ${data.device ? `<div class="label" style="margin-top: 12px;">Device</div><div class="value">${data.device}</div>` : ""}
            ${data.location ? `<div class="label" style="margin-top: 12px;">Location</div><div class="value">${data.location}</div>` : ""}
            ${data.ipAddress ? `<div class="label" style="margin-top: 12px;">IP Address</div><div class="value mono">${data.ipAddress}</div>` : ""}
            ${data.details ? `<div class="label" style="margin-top: 12px;">Details</div><div class="value">${data.details}</div>` : ""}

            <div class="label" style="margin-top: 12px;">Timestamp</div>
            <div class="value" style="font-size: 12px;">${new Date(data.timestamp).toLocaleString()}</div>
          </div>
          <div style="text-align: center; margin-top: 16px;">
            <p style="color: rgba(255,255,255,0.5); font-size: 13px; line-height: 1.5;">
              If this was not you, please secure your account immediately.
            </p>
            <a href="${process.env.FRONTEND_URL || "http://localhost:5173"}/dashboard/settings" class="btn" style="background: #ef4444; color: #fff;">Review Activity</a>
          </div>
        </div>
        <div class="footer">
          <p>StellarStream — Real-time asset streaming on Stellar</p>
          <p>This is an automated security alert. Do not reply to this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function buildWeeklySummaryHtml(data: WeeklySummaryData): string {
    const topStreamsHtml = data.topStreams
        .map(
            (s) => `
    <div class="row">
      <div><div class="value mono" style="font-size: 11px;">${s.streamId}</div><div class="label">${s.receiver}</div></div>
      <div><div class="value" style="text-align: right;">${s.amount} ${s.asset}</div></div>
    </div>
  `
        )
        .join("");

    return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><style>${BASE_STYLES}</style></head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📊 Weekly Summary</h1>
          <p>${new Date(data.periodStart).toLocaleDateString()} — ${new Date(data.periodEnd).toLocaleDateString()}</p>
        </div>
        <div class="body">
          <!-- Key Stats -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
            <div class="card" style="text-align: center;">
              <div class="label">Total Streamed</div>
              <div class="value" style="font-size: 22px; color: #34d399;">${data.totalStreamed}</div>
            </div>
            <div class="card" style="text-align: center;">
              <div class="label">Active Streams</div>
              <div class="value" style="font-size: 22px; color: #00f5ff;">${data.activeStreams}</div>
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 16px;">
            <div class="card" style="text-align: center; padding: 12px;">
              <div class="label">New</div>
              <div class="value" style="font-size: 18px; color: #34d399;">${data.newStreams}</div>
            </div>
            <div class="card" style="text-align: center; padding: 12px;">
              <div class="label">Completed</div>
              <div class="value" style="font-size: 18px; color: #00f5ff;">${data.completedStreams}</div>
            </div>
            <div class="card" style="text-align: center; padding: 12px;">
              <div class="label">Fees</div>
              <div class="value" style="font-size: 18px; color: #fbbf24;">${data.totalFees}</div>
            </div>
          </div>

          ${topStreamsHtml ? `
          <div class="card">
            <div class="label" style="margin-bottom: 8px;">Top Streams by Volume</div>
            ${topStreamsHtml}
          </div>
          ` : ""}

          <div style="text-align: center;">
            <a href="${process.env.FRONTEND_URL || "http://localhost:5173"}/dashboard" class="btn">Open Dashboard</a>
          </div>
        </div>
        <div class="footer">
          <p>StellarStream — Real-time asset streaming on Stellar</p>
          <p>You received this email because you subscribed to weekly summaries.</p>
          <p><a href="${process.env.FRONTEND_URL || "http://localhost:5173"}/dashboard/settings">Manage preferences</a></p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// ─── Delivery Tracking ────────────────────────────────────────────────────────

async function trackDelivery(params: {
    stellarAddress: string;
    email: string;
    template: string;
    subject: string;
    status: "SENT" | "DELIVERED" | "OPENED" | "BOUNCED" | "FAILED";
    errorMessage?: string;
    metadata?: Record<string, unknown>;
}): Promise<void> {
    try {
        await prisma.emailDelivery.create({
            data: {
                stellarAddress: params.stellarAddress,
                email: params.email,
                template: params.template,
                subject: params.subject,
                status: params.status,
                errorMessage: params.errorMessage,
                metadata: (params.metadata as Record<string, unknown>) || undefined,
                sentAt: new Date(),
                deliveredAt: params.status === "DELIVERED" ? new Date() : undefined,
            },
        });
    } catch (err) {
        logger.error("[EmailService] Failed to track delivery", { err, email: params.email });
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class EmailService {
    /**
     * Send an email notification and track delivery.
     * Returns true if the email was sent successfully.
     */
    async sendEmail(params: {
        stellarAddress: string;
        email: string;
        template: string;
        data: unknown;
    }): Promise<boolean> {
        const { stellarAddress, email, template, data } = params;

        try {
            const subject = buildSubject(template, data);
            const html = buildHtml(template, data);

            const info = await transporter.sendMail({
                from: {
                    name: process.env.EMAIL_FROM_NAME || "StellarStream",
                    address: process.env.EMAIL_FROM || "noreply@stellarstream.io",
                },
                to: email,
                subject,
                html,
            });

            logger.info("[EmailService] Email sent", {
                template,
                email,
                messageId: info.messageId,
            });

            // Track as SENT (we don't have actual delivery/read receipts from SMTP)
            await trackDelivery({
                stellarAddress,
                email,
                template,
                subject,
                status: "SENT",
                metadata: data as Record<string, unknown>,
            });

            return true;
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Unknown error";
            logger.error("[EmailService] Failed to send email", {
                template,
                email,
                error: errorMessage,
            });

            // Track as FAILED
            await trackDelivery({
                stellarAddress,
                email,
                template: params.template,
                subject: buildSubject(template, data),
                status: "FAILED",
                errorMessage,
                metadata: params.data as Record<string, unknown>,
            });

            return false;
        }
    }

    /**
     * Send a payment confirmation email.
     */
    async sendPaymentConfirmation(
        stellarAddress: string,
        email: string,
        data: PaymentConfirmationData
    ): Promise<boolean> {
        return this.sendEmail({
            stellarAddress,
            email,
            template: "payment_confirmation",
            data,
        });
    }

    /**
     * Send a stream status update email.
     */
    async sendStreamStatusUpdate(
        stellarAddress: string,
        email: string,
        data: StreamStatusData
    ): Promise<boolean> {
        return this.sendEmail({
            stellarAddress,
            email,
            template: "stream_status",
            data,
        });
    }

    /**
     * Send a security alert email.
     */
    async sendSecurityAlert(
        stellarAddress: string,
        email: string,
        data: SecurityAlertData
    ): Promise<boolean> {
        return this.sendEmail({
            stellarAddress,
            email,
            template: "security_alert",
            data,
        });
    }

    /**
     * Send a weekly summary email.
     */
    async sendWeeklySummary(
        stellarAddress: string,
        email: string,
        data: WeeklySummaryData
    ): Promise<boolean> {
        return this.sendEmail({
            stellarAddress,
            email,
            template: "weekly_summary",
            data,
        });
    }

    /**
     * Get delivery history for a Stellar address.
     */
    async getDeliveryHistory(
        stellarAddress: string,
        limit: number = 20,
        offset: number = 0
    ): Promise<{
        deliveries: Array<{
            id: string;
            template: string;
            subject: string;
            status: string;
            errorMessage: string | null;
            sentAt: Date;
            deliveredAt: Date | null;
            openedAt: Date | null;
        }>;
        total: number;
    }> {
        const [deliveries, total] = await Promise.all([
            prisma.emailDelivery.findMany({
                where: { stellarAddress },
                orderBy: { sentAt: "desc" },
                take: limit,
                skip: offset,
                select: {
                    id: true,
                    template: true,
                    subject: true,
                    status: true,
                    errorMessage: true,
                    sentAt: true,
                    deliveredAt: true,
                    openedAt: true,
                },
            }),
            prisma.emailDelivery.count({ where: { stellarAddress } }),
        ]);

        return { deliveries, total };
    }

    /**
     * Get notification preferences for a Stellar address.
     */
    async getPreferences(stellarAddress: string): Promise<{
        email: string | null;
        emailVerified: boolean;
        paymentConfirmations: boolean;
        streamStatusUpdates: boolean;
        securityAlerts: boolean;
        weeklySummaries: boolean;
    } | null> {
        const pref = await prisma.notificationPreference.findUnique({
            where: { stellarAddress_platform: { stellarAddress, platform: "email" as any } },
        });

        if (!pref) return null;

        return {
            email: pref.email,
            emailVerified: pref.emailVerified,
            paymentConfirmations: pref.paymentConfirmations,
            streamStatusUpdates: pref.streamStatusUpdates,
            securityAlerts: pref.securityAlerts,
            weeklySummaries: pref.weeklySummaries,
        };
    }

    /**
     * Upsert notification preferences for a Stellar address.
     */
    async upsertPreferences(
        stellarAddress: string,
        data: {
            email: string;
            paymentConfirmations?: boolean;
            streamStatusUpdates?: boolean;
            securityAlerts?: boolean;
            weeklySummaries?: boolean;
        }
    ): Promise<void> {
        await prisma.notificationPreference.upsert({
            where: { stellarAddress_platform: { stellarAddress, platform: "email" as any } },
            update: {
                email: data.email,
                emailVerified: false, // Reset verification on email change
                ...(data.paymentConfirmations !== undefined && { paymentConfirmations: data.paymentConfirmations }),
                ...(data.streamStatusUpdates !== undefined && { streamStatusUpdates: data.streamStatusUpdates }),
                ...(data.securityAlerts !== undefined && { securityAlerts: data.securityAlerts }),
                ...(data.weeklySummaries !== undefined && { weeklySummaries: data.weeklySummaries }),
            },
            create: {
                stellarAddress,
                platform: "email" as any,
                email: data.email,
                paymentConfirmations: data.paymentConfirmations ?? true,
                streamStatusUpdates: data.streamStatusUpdates ?? true,
                securityAlerts: data.securityAlerts ?? true,
                weeklySummaries: data.weeklySummaries ?? false,
            },
        });
    }

    /**
     * Get all email preferences that have weekly summaries enabled.
     * Used by the weekly summary cron job.
     */
    async getWeeklySummarySubscribers(): Promise<
        Array<{
            stellarAddress: string;
            email: string;
        }>
    > {
        const prefs = await prisma.notificationPreference.findMany({
            where: {
                platform: "email" as any,
                weeklySummaries: true,
                isActive: true,
                email: { not: null },
            },
            select: {
                stellarAddress: true,
                email: true,
            },
        });

        return prefs.filter((p): p is { stellarAddress: string; email: string } => p.email !== null);
    }

    /**
     * Send weekly summaries to all subscribers.
     * Called by the weekly cron job scheduler.
     */
    async sendWeeklySummaries(): Promise<{ sent: number; failed: number }> {
        const subscribers = await this.getWeeklySummarySubscribers();
        let sent = 0;
        let failed = 0;

        const periodEnd = new Date();
        const periodStart = new Date(periodEnd);
        periodStart.setDate(periodStart.getDate() - 7);

        for (const sub of subscribers) {
            try {
                // Gather summary data for this address
                const streams = await prisma.stream.findMany({
                    where: {
                        OR: [{ sender: sub.stellarAddress }, { receiver: sub.stellarAddress }],
                        createdAt: { gte: periodStart },
                    },
                    select: {
                        streamId: true,
                        amount: true,
                        tokenAddress: true,
                        sender: true,
                        receiver: true,
                        status: true,
                    },
                });

                const activeStreams = streams.filter((s) => s.status === "ACTIVE").length;
                const completedStreams = streams.filter((s) => s.status === "COMPLETED").length;
                const newStreams = streams.length;
                const totalStreamed = streams
                    .filter((s) => s.sender === sub.stellarAddress)
                    .reduce((sum, s) => sum + BigInt(s.amount || "0"), 0n)
                    .toString();

                const topStreams = streams
                    .filter((s) => s.sender === sub.stellarAddress)
                    .sort((a, b) => {
                        const aAmt = BigInt(a.amount || "0");
                        const bAmt = BigInt(b.amount || "0");
                        return bAmt > aAmt ? 1 : -1;
                    })
                    .slice(0, 5)
                    .map((s) => ({
                        streamId: s.streamId || "unknown",
                        amount: s.amount || "0",
                        asset: s.tokenAddress || "XLM",
                        receiver: s.receiver,
                    }));

                const summaryData: WeeklySummaryData = {
                    stellarAddress: sub.stellarAddress,
                    periodStart: periodStart.toISOString(),
                    periodEnd: periodEnd.toISOString(),
                    totalStreamed,
                    activeStreams,
                    newStreams,
                    completedStreams,
                    totalFees: "0", // Fee calculation TBD
                    topStreams,
                };

                const ok = await this.sendWeeklySummary(sub.stellarAddress, sub.email, summaryData);
                if (ok) sent++;
                else failed++;
            } catch (err) {
                logger.error("[EmailService] Weekly summary failed", {
                    stellarAddress: sub.stellarAddress,
                    err,
                });
                failed++;
            }
        }

        logger.info("[EmailService] Weekly summaries dispatched", { sent, failed, total: subscribers.length });
        return { sent, failed };
    }
}

// Singleton instance
export const emailService = new EmailService();

