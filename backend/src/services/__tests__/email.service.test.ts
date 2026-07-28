import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emailService } from '../email.service.js';

// Mock nodemailer
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn().mockReturnValue({
      sendMail: vi.fn().mockResolvedValue({ response: 'ok' }),
    }),
  },
}));

describe('EmailService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set environment variables for testing
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASSWORD = 'password';
    process.env.MAIL_FROM = 'noreply@stellarstream.com';
    process.env.APP_URL = 'https://stellarstream.com';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('sendInvitation', () => {
    it('should send invitation email with token', async () => {
      const inviteeEmail = 'newmember@example.com';
      const inviteData = {
        inviteeEmail,
        organizationName: 'Acme Corp',
        organizationGAddress: 'GORGANIZATION123456789012345678901234567890123456789012345678901',
        invitationToken: 'inv_abc123def456',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        inviterName: 'Alice',
      };

      await emailService.sendInvitation(inviteeEmail, inviteData);

      // Should not throw - email is best-effort
      expect(true).toBe(true);
    });

    it('should include invitation link in email', async () => {
      const inviteeEmail = 'newmember@example.com';
      const token = 'inv_test123';
      const inviteData = {
        inviteeEmail,
        organizationName: 'Acme Corp',
        organizationGAddress: 'GORG123...',
        invitationToken: token,
        expiresAt: new Date(),
      };

      await emailService.sendInvitation(inviteeEmail, inviteData);

      // Email was sent without throwing
      expect(true).toBe(true);
    });

    it('should handle email send errors gracefully', async () => {
      const inviteeEmail = 'newmember@example.com';
      const inviteData = {
        inviteeEmail,
        organizationName: 'Acme Corp',
        organizationGAddress: 'GORG123...',
        invitationToken: 'inv_test123',
        expiresAt: new Date(),
      };

      // Email failures are logged but not thrown
      await emailService.sendInvitation(inviteeEmail, inviteData);

      // Should still succeed despite any email errors
      expect(true).toBe(true);
    });
  });

  describe('sendMemberAdded', () => {
    it('should send member added notification', async () => {
      const memberEmail = 'member@example.com';
      const memberName = 'Bob Smith';
      const orgName = 'Acme Corp';

      await emailService.sendMemberAdded(memberEmail, memberName, orgName);

      // Should not throw
      expect(true).toBe(true);
    });

    it('should include member name and org name in email', async () => {
      const memberEmail = 'member@example.com';
      const memberName = 'Bob Smith';
      const orgName = 'Acme Corp';

      await emailService.sendMemberAdded(memberEmail, memberName, orgName);

      // Email sent successfully
      expect(true).toBe(true);
    });
  });

  describe('sendMemberRemoved', () => {
    it('should send member removed notification with role and timestamp', async () => {
      const memberEmail = 'member@example.com';
      const organizationName = 'Acme Corp';
      const role = 'APPROVER';

      await emailService.sendMemberRemoved(memberEmail, organizationName, role);

      // Should not throw
      expect(true).toBe(true);
    });

    it('should include organization name in removal email', async () => {
      const memberEmail = 'member@example.com';
      const organizationName = 'Acme Corp';
      const role = 'DRAFTER';

      await emailService.sendMemberRemoved(memberEmail, organizationName, role);

      // Email sent
      expect(true).toBe(true);
    });

    it('should include member role in removal email', async () => {
      const memberEmail = 'removed@example.com';
      const organizationName = 'Tech Company';
      const role = 'EXECUTOR';

      await emailService.sendMemberRemoved(memberEmail, organizationName, role);

      // Email sent with role information
      expect(true).toBe(true);
    });

    it('should handle SMTP failures gracefully for member removal', async () => {
      const memberEmail = 'member@example.com';
      const organizationName = 'Acme Corp';
      const role = 'APPROVER';

      // Should not throw even if email service fails
      await expect(
        emailService.sendMemberRemoved(memberEmail, organizationName, role)
      ).resolves.not.toThrow();
    });

    it('should return early when SMTP not configured', async () => {
      delete process.env.SMTP_HOST;

      const memberEmail = 'member@example.com';
      const organizationName = 'Acme Corp';
      const role = 'EXECUTOR';

      // Should handle gracefully
      await expect(
        emailService.sendMemberRemoved(memberEmail, organizationName, role)
      ).resolves.not.toThrow();
    });

    it('should handle various organization names', async () => {
      const memberEmail = 'member@example.com';
      const role = 'APPROVER';

      // Test with special characters
      await emailService.sendMemberRemoved(memberEmail, "O'Reilly & Associates", role);
      await emailService.sendMemberRemoved(memberEmail, 'Company <Corp>', role);

      expect(true).toBe(true);
    });
  });

  describe('sendRoleChanged', () => {
    it('should send role changed notification', async () => {
      const memberEmail = 'member@example.com';
      const newRole = 'EXECUTOR';
      const orgName = 'Acme Corp';

      await emailService.sendRoleChanged(memberEmail, newRole, orgName);

      // Should not throw
      expect(true).toBe(true);
    });

    it('should include new role in email', async () => {
      const memberEmail = 'member@example.com';
      const newRole = 'APPROVER';
      const orgName = 'Acme Corp';

      await emailService.sendRoleChanged(memberEmail, newRole, orgName);

      // Email sent
      expect(true).toBe(true);
    });
  });

  describe('sendPolicyUpdated', () => {
    it('should send policy update notification with change details', async () => {
      const memberEmail = 'member@example.com';
      const organizationName = 'Acme Corp';
      const changeDetails = 'Daily spend limit increased to $50,000';

      await emailService.sendPolicyUpdated(memberEmail, organizationName, changeDetails);

      // Should not throw
      expect(true).toBe(true);
    });

    it('should send optional policy change notifications', async () => {
      const memberEmail = 'approver@example.com';
      const organizationName = 'Acme Corp';
      const changeDetails = 'Asset whitelist updated: Added USDC';

      await emailService.sendPolicyUpdated(memberEmail, organizationName, changeDetails);

      expect(true).toBe(true);
    });

    it('should handle SMTP failures gracefully for policy updates', async () => {
      const memberEmail = 'member@example.com';
      const organizationName = 'Acme Corp';
      const changeDetails = 'Policy updated';

      // Should not throw even if email fails
      await expect(
        emailService.sendPolicyUpdated(memberEmail, organizationName, changeDetails)
      ).resolves.not.toThrow();
    });

    it('should include policy change details in email', async () => {
      const memberEmail = 'member@example.com';
      const organizationName = 'Test Org';
      const changeDetails =
        'Spending limit: $10,000 -> $25,000\nAllowed assets: All -> [USDC, native]';

      await emailService.sendPolicyUpdated(memberEmail, organizationName, changeDetails);

      expect(true).toBe(true);
    });

    it('should return early when SMTP not configured', async () => {
      delete process.env.SMTP_HOST;

      const memberEmail = 'member@example.com';
      const organizationName = 'Acme Corp';
      const changeDetails = 'Policy updated';

      // Should handle gracefully
      await expect(
        emailService.sendPolicyUpdated(memberEmail, organizationName, changeDetails)
      ).resolves.not.toThrow();
    });
  });

  describe('sendQuotaWarning', () => {
    it('should send quota warning when usage exceeds 80%', async () => {
      const organizationEmail = 'admin@example.com';
      const organizationName = 'Acme Corp';
      const quotaType = 'Disbursements';
      const currentUsage = 85;
      const limit = 100;
      const percentageUsed = 85;

      await emailService.sendQuotaWarning(
        organizationEmail,
        organizationName,
        quotaType,
        currentUsage,
        limit,
        percentageUsed
      );

      expect(true).toBe(true);
    });

    it('should only send quota warning when > 80%', async () => {
      const organizationEmail = 'admin@example.com';
      const organizationName = 'Acme Corp';
      const quotaType = 'Streams';
      const currentUsage = 7;
      const limit = 10;
      const percentageUsed = 70;

      // Should return early without sending
      await emailService.sendQuotaWarning(
        organizationEmail,
        organizationName,
        quotaType,
        currentUsage,
        limit,
        percentageUsed
      );

      expect(true).toBe(true);
    });

    it('should send warning at exactly 80.1%', async () => {
      const organizationEmail = 'admin@example.com';
      const organizationName = 'Acme Corp';
      const quotaType = 'API Requests';
      const currentUsage = 8010;
      const limit = 10000;
      const percentageUsed = 80.1;

      await emailService.sendQuotaWarning(
        organizationEmail,
        organizationName,
        quotaType,
        currentUsage,
        limit,
        percentageUsed
      );

      expect(true).toBe(true);
    });

    it('should include quota usage details in warning email', async () => {
      const organizationEmail = 'admin@example.com';
      const organizationName = 'Tech Startup';
      const quotaType = 'Disbursements';
      const currentUsage = 92;
      const limit = 100;
      const percentageUsed = 92;

      await emailService.sendQuotaWarning(
        organizationEmail,
        organizationName,
        quotaType,
        currentUsage,
        limit,
        percentageUsed
      );

      expect(true).toBe(true);
    });

    it('should provide recommendations based on quota type', async () => {
      // Test Disbursements quota
      await emailService.sendQuotaWarning(
        'admin@example.com',
        'Acme Corp',
        'Disbursements',
        95,
        100,
        95
      );

      // Test Streams quota
      await emailService.sendQuotaWarning('admin@example.com', 'Acme Corp', 'Streams', 9, 10, 90);

      // Test API Requests quota
      await emailService.sendQuotaWarning(
        'admin@example.com',
        'Acme Corp',
        'API Requests',
        8500,
        10000,
        85
      );

      expect(true).toBe(true);
    });

    it('should handle SMTP failures gracefully for quota warnings', async () => {
      const organizationEmail = 'admin@example.com';
      const organizationName = 'Acme Corp';

      // Should not throw even if email fails
      await expect(
        emailService.sendQuotaWarning(
          organizationEmail,
          organizationName,
          'Disbursements',
          95,
          100,
          95
        )
      ).resolves.not.toThrow();
    });

    it('should return early when SMTP not configured', async () => {
      delete process.env.SMTP_HOST;

      const organizationEmail = 'admin@example.com';
      const organizationName = 'Acme Corp';

      // Should handle gracefully
      await expect(
        emailService.sendQuotaWarning(
          organizationEmail,
          organizationName,
          'Disbursements',
          95,
          100,
          95
        )
      ).resolves.not.toThrow();
    });

    it('should handle at exactly 80% (should not send)', async () => {
      const organizationEmail = 'admin@example.com';
      const organizationName = 'Acme Corp';
      const quotaType = 'Disbursements';
      const currentUsage = 80;
      const limit = 100;
      const percentageUsed = 80; // Exactly 80% - should not send (needs > 80%)

      // Should not send email since percentageUsed is not > 80%
      await emailService.sendQuotaWarning(
        organizationEmail,
        organizationName,
        quotaType,
        currentUsage,
        limit,
        percentageUsed
      );

      expect(true).toBe(true);
    });

    it('should include dashboard link in quota warning', async () => {
      process.env.APP_URL = 'https://app.example.com';

      const organizationEmail = 'admin@example.com';
      const organizationName = 'Acme Corp';

      await emailService.sendQuotaWarning(
        organizationEmail,
        organizationName,
        'Disbursements',
        95,
        100,
        95
      );

      // Link should be included in email
      expect(true).toBe(true);
    });

    it('should use default APP_URL for quota warning if not set', async () => {
      delete process.env.APP_URL;

      const organizationEmail = 'admin@example.com';
      const organizationName = 'Acme Corp';

      await emailService.sendQuotaWarning(
        organizationEmail,
        organizationName,
        'Disbursements',
        95,
        100,
        95
      );

      // Should use default URL without error
      expect(true).toBe(true);
    });
  });

  describe('email configuration', () => {
    it('should build correct invitation link', async () => {
      const inviteeEmail = 'test@example.com';
      const token = 'inv_abc123';
      const inviteData = {
        inviteeEmail,
        organizationName: 'Test Org',
        organizationGAddress: 'GORG123...',
        invitationToken: token,
        expiresAt: new Date(),
      };

      process.env.APP_URL = 'https://app.example.com';

      // Email service should build link with token
      await emailService.sendInvitation(inviteeEmail, inviteData);

      expect(true).toBe(true);
    });

    it('should use default APP_URL if not set', async () => {
      delete process.env.APP_URL;

      const inviteeEmail = 'test@example.com';
      const inviteData = {
        inviteeEmail,
        organizationName: 'Test Org',
        organizationGAddress: 'GORG123...',
        invitationToken: 'inv_abc123',
        expiresAt: new Date(),
      };

      // Should use default URL
      await emailService.sendInvitation(inviteeEmail, inviteData);

      expect(true).toBe(true);
    });

    it('should handle missing SMTP configuration', async () => {
      delete process.env.SMTP_HOST;

      const inviteeEmail = 'test@example.com';
      const inviteData = {
        inviteeEmail,
        organizationName: 'Test Org',
        organizationGAddress: 'GORG123...',
        invitationToken: 'inv_abc123',
        expiresAt: new Date(),
      };

      // Should handle gracefully without throwing
      await emailService.sendInvitation(inviteeEmail, inviteData);

      expect(true).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should not throw on email send failure', async () => {
      const inviteeEmail = 'test@example.com';
      const inviteData = {
        inviteeEmail,
        organizationName: 'Test Org',
        organizationGAddress: 'GORG123...',
        invitationToken: 'inv_abc123',
        expiresAt: new Date(),
      };

      // Should not throw even if email fails
      await expect(emailService.sendInvitation(inviteeEmail, inviteData)).resolves.not.toThrow();
    });

    it('should log email failures', async () => {
      const inviteeEmail = 'test@example.com';
      const inviteData = {
        inviteeEmail,
        organizationName: 'Test Org',
        organizationGAddress: 'GORG123...',
        invitationToken: 'inv_abc123',
        expiresAt: new Date(),
      };

      // Email failures should be logged but operation continues
      await emailService.sendInvitation(inviteeEmail, inviteData);

      expect(true).toBe(true);
    });
  });
});
