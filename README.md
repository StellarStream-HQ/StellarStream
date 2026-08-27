# StellarStream 🌊

**Real-time, linear asset streaming on the Stellar Network.**
> Money shouldn't move in lump sums. It should flow.

StellarStream is a decentralized, non-custodial protocol built on **Soroban** (Stellar's smart contract platform) that turns payments into continuous flows instead of one-time transfers. Assets move from sender to receiver **second-by-second**, unlocking in real time as the Stellar ledger advances — no intermediaries, no waiting periods, no trust required beyond the smart contract itself.

Think of it as a financial tap: once it's turned on, value drips continuously into the receiver's wallet, available to withdraw at any instant.

---

## 💡 Why StellarStream?

Traditional payment systems — payroll, subscriptions, vesting schedules, invoicing — all rely on **discrete, scheduled events**: a paycheck every two weeks, an invoice paid net-30, tokens vesting in quarterly cliffs. This creates real problems:

| Problem | StellarStream's Fix |
|---|---|
| Employees/freelancers wait weeks to get paid for work already done | Funds unlock continuously, available to withdraw anytime |
| Senders must fully trust receivers (or vice versa) with lump-sum transfers | Non-custodial smart contract enforces the terms — no party controls the other's funds |
| Canceling a subscription/payroll mid-cycle means overpaying or clawing back funds | Cancellation instantly and precisely splits funds pro-rata by the second |
| Cross-border payroll is slow and expensive | Built on Stellar, designed for fast, low-cost settlement with stablecoins |

By making payment a **continuous function of time** rather than a series of transactions, StellarStream gives receivers instant liquidity and gives senders precise, programmable control over how their capital is disbursed.

**Common use cases:**
- 💼 **Payroll** — employees earn and can withdraw wages in real time instead of biweekly
- 🧑‍💻 **Freelance & contractor payments** — get paid continuously as work happens
- 🔓 **Token vesting** — linear unlock schedules for team/investor allocations, fully on-chain
- 🔄 **Subscriptions** — pay-as-you-go services billed by the second instead of the month
- 🤝 **Grants & retainers** — funders stream capital that recipients draw down as needed

---

## 🚀 The Concept: How It Works

Every StellarStream payment is called a **stream**. A stream has three key parameters set at creation:

- **Total Amount** — the full sum being streamed
- **Start Time** — when unlocking begins
- **End Time** — when the stream is fully vested (100% unlocked)

Once initialized, the smart contract doesn't "do" anything on a timer — instead, it **calculates** how much has unlocked *on demand*, using the current ledger's timestamp. This is what makes it trustless and gas-efficient: there's no background process, just math evaluated at the moment someone interacts with the stream.

### The Mathematical Engine

$$Unlocked = \frac{TotalAmount \times (CurrentTime - StartTime)}{EndTime - StartTime}$$

**In plain terms:** the fraction of time that has elapsed between `StartTime` and `EndTime` determines the fraction of `TotalAmount` that has unlocked. If a stream is 30% of the way through its duration, 30% of the funds are unlocked and withdrawable — down to the precision of a single ledger close (Stellar ledgers close roughly every 5 seconds).

**Example:** A sender streams 10,000 USDC over 30 days. After exactly 10 days (⅓ of the duration), the receiver has ~3,333 USDC unlocked and available to withdraw — whether or not they've withdrawn anything yet.

---

## ✨ Features in Detail

### 1. Second-by-Second Liquidity
Receivers don't wait for a stream to end. Calling `withdraw` at any point pulls out whatever portion has unlocked *up to that exact ledger timestamp*. Multiple partial withdrawals are supported — the contract simply tracks how much has already been claimed and pays out the difference.

### 2. Programmable Cancellations
Streams don't have to run to completion. Depending on how the stream is configured, either the sender, the receiver, or both can cancel early:
- The **receiver** immediately receives everything earned up to the cancellation second.
- The **sender** is automatically refunded whatever remains unearned.

This means no manual reconciliation, no disputes over "how much was owed" — the contract settles it exactly, atomically, at the moment of cancellation.

### 3. Native Asset Support
Built on the **Soroban Token Interface** (SEP-41), StellarStream works with any compliant token, including:
- **Fiat-backed stablecoins**: USDC, BRLG, ARST
- **Stellar Asset Contracts (SAC)**: wrapped XLM and other classic Stellar assets bridged into Soroban

Because it speaks the standard token interface, StellarStream can support new assets as they become SAC-compliant without any contract changes.

### 4. Precise, Safe Arithmetic
Streaming math involves continuous division over potentially long durations — a naive implementation risks rounding errors or overflow. StellarStream's `math.rs` module uses fixed-point arithmetic purpose-built for accurate, safe streaming calculations at scale.

---

## 🛠 Project Structure

StellarStream is organized as a **modular monorepo** — each layer (contract, frontend, backend) is decoupled so teams can build and ship independently without cross-dependencies slowing each other down.

```text
StellarStream/
├── contracts/               # THE CORE PROTOCOL (Rust + Soroban)
│   ├── src/
│   │   ├── lib.rs           # Main entry points (initialize, withdraw, cancel)
│   │   ├── types.rs         # Data structures (Stream, UserProfile)
│   │   ├── math.rs          # Precise fixed-point arithmetic for streaming
│   │   ├── validation.rs    # Safety guards (TTL, Auth, Bounds)
│   │   └── errors.rs        # Custom Error Enum with 40+ variants
│   └── tests/               # Comprehensive test suite (try_ pattern)
│
├── frontend/                # THE USER DASHBOARD (Next.js 14)
│   ├── src/
│   │   ├── components/      # "Ticking" balance UI, Stream cards
│   │   ├── hooks/           # Soroban-Client & Freighter Wallet hooks
│   │   ├── store/           # Global state for active streams (Zustand/Redux)
│   │   └── layout/          # Responsive Dashboard for Senders/Receivers
│
├── backend/                 # THE ANALYTICS LAYER (Node.js + TS)
│   ├── src/
│   │   ├── indexer/         # Event listener for Horizon/Soroban-RPC
│   │   ├── db/              # PostgreSQL schema for historical data
│   │   └── api/             # REST/GraphQL endpoints for stream stats
│
└── docs/                    # Technical specs and Wave assets
```

### What Each Layer Does

- **`contracts/`** — The source of truth. All stream logic, balance calculations, and fund custody live here, on-chain. Nothing in the frontend or backend can override what this layer enforces.
- **`frontend/`** — Where users actually watch their money move. The dashboard renders live, "ticking" balances so senders and receivers can see funds unlock in real time, plus tools to create, manage, and cancel streams via a connected Freighter wallet.
- **`backend/`** — A read-only analytics and indexing layer. It listens to on-chain events and mirrors them into a queryable database, powering historical charts, notifications, and stats — without ever holding custody of funds itself.

---

## 🤝 How to Contribute

We follow an **Issue-Oriented workflow**: browse open issues, assign yourself before starting work, and open a PR that references the issue it resolves. This keeps effort from being duplicated and makes review easier.

### Folder-Specific Guidelines

#### 🦀 Smart Contract Engineers (`/contracts`)
- **Focus:** State management, security, and gas optimization.
- **Setup:** Requires `rustup` and `soroban-cli`.
- **Rule:** No logic changes without a corresponding test update. Run `cargo test` before submitting a PR.

#### ⚛️ Frontend Developers (`/frontend`)
- **Focus:** UX/UI, real-time data visualization, and wallet connectivity.
- **Setup:** `npm install` inside the directory.
- **Rule:** Components must be responsive. Use `framer-motion` for the ticking number animations.

#### 🗄️ Backend Engineers (`/backend`)
- **Focus:** Indexing performance, data persistence, and API reliability.
- **Setup:** Docker Compose is provided for local DB setup.
- **Rule:** The indexer must be idempotent and capable of handling ledger rollbacks.

---

## 🚦 Getting Started

**1. Clone the repository**
```bash
git clone https://github.com/your-username/stellar-stream.git
cd stellar-stream
```

**2. Build the smart contracts**
```bash
cd contracts
soroban contract build
```

**3. Run the frontend dashboard**
```bash
cd ../frontend
npm install
npm run dev
```

**4. (Optional) Spin up the backend indexer**
```bash
cd ../backend
docker-compose up
```

**5. (Optional) Run the Contract Analytics Framework**
```bash
cd ../analytics
npm install
npm run seed  # Optional: generate sample activity data
npm run dev   # Runs analytics API & visualization dashboard on http://localhost:4000
```

---

## 📚 Learn More

- [Soroban Documentation](https://soroban.stellar.org/)
- [Stellar Developer Docs](https://developers.stellar.org/)
- [SEP-41 Token Interface Spec](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md)

---

Built for the **Drips Stellar Wave**. Pushing the boundaries of real-time finance. 🌊