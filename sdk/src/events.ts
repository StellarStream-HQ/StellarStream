import { StreamEvent } from "./types.js";

/**
 * Decodes raw Soroban contract events into strongly-typed StreamEvent objects.
 */
export function parseContractEvent(rawEvent: any): StreamEvent {
  const contractId = rawEvent.contractId?.toString() ?? "";
  const ledger = Number(rawEvent.ledger ?? 0);
  const topics = rawEvent.topic ?? [];
  const eventName = topics[0]?.toString() ?? "Unknown";

  let type: StreamEvent["type"] = "Unknown";
  if (eventName === "stream_created" || eventName === "StreamCreated") type = "StreamCreated";
  else if (eventName === "stream_paused" || eventName === "StreamPaused") type = "StreamPaused";
  else if (eventName === "stream_unpaused" || eventName === "StreamUnpaused") type = "StreamUnpaused";
  else if (eventName === "stream_cancelled" || eventName === "StreamCancelled") type = "StreamCancelled";
  else if (eventName === "withdraw" || eventName === "Withdrawal") type = "Withdrawal";

  const streamId = topics[1] ? BigInt(topics[1].toString()) : 0n;

  return {
    type,
    streamId,
    contractId,
    ledger,
    data: rawEvent.value ?? {},
  };
}
