# 🌊 @stellarstream/cli

Official Command-Line Interface (CLI) for **StellarStream** — real-time continuous asset streaming on Stellar (Soroban).

---

## 📦 Installation

```bash
npm install -g @stellarstream/cli
# or
pnpm add -g @stellarstream/cli
```

---

## 🚀 Quick Usage

### Configuration
```bash
# View active configuration
stellarstream config show

# Switch network
stellarstream config set-network testnet
stellarstream config set-network mainnet

# Set deployed contract address
stellarstream config set-contract CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
```

### Stream Management
```bash
# Create a 30-day payment stream
stellarstream create \
  --sender GBJEI26XQ6F2633USZ27P6T4H2AEL2JMYV4J43M7W3F7Z5L5K6MH7WVA \
  --receiver GCXFSWUSLTYBGYSQCST6AQNWHQW4G5T7R2H7ZHYK37B4K2L5N6Q6MH7W \
  --token CUSDC7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
  --amount 3000000000 \
  --duration 30d

# Query stream status
stellarstream query --stream-id 101

# Calculate real-time streaming velocity / rates
stellarstream rates --stream-id 101

# Withdraw vested tokens
stellarstream withdraw --stream-id 101

# Cancel stream (refund unvested tokens to sender)
stellarstream cancel --stream-id 101
```

### Protocol Analytics
```bash
# Query protocol Total Value Locked (TVL)
stellarstream tvl
```

---

## 🧪 Testing

```bash
pnpm test
```
