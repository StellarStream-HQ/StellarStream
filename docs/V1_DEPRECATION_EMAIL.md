# StellarStream V1 Deprecation Email Content

Use this copy for API consumers who have called `/api/v1` in the last 90 days.
Replace bracketed placeholders before sending.

## Announcement

Subject: StellarStream API v1 deprecation notice - migrate before 2026-10-01

Hi [Name],

We are deprecating StellarStream API v1 and moving active integrations to the
supported V3 API surface. Your integration has recently used `/api/v1`, so we
want to give you the migration window early.

Important dates:

- 2026-06-29: V1 responses begin returning deprecation headers.
- 2026-08-01: New V1 integrations are frozen.
- 2026-10-01: V1 reaches sunset and may be disabled.

What changes now:

- Existing V1 requests continue to work during the migration window.
- V1 responses include `Deprecation`, `Sunset`, `Link`, `Warning`, and
  `X-StellarStream-API-Deprecation` headers.
- New integrations should use V3 endpoints or a documented bridge path.

Migration resources:

- Timeline: [DEPRECATION_TIMELINE.md]
- Top endpoint guide: [docs/V1_MIGRATION_GUIDE.md]
- API reference: [docs/API_DOCUMENTATION.md]

Please reply with the V1 endpoints you still depend on if the guide does not
cover your use case.

Thanks,
The StellarStream team

## 30-day reminder

Subject: Reminder: StellarStream API v1 sunsets on 2026-10-01

Hi [Name],

This is a reminder that StellarStream API v1 sunsets on 2026-10-01. We still
see recent traffic from your integration to `[observed_v1_endpoint]`.

Recommended next step:

1. Move read-only calls to the documented V3 or bridge endpoint.
2. Confirm response parsing against the V3 `success` and `data` envelope.
3. Keep V1 fallback only until production traffic is verified.

Migration guide: [docs/V1_MIGRATION_GUIDE.md]

Please contact us by [support_deadline] if you have a blocker that requires V3
endpoint parity.

Thanks,
The StellarStream team

## Final reminder

Subject: Action required: StellarStream API v1 sunset is 7 days away

Hi [Name],

StellarStream API v1 reaches sunset on 2026-10-01. Your integration still
appears to call `[observed_v1_endpoint]`.

After the sunset date, V1 endpoints may be disabled or moved behind
compatibility support. To avoid interruption, migrate the remaining calls using
the V1 migration guide:

[docs/V1_MIGRATION_GUIDE.md]

If you believe this traffic is no longer active, please verify that old jobs,
webhooks, retry queues, and background workers no longer reference `/api/v1`.

Thanks,
The StellarStream team
