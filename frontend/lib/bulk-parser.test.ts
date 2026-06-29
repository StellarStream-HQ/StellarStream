import { describe, expect, it } from "vitest";
import { parseCSV, parseJSON } from "./bulk-parser";

const VALID_G_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const VALID_M_ADDRESS = "MAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACTA4";

describe("bulk recipient address validation", () => {
  it("accepts checksum-valid G and M recipient addresses from CSV", () => {
    const result = parseCSV(`address,amount\n${VALID_G_ADDRESS},10\n${VALID_M_ADDRESS},20`);

    expect(result.errors).toEqual([]);
    expect(result.valid.map((row) => row.address)).toEqual([VALID_G_ADDRESS, VALID_M_ADDRESS]);
  });

  it("rejects unsupported prefixes and invalid checksums from JSON", () => {
    const invalidChecksum = `${VALID_G_ADDRESS.slice(0, -1)}G`;
    const result = parseJSON(
      JSON.stringify([
        { address: `C${VALID_G_ADDRESS.slice(1)}`, amount: "10" },
        { address: invalidChecksum, amount: "20" },
      ]),
    );

    expect(result.valid).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].reason).toContain("Invalid Stellar address");
    expect(result.errors[1].reason).toContain("Invalid Stellar address");
  });
});
