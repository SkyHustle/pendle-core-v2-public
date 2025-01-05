import axios from "axios";
import * as fs from "fs/promises";
import * as path from "path";

const ACTIVE_MARKETS_FILE = path.join("data", "active-markets.json");
const OUTPUT_DIR = "data";
const OUTPUT_FILE = path.join(OUTPUT_DIR, "market-details.json");

interface Asset {
  id: string;
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
  accentColor: string | null;
  price: {
    usd: number;
  };
  priceUpdatedAt: string;
  name: string;
}

interface DailyPoolReward {
  asset: Asset;
  amount: number;
}

interface MarketData {
  address: string;
  name: string;
  timestamp: string;
  liquidity: {
    usd: number;
    acc: number;
  };
  tradingVolume: {
    usd: number;
  };
  underlyingInterestApy: number;
  underlyingRewardApy: number;
  underlyingApy: number;
  impliedApy: number;
  ytFloatingApy: number;
  swapFeeApy: number;
  voterApy: number;
  ptDiscount: number;
  pendleApy: number;
  arbApy: number;
  lpRewardApy: number;
  aggregatedApy: number;
  maxBoostedApy: number;
  estimatedDailyPoolRewards: DailyPoolReward[];
  totalPt: number;
  totalSy: number;
  totalLp: number;
  totalActiveSupply: number;
}

async function ensureDirectoryExists(dirPath: string) {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

async function fetchMarketData(address: string): Promise<MarketData | null> {
  try {
    const url = `https://api-v2.pendle.finance/core/v2/1/markets/${address}/data`;
    const response = await axios.get(url);
    return {
      address,
      name: "", // We'll fill this from the active markets data
      ...response.data,
    };
  } catch (error) {
    console.error(`Failed to fetch data for market ${address}:`, error);
    return null;
  }
}

async function fetchAllMarketData() {
  try {
    console.log("Reading active markets file...");
    const activeMarketsContent = await fs.readFile(
      ACTIVE_MARKETS_FILE,
      "utf-8",
    );
    const activeMarkets = JSON.parse(activeMarketsContent);

    console.log("Fetching detailed data for each market...");
    const marketDataPromises = activeMarkets.data.markets.map(
      async (market: any) => {
        const data = await fetchMarketData(market.address);
        if (data) {
          data.name = market.name;
        }
        return data;
      },
    );

    const results = await Promise.all(marketDataPromises);
    const validResults = results.filter(
      (result): result is MarketData => result !== null,
    );

    const output = {
      timestamp: new Date().toISOString(),
      totalMarkets: validResults.length,
      markets: validResults,
    };

    // Ensure the data directory exists
    await ensureDirectoryExists(OUTPUT_DIR);

    // Save the response to a JSON file
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.log(
      `Successfully saved data for ${validResults.length} markets to ${OUTPUT_FILE}`,
    );
    console.log("\nMarket APYs:");
    validResults.forEach((market) => {
      console.log(`- ${market.name} (${market.address}):`);
      console.log(
        `  Underlying APY: ${(market.underlyingApy * 100).toFixed(2)}%`,
      );
      console.log(`  Implied APY: ${(market.impliedApy * 100).toFixed(2)}%`);
      console.log(
        `  Aggregated APY: ${(market.aggregatedApy * 100).toFixed(2)}%`,
      );
      console.log(
        `  Liquidity: $${Math.round(market.liquidity.usd).toLocaleString()}`,
      );
      console.log();
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("Failed to fetch market data:", error.message);
      if (error.response) {
        console.error("API Response:", error.response.data);
      }
    } else {
      console.error("An unexpected error occurred:", error);
    }
    throw error;
  }
}

// Run the script
fetchAllMarketData()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  });
