import { decodeScVal } from "./transport.js";
import type { ParsedContractEvent } from "./types.js";

/** Converts an RPC diagnostic/contract event into a stable frontend shape. */
export function parseContractEvent(event: { topic?: unknown; topics?: unknown[]; value?: unknown; data?: unknown; contractId?: string }): ParsedContractEvent {
  const topics = event.topics ?? (event.topic === undefined ? [] : [event.topic]);
  const decodedTopics = topics.map(decodeScVal);
  return { topic: String(decodedTopics[0] ?? "unknown"), source: event.contractId, value: decodeScVal(event.value ?? event.data), raw: event };
}
