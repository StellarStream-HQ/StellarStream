// Suppress logger output during Jest runs
process.env.LOG_LEVEL = "silent";
process.env.NODE_ENV = "test";
// Provide dummy env vars required by config.ts validation
process.env.STELLAR_RPC_URL = "http://localhost:8000";
process.env.CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/stellarstream_test";
