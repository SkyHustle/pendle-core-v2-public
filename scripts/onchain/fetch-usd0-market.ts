import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";
import {
  MARKET_FACTORY_V5,
  TOKEN_ABI,
  connectToProvider,
} from "./fetch-active-markets";

// Load environment variables from .env file
dotenv.config();

const USD0_MARKET_ADDRESS = "0x048680F64d6DFf1748ba6D9a01F578433787e24B";

// Contract ABIs
const MARKET_ABI = [
  "function readTokens() external view returns (address _SY, address _PT, address _YT)",
  "function readState(address router) external view returns (tuple(int256 totalPt, int256 totalSy, int256 totalLp, address treasury, int256 scalarRoot, uint256 expiry, uint256 lnFeeRateRoot, uint256 reserveFeePercent, uint256 lastLnImpliedRate))",
  "function getRewardTokens() external view returns (address[] memory)",
];

const TOKEN_ABIS = {
  sy: [
    "function exchangeRate() external view returns (uint256)",
    "function getRewardTokens() external view returns (address[] memory)",
    "function accruedRewards(address user) external view returns (uint256[] memory)",
    "function name() external view returns (string)",
    "function symbol() external view returns (string)",
    "function decimals() external view returns (uint8)",
  ],
  yt: ["function pyIndexStored() external view returns (uint256)"],
};

// Types
interface MarketState {
  totalPt: string;
  totalSy: string;
  totalLp: string;
  scalarRoot: string;
  expiry: number;
  reserveFeePercent: number;
  lastLnImpliedRate: string;
}

interface MarketDetails {
  address: string;
  sySymbol: string;
  ptSymbol: string;
  ytSymbol: string;
  state: MarketState;
  syAddress: string;
  ptAddress: string;
  ytAddress: string;
  timestamp: number;
  blockNumber: number;
  syExchangeRate: string;
  rewardTokens: string[];
  creationBlock?: number;
  creationTimestamp?: number;
}

// Utility functions
const formatUtils = {
  date: (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      timeZoneName: "short",
    });
  },

  bigNumber: (value: string) => {
    const formatted = ethers.formatEther(value);
    return Number(formatted).toLocaleString("en-US", {
      maximumFractionDigits: 6,
      minimumFractionDigits: 2,
    });
  },

  usd: (value: number) => {
    return "$" + value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  },
};

const marketMetrics = {
  impliedApy: (lnRate: string) => {
    const rateNumber = Number(ethers.formatEther(lnRate));
    return ((Math.exp(rateNumber) - 1) * 100).toFixed(2) + "%";
  },

  timeRemaining: (expiry: number, now: number) => {
    const diff = expiry - now;
    if (diff <= 0) return "Expired";
    const days = Math.floor(diff / (24 * 60 * 60));
    return `${days} days`;
  },

  utilization: (totalPt: string, totalSy: string) => {
    const pt = Number(ethers.formatEther(totalPt));
    const sy = Number(ethers.formatEther(totalSy));
    if (sy === 0) return "0.00%";
    return ((pt / sy) * 100).toFixed(2) + "%";
  },

  feeAdjustedApy: (lnRate: string, reserveFeePercent: number) => {
    const rateNumber = Number(ethers.formatEther(lnRate));
    const apy = Math.exp(rateNumber) - 1;
    const feeAdjustedApy = apy * (1 - reserveFeePercent / 100);
    return (feeAdjustedApy * 100).toFixed(2) + "%";
  },

  ytBalance: (totalPt: string, totalSy: string) => {
    const pt = BigInt(totalPt);
    const sy = BigInt(totalSy);
    return (pt > sy ? pt - sy : BigInt(0)).toString();
  },

  tvl: (
    totalSy: string,
    totalPt: string,
    totalLp: string,
    syExchangeRate: string,
  ) => {
    const sy = BigInt(totalSy);
    const pt = BigInt(totalPt);
    const yt = BigInt(marketMetrics.ytBalance(totalPt, totalSy));
    const lp = BigInt(totalLp);
    const rate = BigInt(syExchangeRate);
    const totalValue = ((sy + pt + yt + lp) * rate) / BigInt(1e18);
    return ethers.formatEther(totalValue);
  },

  maturityProgress: (creation: number, expiry: number, current: number) => {
    if (!creation) return "Unknown";
    const total = expiry - creation;
    const elapsed = current - creation;
    if (total <= 0) return "100.00%";
    return ((elapsed / total) * 100).toFixed(2) + "%";
  },

  ytYield: (lnImpliedRate: string) => {
    try {
      const rateNumber = Number(ethers.formatEther(lnImpliedRate));
      if (isNaN(rateNumber) || !isFinite(rateNumber)) return "N/A";
      const ytYield = Math.exp(rateNumber) - 1;
      if (isNaN(ytYield) || !isFinite(ytYield) || ytYield < -1 || ytYield > 10)
        return "N/A";
      return (ytYield * 100).toFixed(2) + "%";
    } catch (error) {
      console.warn("Error calculating YT yield:", error);
      return "N/A";
    }
  },

  tokenPrices: (
    syExchangeRate: string,
    lastLnImpliedRate: string,
    expiry: number,
    timestamp: number,
  ) => {
    try {
      const rateNumber = Number(ethers.formatEther(lastLnImpliedRate));
      const timeToExpiry = (expiry - timestamp) / (365 * 24 * 60 * 60);
      const ptPrice = Math.exp(-rateNumber * timeToExpiry);
      const ytPrice = 1 - ptPrice;
      return {
        pt: `$${ptPrice.toFixed(4)}`,
        yt: `$${ytPrice.toFixed(4)}`,
      };
    } catch (error) {
      console.warn("Error calculating token prices:", error);
      return { pt: "N/A", yt: "N/A" };
    }
  },
};

async function getMarketDetails(
  marketAddress: string,
  provider: ethers.Provider,
): Promise<MarketDetails> {
  const market = new ethers.Contract(marketAddress, MARKET_ABI, provider);
  const block = await provider.getBlock("latest");
  if (!block) throw new Error("Failed to get latest block");

  const [tokens, state, rewardTokens] = await Promise.all([
    market.readTokens(),
    market.readState(ethers.ZeroAddress),
    market.getRewardTokens(),
  ]);

  const [syAddress, ptAddress, ytAddress] = [
    tokens._SY,
    tokens._PT,
    tokens._YT,
  ];

  // Create contract instances
  const contracts = {
    sy: new ethers.Contract(
      syAddress,
      [...TOKEN_ABIS.sy, ...TOKEN_ABI],
      provider,
    ),
    pt: new ethers.Contract(ptAddress, TOKEN_ABI, provider),
    yt: new ethers.Contract(
      ytAddress,
      [...TOKEN_ABIS.yt, ...TOKEN_ABI],
      provider,
    ),
  };

  // Get token info
  const [sySymbol, ptSymbol, ytSymbol, currentExchangeRate, currentYtIndex] =
    await Promise.all([
      contracts.sy.symbol(),
      contracts.pt.symbol(),
      contracts.yt.symbol(),
      contracts.sy.exchangeRate(),
      contracts.yt.pyIndexStored(),
    ]);

  // Get USD0++ token info
  try {
    const [name, symbol, decimals] = await Promise.all([
      contracts.sy.name(),
      contracts.sy.symbol(),
      contracts.sy.decimals(),
    ]);
    console.log("\nUSD0++ Token Info:", { name, symbol, decimals });
  } catch (error: any) {
    console.warn(
      "Could not fetch USD0++ token info:",
      error?.message || "Unknown error",
    );
  }

  // Get creation info
  const [creationBlock, creationTimestamp] = await getCreationInfo(
    marketAddress,
    block.number,
    provider,
  );

  return {
    address: marketAddress,
    sySymbol,
    ptSymbol,
    ytSymbol,
    state: {
      totalPt: state.totalPt.toString(),
      totalSy: state.totalSy.toString(),
      totalLp: state.totalLp.toString(),
      scalarRoot: state.scalarRoot.toString(),
      expiry: Number(state.expiry),
      reserveFeePercent: Number(state.reserveFeePercent),
      lastLnImpliedRate: state.lastLnImpliedRate.toString(),
    },
    syAddress,
    ptAddress,
    ytAddress,
    timestamp: block.timestamp,
    blockNumber: block.number,
    syExchangeRate: currentExchangeRate.toString(),
    rewardTokens,
    creationBlock,
    creationTimestamp,
  };
}

async function getCreationInfo(
  marketAddress: string,
  currentBlock: number,
  provider: ethers.Provider,
): Promise<[number | undefined, number | undefined]> {
  try {
    const code = await provider.getCode(marketAddress);
    if (code === "0x") return [undefined, undefined];

    const events = await provider.getLogs({
      address: marketAddress,
      fromBlock: 0,
      toBlock: currentBlock,
    });

    if (events.length === 0) return [undefined, undefined];

    const creationBlock = events[0].blockNumber;
    const creationBlockData = await provider.getBlock(creationBlock);
    return [creationBlock, creationBlockData?.timestamp];
  } catch (error) {
    console.warn("Could not fetch creation info:", error);
    return [undefined, undefined];
  }
}

async function formatMarketData(
  market: MarketDetails,
  provider: ethers.Provider,
) {
  // Get reward token symbols
  const rewardTokenSymbols = await Promise.all(
    market.rewardTokens.map(async (address) => {
      const contract = new ethers.Contract(address, TOKEN_ABI, provider);
      try {
        return {
          address,
          symbol: await contract.symbol(),
        };
      } catch {
        return { address, symbol: "UNKNOWN" };
      }
    }),
  );

  const ytBalance = marketMetrics.ytBalance(
    market.state.totalPt,
    market.state.totalSy,
  );
  const tokenPrices = marketMetrics.tokenPrices(
    market.syExchangeRate,
    market.state.lastLnImpliedRate,
    market.state.expiry,
    market.timestamp,
  );

  return {
    address: market.address,
    tokens: {
      sy: { address: market.syAddress, symbol: market.sySymbol },
      pt: { address: market.ptAddress, symbol: market.ptSymbol },
      yt: { address: market.ytAddress, symbol: market.ytSymbol },
    },
    expiry: formatUtils.date(market.state.expiry),
    timeRemaining: marketMetrics.timeRemaining(
      market.state.expiry,
      market.timestamp,
    ),
    createdAt: market.creationTimestamp
      ? formatUtils.date(market.creationTimestamp)
      : "Unknown",
    balances: {
      sy: formatUtils.bigNumber(market.state.totalSy),
      pt: formatUtils.bigNumber(market.state.totalPt),
      yt: formatUtils.bigNumber(ytBalance),
      lp: formatUtils.bigNumber(market.state.totalLp),
    },
    metrics: {
      scalarRoot: formatUtils.bigNumber(market.state.scalarRoot),
      impliedApy: marketMetrics.impliedApy(market.state.lastLnImpliedRate),
      feeAdjustedApy: marketMetrics.feeAdjustedApy(
        market.state.lastLnImpliedRate,
        market.state.reserveFeePercent,
      ),
      ytYieldRate: marketMetrics.ytYield(market.state.lastLnImpliedRate),
      ytPrice: tokenPrices.yt,
      ptPrice: tokenPrices.pt,
      utilizationRate: marketMetrics.utilization(
        market.state.totalPt,
        market.state.totalSy,
      ),
      reserveFeePercent: market.state.reserveFeePercent + "%",
      liquidity: formatUtils.usd(
        Number(
          ethers.formatEther(
            ((BigInt(market.state.totalSy) + BigInt(market.state.totalPt)) *
              BigInt(market.syExchangeRate)) /
              BigInt(1e18),
          ),
        ),
      ),
      tvl: formatUtils.usd(
        Number(
          marketMetrics.tvl(
            market.state.totalSy,
            market.state.totalPt,
            market.state.totalLp,
            market.syExchangeRate,
          ),
        ),
      ),
      maturityProgress: market.creationBlock
        ? marketMetrics.maturityProgress(
            market.creationBlock,
            market.state.expiry,
            market.timestamp,
          )
        : "Unknown",
    },
    rewardTokens: rewardTokenSymbols,
    timestamp: formatUtils.date(market.timestamp),
    blockNumber: market.blockNumber,
  };
}

function printMarketSummary(data: any) {
  const summary = [
    ["=== USD0++ Market Summary ==="],
    [
      `Tokens: SY=${data.tokens.sy.symbol}, PT=${data.tokens.pt.symbol}, YT=${data.tokens.yt.symbol}`,
    ],
    [`Created: ${data.createdAt}`],
    [`Expiry: ${data.expiry}`],
    [`Time Remaining: ${data.timeRemaining}`],
    [`Maturity Progress: ${data.metrics.maturityProgress}`],
    [
      `Balances: ${data.balances.sy} SY, ${data.balances.pt} PT, ${data.balances.yt} YT`,
    ],
    [`Total LP Supply: ${data.balances.lp}`],
    [`Liquidity: ${data.metrics.liquidity}`],
    [`TVL: ${data.metrics.tvl}`],
    [`YT Price: ${data.metrics.ytPrice}`],
    [`PT Price: ${data.metrics.ptPrice}`],
    [`YT Yield Rate: ${data.metrics.ytYieldRate}`],
    [`Implied APY: ${data.metrics.impliedApy}`],
    [`Fee-Adjusted APY: ${data.metrics.feeAdjustedApy}`],
    [`Utilization Rate: ${data.metrics.utilizationRate}`],
    [`Reserve Fee: ${data.metrics.reserveFeePercent}`],
  ];

  if (data.rewardTokens.length > 0) {
    summary.push([
      `Reward Tokens: ${data.rewardTokens
        .map((token: any) => `${token.symbol} (${token.address})`)
        .join(", ")}`,
    ]);
  }

  console.log("\n" + summary.map(([line]) => line).join("\n"));
}

async function main() {
  if (!process.env.ETH_RPC_URL) {
    throw new Error("Please set ETH_RPC_URL in your environment variables");
  }

  const provider = await connectToProvider(process.env.ETH_RPC_URL);
  console.log("\nFetching USD0++ market data...");

  const marketDetails = await getMarketDetails(USD0_MARKET_ADDRESS, provider);
  const formattedData = await formatMarketData(marketDetails, provider);

  const outputPath = path.join("data", "onchain", "usd0-market-details.json");
  const jsonString = JSON.stringify(
    {
      source: "on-chain",
      factory: MARKET_FACTORY_V5,
      fetchTimestamp: formattedData.timestamp,
      market: formattedData,
    },
    null,
    2,
  );

  require("fs").writeFileSync(outputPath, jsonString);
  console.log(`\nSaved formatted market data to ${outputPath}`);
  printMarketSummary(formattedData);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
