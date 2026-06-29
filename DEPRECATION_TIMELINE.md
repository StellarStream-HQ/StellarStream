# StellarStream API V1 Deprecation Timeline

This page is the source of truth for the StellarStream API v1 deprecation window.
It covers the `/api/v1` routes in the main backend and the standalone
`backend/legacy_v1` stream API.

## Timeline

| Date | Milestone | Impact |
|------|-----------|--------|
| 2026-06-29 | Deprecation announced and runtime warnings enabled | V1 is marked deprecated in docs and Swagger metadata. V1 responses include `Deprecation`, `Sunset`, `Link`, `Warning`, and `X-StellarStream-API-Deprecation` headers. |
| 2026-08-01 | New V1 integrations frozen | New API consumers should be onboarded to V3 or an approved bridge endpoint only. |
| 2026-09-01 | Final migration window | Support focuses on migration blockers and endpoint parity gaps. |
| 2026-10-01 | V1 sunset | V1 endpoints may be disabled or moved behind compatibility support. |
| 2026-11-01 or later | V1 removal | Remaining V1 code paths may be removed after consumer migration review. |

## Runtime warning headers

Every V1 API response should include:

```http
Deprecation: @1782691200
Sunset: Thu, 01 Oct 2026 00:00:00 GMT
Link: <https://github.com/StellarStream-HQ/StellarStream/blob/main/DEPRECATION_TIMELINE.md>; rel="deprecation"; type="text/markdown", <https://github.com/StellarStream-HQ/StellarStream/blob/main/docs/V1_MIGRATION_GUIDE.md>; rel="successor-version"; type="text/markdown"
Warning: 299 - "StellarStream API v1 is deprecated and will sunset on 2026-10-01. Migrate to v3 endpoints where available; use documented bridge paths where V3 parity is not yet available. See docs/V1_MIGRATION_GUIDE.md."
X-StellarStream-API-Deprecation: StellarStream API v1 is deprecated and will sunset on 2026-10-01. Migrate to v3 endpoints where available; use documented bridge paths where V3 parity is not yet available. See docs/V1_MIGRATION_GUIDE.md.
```

The headers are advisory and non-breaking. They do not change status codes,
response body shape, authentication, or rate limits.
The `Deprecation` value is a structured field date for the announcement date.

## Migration resources

- Top endpoint migration guide: [`docs/V1_MIGRATION_GUIDE.md`](./docs/V1_MIGRATION_GUIDE.md)
- Consumer notification copy: [`docs/V1_DEPRECATION_EMAIL.md`](./docs/V1_DEPRECATION_EMAIL.md)
- API reference: [`docs/API_DOCUMENTATION.md`](./docs/API_DOCUMENTATION.md)

## Compatibility policy

- Critical security fixes may still be applied to V1 during the migration
  window.
- New API features should target V3.
- If a V1 endpoint has no exact V3 equivalent, keep the consumer on the
  documented bridge path until V3 parity exists.
