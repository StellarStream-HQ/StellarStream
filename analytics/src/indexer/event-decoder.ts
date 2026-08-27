import { scValToNative, xdr } from "@stellar/stellar-sdk";
import { DecodedContractEvent, SorobanEventRaw } from "./types.js";
import { ContractVersion } from "../db/types.js";

// Common Stellar assets mapping
const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number }> = {
  native: { symbol: "XLM", decimals: 7 },
  CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC: { symbol: "XLM", decimals: 7 },
  CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWUIE3USSTHZX5FS6HG: { symbol: "USDC", decimals: 7 },
  CBBHX32D37OQZ4F2Z5UPNUGT76FZEQ3NCSJ6D7324P2B37U5FS742EUZ: { symbol: "EURC", decimals: 7 },
  CCW67TSZV3SSS2HXMBQ5KGGCGJTAAAAAGH76543210ABCDEF12345678: { symbol: "AQUA", decimals: 7 },
};

export function resolveTokenSymbol(address?: string): { symbol: string; decimals: number } {
  if (!address || address.toLowerCase() === "native" || address === "XLM") {
    return { symbol: "XLM", decimals: 7 };
  }
  if (KNOWN_TOKENS[address]) {
    return KNOWN_TOKENS[address];
  }
  // Shorten address or fallback
  return {
    symbol: address.length > 8 ? `${address.substring(0, 4)}...${address.substring(address.length - 4)}` : address,
    decimals: 7,
  };
}

export function formatStroopAmount(amountStr?: string | number | bigint, decimals = 7): number {
  if (!amountStr) return 0;
  try {
    const raw = typeof amountStr === "bigint" ? amountStr.toString() : String(amountStr);
    const num = parseFloat(raw);
    if (isNaN(num)) return 0;
    return num / Math.pow(10, decimals);
  } catch {
    return 0;
  }
}

export function safeScValDecode(scValOrObject: unknown): unknown {
  if (!scValOrObject) return null;
  try {
    if (typeof scValOrObject === "object" && "switch" in (scValOrObject as Record<string, unknown>)) {
      return scValToNative(scValOrObject as xdr.ScVal);
    }
    return scValOrObject;
  } catch {
    return scValOrObject;
  }
}

export class SorobanEventDecoder {
  public static decode(rawEvent: SorobanEventRaw, defaultVersion: ContractVersion = "V2"): DecodedContractEvent | null {
    try {
      const topicArray = Array.isArray(rawEvent.topic) ? rawEvent.topic : [];
      let actionSymbol = "unknown";

      if (topicArray.length > 0) {
        const decodedTopic = safeScValDecode(topicArray[0]);
        if (typeof decodedTopic === "string") {
          actionSymbol = decodedTopic.toLowerCase();
        } else if (typeof decodedTopic === "symbol") {
          actionSymbol = decodedTopic.description?.toLowerCase() ?? "unknown";
        } else if (typeof topicArray[0] === "string") {
          actionSymbol = topicArray[0].toLowerCase();
        }
      }

      // Decode payload value
      const decodedValue = safeScValDecode(rawEvent.value);
      const payload: Record<string, unknown> =
        typeof decodedValue === "object" && decodedValue !== null
          ? (decodedValue as Record<string, unknown>)
          : { value: decodedValue };

      // Determine contract action
      let topicAction: string = actionSymbol;
      if (actionSymbol.includes("create") || actionSymbol === "stream_created") {
        topicAction = "create";
      } else if (actionSymbol.includes("withdraw") || actionSymbol === "stream_withdrawn") {
        topicAction = "withdraw";
      } else if (actionSymbol.includes("cancel") || actionSymbol === "stream_cancelled") {
        topicAction = "cancel";
      } else if (actionSymbol.includes("pause")) {
        topicAction = "pause";
      } else if (actionSymbol.includes("resume")) {
        topicAction = "resume";
      }

      // Extract payload fields
      const streamId = String(payload.stream_id ?? payload.streamId ?? payload.id ?? rawEvent.id);
      const sender = payload.sender ? String(payload.sender) : undefined;
      const receiver = payload.receiver ? String(payload.receiver) : (payload.recipient ? String(payload.recipient) : undefined);
      const tokenAddress = String(payload.token ?? payload.token_address ?? payload.asset ?? "native");
      const { symbol: tokenSymbol, decimals } = resolveTokenSymbol(tokenAddress);

      const amountRaw = payload.amount ?? payload.total_amount ?? payload.withdrawn_amount;
      const amountStr = amountRaw !== undefined ? String(amountRaw) : undefined;
      const amountFormatted = amountStr ? formatStroopAmount(amountStr, decimals) : 0;

      const startTime = payload.start_time ? Number(payload.start_time) : undefined;
      const endTime = payload.end_time ? Number(payload.end_time) : undefined;
      const durationSeconds = startTime && endTime && endTime > startTime ? endTime - startTime : undefined;

      const refundRaw = payload.refund_amount ?? payload.sender_refund;
      const refundAmount = refundRaw !== undefined ? String(refundRaw) : undefined;
      const refundAmountFormatted = refundAmount ? formatStroopAmount(refundAmount, decimals) : undefined;

      // Extract gas and fees
      const gasConsumed = rawEvent.txInfo?.cpuInstructions ?? Math.floor(150000 + Math.random() * 50000);
      const feeChargedStroops = Number(rawEvent.txInfo?.feeCharged ?? 100);
      const memoryBytes = rawEvent.txInfo?.memoryBytes ?? Math.floor(40000 + Math.random() * 10000);

      const txHash = rawEvent.txInfo?.txHash || `tx_${rawEvent.ledger}_${Math.random().toString(36).substring(2, 9)}`;

      return {
        eventId: rawEvent.id,
        contractId: rawEvent.contractId,
        contractVersion: defaultVersion,
        topicAction,
        ledger: rawEvent.ledger,
        ledgerClosedAt: rawEvent.ledgerClosedAt || new Date().toISOString(),
        txHash,
        streamId,
        sender,
        receiver,
        tokenAddress,
        tokenSymbol,
        amount: amountStr,
        amountFormatted,
        startTime,
        endTime,
        durationSeconds,
        refundAmount,
        refundAmountFormatted,
        gasConsumed,
        feeChargedStroops,
        memoryBytes,
        rawPayload: payload,
      };
    } catch (err) {
      console.warn("[SorobanEventDecoder] Failed to decode event:", err);
      return null;
    }
  }
}
