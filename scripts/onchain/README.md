# Onchain Scripts

This directory contains scripts that interact directly with the Ethereum blockchain.

## Files

- `fetch-active-markets.ts`: Queries and lists all valid, non-expired markets directly from Pendle smart contracts
- `fetch-stablecoin-markets.ts`: Filters active markets to show only stablecoin-related markets

## Usage

These scripts interact directly with deployed smart contracts using ethers.js. They require an Ethereum RPC endpoint to be configured in the `.env` file.

### Running the scripts

```bash
# Fetch all active markets
npx ts-node scripts/onchain/fetch-active-markets.ts

# Fetch only stablecoin markets
npx ts-node scripts/onchain/fetch-stablecoin-markets.ts
```
