describe("WebhookDispatcherService signatures", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("sends StellarStream signature, timestamp, and nonce headers on webhook deliveries", async () => {
    const updateMock = jest.fn(async () => undefined);

    const claimedDelivery = {
      id: "delivery_1",
      webhookId: "wh_1",
      attempts: 0,
      maxRetries: 5,
      payload: {
        eventType: "split.completed",
        splitId: "42",
        txHash: "tx_42",
        timestamp: "2026-03-29T00:00:00.000Z",
      },
      webhook: {
        id: "wh_1",
        url: "https://example.com/webhook",
        secretKey: "super-secret",
      },
    };

    // processDeliveries claims rows before sending: stale-reclaim updateMany,
    // candidate findMany, claiming updateMany, then a findMany for the rows won.
    const findManyMock = jest
      .fn()
      .mockResolvedValueOnce([{ id: claimedDelivery.id }])
      .mockResolvedValueOnce([claimedDelivery]);
    const updateManyMock = jest
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    jest.doMock("../generated/client/index.js", () => ({
      PrismaClient: jest.fn().mockImplementation(() => ({
        webhookDelivery: {
          findMany: findManyMock,
          updateMany: updateManyMock,
          update: updateMock,
        },
      })),
    }));

    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
    }));
    global.fetch = fetchMock as any;

    const { WebhookDispatcherService } = await import("../services/webhook-dispatcher.service");
    const service = new WebhookDispatcherService();

    await service.processDeliveries();

    if (fetchMock.mock.calls.length !== 1) {
      throw new Error(`Expected 1 fetch call, received ${fetchMock.mock.calls.length}`);
    }
    const firstCall = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> }
    ];
    const options = firstCall[1];
    const headers = options?.headers;
    if (!headers?.["X-StellarStream-Signature"]) {
      throw new Error("Missing X-StellarStream-Signature header");
    }
    if (!headers["X-StellarStream-Timestamp"]) {
      throw new Error("Missing X-StellarStream-Timestamp header");
    }
    if (!headers["X-StellarStream-Nonce"]) {
      throw new Error("Missing X-StellarStream-Nonce header");
    }
    if (!headers["X-StellarStream-Signature"].startsWith("sha256=")) {
      throw new Error("StellarStream signature is missing sha256 prefix");
    }
    if (headers["X-Nebula-Signature"] !== headers["X-StellarStream-Signature"]) {
      throw new Error("Nebula compatibility header does not match StellarStream signature");
    }
    if (headers["X-Webhook-Signature"] !== headers["X-StellarStream-Signature"]) {
      throw new Error("Nebula signature header does not match legacy webhook signature");
    }
    if (updateMock.mock.calls.length !== 1) {
      throw new Error(`Expected 1 delivery update, received ${updateMock.mock.calls.length}`);
    }
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "delivery_1" },
      data: expect.objectContaining({
        status: "success",
        attempts: 1,
        lastStatusCode: 200,
        lastError: null,
        nextRetryAt: null,
        lockedAt: null,
        lockedBy: null,
      }),
    });
  });

  it("verifies fresh signatures and rejects stale replay attempts", async () => {
    jest.doMock("../generated/client/index.js", () => ({
      PrismaClient: jest.fn().mockImplementation(() => ({})),
    }));

    const { WebhookDispatcherService } = await import("../services/webhook-dispatcher.service");
    const payload = JSON.stringify({ eventType: "split.completed", splitId: "42" });
    const secret = "super-secret";
    const timestamp = "2026-06-25T12:00:00.000Z";
    const nonce = "nonce-123";
    const signature = WebhookDispatcherService.signPayload(payload, secret, timestamp, nonce);

    expect(
      WebhookDispatcherService.verifySignature(
        payload,
        signature,
        secret,
        timestamp,
        nonce,
        new Date("2026-06-25T12:04:59.000Z")
      )
    ).toBe(true);

    expect(
      WebhookDispatcherService.verifySignature(
        payload,
        signature,
        secret,
        timestamp,
        nonce,
        new Date("2026-06-25T12:05:01.000Z")
      )
    ).toBe(false);
  });
});
