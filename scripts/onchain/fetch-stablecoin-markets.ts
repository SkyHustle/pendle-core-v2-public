import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";
import {
  MARKET_FACTORY_V5,
  MARKET_FACTORY_ABI,
  MarketInfo,
  findValidNonExpiredMarkets,
  connectToProvider,
  saveMarketsData,
} from "./fetch-active-markets";

// Load environment variables from .env file
dotenv.config();

// List of known stablecoin identifiers in symbols
const STABLECOIN_IDENTIFIERS = [
  "USD",
  "USDC",
  "USDT",
  "DAI",
  "USDE",
  "USDS",
  "sUSD",
  "USUAL",
  "crvUSD",
];

function isStablecoinMarket(market: MarketInfo): boolean {
  const symbols = [
    market.sySymbol.toUpperCase(),
    market.ptSymbol.toUpperCase(),
    market.ytSymbol.toUpperCase(),
  ];

  return symbols.some((symbol) =>
    STABLECOIN_IDENTIFIERS.some((identifier) => symbol.includes(identifier)),
  );
}

async function main() {
  if (!process.env.ETH_RPC_URL) {
    throw new Error(
      "Please set ETH_RPC_URL in your environment variables. You can do this by:\n" +
        "1. Creating a .env file with ETH_RPC_URL=your_url, or\n" +
        "2. Setting it in your terminal with: export ETH_RPC_URL=your_url",
    );
  }

  const provider = await connectToProvider(process.env.ETH_RPC_URL);

  const marketFactory = new ethers.Contract(
    MARKET_FACTORY_V5,
    MARKET_FACTORY_ABI,
    provider,
  );

  console.log("Fetching all active markets...");
  const allMarkets = await findValidNonExpiredMarkets(marketFactory, provider);

  console.log("\nFiltering for stablecoin markets...");
  const stablecoinMarkets = allMarkets.filter(isStablecoinMarket);

  // Sort markets by expiry date
  stablecoinMarkets.sort((a, b) => a.expiry - b.expiry);

  console.log("\n=== Summary of Stablecoin Markets ===");
  console.log(`Total stablecoin markets found: ${stablecoinMarkets.length}\n`);

  stablecoinMarkets.forEach((market, index) => {
    console.log(`\n${index + 1}. Market: ${market.address}`);
    console.log(
      `   Tokens: SY=${market.sySymbol}, PT=${market.ptSymbol}, YT=${market.ytSymbol}`,
    );
    console.log(
      `   Expiry: ${new Date(market.expiry * 1000).toLocaleString()}`,
    );
    console.log(
      `   Total LP Supply: ${ethers.formatEther(market.totalLpSupply)}`,
    );
  });

  const outputPath = path.join(
    "data",
    "onchain",
    "onchain-active-stablecoin-markets.json",
  );
  await saveMarketsData(stablecoinMarkets, outputPath);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
