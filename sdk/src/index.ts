import { asSdkError } from "./errors.js";
import { parseContractEvent } from "./events.js";
import { TransactionBuilderHelper, type ContractTransport, type InvocationMode } from "./transport.js";
import type { Address, ContractHealth, ContractMetrics, CreateProposalParams, CreateStreamParams, Network, ParsedContractEvent, Stream, StreamEvent, StreamId, StreamMetadata, StreamProposal } from "./types.js";

export * from "./types.js";
export * from "./errors.js";
export * from "./events.js";
export * from "./transport.js";

/**
 * Typed client for every public function in the StellarStream V1 contract.
 * Supply a transport that connects `invoke` to your wallet or relayer. Read and
 * write calls are intentionally distinguished so transports can simulate reads
 * and request signatures only for writes.
 */
export class StellarStreamSDK {
  readonly transactions: TransactionBuilderHelper;
  constructor(public readonly contractId: string, public readonly network: Network, private readonly transport: ContractTransport) {
    this.transactions = new TransactionBuilderHelper(contractId, network);
  }

  async initialize(admin: Address): Promise<void> { await this.write("initialize", [admin]); }
  async createStream(params: CreateStreamParams): Promise<StreamId> {
    return this.write("create_stream", [params.sender, params.receiver, params.token, params.totalAmount, params.startTime, params.endTime, params.curveType ?? 0, params.isSoulbound ?? false, params.milestones ?? null]) as Promise<StreamId>;
  }
  async createProposal(params: CreateProposalParams): Promise<bigint> { return this.write("create_proposal", [params.sender, params.receiver, params.token, params.totalAmount, params.startTime, params.endTime, params.requiredApprovals, params.deadline]) as Promise<bigint>; }
  async approveProposal(proposalId: bigint, approver: Address): Promise<void> { await this.write("approve_proposal", [proposalId, approver]); }
  async getProposal(proposalId: bigint): Promise<StreamProposal> { return normalize(await this.read("get_proposal", [proposalId])) as StreamProposal; }
  async withdraw(streamId: StreamId, receiver: Address): Promise<bigint> { return this.write("withdraw", [streamId, receiver]) as Promise<bigint>; }
  async cancelStream(streamId: StreamId, sender: Address): Promise<void> { await this.write("cancel_stream", [streamId, sender]); }
  async pauseStream(streamId: StreamId, caller: Address): Promise<void> { await this.write("pause_stream", [streamId, caller]); }
  async resumeStream(streamId: StreamId, caller: Address): Promise<void> { await this.write("resume_stream", [streamId, caller]); }
  async getStream(streamId: StreamId): Promise<Stream> { return normalize(await this.read("get_stream", [streamId])) as Stream; }
  async getUnlockedAmount(streamId: StreamId): Promise<bigint> { return this.read("get_unlocked_amount", [streamId]) as Promise<bigint>; }
  async getWithdrawableAmount(streamId: StreamId): Promise<bigint> { return this.read("get_withdrawable_amount", [streamId]) as Promise<bigint>; }
  async getTimeRemainingSeconds(streamId: StreamId): Promise<bigint> { return this.read("get_time_remaining_seconds", [streamId]) as Promise<bigint>; }
  async getTimeRemainingDays(streamId: StreamId): Promise<bigint> { return this.read("get_time_remaining_days", [streamId]) as Promise<bigint>; }
  async getCompletionPercentage(streamId: StreamId): Promise<number> { return this.read("get_completion_percentage", [streamId]) as Promise<number>; }
  async getUserStreams(user: Address): Promise<StreamId[]> { return this.read("get_user_streams", [user]) as Promise<StreamId[]>; }
  async healthCheck(): Promise<ContractHealth> { return normalize(await this.read("health_check")) as ContractHealth; }
  async getMetrics(): Promise<ContractMetrics> { return normalize(await this.read("get_metrics")) as ContractMetrics; }
  async setProtocolFee(manager: Address, feeBps: number): Promise<void> { await this.write("set_protocol_fee", [manager, feeBps]); }
  async setTreasuryAddress(manager: Address, treasury: Address): Promise<void> { await this.write("set_treasury_address", [manager, treasury]); }
  async getProtocolFee(): Promise<number> { return this.read("get_protocol_fee") as Promise<number>; }
  async getTreasuryAddress(): Promise<Address | undefined> { return this.read("get_treasury_address") as Promise<Address | undefined>; }
  async calculateProtocolFee(amount: bigint): Promise<bigint> { return this.read("calculate_protocol_fee", [amount]) as Promise<bigint>; }
  async grantRole(admin: Address, account: Address, role: number): Promise<void> { await this.write("grant_role", [admin, account, role]); }
  async revokeRole(admin: Address, account: Address, role: number): Promise<void> { await this.write("revoke_role", [admin, account, role]); }
  async restrictAddress(admin: Address, target: Address): Promise<void> { await this.write("restrict_address", [admin, target]); }
  async unrestrictAddress(admin: Address, target: Address): Promise<void> { await this.write("unrestrict_address", [admin, target]); }
  async pauseContract(pauser: Address): Promise<void> { await this.write("pause_contract", [pauser]); }
  async unpauseContract(pauser: Address): Promise<void> { await this.write("unpause_contract", [pauser]); }
  async isAddressRestricted(target: Address): Promise<boolean> { return this.read("is_address_restricted", [target]) as Promise<boolean>; }
  async batchWithdraw(streamIds: StreamId[], receiver: Address): Promise<bigint[]> { return this.write("batch_withdraw", [streamIds, receiver]) as Promise<bigint[]>; }
  async updateStreamMetadata(streamId: StreamId, sender: Address, metadata: StreamMetadata): Promise<void> { await this.write("update_stream_metadata", [streamId, sender, metadata.label, metadata.tags, metadata.externalRef ?? null]); }
  async getStreamMetadata(streamId: StreamId): Promise<StreamMetadata | undefined> { return normalize(await this.read("get_stream_metadata", [streamId])) as StreamMetadata | undefined; }
  async nextStreamId(): Promise<StreamId> { return this.read("next_stream_id") as Promise<StreamId>; }
  async getStreamHistory(streamId: StreamId): Promise<StreamEvent[]> { return normalize(await this.read("get_stream_history", [streamId])) as StreamEvent[]; }
  async getActiveStreamsCount(): Promise<bigint> { return this.read("get_active_streams_count") as Promise<bigint>; }
  async getUserActiveStreamsCount(user: Address): Promise<bigint> { return this.read("get_user_active_streams_count", [user]) as Promise<bigint>; }
  async getTotalStreamsCount(): Promise<bigint> { return this.read("get_total_streams_count") as Promise<bigint>; }
  async getUserTotalStreamsCount(user: Address): Promise<bigint> { return this.read("get_user_total_streams_count", [user]) as Promise<bigint>; }
  async getPausedStreamsCount(): Promise<bigint> { return this.read("get_paused_streams_count") as Promise<bigint>; }
  async getUserPausedStreamsCount(user: Address): Promise<bigint> { return this.read("get_user_paused_streams_count", [user]) as Promise<bigint>; }
  async getClosedStreamsCount(): Promise<bigint> { return this.read("get_closed_streams_count") as Promise<bigint>; }
  async getUserClosedStreamsCount(user: Address): Promise<bigint> { return this.read("get_user_closed_streams_count", [user]) as Promise<bigint>; }
  parseEvent(event: Parameters<typeof parseContractEvent>[0]): ParsedContractEvent { return parseContractEvent(event); }
  private async call(method: string, args: unknown[], mode: InvocationMode): Promise<unknown> { try { return await this.transport.invoke(method, args, mode); } catch (error) { throw asSdkError(error, method); } }
  private read(method: string, args: unknown[] = []): Promise<unknown> { return this.call(method, args, "read"); }
  private write(method: string, args: unknown[] = []): Promise<unknown> { return this.call(method, args, "write"); }
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object" && !(value instanceof Map)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), normalize(item)]));
  return value;
}
