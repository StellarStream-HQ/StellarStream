import { describe, expect, it } from "vitest";
import { processRows } from "./disbursement-file.service.js";

const VALID_G_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const VALID_M_ADDRESS = "MAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACTA4";

describe("processRows recipient address validation", () => {
  it("accepts checksum-valid G and M recipient addresses", () => {
    const result = processRows([
      { address: VALID_G_ADDRESS, amount: "1" },
      { address: VALID_M_ADDRESS, amount: "2.5" },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.valid).toEqual([
      { address: VALID_G_ADDRESS, amountStroops: "10000000" },
      { address: VALID_M_ADDRESS, amountStroops: "25000000" },
    ]);
  });

  it("rejects unsupported prefixes and invalid checksums", () => {
    const invalidChecksum = `${VALID_G_ADDRESS.slice(0, -1)}G`;
    const result = processRows([
      { address: `C${VALID_G_ADDRESS.slice(1)}`, amount: "1" },
      { address: invalidChecksum, amount: "2" },
    ]);

    expect(result.valid).toEqual([]);
    expect(result.errors).toEqual([
      { row: 1, address: `C${VALID_G_ADDRESS.slice(1)}`, reason: "Invalid Stellar address checksum" },
      { row: 2, address: invalidChecksum, reason: "Invalid Stellar address checksum" },
    ]);
  });
});
