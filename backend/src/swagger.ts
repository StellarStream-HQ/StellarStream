import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "StellarStream API",
      version: "1.0.0",
      description:
        "REST API for the StellarStream Stellar payment streaming indexer. " +
        "Provides endpoints to query streams, audit logs, statistics, authentication, and webhook management.",
      contact: { name: "StellarStream", url: "https://github.com/StellarStream-HQ/StellarStream" },
      license: { name: "MIT" },
    },
    servers: [
      { url: "/api/v1", description: "V1 API (current)" },
      { url: "http://localhost:3000/api/v1", description: "Local development" },
    ],
    tags: [
      { name: "Streams", description: "Stellar payment stream queries and fee estimation" },
      { name: "Auth", description: "Challenge-response wallet authentication" },
      { name: "Public", description: "Public stats and search — no authentication required" },
      { name: "Webhooks", description: "Register and manage webhook callbacks for stream events" },
      { name: "Audit Log", description: "Protocol audit trail and hash-chain verification" },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-Api-Key",
          description: "API key for StellarStream. Can also be sent as `Authorization: Bearer <key>`.",
        },
        WalletAuth: {
          type: "apiKey",
          in: "header",
          name: "X-Stellar-Address",
          description:
            "Stellar wallet address. Must be accompanied by `X-Auth-Nonce` and `X-Auth-Signature` headers.",
        },
      },
      schemas: {
        Stream: {
          type: "object",
          properties: {
            id: { type: "string", example: "clxyz1234" },
            streamId: { type: "string", example: "stream-abc123" },
            sender: { type: "string", example: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" },
            receiver: { type: "string", example: "GBVVJJWT3JTHKBZISFYIGR7QRKNSENTRY3BNKFNZOMKVLBXGKBCXBXBB" },
            tokenAddress: { type: "string", example: "USDC" },
            amount: { type: "string", example: "1000000000", description: "Total amount in stroops" },
            withdrawn: { type: "string", example: "500000000", description: "Amount withdrawn in stroops" },
            status: { type: "string", enum: ["ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"], example: "ACTIVE" },
            duration: { type: "number", nullable: true, example: 2592000, description: "Stream duration in seconds" },
          },
        },
        AuditLogEvent: {
          type: "object",
          properties: {
            id: { type: "integer", example: 1 },
            eventType: { type: "string", example: "create", description: "Contract event type (create, withdraw, cancel, migrate)" },
            streamId: { type: "string", example: "stream-abc123" },
            txHash: { type: "string", example: "a1b2c3d4e5f6..." },
            sender: { type: "string", example: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" },
            amount: { type: "string", nullable: true, example: "1000000000" },
            ledgerClosedAt: { type: "string", format: "date-time", example: "2024-01-15T10:30:00.000Z" },
            metadata: { type: "string", nullable: true, description: "JSON-encoded extra metadata" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        StatsResponse: {
          type: "object",
          properties: {
            totalStreams: { type: "integer", example: 1042 },
            uniqueSenders: { type: "integer", example: 318 },
            uniqueReceivers: { type: "integer", example: 524 },
            globalTvl: { type: "string", example: "98540000000", description: "Total value locked in stroops" },
            activeStreams: { type: "integer", example: 204 },
            tvlRefreshedAt: { type: "string", format: "date-time", nullable: true, example: "2024-06-01T12:00:00.000Z" },
          },
        },
        SearchResponse: {
          type: "object",
          properties: {
            streams: { type: "array", items: { $ref: "#/components/schemas/Stream" } },
            total: { type: "integer", example: 42 },
            limit: { type: "integer", example: 20 },
            offset: { type: "integer", example: 0 },
          },
        },
        FeeEstimate: {
          type: "object",
          properties: {
            estimatedFeeXlm: { type: "string", example: "0.01234", description: "Total fee in XLM" },
            estimatedFeeStroops: { type: "string", example: "123400" },
            resourceFee: { type: "string", example: "100000", description: "Soroban resource fee in stroops" },
            inclusionFee: { type: "string", example: "23400", description: "Network inclusion fee in stroops" },
            curveType: { type: "string", enum: ["linear", "exponential"], example: "linear" },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: { type: "string", example: "Validation failed" },
            code: { type: "string", example: "INVALID_PARAMS" },
          },
        },
        WebhookRegistration: {
          type: "object",
          properties: {
            id: { type: "string", example: "wh_abc123" },
            url: { type: "string", format: "uri", example: "https://example.com/webhook" },
            eventType: { type: "string", example: "stream.created" },
            secretKey: { type: "string", example: "sk_live_xxxxxxxxxx", description: "Store securely — shown only once" },
            description: { type: "string", nullable: true, example: "Payment notifications" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Nonce: {
          type: "object",
          properties: {
            nonce: { type: "string", example: "a3f8c2e1d4b7a9f0c3e2b1d8f5c4e7a2" },
          },
        },
      },
    },
  },
  apis: [
    "./src/api/*.ts",
    "./src/api/v2/*.ts",
    "./src/api/v3/*.ts",
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
