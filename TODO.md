# TODO
- [ ] Locate login/signup endpoints (if different from /api/v1/auth/challenge and /api/v1/auth/verify) and confirm mapping.
- [ ] Implement exponential backoff rate limiter with Redis tracking.
- [ ] Enforce limits per IP:
  - [ ] Login: 5 attempts / 15 minutes, then 1 hour lockout.
  - [ ] Signup: 3 attempts / 1 hour.
- [ ] Add Retry-After header and 429 responses.
- [ ] Add localhost bypass for development.
- [ ] Add monitoring/logging on rate-limit triggers.
- [ ] Wire middleware into auth routes in backend/src/api/wallet-auth.routes.ts.
- [ ] Run backend tests/lint.

