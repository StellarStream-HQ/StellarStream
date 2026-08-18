use soroban_sdk::{contracterror, contracttype, Address};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    StreamNotFound = 4,
    StreamNotActive = 5,
    StreamPaused = 6,
    StreamAlreadyFinished = 7,
    InvalidTimeRange = 8,
    InvalidAmount = 9,
    ZeroDuration = 10,
    CalculationOverflow = 11,
    LimitExceeded = 12,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum StreamState {
    Active = 0,
    Paused = 1,
    Completed = 2,
    Cancelled = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Stream {
    pub id: u64,
    pub sender: Address,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub withdrawn_amount: i128,
    pub start_time: u64,
    pub end_time: u64,
    pub paused_duration: u64,
    pub last_paused_time: u64,
    pub state: StreamState,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Default)]
pub struct StreamFilter {
    pub token: Option<Address>,
    pub state: Option<u32>,
    pub min_amount: Option<i128>,
    pub max_amount: Option<i128>,
    pub start_time_after: Option<u64>,
    pub end_time_before: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractHealth {
    pub is_paused: bool,
    pub active_streams: u64,
    pub total_streams: u64,
    pub last_activity_time: u64,
    pub version: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractMetrics {
    pub total_streams: u64,
    pub active_streams: u64,
    pub completed_streams: u64,
    pub cancelled_streams: u64,
    pub total_volume_streamed: i128,
    pub total_withdrawn_volume: i128,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    NextStreamId,
    Stream(u64),
    StreamCount,
    TokenTvl(Address),
    TokensList,
    ProtocolPaused,
    LastActivityTime,
}
