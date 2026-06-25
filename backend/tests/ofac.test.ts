import { OfacService } from "../src/services/ofac.service.js";

describe("OFAC Compliance Tests", () => {
  let ofacService: OfacService;

  beforeAll(() => {
    ofacService = new OfacService();
  });

  describe("Known SDN Address Blocking", () => {
    // 10 known SDN addresses that should be blocked
    const KNOWN_SDN_ADDRESSES = [
      "GD5PMJGQ6WJXWB5G4FJ3QDKXNFMJQK5T5Y4M4M4M4M4M4M4M4M4M4M4M",
      "GB7I5Q6KXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJ",
      "GC3M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M",
      "GAB3M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M",
      "GDE3M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M",
      "GDF3M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M",
      "GDG3M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M",
      "GDH3M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M",
      "GDI3M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M",
      "GDJ3M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M4M",
    ];

    test.each(KNOWN_SDN_ADDRESSES)("should block known SDN address: %s", async (address) => {
      const result = await ofacService.checkAddress(address);
      expect(result.isSanctioned).toBe(true);
      expect(result.address).toBe(address.toUpperCase());
      expect(result.source).toBe("sdn-list");
      expect(result.checkedAt).toBeDefined();
    });
  });

  describe("Non-SDN Address Allowance", () => {
    test("should allow non-SDN addresses", async () => {
      const cleanAddress = "GD5PMJGQ6WJXWB5G4FJ3QDKXNFMJQK5T5Y4M4M4M4M4M4M4M4M4M4M5";
      const result = await ofacService.checkAddress(cleanAddress);
      expect(result.isSanctioned).toBe(false);
      expect(result.address).toBe(cleanAddress.toUpperCase());
    });
  });

  describe("Caching", () => {
    test("should cache OFAC check results", async () => {
      const address = "GD5PMJGQ6WJXWB5G4FJ3QDKXNFMJQK5T5Y4M4M4M4M4M4M4M4M4M4M";
      
      // First check
      const result1 = await ofacService.checkAddress(address);
      expect(result1.isSanctioned).toBe(true);
      
      // Second check should return cached result
      const result2 = await ofacService.checkAddress(address);
      expect(result2.isSanctioned).toBe(true);
      expect(result2.checkedAt).toBe(result1.checkedAt);
    });
  });

  describe("Batch Address Checking", () => {
    test("should check multiple addresses in batch", async () => {
      const addresses = [
        "GD5PMJGQ6WJXWB5G4FJ3QDKXNFMJQK5T5Y4M4M4M4M4M4M4M4M4M4M", // SDN
        "GB7I5Q6KXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJXJ", // SDN
        "GD5PMJGQ6WJXWB5G4FJ3QDKXNFMJQK5T5Y4M4M4M4M4M4M4M4M4M4M5", // Clean
      ];

      const results = await ofacService.checkAddresses(addresses);
      
      expect(results.size).toBe(3);
      expect(results.get(addresses[0])?.isSanctioned).toBe(true);
      expect(results.get(addresses[1])?.isSanctioned).toBe(true);
      expect(results.get(addresses[2])?.isSanctioned).toBe(false);
    });
  });

  describe("Address Normalization", () => {
    test("should normalize address to uppercase", async () => {
      const lowercaseAddress = "gd5pmjgq6wjxwb5g4fj3qdkxnfmjqk5t5y4m4m4m4m4m4m4m4m4m4m";
      const result = await ofacService.checkAddress(lowercaseAddress);
      expect(result.address).toBe(lowercaseAddress.toUpperCase());
    });
  });

  describe("Known SDN Address Helpers", () => {
    test("should identify known SDN addresses", () => {
      const sdnAddress = "GD5PMJGQ6WJXWB5G4FJ3QDKXNFMJQK5T5Y4M4M4M4M4M4M4M4M4M4M";
      expect(ofacService.isKnownSdnAddress(sdnAddress)).toBe(true);
    });

    test("should not identify non-SDN addresses", () => {
      const cleanAddress = "GD5PMJGQ6WJXWB5G4FJ3QDKXNFMJQK5T5Y4M4M4M4M4M4M4M4M4M4M5";
      expect(ofacService.isKnownSdnAddress(cleanAddress)).toBe(false);
    });

    test("should return all known SDN addresses", () => {
      const knownSdns = ofacService.getKnownSdnAddresses();
      expect(knownSdns).toHaveLength(10);
      expect(knownSdns).toContain("GD5PMJGQ6WJXWB5G4FJ3QDKXNFMJQK5T5Y4M4M4M4M4M4M4M4M4M4M");
    });
  });

  describe("Audit Trail", () => {
    test("should retrieve audit log", async () => {
      const auditLog = await ofacService.getAuditLog(10);
      expect(Array.isArray(auditLog)).toBe(true);
    });
  });
});
