use soroban_sdk::{contracttype, Address, BytesN};

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum DataKey {
    Admin,
    QuorumAdmins,
    NextProposalId,
    Token,
    FeeBps,
    Treasury,
    StrictMode,
    VerifiedUsers(Address),
    Proposal(u64),
    NextSplitId,
    ScheduledSplit(u64),
    ClaimableBalance(Address, Address),
    CouncilKeys,
    ContractState,
    AffiliateAddress,
    AffiliateBps,
    PendingWithdrawal(Address),
    ProcessedHash(BytesN<32>),
    SplitFundsNextIndex,
    // #924: migration version to prevent re-running migration logic
    MigrationVersion,
    // #927: whitelist map and flag
    Whitelisted(Address),
    WhitelistOnly,
    // #918: external identity validator contract address
    IdentityValidator,
    // #911: protocol-level version constant
    ProtocolVersion,
    // #911: protocol fee wallet (alias for Treasury used in init)
    FeeWallet,
    // #913: reentrancy guard — set to true while split_funds is executing
    Locked,
    // #916: multi-sig admin change proposals
    AdminProposal(u64),
    NextAdminProposalId,
    /// Minimum approvals required to execute a sensitive admin action.
    AdminThreshold,
}
