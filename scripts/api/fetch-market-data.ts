import axios from "axios";
import * as fs from "fs/promises";
import * as path from "path";

const ACTIVE_MARKETS_FILE = path.join("data", "active-markets.json");
const OUTPUT_DIR = "data";
const OUTPUT_FILE = path.join(OUTPUT_DIR, "market-details.json");

// Utility functions for number formatting
function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatUSD(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value: number, decimals: number = 2): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(value);
}

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
  expiry: string;
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

interface FormattedMarketData {
  address: string;
  name: string;
  timestamp: string;
  expiry: string;
  estimatedDailyPoolRewards: DailyPoolReward[];
  formatted: {
    expiry: string;
    liquidity: {
      usd: string;
      acc: string;
    };
    tradingVolume: {
      usd: string;
    };
    underlyingInterestApy: string;
    underlyingRewardApy: string;
    underlyingApy: string;
    impliedApy: string;
    ytFloatingApy: string;
    swapFeeApy: string;
    voterApy: string;
    ptDiscount: string;
    pendleApy: string;
    arbApy: string;
    lpRewardApy: string;
    aggregatedApy: string;
    maxBoostedApy: string;
    totalPt: string;
    totalSy: string;
    totalLp: string;
    totalActiveSupply: string;
    estimatedDailyPoolRewards: {
      asset: Asset;
      amount: string;
      usdValue: string;
    }[];
  };
  raw: MarketData;
}

function formatDate(dateString: string): string {
  return (
    new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " UTC"
  );
}

function formatMarketData(data: MarketData): FormattedMarketData {
  const formatted = {
    expiry: formatDate(data.expiry),
    liquidity: {
      usd: formatUSD(data.liquidity.usd),
      acc: formatUSD(data.liquidity.acc),
    },
    tradingVolume: {
      usd: formatUSD(data.tradingVolume.usd),
    },
    underlyingInterestApy: formatPercent(data.underlyingInterestApy),
    underlyingRewardApy: formatPercent(data.underlyingRewardApy),
    underlyingApy: formatPercent(data.underlyingApy),
    impliedApy: formatPercent(data.impliedApy),
    ytFloatingApy: formatPercent(data.ytFloatingApy),
    swapFeeApy: formatPercent(data.swapFeeApy),
    voterApy: formatPercent(data.voterApy),
    ptDiscount: formatPercent(data.ptDiscount),
    pendleApy: formatPercent(data.pendleApy),
    arbApy: formatPercent(data.arbApy),
    lpRewardApy: formatPercent(data.lpRewardApy),
    aggregatedApy: formatPercent(data.aggregatedApy),
    maxBoostedApy: formatPercent(data.maxBoostedApy),
    totalPt: formatNumber(data.totalPt),
    totalSy: formatNumber(data.totalSy),
    totalLp: formatNumber(data.totalLp),
    totalActiveSupply: formatNumber(data.totalActiveSupply),
    estimatedDailyPoolRewards: data.estimatedDailyPoolRewards.map((reward) => ({
      asset: reward.asset,
      amount: formatNumber(reward.amount),
      usdValue: formatUSD(reward.amount * reward.asset.price.usd),
    })),
  };

  return {
    address: data.address,
    name: data.name,
    timestamp: data.timestamp,
    expiry: data.expiry,
    estimatedDailyPoolRewards: data.estimatedDailyPoolRewards,
    formatted,
    raw: data,
  };
}

async function ensureDirectoryExists(dirPath: string) {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

async function fetchMarketData(
  address: string,
  expiry: string,
): Promise<MarketData | null> {
  try {
    const url = `https://api-v2.pendle.finance/core/v2/1/markets/${address}/data`;
    const response = await axios.get(url);
    return {
      address,
      name: "", // We'll fill this from the active markets data
      expiry,
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
        const data = await fetchMarketData(market.address, market.expiry);
        if (data) {
          data.name = market.name;
          return formatMarketData(data);
        }
        return null;
      },
    );

    const results = await Promise.all(marketDataPromises);
    const validResults = results.filter(
      (result): result is FormattedMarketData => result !== null,
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
      console.log(`  Expiry: ${market.formatted.expiry}`);
      console.log(`  Underlying APY: ${market.formatted.underlyingApy}`);
      console.log(`  Implied APY: ${market.formatted.impliedApy}`);
      console.log(`  Aggregated APY: ${market.formatted.aggregatedApy}`);
      console.log(`  Liquidity: ${market.formatted.liquidity.usd}`);
      console.log(`  Trading Volume: ${market.formatted.tradingVolume.usd}`);
      console.log(`  PT Discount: ${market.formatted.ptDiscount}`);
      if (market.formatted.estimatedDailyPoolRewards.length > 0) {
        const reward = market.formatted.estimatedDailyPoolRewards[0];
        console.log(
          `  Daily PENDLE Rewards: ${reward.amount} (${reward.usdValue})`,
        );
      }
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
