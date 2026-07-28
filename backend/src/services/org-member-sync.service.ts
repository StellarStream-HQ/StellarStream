import { prisma } from '../lib/db.js';
import { redis } from '../lib/redis.js';

const TAGS_PREFIX = 'org-member-tags:';

export interface OrgMemberTag {
  id: string;
  name: string;
  color?: string;
}

export interface OrgMemberWithTags {
  memberAddress: string;
  role: string;
  tags: OrgMemberTag[];
  addedBy: string;
  createdAt: Date;
}

export class OrgMemberSyncService {
  /**
   * Sync organization members.
   * Allows bulk operations for team organization.
   */
  async syncMembers(
    orgAddress: string,
    members: Array<{
      memberAddress: string;
      role: 'DRAFTER' | 'APPROVER' | 'EXECUTOR';
      tags?: string[];
    }>,
  ): Promise<void> {
    for (const member of members) {
      await prisma.organizationMember.upsert({
        where: {
          orgAddress_memberAddress: {
            orgAddress,
            memberAddress: member.memberAddress,
          },
        },
        create: {
          orgAddress,
          memberAddress: member.memberAddress,
          role: member.role,
          addedBy: 'system',
          isActive: true,
        },
        update: {
          role: member.role,
          isActive: true,
        },
      });

      // Store tags in Redis
      if (member.tags && member.tags.length > 0) {
        await this.addTagsToMember(orgAddress, member.memberAddress, member.tags);
      }
    }
  }

  /**
   * Add tags to a member (stored in Redis).
   */
  async addTagsToMember(
    orgAddress: string,
    memberAddress: string,
    tags: string[],
  ): Promise<void> {
    const key = `${TAGS_PREFIX}${orgAddress}:${memberAddress}`;
    const existing = await redis.smembers(key);
    const allTags = Array.from(new Set([...existing, ...tags]));

    await redis.del(key);
    if (allTags.length > 0) {
      await redis.sadd(key, ...allTags);
    }
  }

  /**
   * Remove tags from a member.
   */
  async removeTagsFromMember(
    orgAddress: string,
    memberAddress: string,
    tags: string[],
  ): Promise<void> {
    const key = `${TAGS_PREFIX}${orgAddress}:${memberAddress}`;
    for (const tag of tags) {
      await redis.srem(key, tag);
    }
  }

  /**
   * Get members by tag.
   */
  async getMembersByTag(orgAddress: string, tag: string): Promise<OrgMemberWithTags[]> {
    const members = await prisma.organizationMember.findMany({
      where: {
        orgAddress,
        isActive: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const result: OrgMemberWithTags[] = [];

    for (const member of members) {
      const tags = await redis.smembers(`${TAGS_PREFIX}${orgAddress}:${member.memberAddress}`);
      if (tags.includes(tag)) {
        result.push({
          memberAddress: member.memberAddress,
          role: member.role,
          tags: tags.map((t: string) => ({ id: t, name: t })),
          addedBy: member.addedBy,
          createdAt: member.createdAt,
        });
      }
    }

    return result;
  }

  /**
   * List all members with their tags.
   */
  async listMembersWithTags(orgAddress: string): Promise<OrgMemberWithTags[]> {
    const members = await prisma.organizationMember.findMany({
      where: {
        orgAddress,
        isActive: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const result: OrgMemberWithTags[] = [];

    for (const member of members) {
      const tags = await redis.smembers(`${TAGS_PREFIX}${orgAddress}:${member.memberAddress}`);
      result.push({
        memberAddress: member.memberAddress,
        role: member.role,
        tags: tags.map((t: string) => ({ id: t, name: t })),
        addedBy: member.addedBy,
        createdAt: member.createdAt,
      });
    }

    return result;
  }

  /**
   * Get all unique tags in an organization.
   */
  async getOrgTags(orgAddress: string): Promise<string[]> {
    const members = await prisma.organizationMember.findMany({
      where: {
        orgAddress,
        isActive: true,
      },
    });

    const allTags = new Set<string>();

    for (const member of members) {
      const tags = await redis.smembers(`${TAGS_PREFIX}${orgAddress}:${member.memberAddress}`);
      tags.forEach((t: string) => allTags.add(t));
    }

    return Array.from(allTags).sort();
  }
}

export const orgMemberSyncService = new OrgMemberSyncService();
