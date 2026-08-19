# Contributing to StellarStream 🌊

First off, thank you for considering contributing to StellarStream! This project exists to make real-time, trustless payment streaming a reality on Stellar, and every contribution — whether it's a smart contract fix, a UI polish, or a typo correction in the docs — moves that forward.

This document outlines how we work, what we expect from contributions, and how to get your changes merged smoothly.

---

## 📋 Table of Contents

- [Code of Conduct](#-code-of-conduct)
- [Our Workflow: Issue-Oriented Development](#-our-workflow-issue-oriented-development)
- [Getting Started](#-getting-started)
- [Contributing by Layer](#-contributing-by-layer)
  - [Smart Contracts](#-smart-contract-engineers-contracts)
  - [Frontend](#-frontend-developers-frontend)
  - [Backend](#-backend-engineers-backend)
- [Commit & Branch Conventions](#-commit--branch-conventions)
- [Pull Request Process](#-pull-request-process)
- [Testing Expectations](#-testing-expectations)
- [Reporting Bugs](#-reporting-bugs)
- [Suggesting Features](#-suggesting-features)
- [Questions?](#-questions)

---

## 🤝 Code of Conduct

Be respectful, be constructive, and assume good intent. We're building financial infrastructure that people may trust with real money — that same care should extend to how we treat each other in issues, PRs, and discussions. Disagreements about code and architecture are welcome; personal attacks are not.

---

## 🔄 Our Workflow: Issue-Oriented Development

StellarStream follows an **Issue-Oriented workflow**. This keeps effort from being duplicated and gives maintainers visibility into what's being worked on before code lands.

1. **Find or file an issue.** Browse [open issues](../../issues) for something that interests you, or open a new one if you've spotted a bug or have a feature idea.
2. **Assign yourself.** Comment on the issue to claim it before starting work. If it's already assigned, check with that contributor first — they may welcome help, or may already be close to done.
3. **Discuss before big changes.** For anything that touches core contract logic, changes the streaming math, or alters public interfaces, leave a comment outlining your approach before writing code. This avoids wasted work on approaches that won't be merged.
4. **Do the work in a branch**, following the conventions below.
5. **Open a PR that references the issue** (e.g., `Closes #42`).

> **Note:** PRs that aren't tied to an issue are still welcome for small fixes (typos, docs, minor cleanups) — just be clear in the PR description about what problem it solves.

---

## 🚀 Getting Started

1. **Fork the repository** and clone your fork:
   ```bash
   git clone https://github.com/your-username/stellar-stream.git
   cd stellar-stream
   ```

2. **Add the upstream remote** so you can stay in sync:
   ```bash
   git remote add upstream https://github.com/original-org/stellar-stream.git
   ```

3. **Pick the layer(s) you're working in** and follow the layer-specific setup below.

4. **Create a branch** for your work (see [branch conventions](#-commit--branch-conventions)).

---

## 🛠 Contributing by Layer

StellarStream is a modular monorepo — contracts, frontend, and backend are decoupled. You don't need to set up the whole stack to contribute to one layer, but keep in mind how your changes might affect the others (e.g., a contract interface change will require corresponding frontend hook updates).

### 🦀 Smart Contract Engineers (`/contracts`)

The contracts layer is the **source of truth** for all stream logic and fund custody. Changes here carry the highest bar for correctness, since bugs can directly risk user funds.

**Focus areas:** state management, security, gas optimization, and precise fixed-point arithmetic.

**Setup:**
```bash
# Install Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install the Soroban CLI
cargo install --locked soroban-cli

# Build the contracts
cd contracts
soroban contract build
```

**Rules:**
- 🔒 **No logic changes without a corresponding test update.** If you change how `withdraw`, `cancel`, or the unlock calculation behaves, add or update tests that prove it.
- ✅ Run the full test suite before submitting a PR:
  ```bash
  cargo test
  ```
- 🧮 Be extremely careful with arithmetic. Streaming math runs over long durations and must avoid overflow, underflow, and rounding drift — use the fixed-point helpers in `math.rs` rather than raw division.
- 🛡️ New error conditions should get a named variant in `errors.rs`, not a generic panic.
- 📝 Document any new public function with a doc comment explaining inputs, outputs, and edge cases (e.g., what happens if `withdraw` is called on an already-fully-vested stream).

---

### ⚛️ Frontend Developers (`/frontend`)

The dashboard is where users watch their money move — literally. It needs to feel alive, accurate, and trustworthy.

**Focus areas:** UX/UI, real-time data visualization, wallet connectivity.

**Setup:**
```bash
cd frontend
npm install
npm run dev
```

**Rules:**
- 📱 **Components must be responsive.** Test at mobile, tablet, and desktop breakpoints — senders and receivers may check stream status from anywhere.
- 🎞️ Use `framer-motion` for the "ticking" balance animations so unlocked amounts feel continuous rather than jumpy.
- 🔌 Wallet interactions should go through the existing Freighter hooks in `src/hooks/` — don't duplicate wallet connection logic.
- 🔄 Keep stream state in the established store (Zustand/Redux) rather than local component state, so balances stay in sync across views.
- ♿ Keep accessibility in mind: proper contrast, keyboard navigation, and ARIA labels for interactive elements like withdraw/cancel buttons.

---

### 🗄️ Backend Engineers (`/backend`)

The backend is a **read-only analytics and indexing layer** — it never holds custody of funds. Its job is to mirror on-chain events into a queryable form for dashboards, notifications, and historical stats.

**Focus areas:** indexing performance, data persistence, API reliability.

**Setup:**
```bash
cd backend
docker-compose up   # spins up local PostgreSQL + services
```

**Rules:**
- 🔁 **The indexer must be idempotent.** Re-processing the same ledger event twice should never double-count or corrupt data.
- ⛓️ **Handle ledger rollbacks gracefully.** The indexer must be able to detect and correct for chain reorganizations without manual intervention.
- 🗃️ Schema changes to `db/` should ship with a migration, not a manual ALTER statement.
- 🌐 New API endpoints should follow the existing REST/GraphQL patterns in `src/api/` and include basic input validation.

---

## 🌳 Commit & Branch Conventions

**Branch naming:**
```
<type>/<short-description>
```
Examples: `feat/pro-rata-cancellation`, `fix/withdraw-rounding-bug`, `docs/readme-cleanup`

**Commit messages** should be clear and scoped to a single logical change. We loosely follow [Conventional Commits](https://www.conventionalcommits.org/):
```
feat(contracts): add partial withdrawal cap
fix(frontend): correct ticking balance drift on tab refocus
docs(readme): clarify unlock formula example
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`.

---

## 🔍 Pull Request Process

1. **Sync with upstream** before opening your PR to minimize merge conflicts:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```
2. **Fill out the PR template** — describe what changed, why, and how it was tested. Link the issue it resolves.
3. **Keep PRs focused.** One logical change per PR is easier to review than a bundle of unrelated fixes.
4. **Ensure CI passes** — tests, linting, and builds must be green before review.
5. **Respond to review feedback promptly.** If a requested change doesn't make sense to you, say so — reviews are a conversation, not a checklist.
6. A maintainer will merge once the PR has the required approvals and passing checks.

---

## ✅ Testing Expectations

| Layer | Requirement |
|---|---|
| `contracts/` | `cargo test` must pass; new logic requires new/updated tests using the `try_` pattern |
| `frontend/` | Components should be manually verified across breakpoints; add unit tests for non-trivial logic (e.g., balance calculations) |
| `backend/` | Indexer changes should be tested against replayed ledger data, including simulated rollback scenarios |

---

## 🐛 Reporting Bugs

Before filing, please check whether the bug has already been reported. A good bug report includes:

- **What happened** vs. **what you expected**
- Steps to reproduce
- Relevant environment info (network — testnet/mainnet, wallet used, browser, OS)
- Logs, screenshots, or transaction hashes if applicable

Security-sensitive bugs (e.g., anything that could let funds be drained, misappropriated, or a stream manipulated outside its intended terms) should **not** be filed as a public issue — see [Reporting Security Issues](#-reporting-security-issues) below.

### 🔐 Reporting Security Issues
If you discover a vulnerability in the smart contracts or any part of the system that could put user funds at risk, please report it privately rather than opening a public issue. Contact the maintainers directly (see repository details for current contact info) so it can be assessed and patched before disclosure.

---

## 💡 Suggesting Features

Feature requests are welcome as issues. Good feature proposals explain:
- The problem it solves (ideally tied to a real use case — payroll, vesting, subscriptions, etc.)
- Why it fits StellarStream's scope as a streaming payments protocol
- Any tradeoffs or alternatives you considered

Not every idea will fit the project's direction, but we read and consider all of them.

---

## ❓ Questions?

If something in this guide is unclear, or you're not sure where a contribution fits, open a discussion or issue and ask. We'd rather answer a question up front than have you spend hours on the wrong approach.

Thanks again for contributing — let's make money move like it should. 🌊