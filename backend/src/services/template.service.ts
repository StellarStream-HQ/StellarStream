import { prisma } from "../lib/db.js";
import { logger } from "../logger.js";

// Allowed values for template fields
const VALID_RATE_TYPES = new Set(["per-second", "per-minute", "per-hour", "per-day"]);
const VALID_DURATION_PRESETS = new Set(["1 Hour", "1 Day", "1 Week", "1 Month", "3 Months", "1 Year"]);
const ALLOWED_UPDATE_FIELDS = new Set([
  "name", "asset", "recipientAddress", "splitEnabled", "splitAddress",
  "splitPercent", "totalAmount", "rateType", "durationPreset",
]);

export interface CreateTemplateInput {
  name: string;
  asset: string;
  recipientAddress: string;
  splitEnabled?: boolean;
  splitAddress?: string;
  splitPercent?: number;
  totalAmount: string;
  rateType: string;
  durationPreset: string;
  createdBy: string;
}

export interface UpdateTemplateInput {
  name?: string;
  asset?: string;
  recipientAddress?: string;
  splitEnabled?: boolean;
  splitAddress?: string;
  splitPercent?: number;
  totalAmount?: string;
  rateType?: string;
  durationPreset?: string;
}

function validateTemplateInput(input: {
  rateType?: string;
  durationPreset?: string;
  splitPercent?: number;
}) {
  if (input.rateType !== undefined && !VALID_RATE_TYPES.has(input.rateType)) {
    throw new Error(`Invalid rateType: "${input.rateType}". Must be one of: ${[...VALID_RATE_TYPES].join(", ")}`);
  }
  if (input.durationPreset !== undefined && !VALID_DURATION_PRESETS.has(input.durationPreset)) {
    throw new Error(`Invalid durationPreset: "${input.durationPreset}". Must be one of: ${[...VALID_DURATION_PRESETS].join(", ")}`);
  }
  if (input.splitPercent !== undefined && (input.splitPercent < 0 || input.splitPercent > 100)) {
    throw new Error("splitPercent must be between 0 and 100");
  }
}

export class TemplateService {
  /**
   * List all templates, optionally filtered by createdBy.
   */
  async listTemplates(createdBy?: string) {
    return prisma.streamTemplate.findMany({
      where: createdBy ? { createdBy } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Get a single template by ID.
   */
  async getTemplate(id: string) {
    return prisma.streamTemplate.findUnique({ where: { id } });
  }

  /**
   * Create a new stream template.
   */
  async createTemplate(input: CreateTemplateInput) {
    validateTemplateInput(input);
    return prisma.streamTemplate.create({
      data: {
        name: input.name,
        asset: input.asset,
        recipientAddress: input.recipientAddress,
        splitEnabled: input.splitEnabled ?? false,
        splitAddress: input.splitAddress ?? null,
        splitPercent: input.splitPercent ?? 0,
        totalAmount: input.totalAmount,
        rateType: input.rateType,
        durationPreset: input.durationPreset,
        createdBy: input.createdBy,
      },
    });
  }

  /**
   * Update an existing template. Only whitelisted fields are applied.
   */
  async updateTemplate(id: string, rawInput: Record<string, unknown>) {
    // Whitelist allowed fields to prevent injection of protected fields
    const input: UpdateTemplateInput = {};
    for (const key of ALLOWED_UPDATE_FIELDS) {
      if (key in rawInput) {
        (input as any)[key] = rawInput[key];
      }
    }

    validateTemplateInput(input);

    const template = await prisma.streamTemplate.findUnique({ where: { id } });
    if (!template) return null;

    return prisma.streamTemplate.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.asset !== undefined && { asset: input.asset }),
        ...(input.recipientAddress !== undefined && { recipientAddress: input.recipientAddress }),
        ...(input.splitEnabled !== undefined && { splitEnabled: input.splitEnabled }),
        ...(input.splitAddress !== undefined && { splitAddress: input.splitAddress }),
        ...(input.splitPercent !== undefined && { splitPercent: input.splitPercent }),
        ...(input.totalAmount !== undefined && { totalAmount: input.totalAmount }),
        ...(input.rateType !== undefined && { rateType: input.rateType }),
        ...(input.durationPreset !== undefined && { durationPreset: input.durationPreset }),
      },
    });
  }

  /**
   * Delete a template by ID.
   */
  async deleteTemplate(id: string) {
    const template = await prisma.streamTemplate.findUnique({ where: { id } });
    if (!template) return null;

    await prisma.streamTemplate.delete({ where: { id } });
    return template;
  }

  /**
   * Increment the usage count for a template (called when a stream is created from it).
   */
  async incrementUsage(id: string) {
    try {
      const updated = await prisma.streamTemplate.update({
        where: { id },
        data: { usageCount: { increment: 1 } },
      });
      return updated;
    } catch (err) {
      logger.error("Failed to increment template usage count", { id, err });
      return null;
    }
  }

  /**
   * Bulk create templates for testing/benchmarking purposes.
   * Uses createMany for efficiency.
   */
  async bulkCreate(templates: CreateTemplateInput[]) {
    // Validate all templates first
    for (const t of templates) {
      validateTemplateInput(t);
    }

    const result = await prisma.streamTemplate.createMany({
      data: templates.map((t) => ({
        name: t.name,
        asset: t.asset,
        recipientAddress: t.recipientAddress,
        splitEnabled: t.splitEnabled ?? false,
        splitAddress: t.splitAddress ?? null,
        splitPercent: t.splitPercent ?? 0,
        totalAmount: t.totalAmount,
        rateType: t.rateType,
        durationPreset: t.durationPreset,
        createdBy: t.createdBy,
      })),
    });
    return result.count;
  }
}
