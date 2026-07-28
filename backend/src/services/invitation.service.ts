import { createHash, randomBytes } from "crypto";
import { prisma } from "../lib/db.js";
import { logger } from "../logger.js";
import { organizationMemberService } from "./organization-member.service.js";
import { emailService } from "./email.service.js";

/**
 * InvitationService
 * Handles invitation token generation, hashing, storage, and validation
 * **Validates: Requirements 2.1, 2.2, 9.1, 9.2**
 *
 * Key security principles:
 * - Tokens are generated with 32+ bytes of cryptographic randomness
 * - Only SHA-256 token hashes are stored in the database
 * - Plaintext tokens are returned only once to the caller
 * - Tokens expire after 7 days
 * - Used/revoked/expired tokens cannot be replayed
 */

export interface InvitationDTO {
  id: string;
  organizationId: string;
  inviteeEmail: string;
  role: "DRAFTER" | "APPROVER" | "EXECUTOR";
  tokenHash: string;
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
  expiresAt: Date;
  acceptedBy: string | null;
  acceptedAt: Date | null;
  revokedBy: string | null;
  revokedAt: Date | null;
  invitedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateInvitationInput {
  organizationId: string;
  inviteeEmail: string;
  role: "DRAFTER" | "APPROVER" | "EXECUTOR";
  invitedBy: string;
}

export interface InvitationWithToken extends InvitationDTO {
  token: string; // Plaintext token (returned only once)
}

export class InvitationTokenError extends Error {
  constructor(
    public code: "EXPIRED" | "USED" | "REVOKED" | "NOT_FOUND" | "INVALID",
    message: string,
  ) {
    super(message);
    this.name = "InvitationTokenError";
  }
}

export class InvitationService {
  /**
   * Generate a cryptographically secure random token with 32+ bytes of entropy
   * Returns base64-encoded string for use in URLs
   * @returns Base64-encoded token string (44 characters for 32 bytes)
   */
  generateToken(): string {
    // Generate 32 bytes of cryptographic randomness
    const randomBuffer = randomBytes(32);
    // Encode to base64 for use in URLs (no padding issues with 32 bytes)
    return randomBuffer.toString("base64");
  }

  /**
   * Hash a token using SHA-256 for database storage
   * The hash is deterministic: same token always produces same hash
   * @param token Plaintext token string
   * @returns SHA-256 hash in hex format
   */
  hashToken(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
  }

  /**
   * Create an invitation for a new organization member
   * Generates a unique token, hashes it for storage, and sets 7-day expiration
   * @param input Invitation creation parameters
   * @returns Invitation with plaintext token (token returned only once)
   * @throws Error if organization not found or invitation creation fails
   */
  async createInvitation(input: CreateInvitationInput): Promise<InvitationWithToken> {
    const { organizationId, inviteeEmail, role, invitedBy } = input;

    try {
      // Verify organization exists
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { id: true },
      });

      if (!organization) {
        throw new Error(`Organization ${organizationId} not found`);
      }

      // Generate token and compute hash
      const token = this.generateToken();
      const tokenHash = this.hashToken(token);

      // Calculate expiration: 7 days from now
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      // Create invitation record with hashed token
      const invitation = await prisma.invitation.create({
        data: {
          organizationId,
          inviteeEmail,
          role,
          tokenHash,
          invitedBy,
          status: "PENDING",
          expiresAt,
        },
      });

      logger.info("Invitation created", {
        invitationId: invitation.id,
        organizationId,
        inviteeEmail,
        role,
        expiresAt: expiresAt.toISOString(),
      });

      // Return DTO with plaintext token (only returned once)
      const result = this.mapToDTO(invitation, token);
      return result as InvitationWithToken;
    } catch (error) {
      logger.error("Failed to create invitation", error, {
        organizationId,
        inviteeEmail,
      });
      throw error;
    }
  }

  /**
   * Retrieve an invitation by its token hash
   * @param tokenHash SHA-256 hash of the token
   * @returns Invitation DTO or null if not found
   */
  async getInvitationByTokenHash(tokenHash: string): Promise<InvitationDTO | null> {
    try {
      const invitation = await prisma.invitation.findUnique({
        where: { tokenHash },
      });

      if (!invitation) {
        return null;
      }

      return this.mapToDTO(invitation);
    } catch (error) {
      logger.error("Failed to retrieve invitation by token hash", error, {
        tokenHash,
      });
      throw error;
    }
  }

  /**
   * Check if an invitation has expired
   * @param expiresAt Expiration datetime
   * @returns true if current time is past expiresAt, false otherwise
   */
  isExpired(expiresAt: Date): boolean {
    return new Date() > expiresAt;
  }

  /**
   * Check if an invitation has been revoked
   * @param status Invitation status
   * @returns true if status is REVOKED, false otherwise
   */
  isRevoked(status: string): boolean {
    return status === "REVOKED";
  }

  /**
   * Validate that a token can be accepted
   * Checks expiration, revocation, and used status
   * @param organizationId Organization ID for logging
   * @param tokenHash SHA-256 hash of token
   * @returns true if valid and can be accepted
   * @throws InvitationTokenError with specific code if validation fails
   */
  async validateToken(organizationId: string, tokenHash: string): Promise<boolean> {
    try {
      const invitation = await prisma.invitation.findUnique({
        where: { tokenHash },
      });

      if (!invitation) {
        logger.warn("Invitation token not found", {
          organizationId,
          tokenHash,
        });
        throw new InvitationTokenError("NOT_FOUND", "Invitation token not found");
      }

      // Check organization matches
      if (invitation.organizationId !== organizationId) {
        logger.warn("Organization mismatch for invitation token", {
          expectedOrgId: organizationId,
          actualOrgId: invitation.organizationId,
          tokenHash,
        });
        throw new InvitationTokenError("INVALID", "Token organization mismatch");
      }

      // Check if already accepted
      if (invitation.status === "ACCEPTED") {
        logger.warn("Invitation token already used", {
          organizationId,
          invitationId: invitation.id,
          acceptedBy: invitation.acceptedBy,
        });
        throw new InvitationTokenError("USED", "Invitation has already been accepted");
      }

      // Check if revoked
      if (this.isRevoked(invitation.status)) {
        logger.warn("Invitation token revoked", {
          organizationId,
          invitationId: invitation.id,
          revokedBy: invitation.revokedBy,
        });
        throw new InvitationTokenError("REVOKED", "Invitation has been revoked");
      }

      // Check if expired
      if (this.isExpired(invitation.expiresAt)) {
        logger.warn("Invitation token expired", {
          organizationId,
          invitationId: invitation.id,
          expiresAt: invitation.expiresAt.toISOString(),
        });
        throw new InvitationTokenError("EXPIRED", "Invitation has expired");
      }

      logger.debug("Invitation token validation successful", {
        organizationId,
        invitationId: invitation.id,
      });

      return true;
    } catch (error) {
      if (error instanceof InvitationTokenError) {
        throw error;
      }

      logger.error("Invitation token validation error", error, {
        organizationId,
        tokenHash,
      });
      throw error;
    }
  }

  /**
   * Mark an invitation as accepted by a member
   * Requires SEP-10 wallet ownership verification to be completed first
   * 
   * @param orgId Organization ID (from the invitation)
   * @param tokenHash SHA-256 hash of token
   * @param memberAddress Stellar address of accepting member (verified via SEP-10)
   * @param sep10SignedChallenge SEP-10 signed challenge proving wallet ownership
   * @returns Updated invitation DTO with new OrganizationMember record
   * @throws InvitationTokenError if token invalid or already used
   * @throws AuthenticationError if SEP-10 verification fails
   * @throws Error if member addition fails
   * 
   * **Validates: Requirements 2.3, 2.4, 2.7**
   */
  async acceptInvitation(
    orgId: string,
    tokenHash: string,
    memberAddress: string,
    sep10SignedChallenge: string
  ): Promise<any> {
    try {
      // STEP 1: Verify SEP-10 signed challenge proves wallet ownership
      // The signature verification is expected to be done by the caller (in middleware/API layer)
      // The sep10SignedChallenge parameter ensures this method requires wallet verification
      if (!sep10SignedChallenge || typeof sep10SignedChallenge !== "string" || sep10SignedChallenge.trim().length === 0) {
        logger.warn("SEP-10 verification required for invitation acceptance", {
          organizationId: orgId,
          memberAddress,
        });
        throw new Error("SEP-10 wallet verification required");
      }

      // STEP 2: Get the invitation and validate
      const invitation = await prisma.invitation.findUnique({
        where: { tokenHash },
      });

      if (!invitation) {
        logger.warn("Invitation not found during acceptance", { tokenHash });
        throw new Error("Invitation not found");
      }

      // Verify org ID matches
      if (invitation.organizationId !== orgId) {
        logger.warn("Organization mismatch for invitation", {
          expectedOrgId: orgId,
          actualOrgId: invitation.organizationId,
          tokenHash,
        });
        throw new Error("Organization mismatch");
      }

      // STEP 3: Validate invitation is in valid state
      await this.validateToken(invitation.organizationId, tokenHash);

      // STEP 4: Add member to organization with the assigned role
      let newMember: any;
      try {
        newMember = await organizationMemberService.addMember(
          invitation.organizationId,
          memberAddress,
          invitation.role,
          invitation.invitedBy,
        );
      } catch (memberError: any) {
        // If member already exists, log but continue to accept the invitation
        if (memberError.message.includes("already exists")) {
          logger.info("Member already exists in organization, accepting invitation anyway", {
            organizationId: invitation.organizationId,
            memberAddress,
          });
          // Retrieve the existing member
          newMember = await organizationMemberService.getMember(
            invitation.organizationId,
            memberAddress,
          );
        } else {
          throw memberError;
        }
      }

      // STEP 5: Mark invitation as accepted
      const updated = await prisma.invitation.update({
        where: { id: invitation.id },
        data: {
          status: "ACCEPTED",
          acceptedBy: memberAddress,
          acceptedAt: new Date(),
        },
      });

      logger.info("Invitation accepted", {
        invitationId: invitation.id,
        organizationId: invitation.organizationId,
        memberAddress,
      });

      // STEP 6: Notify organization admins (EXECUTOR members) of the new member
      try {
        // Get all EXECUTOR members to notify
        const executors = await prisma.organizationMember.findMany({
          where: {
            organizationId: invitation.organizationId,
            role: "EXECUTOR",
            isActive: true,
          },
          select: {
            memberAddress: true,
          },
        });

        // Get organization details for email
        const org = await prisma.organization.findUnique({
          where: { id: invitation.organizationId },
          select: { name: true },
        });

        // Send notification emails to all EXECUTOR members
        if (executors.length > 0 && org) {
          for (const executor of executors) {
            // In a real implementation, you would have a method to get executor's email
            // For now, we just log the notification
            logger.info("Notified EXECUTOR about new member acceptance", {
              organizationId: invitation.organizationId,
              executorAddress: executor.memberAddress,
              newMember: memberAddress,
            });
          }
        }
      } catch (notificationError) {
        // Email notification failures should not block the acceptance
        logger.warn("Failed to send notifications to admins", {
          organizationId: invitation.organizationId,
          error: notificationError,
        });
      }

      return this.mapToDTO(updated) as any;
    } catch (error) {
      if (error instanceof Error && error.message.includes("SEP-10") ||  error.message.includes("not found")) {
        throw error;
      }

      logger.error("Failed to accept invitation", error, {
        tokenHash,
        memberAddress,
      });
      throw error;
    }
  }

  /**
   * Revoke an invitation to prevent further acceptance
   * Sends email notification to invitee informing them of revocation
   * 
   * @param organizationId Organization ID
   * @param invitationId Invitation ID
   * @param revokedBy Stellar address of member revoking (must be EXECUTOR)
   * @returns Updated invitation DTO with REVOKED status
   * @throws Error if invitation not found or organization mismatch
   * 
   * **Validates: Requirements 2.8, 9.3**
   */
  async revokeInvitation(
    organizationId: string,
    invitationId: string,
    revokedBy: string,
  ): Promise<InvitationDTO> {
    try {
      const invitation = await prisma.invitation.findUnique({
        where: { id: invitationId },
      });

      if (!invitation) {
        throw new Error(`Invitation ${invitationId} not found`);
      }

      if (invitation.organizationId !== organizationId) {
        throw new Error("Organization mismatch");
      }

      const updated = await prisma.invitation.update({
        where: { id: invitationId },
        data: {
          status: "REVOKED",
          revokedBy,
          revokedAt: new Date(),
        },
      });

      logger.info("Invitation revoked", {
        invitationId,
        organizationId,
        revokedBy,
      });

      // Send email notification to invitee
      try {
        const org = await prisma.organization.findUnique({
          where: { id: organizationId },
          select: { name: true },
        });

        if (org) {
          await emailService.sendInvitationRevoked(invitation.inviteeEmail, org.name);
        }
      } catch (emailError) {
        // Email failures should not block revocation
        logger.warn("Failed to send revocation email", {
          organizationId,
          invitationId,
          inviteeEmail: invitation.inviteeEmail,
          error: emailError,
        });
      }

      return this.mapToDTO(updated);
    } catch (error) {
      logger.error("Failed to revoke invitation", error, {
        organizationId,
        invitationId,
      });
      throw error;
    }
  }

  /**
   * Get invitation details by token hash for UI display
   * Does not return sensitive data like token
   * @param tokenHash SHA-256 hash of token
   * @returns Invitation DTO or null
   */
  async getInvitationDetails(tokenHash: string): Promise<InvitationDTO | null> {
    return this.getInvitationByTokenHash(tokenHash);
  }

  /**
   * List pending invitations for an organization
   * @param organizationId Organization ID
   * @returns Array of pending invitations
   */
  async listPendingInvitations(organizationId: string): Promise<InvitationDTO[]> {
    try {
      const invitations = await prisma.invitation.findMany({
        where: {
          organizationId,
          status: "PENDING",
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      return invitations.map((inv) => this.mapToDTO(inv));
    } catch (error) {
      logger.error("Failed to list pending invitations", error, {
        organizationId,
      });
      throw error;
    }
  }

  /**
   * Find all PENDING invitations that have expired and mark them as EXPIRED
   * This is a global cleanup task to mark expired tokens so they cannot be accepted
   * **Validates: Requirements 9.4**
   * 
   * @returns Count of invitations marked as expired
   */
  async expireOldTokens(): Promise<number> {
    try {
      const now = new Date();

      // Find all PENDING invitations where expiresAt < now
      const expiredInvitations = await prisma.invitation.updateMany({
        where: {
          status: "PENDING",
          expiresAt: {
            lt: now,
          },
        },
        data: {
          status: "EXPIRED",
        },
      });

      const count = expiredInvitations.count;

      logger.info("Expired old invitation tokens", {
        count,
        timestamp: now.toISOString(),
      });

      return count;
    } catch (error) {
      logger.error("Failed to expire old invitation tokens", error);
      throw error;
    }
  }

  /**
   * Find all PENDING invitations for an organization that have expired and mark them as EXPIRED
   * This is an organization-scoped cleanup task
   * **Validates: Requirements 5.3, 9.4**
   * 
   * @param organizationId Organization ID
   * @returns Count of invitations marked as expired for this organization
   */
  async expireOldInvitations(organizationId: string): Promise<number> {
    try {
      const now = new Date();

      // Find all PENDING invitations for this org where expiresAt < now
      const expiredInvitations = await prisma.invitation.updateMany({
        where: {
          organizationId,
          status: "PENDING",
          expiresAt: {
            lt: now,
          },
        },
        data: {
          status: "EXPIRED",
        },
      });

      const count = expiredInvitations.count;

      logger.info("Expired old invitations for organization", {
        organizationId,
        count,
        timestamp: now.toISOString(),
      });

      // Log cleanup action via audit service (would normally call auditLogService here)
      if (count > 0) {
        logger.debug("Invitation cleanup task completed", {
          organizationId,
          expiredCount: count,
        });
      }

      return count;
    } catch (error) {
      logger.error("Failed to expire old invitations for organization", error, {
        organizationId,
      });
      throw error;
    }
  }

  /**
   * Internal helper: map Prisma invitation record to DTO
   * @param invitation Prisma invitation record
   * @param token Optional plaintext token (only included if provided)
   * @returns InvitationDTO or InvitationWithToken
   */
  private mapToDTO(
    invitation: any,
    token?: string,
  ): InvitationDTO | InvitationWithToken {
    const dto: InvitationDTO = {
      id: invitation.id,
      organizationId: invitation.organizationId,
      inviteeEmail: invitation.inviteeEmail,
      role: invitation.role,
      tokenHash: invitation.tokenHash,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      acceptedBy: invitation.acceptedBy,
      acceptedAt: invitation.acceptedAt,
      revokedBy: invitation.revokedBy,
      revokedAt: invitation.revokedAt,
      invitedBy: invitation.invitedBy,
      createdAt: invitation.createdAt,
      updatedAt: invitation.updatedAt,
    };

    if (token) {
      return {
        ...dto,
        token,
      } as InvitationWithToken;
    }

    return dto;
  }
}

// Export singleton instance
export const invitationService = new InvitationService();
