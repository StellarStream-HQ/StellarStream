import { logger } from '../logger.js';

/**
 * Email service configuration from environment
 */
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = process.env.SMTP_PORT || '587';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASSWORD = process.env.SMTP_PASSWORD || '';
const MAIL_FROM = process.env.MAIL_FROM || 'noreply@stellarstream.com';

/**
 * Invitation email data
 */
export interface InvitationEmailData {
  inviteeEmail: string;
  organizationName: string;
  organizationGAddress: string;
  invitationToken: string; // Plaintext token
  expiresAt: Date;
  inviterName?: string;
}

/**
 * EmailService
 *
 * Sends transactional emails for invitation and member management notifications.
 * Email failures are best-effort only and do NOT block operations.
 *
 * **Validates: Requirements 11.1, 11.2, 11.3, 11.4**
 */
export class EmailService {
  /**
   * Send invitation email
   *
   * Email MUST be sent even if other errors occur in the request.
   * Failures do NOT block the operation - best-effort delivery.
   *
   * @param inviteeEmail - Email address to send to
   * @param inviteData - Invitation data
   * @returns void (failures are logged but not thrown)
   */
  async sendInvitation(inviteeEmail: string, inviteData: InvitationEmailData): Promise<void> {
    try {
      const acceptUrl = this.buildInvitationLink(inviteData.invitationToken);

      const htmlBody = `
        <h2>You're Invited to ${inviteData.organizationName}</h2>
        <p>Hi there,</p>
        <p>${inviteData.inviterName || 'An administrator'} has invited you to join <strong>${inviteData.organizationName}</strong> on StellarStream.</p>
        
        <h3>About This Organization</h3>
        <p><strong>Organization ID (G-address):</strong> ${inviteData.organizationGAddress}</p>
        
        <h3>Accept Your Invitation</h3>
        <p>
          <a href="${acceptUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">
            Accept Invitation
          </a>
        </p>
        
        <p>Or copy this link: <a href="${acceptUrl}">${acceptUrl}</a></p>
        
        <h3>Invitation Valid Until</h3>
        <p>${inviteData.expiresAt.toISOString()}</p>
        
        <p>This invitation will expire in 7 days.</p>
        
        <p>If you have any questions, please contact the organization administrator.</p>
        
        <p>Best regards,<br>StellarStream Team</p>
      `;

      const textBody = `
You're Invited to ${inviteData.organizationName}

Hi there,

${inviteData.inviterName || 'An administrator'} has invited you to join ${inviteData.organizationName} on StellarStream.

Accept your invitation here:
${acceptUrl}

This invitation will expire in 7 days on ${inviteData.expiresAt.toISOString()}.

If you have any questions, please contact the organization administrator.

Best regards,
StellarStream Team
      `;

      await this.sendEmail(inviteeEmail, `Invitation to ${inviteData.organizationName}`, textBody, htmlBody);

      logger.info('Invitation email sent', {
        inviteeEmail,
        organizationName: inviteData.organizationName,
      });
    } catch (error) {
      // Log but do not throw - invitation sends are best-effort
      logger.error('Failed to send invitation email', error, {
        inviteeEmail,
        organizationName: inviteData.organizationName,
      });
    }
  }

  /**
   * Send member added notification
   *
   * @param memberEmail - Email address to notify
   * @param memberName - Name of the added member
   * @param orgName - Organization name
   * @returns void (failures are logged but not thrown)
   */
  async sendMemberAdded(
    memberEmail: string,
    memberName: string,
    orgName: string
  ): Promise<void> {
    try {
      const subject = `Welcome to ${orgName}`;

      const htmlBody = `
        <h2>Welcome to ${orgName}</h2>
        <p>Hi ${memberName},</p>
        <p>Your membership in <strong>${orgName}</strong> has been confirmed!</p>
        <p>You can now access all organization resources on StellarStream.</p>
        <p>Best regards,<br>StellarStream Team</p>
      `;

      const textBody = `
Welcome to ${orgName}

Hi ${memberName},

Your membership in ${orgName} has been confirmed!

You can now access all organization resources on StellarStream.

Best regards,
StellarStream Team
      `;

      await this.sendEmail(memberEmail, subject, textBody, htmlBody);

      logger.info('Member added email sent', {
        memberEmail,
        orgName,
      });
    } catch (error) {
      // Log but do not throw
      logger.error('Failed to send member added email', error, {
        memberEmail,
        orgName,
      });
    }
  }

  /**
   * Send member removed notification
   *
   * @param memberEmail - Email address to notify
   * @param organizationName - Organization name
   * @param role - The role the member had in the organization
   * @returns void (failures are logged but not thrown)
   */
  async sendMemberRemoved(
    memberEmail: string,
    organizationName: string,
    role: string
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const subject = `${organizationName} Team: You have been removed from the organization`;

      const htmlBody = `
        <h2>You Have Been Removed from ${organizationName}</h2>
        <p>Hi there,</p>
        <p>Your access to <strong>${organizationName}</strong> has been revoked.</p>
        
        <h3>Removal Details</h3>
        <p><strong>Organization:</strong> ${organizationName}</p>
        <p><strong>Your Previous Role:</strong> ${role}</p>
        <p><strong>Removal Effective:</strong> ${timestamp}</p>
        
        <p>Your access to all organization resources, streams, and disbursements has been removed.</p>
        
        <p>No action is required from you.</p>
        
        <p>If you believe this is a mistake, please contact the organization administrator.</p>
        
        <p>Best regards,<br>StellarStream Team</p>
      `;

      const textBody = `
You Have Been Removed from ${organizationName}

Hi there,

Your access to ${organizationName} has been revoked.

Removal Details:
- Organization: ${organizationName}
- Your Previous Role: ${role}
- Removal Effective: ${timestamp}

Your access to all organization resources, streams, and disbursements has been removed.

No action is required from you.

If you believe this is a mistake, please contact the organization administrator.

Best regards,
StellarStream Team
      `;

      await this.sendEmail(memberEmail, subject, textBody, htmlBody);

      logger.info('Member removed email sent', {
        memberEmail,
        organizationName,
        role,
        timestamp,
      });
    } catch (error) {
      // Log but do not throw - best-effort delivery
      logger.error('Failed to send member removed email', error, {
        memberEmail,
        organizationName,
        role,
      });
    }
  }

  /**
   * Send role changed notification
   *
   * @param memberEmail - Email address to notify
   * @param newRole - New role assigned
   * @param orgName - Organization name
   * @returns void (failures are logged but not thrown)
   */
  async sendRoleChanged(
    memberEmail: string,
    newRole: string,
    orgName: string
  ): Promise<void> {
    try {
      const subject = `Your Role in ${orgName} Has Changed`;

      const htmlBody = `
        <h2>Role Updated</h2>
        <p>Hi there,</p>
        <p>Your role in <strong>${orgName}</strong> has been changed to <strong>${newRole}</strong>.</p>
        <p>This may affect what actions you can perform in the organization.</p>
        <p>If you have questions about your new role, please contact the organization administrator.</p>
        <p>Best regards,<br>StellarStream Team</p>
      `;

      const textBody = `
Role Updated

Hi there,

Your role in ${orgName} has been changed to ${newRole}.

This may affect what actions you can perform in the organization.

If you have questions about your new role, please contact the organization administrator.

Best regards,
StellarStream Team
      `;

      await this.sendEmail(memberEmail, subject, textBody, htmlBody);

      logger.info('Role changed email sent', {
        memberEmail,
        newRole,
        orgName,
      });
    } catch (error) {
      // Log but do not throw
      logger.error('Failed to send role changed email', error, {
        memberEmail,
        newRole,
        orgName,
      });
    }
  }

  /**
   * Send policy updated notification
   *
   * Optional policy change notifications sent to organization members.
   * These emails MAY use different authentication flows independent of invitation requirements.
   *
   * @param memberEmail - Email address to notify
   * @param organizationName - Organization name
   * @param changeDetails - Details of what changed (spending limit, asset whitelist, etc.)
   * @returns void (failures are logged but not thrown)
   */
  async sendPolicyUpdated(
    memberEmail: string,
    organizationName: string,
    changeDetails: string
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const subject = `${organizationName}: Organization Policy Updated`;

      const htmlBody = `
        <h2>Organization Policy Updated</h2>
        <p>Hi there,</p>
        <p>The organization policy for <strong>${organizationName}</strong> has been updated.</p>
        
        <h3>Policy Changes</h3>
        <p>${changeDetails}</p>
        
        <h3>Impact</h3>
        <p>This policy change may impact spending limits, disbursement processing, and asset management. Members who are drafters or approvers may need to take action.</p>
        
        <h3>Details</h3>
        <p><strong>Updated At:</strong> ${timestamp}</p>
        
        <p>For more information about the new policy, log in to StellarStream or contact the organization administrator.</p>
        
        <p>Best regards,<br>StellarStream Team</p>
      `;

      const textBody = `
Organization Policy Updated

Hi there,

The organization policy for ${organizationName} has been updated.

Policy Changes:
${changeDetails}

Impact:
This policy change may impact spending limits, disbursement processing, and asset management. Members who are drafters or approvers may need to take action.

Details:
- Updated At: ${timestamp}

For more information about the new policy, log in to StellarStream or contact the organization administrator.

Best regards,
StellarStream Team
      `;

      await this.sendEmail(memberEmail, subject, textBody, htmlBody);

      logger.info('Policy updated email sent', {
        memberEmail,
        organizationName,
        timestamp,
      });
    } catch (error) {
      // Log but do not throw - best-effort delivery
      logger.error('Failed to send policy updated email', error, {
        memberEmail,
        organizationName,
      });
    }
  }

  /**
   * Send invitation revoked notification
   *
   * @param inviteeEmail - Email address of the invitee
   * @param orgName - Organization name
   * @returns void (failures are logged but not thrown)
   */
  async sendInvitationRevoked(inviteeEmail: string, orgName: string): Promise<void> {
    try {
      const subject = `Invitation Revoked from ${orgName}`;

      const htmlBody = `
        <h2>Invitation Revoked</h2>
        <p>Hi there,</p>
        <p>Your invitation to join <strong>${orgName}</strong> on StellarStream has been revoked.</p>
        <p>You will no longer be able to accept this invitation.</p>
        <p>If you believe this is a mistake or would like to rejoin, please contact the organization administrator.</p>
        <p>Best regards,<br>StellarStream Team</p>
      `;

      const textBody = `
Invitation Revoked

Hi there,

Your invitation to join ${orgName} on StellarStream has been revoked.

You will no longer be able to accept this invitation.

If you believe this is a mistake or would like to rejoin, please contact the organization administrator.

Best regards,
StellarStream Team
      `;

      await this.sendEmail(inviteeEmail, subject, textBody, htmlBody);

      logger.info('Invitation revoked email sent', {
        inviteeEmail,
        orgName,
      });
    } catch (error) {
      // Log but do not throw
      logger.error('Failed to send invitation revoked email', error, {
        inviteeEmail,
        orgName,
      });
    }
  }

  /**
   * Send quota warning when organization approaches usage limits
   *
   * Only sends warnings when usage is greater than 80% of the limit.
   * Prevents spam by not sending for minor usage.
   *
   * @param organizationEmail - Organization admin email address
   * @param organizationName - Organization name
   * @param quotaType - Type of quota (e.g., "Disbursements", "Streams", "API Requests")
   * @param currentUsage - Current usage count
   * @param limit - Maximum allowed usage for billing period
   * @param percentageUsed - Percentage of quota used (0-100)
   * @returns void (failures are logged but not thrown)
   */
  async sendQuotaWarning(
    organizationEmail: string,
    organizationName: string,
    quotaType: string,
    currentUsage: number,
    limit: number,
    percentageUsed: number
  ): Promise<void> {
    // Only send if usage exceeds 80% threshold
    if (percentageUsed <= 80) {
      logger.debug('Quota warning threshold not met', {
        organizationName,
        quotaType,
        percentageUsed,
      });
      return;
    }

    try {
      const timestamp = new Date().toISOString();
      const subject = `${organizationName}: ${quotaType} Usage Warning (${percentageUsed}% full)`;

      const recommendations = this.getQuotaRecommendations(quotaType);

      const htmlBody = `
        <h2>Usage Limit Warning</h2>
        <p>Hi Organization Administrator,</p>
        <p>Your organization <strong>${organizationName}</strong> is approaching its usage limit for <strong>${quotaType}</strong>.</p>
        
        <h3>Current Usage</h3>
        <p><strong>${currentUsage} of ${limit} ${quotaType}</strong> (${percentageUsed}% of quota)</p>
        
        <h3>Recommendations</h3>
        <ul>
          ${recommendations.map((rec) => `<li>${rec}</li>`).join('\n')}
        </ul>
        
        <h3>Next Steps</h3>
        <p>
          <a href="${process.env.APP_URL || 'https://stellarstream.com'}/billing" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">
            View Billing & Usage Dashboard
          </a>
        </p>
        
        <h3>Details</h3>
        <p><strong>Warning Generated At:</strong> ${timestamp}</p>
        
        <p>If you need to increase your quota or upgrade your plan, please contact our support team.</p>
        
        <p>Best regards,<br>StellarStream Team</p>
      `;

      const textBody = `
Usage Limit Warning

Hi Organization Administrator,

Your organization ${organizationName} is approaching its usage limit for ${quotaType}.

Current Usage:
${currentUsage} of ${limit} ${quotaType} (${percentageUsed}% of quota)

Recommendations:
${recommendations.map((rec) => `- ${rec}`).join('\n')}

Next Steps:
View your billing and usage dashboard: ${process.env.APP_URL || 'https://stellarstream.com'}/billing

Details:
- Warning Generated At: ${timestamp}

If you need to increase your quota or upgrade your plan, please contact our support team.

Best regards,
StellarStream Team
      `;

      await this.sendEmail(organizationEmail, subject, textBody, htmlBody);

      logger.info('Quota warning email sent', {
        organizationEmail,
        organizationName,
        quotaType,
        currentUsage,
        limit,
        percentageUsed,
        timestamp,
      });
    } catch (error) {
      // Log but do not throw - best-effort delivery
      logger.error('Failed to send quota warning email', error, {
        organizationEmail,
        organizationName,
        quotaType,
      });
    }
  }

  /**
   * Get quota-specific recommendations for the admin
   * @param quotaType - Type of quota
   * @returns Array of recommendation strings
   */
  private getQuotaRecommendations(quotaType: string): string[] {
    const baseRecommendations = [
      'Review your organization usage patterns and optimize resource allocation',
      'Consider upgrading your subscription plan for increased limits',
    ];

    const typeSpecificRecommendations: Record<string, string[]> = {
      Disbursements: [
        'Consolidate multiple small disbursements into fewer larger ones',
        'Review and cancel any unnecessary recurring disbursements',
        'Schedule disbursements to spread load across billing periods',
      ],
      Streams: [
        'Archive or close inactive streams',
        'Consolidate multiple streams into fewer high-volume ones',
        'Review stream settings and pause non-essential streams',
      ],
      'API Requests': [
        'Implement caching to reduce API call frequency',
        'Batch API requests when possible',
        'Review monitoring and logging configurations for unnecessary calls',
      ],
    };

    const specific = typeSpecificRecommendations[quotaType] || [];
    return [...specific, ...baseRecommendations];
  }

  /**
   * Send email via SMTP
   *
   * @param to - Recipient email address
   * @param subject - Email subject
   * @param text - Plain text body
   * @param html - HTML body
   * @throws Error if SMTP is not configured
   */
  private async sendEmail(
    to: string,
    subject: string,
    text: string,
    html: string
  ): Promise<void> {
    // Check if SMTP is configured
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) {
      logger.warn('SMTP not configured - email not sent', {
        to,
        subject,
      });
      return;
    }

    try {
      // Dynamic import to avoid hard dependency
      const nodemailer = await import('nodemailer');

      const transporter = nodemailer.default.createTransport({
        host: SMTP_HOST,
        port: parseInt(SMTP_PORT, 10),
        secure: parseInt(SMTP_PORT, 10) === 465, // Use TLS for port 465
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASSWORD,
        },
      });

      await transporter.sendMail({
        from: MAIL_FROM,
        to,
        subject,
        text,
        html,
      });

      logger.debug('Email sent successfully', {
        to,
        subject,
      });
    } catch (error) {
      logger.error('Failed to send email', error, {
        to,
        subject,
      });
      throw error;
    }
  }

  /**
   * Build invitation acceptance URL
   */
  private buildInvitationLink(token: string): string {
    const baseUrl = process.env.APP_URL || 'https://stellarstream.com';
    return `${baseUrl}/accept-invite?token=${encodeURIComponent(token)}`;
  }
}

// Export singleton instance
export const emailService = new EmailService();
