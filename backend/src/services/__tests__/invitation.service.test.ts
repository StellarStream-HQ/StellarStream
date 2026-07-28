import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { fc } from "@fast-check/jest";
import { createHash } from "crypto";
import {
  InvitationService,
  InvitationTokenError,
  InvitationDTO,
  InvitationWithToken,
} from "../invitation.service.js";
import { prisma } from "../../lib/db.js";

/**
 * Test suite for InvitationService
 * **Validates: Requirements 2.1, 2.2, 9.1, 9.2**
 *
 * Tests verify:
 * - Token generation: cryptographically secure, unique, 32+ bytes entropy
 * - Token hashing: SHA-256, deterministic, one-way
 * - Invitation creation: correct storage with hashed tokens, 7-day expiration
 * - Token validation: expiration, revocation, used status enforcement
 * - Security: plaintext tokens never stored, no token exposure in errors
 */

describe("InvitationService", () => {
  let service: InvitationService;
  const mockOrgId = "org-test-123";
  const creatorAddress = "GCREATOR23456789012345678901234567890123456789012345678";
  const testEmail = "user@example.com";

  beforeEach(() => {
    service = new InvitationService();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("generateToken()", () => {
    it("should generate base64-encoded token", () => {
      const token = service.generateToken();

      expect(typeof token).toBe("string");
      // Base64 of 32 bytes is ~44 characters
      expect(token.length).toBeGreaterThanOrEqual(40);
      // Should be valid base64
      expect(() => Buffer.from(token, "base64")).not.toThrow();
    });

    it("should generate unique tokens each time", () => {
      const token1 = service.generateToken();
      const token2 = service.generateToken();
      const token3 = service.generateToken();

      expect(token1).not.toBe(token2);
      expect(token2).not.toBe(token3);
      expect(token1).not.toBe(token3);
    });

    it("should generate tokens with sufficient entropy", () => {
      const tokens = Array.from({ length: 100 }, () => service.generateToken());

      // All tokens should be unique (extremely unlikely collision with 32 bytes)
      const uniqueTokens = new Set(tokens);
      expect(uniqueTokens.size).toBe(tokens.length);
    });

    it("should decode to 32 bytes when base64 decoded", () => {
      const token = service.generateToken();
      const buffer = Buffer.from(token, "base64");

      // 32 bytes input = 32 bytes output
      expect(buffer.length).toBe(32);
    });

    // Property-based test: generated tokens are always valid base64
    it("should generate valid base64 tokens", () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 100 }), () => {
          const token = service.generateToken();

          // Valid base64 must be string
          expect(typeof token).toBe("string");

          // Must decode without error
          expect(() => Buffer.from(token, "base64")).not.toThrow();

          // Decoded buffer must be exactly 32 bytes
          const buffer = Buffer.from(token, "base64");
          expect(buffer.length).toBe(32);
        }),
      );
    });
  });

  describe("hashToken()", () => {
    it("should return SHA-256 hex string", () => {
      const token = "test-token-value";
      const hash = service.hashToken(token);

      // SHA-256 produces 64 hex characters
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should be deterministic (same input = same hash)", () => {
      const token = "fixed-token-value";
      const hash1 = service.hashToken(token);
      const hash2 = service.hashToken(token);
      const hash3 = service.hashToken(token);

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });

    it("should produce different hashes for different tokens", () => {
      const hash1 = service.hashToken("token1");
      const hash2 = service.hashToken("token2");
      const hash3 = service.hashToken("token3");

      expect(hash1).not.toBe(hash2);
      expect(hash2).not.toBe(hash3);
      expect(hash1).not.toBe(hash3);
    });

    it("should match Node.js crypto.createHash directly", () => {
      const token = "verification-token";
      const serviceHash = service.hashToken(token);
      const directHash = createHash("sha256").update(token, "utf8").digest("hex");

      expect(serviceHash).toBe(directHash);
    });

    // Property-based test: all hashes are valid hex strings
    it("should always produce valid SHA-256 hex strings", () => {
      fc.assert(
        fc.property(fc.string(), (token) => {
          const hash = service.hashToken(token);

          // Must be 64 hex characters (SHA-256)
          expect(hash).toMatch(/^[a-f0-9]{64}$/);
        }),
      );
    });

    // Property-based test: SHA-256 is one-way (cannot reverse)
    it("should not be easily reversible", () => {
      fc.assert(
        fc.property(fc.string(), (token) => {
          const hash = service.hashToken(token);

          // The hash should not equal the original token
          // (with overwhelming probability for random strings)
          if (token.length > 64) {
            expect(hash).not.toBe(token);
          }
        }),
      );
    });
  });

  describe("isExpired()", () => {
    it("should return false for future dates", () => {
      const future = new Date();
      future.setDate(future.getDate() + 1);

      expect(service.isExpired(future)).toBe(false);
    });

    it("should return true for past dates", () => {
      const past = new Date();
      past.setDate(past.getDate() - 1);

      expect(service.isExpired(past)).toBe(true);
    });

    it("should return true for date in the past (7+ days)", () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 7);

      expect(service.isExpired(oldDate)).toBe(true);
    });

    it("should handle edge case near expiration", () => {
      // Just before expiration
      const almostExpired = new Date(Date.now() + 1000); // 1 second in future
      expect(service.isExpired(almostExpired)).toBe(false);

      // Just after expiration
      const justExpired = new Date(Date.now() - 1000); // 1 second in past
      expect(service.isExpired(justExpired)).toBe(true);
    });
  });

  describe("isRevoked()", () => {
    it("should return true for REVOKED status", () => {
      expect(service.isRevoked("REVOKED")).toBe(true);
    });

    it("should return false for PENDING status", () => {
      expect(service.isRevoked("PENDING")).toBe(false);
    });

    it("should return false for ACCEPTED status", () => {
      expect(service.isRevoked("ACCEPTED")).toBe(false);
    });

    it("should return false for EXPIRED status", () => {
      expect(service.isRevoked("EXPIRED")).toBe(false);
    });

    it("should return false for unknown status", () => {
      expect(service.isRevoked("UNKNOWN")).toBe(false);
      expect(service.isRevoked("")).toBe(false);
    });
  });

  describe("createInvitation()", () => {
    beforeEach(async () => {
      // Create test organization
      await prisma.organization.create({
        data: {
          id: mockOrgId,
          gAddress: "GTEST123456789012345678901234567890123456789012345678",
          name: "Test Organization",
          createdBy: creatorAddress,
        },
      });
    });

    afterEach(async () => {
      // Clean up
      await prisma.invitation.deleteMany({});
      await prisma.organization.deleteMany({});
    });

    it("should create invitation with hashed token", async () => {
      const result = await service.createInvitation({
        organizationId: mockOrgId,
        inviteeEmail: testEmail,
        role: "DRAFTER",
        invitedBy: creatorAddress,
      });

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("token");
      expect(result).toHaveProperty("tokenHash");
      expect(result.organizationId).toBe(mockOrgId);
      expect(result.inviteeEmail).toBe(testEmail);
      expect(result.role).toBe("DRAFTER");
      expect(result.status).toBe("PENDING");
    });

    it("should return plaintext token exactly once", async () => {
      const result = await service.createInvitation({
        organizationId: mockOrgId,
        inviteeEmail: testEmail,
        role: "APPROVER",
        invitedBy: creatorAddress,
      });

      expect(result.token).toBeDefined();
      expect(result.token).not.toEqual("");

      // Verify token is valid base64
      expect(() => Buffer.from(result.token, "base64")).not.toThrow();

      // Verify token decodes to 32 bytes
      const buffer = Buffer.from(result.token, "base64");
      expect(buffer.length).toBe(32);
    });

    it("should hash token before storage", async () => {
      const result = await service.createInvitation({
        organizationId: mockOrgId,
        inviteeEmail: testEmail,
        role: "EXECUTOR",
        invitedBy: creatorAddress,
      });

      // Verify hash is valid SHA-256
      expect(result.tokenHash).toMatch(/^[a-f0-9]{64}$/);

      // Verify hash matches token
      const expectedHash = service.hashToken(result.token);
      expect(result.tokenHash).toBe(expectedHash);

      // Verify plaintext token is NOT in database
      const retrieved = await prisma.invitation.findUnique({
        where: { tokenHash: result.tokenHash },
      });
      expect(retrieved).not.toHaveProperty("token");
    });

    it("should set 7-day expiration", async () => {
      const result = await service.createInvitation({
        organizationId: mockOrgId,
        inviteeEmail: testEmail,
        role: "DRAFTER",
        invitedBy: creatorAddress,
      });

      const now = new Date();
      const expectedExpiry = new Date();
      expectedExpiry.setDate(expectedExpiry.getDate() + 7);

      // Allow 1 minute difference for test execution time
      const diff = Math.abs(result.expiresAt.getTime() - expectedExpiry.getTime());
      expect(diff).toBeLessThan(60 * 1000);
    });

    it("should throw error for non-existent organization", async () => {
      await expect(
        service.createInvitation({
          organizationId: "non-existent-org",
          inviteeEmail: testEmail,
          role: "DRAFTER",
          invitedBy: creatorAddress,
        }),
      ).rejects.toThrow();
    });

    it("should support all roles", async () => {
      const roles: ("DRAFTER" | "APPROVER" | "EXECUTOR")[] = ["DRAFTER", "APPROVER", "EXECUTOR"];

      for (const role of roles) {
        const result = await service.createInvitation({
          organizationId: mockOrgId,
          inviteeEmail: `user-${role}@example.com`,
          role,
          invitedBy: creatorAddress,
        });

        expect(result.role).toBe(role);
      }
    });
  });

  describe("validateToken()", () => {
    let invitationId: string;
    let tokenHash: string;
    let token: string;

    beforeEach(async () => {
      // Create test organization
      await prisma.organization.create({
        data: {
          id: mockOrgId,
          gAddress: "GTEST123456789012345678901234567890123456789012345678",
          name: "Test Organization",
          createdBy: creatorAddress,
        },
      });

      // Create test invitation
      const result = await service.createInvitation({
        organizationId: mockOrgId,
        inviteeEmail: testEmail,
        role: "DRAFTER",
        invitedBy: creatorAddress,
      });

      invitationId = result.id;
      tokenHash = result.tokenHash;
      token = result.token;
    });

    afterEach(async () => {
      await prisma.invitation.deleteMany({});
      await prisma.organization.deleteMany({});
    });

    it("should validate valid token", async () => {
      const isValid = await service.validateToken(mockOrgId, tokenHash);
      expect(isValid).toBe(true);
    });

    it("should throw NOT_FOUND for invalid token", async () => {
      const fakeHash = service.hashToken("non-existent-token");

      await expect(service.validateToken(mockOrgId, fakeHash)).rejects.toThrow(
        InvitationTokenError,
      );

      try {
        await service.validateToken(mockOrgId, fakeHash);
      } catch (error) {
        if (error instanceof InvitationTokenError) {
          expect(error.code).toBe("NOT_FOUND");
        }
      }
    });

    it("should throw EXPIRED for expired token", async () => {
      // Expire the invitation
      await prisma.invitation.update({
        where: { id: invitationId },
        data: {
          expiresAt: new Date(Date.now() - 1000), // 1 second in past
        },
      });

      await expect(service.validateToken(mockOrgId, tokenHash)).rejects.toThrow(
        InvitationTokenError,
      );

      try {
        await service.validateToken(mockOrgId, tokenHash);
      } catch (error) {
        if (error instanceof InvitationTokenError) {
          expect(error.code).toBe("EXPIRED");
        }
      }
    });

    it("should throw REVOKED for revoked token", async () => {
      // Revoke the invitation
      await prisma.invitation.update({
        where: { id: invitationId },
        data: {
          status: "REVOKED",
          revokedBy: creatorAddress,
          revokedAt: new Date(),
        },
      });

      await expect(service.validateToken(mockOrgId, tokenHash)).rejects.toThrow(
        InvitationTokenError,
      );

      try {
        await service.validateToken(mockOrgId, tokenHash);
      } catch (error) {
        if (error instanceof InvitationTokenError) {
          expect(error.code).toBe("REVOKED");
        }
      }
    });

    it("should throw USED for accepted token", async () => {
      const memberAddress = "GMEMBER12345678901234567890123456789012345678901234567";

      // Accept the invitation
      await prisma.invitation.update({
        where: { id: invitationId },
        data: {
          status: "ACCEPTED",
          acceptedBy: memberAddress,
          acceptedAt: new Date(),
        },
      });

      await expect(service.validateToken(mockOrgId, tokenHash)).rejects.toThrow(
        InvitationTokenError,
      );

      try {
        await service.validateToken(mockOrgId, tokenHash);
      } catch (error) {
        if (error instanceof InvitationTokenError) {
          expect(error.code).toBe("USED");
        }
      }
    });

    it("should throw error for organization mismatch", async () => {
      const wrongOrgId = "wrong-org-id";

      await expect(service.validateToken(wrongOrgId, tokenHash)).rejects.toThrow(
        InvitationTokenError,
      );
    });

    it("should not expose plaintext token in errors", async () => {
      const wrongHash = service.hashToken("wrong-token");

      try {
        await service.validateToken(mockOrgId, wrongHash);
      } catch (error) {
        if (error instanceof Error) {
          // Error message should NOT contain the token or hash
          expect(error.message).not.toContain(token);
          expect(error.message).not.toContain(wrongHash);
        }
      }
    });
  });

  describe("acceptInvitation()", () => {
    let invitationId: string;
    let tokenHash: string;
    const memberAddress = "GMEMBER12345678901234567890123456789012345678901234567";

    beforeEach(async () => {
      // Create test organization
      await prisma.organization.create({
        data: {
          id: mockOrgId,
          gAddress: "GTEST123456789012345678901234567890123456789012345678",
          name: "Test Organization",
          createdBy: creatorAddress,
        },
      });

      // Create test invitation
      const result = await service.createInvitation({
        organizationId: mockOrgId,
        inviteeEmail: testEmail,
        role: "APPROVER",
        invitedBy: creatorAddress,
      });

      invitationId = result.id;
      tokenHash = result.tokenHash;
    });

    afterEach(async () => {
      await prisma.invitation.deleteMany({});
      await prisma.organization.deleteMany({});
    });

    it("should accept valid invitation", async () => {
      const result = await service.acceptInvitation(tokenHash, memberAddress);

      expect(result.status).toBe("ACCEPTED");
      expect(result.acceptedBy).toBe(memberAddress);
      expect(result.acceptedAt).not.toBeNull();
    });

    it("should prevent replay attack (cannot accept twice)", async () => {
      // Accept once
      await service.acceptInvitation(tokenHash, memberAddress);

      // Try to accept again
      await expect(service.acceptInvitation(tokenHash, memberAddress)).rejects.toThrow(
        InvitationTokenError,
      );
    });

    it("should prevent acceptance of expired token", async () => {
      // Expire the invitation
      await prisma.invitation.update({
        where: { id: invitationId },
        data: {
          expiresAt: new Date(Date.now() - 1000),
        },
      });

      await expect(service.acceptInvitation(tokenHash, memberAddress)).rejects.toThrow(
        InvitationTokenError,
      );
    });

    it("should update timestamp on acceptance", async () => {
      const before = new Date();

      const result = await service.acceptInvitation(tokenHash, memberAddress);

      const after = new Date();

      expect(result.acceptedAt).not.toBeNull();
      if (result.acceptedAt) {
        expect(result.acceptedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(result.acceptedAt.getTime()).toBeLessThanOrEqual(after.getTime());
      }
    });
  });

  describe("revokeInvitation()", () => {
    let invitationId: string;
    let tokenHash: string;
    const revokerAddress = "GREVOKER1234567890123456789012345678901234567890123456";

    beforeEach(async () => {
      // Create test organization
      await prisma.organization.create({
        data: {
          id: mockOrgId,
          gAddress: "GTEST123456789012345678901234567890123456789012345678",
          name: "Test Organization",
          createdBy: creatorAddress,
        },
      });

      // Create test invitation
      const result = await service.createInvitation({
        organizationId: mockOrgId,
        inviteeEmail: testEmail,
        role: "EXECUTOR",
        invitedBy: creatorAddress,
      });

      invitationId = result.id;
      tokenHash = result.tokenHash;
    });

    afterEach(async () => {
      await prisma.invitation.deleteMany({});
      await prisma.organization.deleteMany({});
    });

    it("should revoke invitation", async () => {
      const result = await service.revokeInvitation(mockOrgId, invitationId, revokerAddress);

      expect(result.status).toBe("REVOKED");
      expect(result.revokedBy).toBe(revokerAddress);
      expect(result.revokedAt).not.toBeNull();
    });

    it("should prevent acceptance after revocation", async () => {
      await service.revokeInvitation(mockOrgId, invitationId, revokerAddress);

      const memberAddress = "GMEMBER12345678901234567890123456789012345678901234567";
      await expect(service.acceptInvitation(tokenHash, memberAddress)).rejects.toThrow(
        InvitationTokenError,
      );
    });

    it("should throw error for non-existent invitation", async () => {
      await expect(
        service.revokeInvitation(mockOrgId, "non-existent-id", revokerAddress),
      ).rejects.toThrow();
    });
  });

  describe("Security: Plaintext Token Protection", () => {
    beforeEach(async () => {
      // Create test organization
      await prisma.organization.create({
        data: {
          id: mockOrgId,
          gAddress: "GTEST123456789012345678901234567890123456789012345678",
          name: "Test Organization",
          createdBy: creatorAddress,
        },
      });
    });

    afterEach(async () => {
      await prisma.invitation.deleteMany({});
      await prisma.organization.deleteMany({});
    });

    it("should never store plaintext token in database", async () => {
      const result = await service.createInvitation({
        organizationId: mockOrgId,
        inviteeEmail: testEmail,
        role: "DRAFTER",
        invitedBy: creatorAddress,
      });

      // Query database directly
      const dbRecord = await prisma.invitation.findUnique({
        where: { tokenHash: result.tokenHash },
      });

      expect(dbRecord).toBeDefined();
      // Verify no token field or it's null
      if (dbRecord && "token" in dbRecord) {
        expect(dbRecord.token).toBeNull();
      }

      // Verify the token is not anywhere in the database record
      const recordString = JSON.stringify(dbRecord);
      expect(recordString).not.toContain(result.token);
    });

    it("should only return token once during creation", async () => {
      const result = await service.createInvitation({
        organizationId: mockOrgId,
        inviteeEmail: testEmail,
        role: "DRAFTER",
        invitedBy: creatorAddress,
      });

      // Token should be in result
      expect(result).toHaveProperty("token");

      // Retrieving invitation should not return token
      const retrieved = await service.getInvitationByTokenHash(result.tokenHash);
      expect(retrieved).not.toHaveProperty("token");
    });
  });

  describe("Edge Cases and Data Integrity", () => {
    beforeEach(async () => {
      // Create test organization
      await prisma.organization.create({
        data: {
          id: mockOrgId,
          gAddress: "GTEST123456789012345678901234567890123456789012345678",
          name: "Test Organization",
          createdBy: creatorAddress,
        },
      });
    });

    afterEach(async () => {
      await prisma.invitation.deleteMany({});
      await prisma.organization.deleteMany({});
    });

    it("should handle multiple invitations with same email", async () => {
      const result1 = await service.createInvitation({
        organizationId: mockOrgId,
        inviteeEmail: testEmail,
        role: "DRAFTER",
        invitedBy: creatorAddress,
      });

      const result2 = await service.createInvitation({
        organizationId: mockOrgId,
        inviteeEmail: testEmail,
        role: "APPROVER",
        invitedBy: creatorAddress,
      });

      // Should have different tokens and hashes
      expect(result1.token).not.toBe(result2.token);
      expect(result1.tokenHash).not.toBe(result2.tokenHash);

      // Both should be valid
      await expect(service.validateToken(mockOrgId, result1.tokenHash)).resolves.toBe(true);
      await expect(service.validateToken(mockOrgId, result2.tokenHash)).resolves.toBe(true);
    });

    it("should handle email with special characters", async () => {
      const specialEmail = "user+tag@example.co.uk";

      const result = await service.createInvitation({
        organizationId: mockOrgId,
        inviteeEmail: specialEmail,
        role: "DRAFTER",
        invitedBy: creatorAddress,
      });

      expect(result.inviteeEmail).toBe(specialEmail);

      const retrieved = await service.getInvitationByTokenHash(result.tokenHash);
      expect(retrieved?.inviteeEmail).toBe(specialEmail);
    });
  });
});
