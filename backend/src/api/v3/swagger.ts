import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "StellarStream V3 API",
      version: "3.0.0",
      description:
        "V3 API for StellarStream — includes bulk disbursement file processing, " +
        "Autopilot periodic split scheduling, and Safe-Vault re-routing.",
      contact: { name: "StellarStream" },
      license: { name: "MIT" },
    },
    servers: [
      { url: "/api/v3", description: "V3 API" },
      { url: "/api/v2", description: "V2 API (legacy)" },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-Api-Key",
          description: "API Key for StellarStream. Can also be sent as 'Authorization: Bearer <key>'",
        },
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "APIKEY",
        },
        WalletAuth: {
          type: "apiKey",
          in: "header",
          name: "X-Stellar-Address",
          description: "Stellar wallet address. Requires companion X-Auth-Nonce and X-Auth-Signature headers.",
        },
      },
      schemas: {
        CleanRecipient: {
          type: "object",
          properties: {
            address: { type: "string", example: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", description: "Validated Stellar recipient address" },
            amountStroops: { type: "string", example: "10050000", description: "Amount in 7-decimal stroops" },
          },
          required: ["address", "amountStroops"],
        },
        FileProcessingError: {
          type: "object",
          properties: {
            row: { type: "integer", example: 3 },
            address: { type: "string", example: "INVALID_ADDR" },
            reason: { type: "string", example: "Invalid Stellar address checksum" },
          },
        },
        ProcessFileResult: {
          type: "object",
          properties: {
            valid: { type: "array", items: { $ref: "#/components/schemas/CleanRecipient" } },
            errors: { type: "array", items: { $ref: "#/components/schemas/FileProcessingError" } },
            totalRows: { type: "integer", example: 1000 },
          },
        },
        SplitAnalyzeRecipient: {
          type: "object",
          properties: {
            address: { type: "string", example: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" },
          },
          required: ["address"],
        },
        SplitDuplicateGroup: {
          type: "object",
          properties: {
            address: { type: "string", example: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" },
            count: { type: "integer", example: 3 },
            rowIndexes: { type: "array", items: { type: "integer", example: 0 } },
          },
        },
        SplitSuggestion: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["merge_duplicate_addresses", "high_fee_transaction"] },
            message: { type: "string", example: "Address GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN appears 3 times. Merge into one row?" },
            severity: { type: "string", enum: ["info", "warning"] },
            addresses: { type: "array", items: { type: "string", example: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" } },
            rowIndexes: { type: "array", items: { type: "integer", example: 0 } },
            feeRatio: { type: "number", example: 0.075, description: "Estimated fee divided by total amount when fee analysis is available" },
          },
          required: ["type", "message", "severity"],
        },
        AutopilotSchedule: {
          type: "object",
          properties: {
            id: { type: "string", example: "clxyz123" },
            name: { type: "string", example: "Weekly Payroll" },
            frequency: { type: "string", example: "0 9 * * 1", description: "Cron expression" },
            splitConfigId: { type: "string", example: "split-abc" },
            operatorAddress: { type: "string", example: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" },
            minGasTankXlm: { type: "number", example: 1.0 },
            isActive: { type: "boolean", example: true },
            lastRun: { type: "string", format: "date-time", nullable: true },
            lastTxHash: { type: "string", nullable: true },
            lastError: { type: "string", nullable: true },
          },
        },
        OrganizationGasStatus: {
          type: "object",
          properties: {
            orgId: { type: "string", example: "org-123" },
            gasTankAddress: { type: "string", example: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" },
            balanceXlm: { type: "string", example: "450.75" },
            isLow: { type: "boolean", example: false },
            thresholdXlm: { type: "string", example: "50.00" },
          },
        },
        AnalyticsLeaderboard: {
          type: "object",
          properties: {
            topStreamers: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  address: { type: "string", example: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" },
                  totalVolumeUsd: { type: "number", example: 12500.50 },
                  streamCount: { type: "integer", example: 42 },
                },
              },
            },
            topReceivers: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  address: { type: "string", example: "GD6FMKDCUA5BQYBPNBPZRWQZFHXQNIRQZ7PFSGKF7KVHRJUALDVF2HP" },
                  totalVolumeUsd: { type: "number", example: 8900.20 },
                  streamCount: { type: "integer", example: 15 },
                },
              },
            },
          },
        },
        WebhookPayload: {
          type: "object",
          description: "Base webhook event payload. The `data` field shape varies by eventType — see webhook event schemas below.",
          properties: {
            eventType: { type: "string", example: "split.completed" },
            txHash: { type: "string", example: "3b7f2a1c9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a" },
            sender: { type: "string", example: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" },
            amount: { type: "string", example: "10000000" },
            timestamp: { type: "string", format: "date-time" },
          },
        },
        WebhookEventSplitCompleted: {
          type: "object",
          description: "Fired when a split payment batch has been successfully submitted and confirmed on-chain.",
          properties: {
            eventType: { type: "string", example: "split.completed" },
            data: {
              type: "object",
              properties: {
                splitId: { type: "string", example: "split-9f3a2b1c" },
                txHash: { type: "string", example: "3b7f2a1c9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a" },
                sender: { type: "string", example: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" },
                totalAmount: { type: "string", example: "500000000" },
                asset: { type: "string", example: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" },
                recipientCount: { type: "integer", example: 47 },
                ledger: { type: "integer", example: 48923110 },
                timestamp: { type: "string", format: "date-time", example: "2026-06-24T13:59:47.312Z" },
              },
            },
          },
        },
        WebhookEventSplitFailed: {
          type: "object",
          description: "Fired when a split payment batch fails during submission or on-chain execution.",
          properties: {
            eventType: { type: "string", example: "split.failed" },
            data: {
              type: "object",
              properties: {
                splitId: { type: "string", example: "split-9f3a2b1c" },
                sender: { type: "string", example: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" },
                reason: { type: "string", example: "tx_failed: op_underfunded" },
                failedAt: { type: "string", format: "date-time", example: "2026-06-24T13:59:47.312Z" },
                retriable: { type: "boolean", example: true },
              },
            },
          },
        },
        WebhookEventStreamCreated: {
          type: "object",
          description: "Fired when a new payment stream is created.",
          properties: {
            eventType: { type: "string", example: "stream.created" },
            data: {
              type: "object",
              properties: {
                streamId: { type: "string", example: "stream-4d7e1f2a" },
                sender: { type: "string", example: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" },
                receiver: { type: "string", example: "GD6FMKDCUA5BQYBPNBPZRWQZFHXQNIRQZ7PFSGKF7KVHRJUALDVF2HP" },
                totalAmount: { type: "string", example: "100000000" },
                asset: { type: "string", example: "XLM" },
                startTime: { type: "string", format: "date-time", example: "2026-06-24T14:00:00.000Z" },
                endTime: { type: "string", format: "date-time", example: "2026-07-24T14:00:00.000Z" },
                txHash: { type: "string", example: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2" },
              },
            },
          },
        },
        WebhookEventStreamWithdrawn: {
          type: "object",
          description: "Fired when a recipient claims/withdraws from an active stream.",
          properties: {
            eventType: { type: "string", example: "stream.withdrawn" },
            data: {
              type: "object",
              properties: {
                streamId: { type: "string", example: "stream-4d7e1f2a" },
                receiver: { type: "string", example: "GD6FMKDCUA5BQYBPNBPZRWQZFHXQNIRQZ7PFSGKF7KVHRJUALDVF2HP" },
                withdrawnAmount: { type: "string", example: "25000000" },
                remainingAmount: { type: "string", example: "75000000" },
                txHash: { type: "string", example: "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3" },
                timestamp: { type: "string", format: "date-time", example: "2026-06-24T16:30:00.000Z" },
              },
            },
          },
        },
        WebhookEventStreamCancelled: {
          type: "object",
          description: "Fired when a stream is cancelled by the sender before completion.",
          properties: {
            eventType: { type: "string", example: "stream.cancelled" },
            data: {
              type: "object",
              properties: {
                streamId: { type: "string", example: "stream-4d7e1f2a" },
                sender: { type: "string", example: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" },
                refundedAmount: { type: "string", example: "80000000" },
                cancelledAt: { type: "string", format: "date-time", example: "2026-06-25T09:00:00.000Z" },
                txHash: { type: "string", example: "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4" },
              },
            },
          },
        },
        WebhookEventAutopilotRun: {
          type: "object",
          description: "Fired after each Autopilot scheduled split execution attempt.",
          properties: {
            eventType: { type: "string", example: "autopilot.run" },
            data: {
              type: "object",
              properties: {
                scheduleId: { type: "string", example: "clxyz123" },
                scheduleName: { type: "string", example: "Weekly Payroll" },
                status: { type: "string", enum: ["success", "failed", "skipped"], example: "success" },
                txHash: { type: "string", example: "d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5", nullable: true },
                recipientCount: { type: "integer", example: 23 },
                totalAmountXlm: { type: "string", example: "230.0000000" },
                gasTankBalanceAfter: { type: "string", example: "317.5000000" },
                error: { type: "string", nullable: true, example: null },
                ranAt: { type: "string", format: "date-time", example: "2026-06-24T09:00:00.000Z" },
              },
            },
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
        ValidationErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: { type: "string", example: "Validation error" },
            details: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string", example: "recipients[2].address" },
                  message: { type: "string", example: "Invalid Stellar G-address" },
                },
              },
            },
          },
        },
        RateLimitResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: { type: "string", example: "Rate limit exceeded" },
            retryAfter: { type: "integer", example: 60, description: "Seconds until the rate limit resets" },
          },
        },
        UpstreamErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: { type: "string", example: "Stellar Horizon unavailable" },
            code: { type: "string", example: "UPSTREAM_FAILURE" },
          },
        },
        WebhookRegistrationRequest: {
          type: "object",
          properties: {
            url: { type: "string", format: "uri", example: "https://erp.example.com/stellarstream/webhooks" },
            eventType: { type: "string", example: "split.completed", description: "Use '*' to receive every supported webhook event." },
            description: { type: "string", example: "ERP split settlement callback" },
          },
          required: ["url"],
        },
        WebhookRegistrationResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            data: {
              type: "object",
              properties: {
                webhookId: { type: "string", example: "cm123abc" },
                secretKey: { type: "string", example: "8f8d7f4a0ff9d6fbbbf0dbe2876ef0bc9efcad727674b81c82ee1d66fc8f8dd1" },
                eventType: { type: "string", example: "split.completed" },
              },
            },
            message: { type: "string", example: "Webhook registered successfully. Store the secretKey securely." },
          },
        },
        // --- New schemas ---
        AssetPrice: {
          type: "object",
          properties: {
            asset: { type: "string", example: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" },
            priceUsd: { type: "number", example: 1.0001 },
            priceXlm: { type: "number", example: 8.3402 },
            updatedAt: { type: "string", format: "date-time", example: "2026-06-24T13:55:00.000Z" },
          },
          required: ["asset", "priceUsd", "priceXlm", "updatedAt"],
        },
        SplitValidationResult: {
          type: "object",
          properties: {
            isValid: { type: "boolean", example: true },
            errors: {
              type: "array",
              items: { type: "string" },
              example: [],
            },
            warnings: {
              type: "array",
              items: { type: "string" },
              example: ["Recipient GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN has no trustline for USDC"],
            },
            estimatedFeeXlm: { type: "string", example: "0.0001200" },
          },
          required: ["isValid", "errors", "warnings", "estimatedFeeXlm"],
        },
        MultisigProposal: {
          type: "object",
          properties: {
            id: { type: "string", example: "prop-7a3b2c1d" },
            operationId: { type: "string", example: "split-9f3a2b1c" },
            proposer: { type: "string", example: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" },
            approvals: {
              type: "array",
              items: { type: "string" },
              example: ["GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", "GD6FMKDCUA5BQYBPNBPZRWQZFHXQNIRQZ7PFSGKF7KVHRJUALDVF2HP"],
            },
            threshold: { type: "integer", example: 3 },
            status: { type: "string", enum: ["pending", "approved", "rejected", "executed", "expired"], example: "pending" },
            expiresAt: { type: "string", format: "date-time", example: "2026-06-25T13:59:47.312Z" },
          },
          required: ["id", "operationId", "proposer", "approvals", "threshold", "status", "expiresAt"],
        },
        SplitTemplate: {
          type: "object",
          properties: {
            id: { type: "string", example: "tmpl-1a2b3c4d" },
            name: { type: "string", example: "Monthly Contractor Payroll" },
            recipients: {
              type: "array",
              items: { $ref: "#/components/schemas/CleanRecipient" },
              example: [
                { address: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", amountStroops: "50000000" },
                { address: "GD6FMKDCUA5BQYBPNBPZRWQZFHXQNIRQZ7PFSGKF7KVHRJUALDVF2HP", amountStroops: "30000000" },
              ],
            },
            createdAt: { type: "string", format: "date-time", example: "2026-06-01T09:00:00.000Z" },
            orgId: { type: "string", example: "org-123" },
          },
          required: ["id", "name", "recipients", "createdAt", "orgId"],
        },
        SplitLink: {
          type: "object",
          properties: {
            slug: { type: "string", example: "payroll-june-2026" },
            url: { type: "string", format: "uri", example: "https://app.stellarstream.io/s/payroll-june-2026" },
            expiresAt: { type: "string", format: "date-time", example: "2026-07-01T00:00:00.000Z", nullable: true },
            maxUses: { type: "integer", example: 1, nullable: true },
            usesRemaining: { type: "integer", example: 1, nullable: true },
            splitConfigId: { type: "string", example: "split-9f3a2b1c" },
          },
          required: ["slug", "url", "splitConfigId"],
        },
        ProofOfPayment: {
          type: "object",
          properties: {
            txHash: { type: "string", example: "3b7f2a1c9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a" },
            sender: { type: "string", example: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" },
            recipient: { type: "string", example: "GD6FMKDCUA5BQYBPNBPZRWQZFHXQNIRQZ7PFSGKF7KVHRJUALDVF2HP" },
            amount: { type: "string", example: "100.0000000" },
            asset: { type: "string", example: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" },
            timestamp: { type: "string", format: "date-time", example: "2026-06-24T13:59:47.312Z" },
            ledger: { type: "integer", example: 48923110 },
            verified: { type: "boolean", example: true },
          },
          required: ["txHash", "sender", "recipient", "amount", "asset", "timestamp", "ledger", "verified"],
        },
        DraftVersion: {
          type: "object",
          properties: {
            id: { type: "string", example: "drft-5e6f7a8b" },
            version: { type: "integer", example: 3 },
            config: {
              type: "object",
              description: "Full split configuration snapshot",
              example: {
                recipients: [
                  { address: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", amountStroops: "50000000" },
                ],
                asset: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
              },
            },
            createdAt: { type: "string", format: "date-time", example: "2026-06-24T12:00:00.000Z" },
            notes: { type: "string", example: "Removed inactive contractors", nullable: true },
          },
          required: ["id", "version", "config", "createdAt"],
        },
        FeeBumpResult: {
          type: "object",
          properties: {
            innerHash: { type: "string", example: "3b7f2a1c9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a" },
            outerHash: { type: "string", example: "e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6" },
            feeAccount: { type: "string", example: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" },
            baseFee: { type: "integer", example: 10000, description: "Fee in stroops" },
          },
          required: ["innerHash", "outerHash", "feeAccount", "baseFee"],
        },
      },
    },
    tags: [
      { name: "Disbursement", description: "Bulk CSV/JSON file processing and split validation" },
      { name: "Safe Vault", description: "Smart routing for vault contract recipients" },
      { name: "Analytics", description: "Protocol analytics and leaderboards" },
      { name: "Organizations", description: "Organization gas tank and policy management" },
      { name: "Webhooks", description: "Webhook registration and event notification" },
      { name: "Templates", description: "Reusable split payment templates" },
      { name: "History", description: "Transaction history and proof of payment" },
      { name: "Assets", description: "Asset price feeds and cached metadata" },
      { name: "Multisig", description: "Multi-signature proposal workflow" },
    ],
    paths: {
      "/process-disbursement-file": {
        post: {
          summary: "Process bulk CSV or JSON disbursement file",
          description: "Validates 1,000+ rows: checks G-address checksums, converts decimal amounts to stroops. Requires X-Idempotency-Key header.",
          operationId: "processDisbursementFile",
          tags: ["Disbursement"],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: "format", in: "query", schema: { type: "string", enum: ["csv", "json"], default: "json" } },
            { name: "X-Idempotency-Key", in: "header", required: true, schema: { type: "string", example: "batch-2026-06-24-payroll" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "array", items: { type: "object", required: ["address", "amount"], properties: { address: { type: "string", example: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" }, amount: { type: "string", example: "100.50" } } } },
                example: [
                  { address: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", amount: "100.50" },
                  { address: "INVALID_ADDR", amount: "50.00" },
                ],
              },
              "text/csv": { schema: { type: "string" }, example: "address,amount\nGAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN,100.50" },
            },
          },
          responses: {
            "200": {
              description: "Processed. Check `errors` array for invalid rows.",
              content: { "application/json": { example: { success: true, data: { valid: [{ address: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", amountStroops: "10050000" }], errors: [{ row: 2, address: "INVALID_ADDR", reason: "Invalid Stellar address checksum" }], totalRows: 2 } } } },
            },
            "400": { description: "Malformed CSV/JSON", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "409": { description: "Idempotency conflict — already processed", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" }, example: { success: false, error: "Already processed", code: "ALREADY_PROCESSED" } } } },
            "422": { description: "All rows failed validation", content: { "application/json": { schema: { $ref: "#/components/schemas/ValidationErrorResponse" } } } },
            "429": { description: "Rate limit exceeded", content: { "application/json": { schema: { $ref: "#/components/schemas/RateLimitResponse" } } } },
          },
        },
      },
      "/split/analyze": {
        post: {
          summary: "Analyze a draft split for optimization suggestions",
          description: "Detects duplicate addresses and high-fee scenarios before submission.",
          tags: ["Disbursement"],
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                example: { recipients: [{ address: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" }, { address: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" }] },
              },
            },
          },
          responses: {
            "200": {
              description: "Suggestions returned",
              content: { "application/json": { example: { success: true, data: { suggestions: [{ type: "merge_duplicate_addresses", severity: "warning", message: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN appears 2 times", rowIndexes: [0, 1] }] } } } },
            },
            "400": { description: "Invalid input", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/validate-split": {
        post: {
          summary: "Validate a split configuration before execution",
          description: "Pre-validates recipients, amounts, trustlines. Returns errors/warnings without submitting to chain.",
          tags: ["Disbursement"],
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { example: { recipients: [{ address: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", amountStroops: "10000000" }], asset: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" } } },
          },
          responses: {
            "200": { description: "Validation result", content: { "application/json": { schema: { $ref: "#/components/schemas/SplitValidationResult" }, example: { isValid: true, errors: [], warnings: [], estimatedFeeXlm: "0.0001200" } } } },
            "400": { description: "Invalid input", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "422": { description: "Validation failed", content: { "application/json": { schema: { $ref: "#/components/schemas/ValidationErrorResponse" } } } },
          },
        },
      },
      "/resolve-vault-routes": {
        post: {
          summary: "Resolve vault routing for recipients",
          description: "G-addresses get `transfer` routes; known vault C-addresses get `invoke_contract` routes.",
          tags: ["Safe Vault"],
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { example: { recipients: [{ address: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", amountStroops: "10000000" }, { address: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4", amountStroops: "50000000" }] } } },
          },
          responses: {
            "200": { description: "Routes resolved", content: { "application/json": { example: { success: true, data: { routes: [{ address: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", routeType: "transfer" }, { address: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4", routeType: "invoke_contract", fn: "deposit" }] } } } } },
            "400": { description: "Invalid input", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/org-gas-status": {
        get: {
          summary: "Get organization gas tank status",
          tags: ["Organizations"],
          security: [{ ApiKeyAuth: [] }],
          responses: {
            "200": { description: "Gas status", content: { "application/json": { schema: { $ref: "#/components/schemas/OrganizationGasStatus" }, example: { orgId: "org-123", gasTankAddress: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", balanceXlm: "450.75", isLow: false, thresholdXlm: "50.00" } } } },
            "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/analytics/leaderboard": {
        get: {
          summary: "Get global disbursement leaderboard",
          tags: ["Analytics"],
          parameters: [
            { name: "timeframe", in: "query", schema: { type: "string", enum: ["daily", "weekly", "all"], default: "all" } },
          ],
          responses: {
            "200": { description: "Leaderboard", content: { "application/json": { schema: { $ref: "#/components/schemas/AnalyticsLeaderboard" } } } },
            "429": { description: "Rate limited", content: { "application/json": { schema: { $ref: "#/components/schemas/RateLimitResponse" } } } },
          },
        },
      },
      "/webhooks/register": {
        post: {
          summary: "Register a webhook endpoint",
          description: "Store the returned `secretKey` securely. Verify incoming webhooks via `X-Webhook-Signature: sha256=<hmac-sha256(secretKey, body)>`.",
          tags: ["Webhooks"],
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/WebhookRegistrationRequest" }, example: { url: "https://erp.example.com/hooks", eventType: "split.completed", description: "ERP settlement callback" } } },
          },
          responses: {
            "201": { description: "Webhook registered", content: { "application/json": { schema: { $ref: "#/components/schemas/WebhookRegistrationResponse" } } } },
            "400": { description: "Invalid URL", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/template": {
        get: {
          summary: "List saved split templates",
          tags: ["Templates"],
          security: [{ ApiKeyAuth: [] }],
          responses: {
            "200": { description: "Templates list", content: { "application/json": { example: { success: true, data: [{ id: "tmpl-1a2b3c4d", name: "Monthly Payroll", recipientCount: 12 }] } } } },
            "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
        post: {
          summary: "Create a split template",
          tags: ["Templates"],
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { example: { name: "Monthly Payroll", recipients: [{ address: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", amountStroops: "50000000" }] } } },
          },
          responses: {
            "201": { description: "Template created", content: { "application/json": { example: { success: true, data: { id: "tmpl-1a2b3c4d" } } } } },
            "400": { description: "Invalid input", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/history/{address}": {
        get: {
          summary: "Get transaction history for an address",
          tags: ["History"],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { in: "path", name: "address", required: true, schema: { type: "string", example: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" } },
            { in: "query", name: "limit", schema: { type: "integer", default: 20, maximum: 100 } },
            { in: "query", name: "offset", schema: { type: "integer", default: 0 } },
          ],
          responses: {
            "200": { description: "History returned", content: { "application/json": { example: { success: true, data: [], total: 0 } } } },
            "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "503": { description: "Upstream unavailable", content: { "application/json": { schema: { $ref: "#/components/schemas/UpstreamErrorResponse" } } } },
          },
        },
      },
      "/proof-of-payment/{txHash}": {
        get: {
          summary: "Get cryptographic proof of payment",
          tags: ["History"],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { in: "path", name: "txHash", required: true, schema: { type: "string", example: "3b7f2a1c9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a" } },
          ],
          responses: {
            "200": { description: "Proof of payment", content: { "application/json": { schema: { $ref: "#/components/schemas/ProofOfPayment" } } } },
            "404": { description: "Transaction not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "503": { description: "Stellar RPC unavailable", content: { "application/json": { schema: { $ref: "#/components/schemas/UpstreamErrorResponse" } } } },
          },
        },
      },
      "/assets/price/{asset}": {
        get: {
          summary: "Get current asset price",
          tags: ["Assets"],
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { in: "path", name: "asset", required: true, schema: { type: "string", example: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" }, description: "`CODE:ISSUER` format or `XLM` for native" },
          ],
          responses: {
            "200": { description: "Asset price", content: { "application/json": { schema: { $ref: "#/components/schemas/AssetPrice" } } } },
            "404": { description: "No price feed for asset", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "503": { description: "Price oracle unavailable", content: { "application/json": { schema: { $ref: "#/components/schemas/UpstreamErrorResponse" } } } },
          },
        },
      },
      "/multisig/propose": {
        post: {
          summary: "Submit a multisig proposal",
          description: "Creates a pending proposal. Executes automatically when approval threshold is reached.",
          tags: ["Multisig"],
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { example: { recipients: [{ address: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", amountStroops: "10000000" }], threshold: 2, expiresInSeconds: 86400 } } },
          },
          responses: {
            "201": { description: "Proposal created", content: { "application/json": { example: { success: true, data: { id: "prop-7a3b2c1d", status: "pending", threshold: 2, approvals: [] } } } } },
            "400": { description: "Invalid input", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "401": { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/multisig/approve": {
        post: {
          summary: "Approve a multisig proposal",
          tags: ["Multisig"],
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { example: { proposalId: "prop-7a3b2c1d", signature: "base64-encoded-stellar-signature" } } },
          },
          responses: {
            "200": { description: "Approval recorded", content: { "application/json": { example: { success: true, data: { proposalId: "prop-7a3b2c1d", status: "approved", approvalsCount: 2, threshold: 2 } } } } },
            "404": { description: "Proposal not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "409": { description: "Already approved by this signer", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
    },
  },
  apis: [],
};

export const swaggerV3Spec = swaggerJsdoc(options);
