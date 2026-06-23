import { TemplateService } from "../services/template.service";
import { prisma } from "../lib/db";

jest.mock("../lib/db", () => ({
  prisma: {
    streamTemplate: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      createMany: jest.fn(),
    },
  },
}));

describe("TemplateService", () => {
  let service: TemplateService;

  beforeEach(() => {
    service = new TemplateService();
    jest.clearAllMocks();
  });

  describe("createTemplate", () => {
    it("should create a template with valid input", async () => {
      const input = {
        name: "Monthly Payroll",
        asset: "USDC",
        recipientAddress: "GABC123XYZ",
        splitEnabled: false,
        totalAmount: "1000",
        rateType: "per-second",
        durationPreset: "1 Month",
        createdBy: "GDEF456ABC",
      };

      const mockCreated = { id: "tpl-1", ...input, createdAt: new Date(), updatedAt: new Date(), usageCount: 0 };
      (prisma.streamTemplate.create as jest.Mock).mockResolvedValue(mockCreated);

      const result = await service.createTemplate(input);

      expect(result).toEqual(mockCreated);
      expect(prisma.streamTemplate.create).toHaveBeenCalledTimes(1);
    });

    it("should reject invalid rateType", async () => {
      const input = {
        name: "Test",
        asset: "USDC",
        recipientAddress: "GABC123",
        totalAmount: "100",
        rateType: "per-year",
        durationPreset: "1 Month",
        createdBy: "GDEF",
      };

      await expect(service.createTemplate(input)).rejects.toThrow("Invalid rateType");
    });

    it("should reject invalid splitPercent range", async () => {
      const input = {
        name: "Test",
        asset: "USDC",
        recipientAddress: "GABC123",
        totalAmount: "100",
        rateType: "per-hour",
        durationPreset: "1 Month",
        splitPercent: 150,
        createdBy: "GDEF",
      };

      await expect(service.createTemplate(input)).rejects.toThrow("splitPercent must be between 0 and 100");
    });

    it("should reject invalid durationPreset", async () => {
      const input = {
        name: "Test",
        asset: "USDC",
        recipientAddress: "GABC123",
        totalAmount: "100",
        rateType: "per-hour",
        durationPreset: "Forever",
        createdBy: "GDEF",
      };

      await expect(service.createTemplate(input)).rejects.toThrow("Invalid durationPreset");
    });
  });

  describe("listTemplates", () => {
    it("should list all templates when no createdBy filter", async () => {
      const mockTemplates = [{ id: "1", name: "T1" }, { id: "2", name: "T2" }];
      (prisma.streamTemplate.findMany as jest.Mock).mockResolvedValue(mockTemplates);

      const result = await service.listTemplates();

      expect(result).toEqual(mockTemplates);
      expect(prisma.streamTemplate.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("should filter by createdBy when provided", async () => {
      const mockTemplates = [{ id: "1", name: "T1" }];
      (prisma.streamTemplate.findMany as jest.Mock).mockResolvedValue(mockTemplates);

      const result = await service.listTemplates("GABC123");

      expect(result).toEqual(mockTemplates);
      expect(prisma.streamTemplate.findMany).toHaveBeenCalledWith({
        where: { createdBy: "GABC123" },
        orderBy: { createdAt: "desc" },
      });
    });
  });

  describe("getTemplate", () => {
    it("should return template by id", async () => {
      const mockTemplate = { id: "1", name: "T1" };
      (prisma.streamTemplate.findUnique as jest.Mock).mockResolvedValue(mockTemplate);

      const result = await service.getTemplate("1");

      expect(result).toEqual(mockTemplate);
    });

    it("should return null if not found", async () => {
      (prisma.streamTemplate.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getTemplate("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("updateTemplate", () => {
    it("should update only whitelisted fields", async () => {
      const existing = { id: "1", name: "Old", asset: "USDC" };
      const updated = { ...existing, name: "New Name" };
      (prisma.streamTemplate.findUnique as jest.Mock).mockResolvedValue(existing);
      (prisma.streamTemplate.update as jest.Mock).mockResolvedValue(updated);

      const result = await service.updateTemplate("1", { name: "New Name", usageCount: 999, createdBy: "hacker" });

      expect(result).toEqual(updated);
      // usageCount and createdBy should NOT be in the update data
      const updateCall = (prisma.streamTemplate.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.usageCount).toBeUndefined();
      expect(updateCall.data.createdBy).toBeUndefined();
      expect(updateCall.data.name).toBe("New Name");
    });

    it("should return null for nonexistent template", async () => {
      (prisma.streamTemplate.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.updateTemplate("nonexistent", { name: "New" });

      expect(result).toBeNull();
    });
  });

  describe("deleteTemplate", () => {
    it("should delete and return template", async () => {
      const mockTemplate = { id: "1", name: "T1" };
      (prisma.streamTemplate.findUnique as jest.Mock).mockResolvedValue(mockTemplate);
      (prisma.streamTemplate.delete as jest.Mock).mockResolvedValue(mockTemplate);

      const result = await service.deleteTemplate("1");

      expect(result).toEqual(mockTemplate);
    });

    it("should return null for nonexistent template", async () => {
      (prisma.streamTemplate.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.deleteTemplate("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("incrementUsage", () => {
    it("should increment usage count", async () => {
      const updated = { id: "1", usageCount: 5 };
      (prisma.streamTemplate.update as jest.Mock).mockResolvedValue(updated);

      const result = await service.incrementUsage("1");

      expect(result).toEqual(updated);
      expect(prisma.streamTemplate.update).toHaveBeenCalledWith({
        where: { id: "1" },
        data: { usageCount: { increment: 1 } },
      });
    });

    it("should return null on error", async () => {
      (prisma.streamTemplate.update as jest.Mock).mockRejectedValue(new Error("DB error"));

      const result = await service.incrementUsage("1");

      expect(result).toBeNull();
    });
  });

  describe("bulkCreate", () => {
    it("should create many templates and return count", async () => {
      const templates = Array.from({ length: 50 }, (_, i) => ({
        name: `Template ${i}`,
        asset: "USDC",
        recipientAddress: `GABC${i}`,
        totalAmount: "100",
        rateType: "per-second",
        durationPreset: "1 Month",
        createdBy: "GMASTER",
      }));

      (prisma.streamTemplate.createMany as jest.Mock).mockResolvedValue({ count: 50 });

      const result = await service.bulkCreate(templates);

      expect(result).toBe(50);
      expect(prisma.streamTemplate.createMany).toHaveBeenCalledTimes(1);
      const createManyCall = (prisma.streamTemplate.createMany as jest.Mock).mock.calls[0][0];
      expect(createManyCall.data).toHaveLength(50);
    });

    it("should validate all templates before bulk creating", async () => {
      const templates = [
        {
          name: "Good",
          asset: "USDC",
          recipientAddress: "GABC",
          totalAmount: "100",
          rateType: "per-second",
          durationPreset: "1 Month",
          createdBy: "GMASTER",
        },
        {
          name: "Bad",
          asset: "USDC",
          recipientAddress: "GABC",
          totalAmount: "100",
          rateType: "invalid",
          durationPreset: "1 Month",
          createdBy: "GMASTER",
        },
      ];

      await expect(service.bulkCreate(templates)).rejects.toThrow("Invalid rateType");
    });
  });

  describe("usage count tracking (acceptance criterion #4)", () => {
    it("should track usage across 100 increment calls", async () => {
      let count = 0;
      (prisma.streamTemplate.update as jest.Mock).mockImplementation(() => {
        count++;
        return Promise.resolve({ id: "1", usageCount: count });
      });

      for (let i = 0; i < 100; i++) {
        const result = await service.incrementUsage("1");
        expect(result).not.toBeNull();
        expect(result!.usageCount).toBe(i + 1);
      }

      expect(prisma.streamTemplate.update).toHaveBeenCalledTimes(100);
    });
  });
});
