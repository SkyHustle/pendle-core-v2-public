import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";
import {
  MARKET_FACTORY_V5,
  MARKET_FACTORY_ABI,
  TOKEN_ABI,
  connectToProvider,
} from "./fetch-active-markets";

// Load environment variables from .env file
dotenv.config();

const USD0_MARKET_ADDRESS = "0x048680F64d6DFf1748ba6D9a01F578433787e24B";

// Updated Market ABI with correct interface
const MARKET_ABI = [
  "function PT() external view returns (address)",
  "function SY() external view returns (address)",
  "function YT() external view returns (address)",
  "function expiry() external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function scalarRoot() external view returns (int256)",
  "function lnFeeRateRoot() external view returns (uint80)",
  "function factory() external view returns (address)",
  "function readTokens() external view returns (address _SY, address _PT, address _YT)",
  "function readState(address router) external view returns (tuple(int256 totalPt, int256 totalSy, int256 totalLp, address treasury, int256 scalarRoot, uint256 expiry, uint256 lnFeeRateRoot, uint256 reserveFeePercent, uint256 lastLnImpliedRate))",
  "function getRewardTokens() external view returns (address[] memory)",
  "function observe(uint256[] memory secondsAgo) external view returns (uint216[] memory lnImpliedRateCumulative)",
];

// Add SY Token ABI for fetching underlying APY
const SY_TOKEN_ABI = [
  "function exchangeRate() external view returns (uint256)",
  "function assetInfo() external view returns (uint8 assetType, address assetAddress, uint8 assetDecimals)",
  "function getTokensIn() external view returns (address[] memory)",
  "function getTokensOut() external view returns (address[] memory)",
  "function getRewardTokens() external view returns (address[] memory)",
  "function accruedRewards(address user) external view returns (uint256[] memory)",
];

// Remove USD0++ Token ABI
const USD0_TOKEN_ABI = [
  // Standard ERC20 functions
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
  "function totalSupply() external view returns (uint256)",
  "function balanceOf(address) external view returns (uint256)",
  "function exchangeRate() external view returns (uint256)",
];

// Add YT Token ABI
const YT_TOKEN_ABI = [
  "function pyIndexCurrent() external returns (uint256)",
  "function pyIndexStored() external view returns (uint256)",
  "function pyIndexLastUpdatedBlock() external view returns (uint128)",
];

interface MarketState {
  totalPt: string;
  totalSy: string;
  totalLp: string;
  treasury: string;
  scalarRoot: string;
  expiry: number;
  lnFeeRateRoot: string;
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
  rates?: {
    timestamp: number;
    lnImpliedRate: string;
  }[];
  exchangeRates?: {
    current: string;
  };
  ytIndex?: {
    current: string;
  };
  syRewards?: {
    tokens: string[];
    rates: string[];
    symbols: string[];
  };
}

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

  // Get token symbols and current exchange rate
  const [syContract, ptContract, ytContract] = [
    syAddress,
    ptAddress,
    ytAddress,
  ].map((address) => new ethers.Contract(address, TOKEN_ABI, provider));

  const syTokenContract = new ethers.Contract(
    syAddress,
    SY_TOKEN_ABI,
    provider,
  );
  const ytTokenContract = new ethers.Contract(
    ytAddress,
    YT_TOKEN_ABI,
    provider,
  );

  // Create USD0++ contract instance
  const usd0Contract = new ethers.Contract(
    syAddress, // The SY token is USD0++
    USD0_TOKEN_ABI,
    provider,
  );

  // Get basic token info first
  const [sySymbol, ptSymbol, ytSymbol, currentExchangeRate, currentYtIndex] =
    await Promise.all([
      syContract.symbol(),
      ptContract.symbol(),
      ytContract.symbol(),
      syTokenContract.exchangeRate(),
      ytTokenContract.pyIndexStored(),
    ]);

  // Try to get USD0++ token info first
  try {
    const [name, symbol, decimals] = await Promise.all([
      usd0Contract.name(),
      usd0Contract.symbol(),
      usd0Contract.decimals(),
    ]);
    console.log(`\nUSD0++ Token Info:`);
    console.log(`Name: ${name}`);
    console.log(`Symbol: ${symbol}`);
    console.log(`Decimals: ${decimals}`);
  } catch (error: any) {
    console.warn(
      "Could not fetch USD0++ token info:",
      error?.message || "Unknown error",
    );
  }

  // Remove the historical rates fetching code
  const rates: Array<{
    timestamp: number;
    lnImpliedRate: string;
  }> = [];

  // Try to get creation block and its timestamp
  let creationBlock;
  let creationTimestamp;
  try {
    const code = await provider.getCode(marketAddress);
    if (code !== "0x") {
      const filter = {
        address: marketAddress,
        fromBlock: 0,
        toBlock: block.number,
      };
      const events = await provider.getLogs(filter);
      if (events.length > 0) {
        creationBlock = events[0].blockNumber;
        const creationBlockData = await provider.getBlock(creationBlock);
        creationTimestamp = creationBlockData?.timestamp;
      }
    }
  } catch (error) {
    console.warn("Could not fetch creation block:", error);
  }

  // Get SY reward information
  let syRewardTokens: string[] = [];
  let syRewardRates: string[] = [];
  let syRewardSymbols: string[] = [];
  try {
    // Get reward tokens from SY
    syRewardTokens = await syTokenContract.getRewardTokens();

    // Get reward rates by checking accrued rewards over a small time window
    const testAddress = "0x0000000000000000000000000000000000000001"; // Dummy address for reward rate check
    const rewardAmounts = await syTokenContract.accruedRewards(testAddress);
    syRewardRates = rewardAmounts.map((amount: ethers.BigNumberish) =>
      amount.toString(),
    );

    // Get reward token symbols
    const rewardTokenContracts = syRewardTokens.map(
      (address) => new ethers.Contract(address, TOKEN_ABI, provider),
    );
    syRewardSymbols = await Promise.all(
      rewardTokenContracts.map((contract) => contract.symbol()),
    );

    console.log("SY Reward Tokens:", syRewardSymbols);
    console.log(
      "SY Reward Rates:",
      syRewardRates.map((rate) => ethers.formatEther(rate)),
    );
  } catch (error) {
    console.warn("Could not fetch SY reward information:", error);
  }

  return {
    address: marketAddress,
    sySymbol,
    ptSymbol,
    ytSymbol,
    state: {
      totalPt: state.totalPt.toString(),
      totalSy: state.totalSy.toString(),
      totalLp: state.totalLp.toString(),
      treasury: state.treasury,
      scalarRoot: state.scalarRoot.toString(),
      expiry: Number(state.expiry),
      lnFeeRateRoot: state.lnFeeRateRoot.toString(),
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
    rates,
    exchangeRates: {
      current: currentExchangeRate.toString(),
    },
    ytIndex: {
      current: currentYtIndex.toString(),
    },
    syRewards: {
      tokens: syRewardTokens,
      rates: syRewardRates,
      symbols: syRewardSymbols,
    },
  };
}

async function formatMarketData(
  market: MarketDetails,
  provider: ethers.Provider,
) {
  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      timeZoneName: "short",
    });
  };

  const formatBigNumber = (value: string) => {
    const formatted = ethers.formatEther(value);
    return Number(formatted).toLocaleString("en-US", {
      maximumFractionDigits: 6,
      minimumFractionDigits: 2,
    });
  };

  // Calculate implied APY from ln rate
  const calculateImpliedApy = (lnRate: string) => {
    const rateNumber = Number(ethers.formatEther(lnRate));
    return ((Math.exp(rateNumber) - 1) * 100).toFixed(2) + "%";
  };

  // Calculate time remaining until expiry
  const calculateTimeRemaining = (expiry: number, now: number) => {
    const diff = expiry - now;
    if (diff <= 0) return "Expired";

    const days = Math.floor(diff / (24 * 60 * 60));
    return `${days} days`;
  };

  // Calculate utilization rate
  const calculateUtilization = (totalPt: string, totalSy: string) => {
    const pt = Number(ethers.formatEther(totalPt));
    const sy = Number(ethers.formatEther(totalSy));
    if (sy === 0) return "0.00%";
    return ((pt / sy) * 100).toFixed(2) + "%";
  };

  // Calculate fee-adjusted APY
  const calculateFeeAdjustedApy = (
    lnRate: string,
    reserveFeePercent: number,
  ) => {
    const rateNumber = Number(ethers.formatEther(lnRate));
    const apy = Math.exp(rateNumber) - 1;
    const feeAdjustedApy = apy * (1 - reserveFeePercent / 100);
    return (feeAdjustedApy * 100).toFixed(2) + "%";
  };

  // Calculate YT balance (PT - SY if positive, otherwise 0)
  const calculateYtBalance = (totalPt: string, totalSy: string) => {
    const pt = BigInt(totalPt);
    const sy = BigInt(totalSy);
    const yt = pt > sy ? pt - sy : BigInt(0);
    return yt.toString();
  };

  // Calculate TVL in USD (total value of SY + PT + YT + LP)
  const calculateTvl = (
    totalSy: string,
    totalPt: string,
    totalLp: string,
    syExchangeRate: string,
  ) => {
    const sy = BigInt(totalSy);
    const pt = BigInt(totalPt);
    const yt = BigInt(calculateYtBalance(totalPt, totalSy));
    const lp = BigInt(totalLp);
    const rate = BigInt(syExchangeRate);

    // Total value is the sum of all tokens, each adjusted by the exchange rate
    const totalValue = ((sy + pt + yt + lp) * rate) / BigInt(1e18);
    return ethers.formatEther(totalValue);
  };

  // Calculate maturity progress
  const calculateMaturityProgress = (
    creation: number,
    expiry: number,
    current: number,
  ) => {
    if (!creation) return "Unknown";
    const total = expiry - creation;
    const elapsed = current - creation;
    if (total <= 0) return "100.00%";
    return ((elapsed / total) * 100).toFixed(2) + "%";
  };

  // Calculate YT yield rate from current rate
  const calculateYtYield = (lnImpliedRate: string) => {
    try {
      // Calculate rate from ln rate
      const rateNumber = Number(ethers.formatEther(lnImpliedRate));

      // If rate is invalid, return N/A
      if (isNaN(rateNumber) || !isFinite(rateNumber)) {
        return "N/A";
      }

      // Calculate YT yield as the implied rate
      const ytYield = Math.exp(rateNumber) - 1;

      // Return N/A if the result is not a reasonable number
      if (
        isNaN(ytYield) ||
        !isFinite(ytYield) ||
        ytYield < -1 ||
        ytYield > 10
      ) {
        return "N/A";
      }

      return (ytYield * 100).toFixed(2) + "%";
    } catch (error) {
      console.warn("Error calculating YT yield:", error);
      return "N/A";
    }
  };

  // Calculate reward APR
  const calculateRewardApr = (rates: string[], symbols: string[]) => {
    if (!rates.length) return "N/A";

    try {
      // For now, we'll focus on the first reward token (usually the main one)
      const ratePerSecond = Number(ethers.formatEther(rates[0]));

      // Annualize the rate (seconds in a year)
      const annualRate = ratePerSecond * 365 * 24 * 60 * 60;

      if (
        isNaN(annualRate) ||
        !isFinite(annualRate) ||
        annualRate < 0 ||
        annualRate > 1000
      ) {
        return "N/A";
      }

      return {
        total: annualRate.toFixed(2) + "%",
        breakdown: symbols.map((symbol, i) => {
          const rate =
            Number(ethers.formatEther(rates[i])) * 365 * 24 * 60 * 60;
          return `${symbol}: ${rate.toFixed(2)}%`;
        }),
      };
    } catch (error) {
      console.warn("Error calculating reward APR:", error);
      return "N/A";
    }
  };

  // Get reward token symbols using the provided provider
  const rewardTokenSymbols = await Promise.all(
    market.rewardTokens.map(async (address) => {
      const contract = new ethers.Contract(address, TOKEN_ABI, provider);
      try {
        const symbol = await contract.symbol();
        return {
          address,
          symbol,
        };
      } catch (error) {
        return {
          address,
          symbol: "UNKNOWN",
        };
      }
    }),
  );

  const ytBalance = calculateYtBalance(
    market.state.totalPt,
    market.state.totalSy,
  );

  // Calculate YT price in USD
  const calculateYtPrice = (
    syExchangeRate: string,
    lastLnImpliedRate: string,
  ) => {
    try {
      // Get the PT price from the implied rate (discount factor)
      const rateNumber = Number(ethers.formatEther(lastLnImpliedRate));
      const timeToExpiry =
        (market.state.expiry - market.timestamp) / (365 * 24 * 60 * 60); // in years
      const discountFactor = Math.exp(-rateNumber * timeToExpiry);

      // PT price = discountFactor (since PT will be worth 1 at expiry)
      const ptPrice = discountFactor;

      // YT price = 1 - PT price (since YT + PT = 1 at expiry)
      const ytPrice = 1 - ptPrice;

      return `$${ytPrice.toFixed(4)}`;
    } catch (error) {
      console.warn("Error calculating YT price:", error);
      return "N/A";
    }
  };

  return {
    address: market.address,
    tokens: {
      sy: {
        address: market.syAddress,
        symbol: market.sySymbol,
      },
      pt: {
        address: market.ptAddress,
        symbol: market.ptSymbol,
      },
      yt: {
        address: market.ytAddress,
        symbol: market.ytSymbol,
      },
    },
    expiry: formatDate(market.state.expiry),
    timeRemaining: calculateTimeRemaining(
      market.state.expiry,
      market.timestamp,
    ),
    createdAt: market.creationTimestamp
      ? formatDate(market.creationTimestamp)
      : "Unknown",
    balances: {
      sy: formatBigNumber(market.state.totalSy),
      pt: formatBigNumber(market.state.totalPt),
      yt: formatBigNumber(ytBalance),
      lp: formatBigNumber(market.state.totalLp),
    },
    metrics: {
      scalarRoot: formatBigNumber(market.state.scalarRoot),
      impliedApy: calculateImpliedApy(market.state.lastLnImpliedRate),
      feeAdjustedApy: calculateFeeAdjustedApy(
        market.state.lastLnImpliedRate,
        market.state.reserveFeePercent,
      ),
      ytYieldRate: calculateYtYield(market.state.lastLnImpliedRate),
      ytPrice: calculateYtPrice(
        market.syExchangeRate,
        market.state.lastLnImpliedRate,
      ),
      utilizationRate: calculateUtilization(
        market.state.totalPt,
        market.state.totalSy,
      ),
      reserveFeePercent: market.state.reserveFeePercent + "%",
      liquidity:
        "$" +
        Number(
          ethers.formatEther(
            ((BigInt(market.state.totalSy) + BigInt(market.state.totalPt)) *
              BigInt(market.syExchangeRate)) /
              BigInt(1e18),
          ),
        ).toLocaleString("en-US", { maximumFractionDigits: 2 }),
      tvl:
        "$" +
        Number(
          calculateTvl(
            market.state.totalSy,
            market.state.totalPt,
            market.state.totalLp,
            market.syExchangeRate,
          ),
        ).toLocaleString("en-US", {
          maximumFractionDigits: 2,
        }),
      maturityProgress: market.creationBlock
        ? calculateMaturityProgress(
            market.creationBlock,
            market.state.expiry,
            market.timestamp,
          )
        : "Unknown",
    },
    rewardTokens: rewardTokenSymbols,
    timestamp: formatDate(market.timestamp),
    blockNumber: market.blockNumber,
  };
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

  // Print summary to console
  console.log("\n=== USD0++ Market Summary ===");
  console.log(
    `Tokens: SY=${formattedData.tokens.sy.symbol}, PT=${formattedData.tokens.pt.symbol}, YT=${formattedData.tokens.yt.symbol}`,
  );
  console.log(`Created: ${formattedData.createdAt}`);
  console.log(`Expiry: ${formattedData.expiry}`);
  console.log(`Time Remaining: ${formattedData.timeRemaining}`);
  console.log(`Maturity Progress: ${formattedData.metrics.maturityProgress}`);
  console.log(
    `Balances: ${formattedData.balances.sy} SY, ${formattedData.balances.pt} PT, ${formattedData.balances.yt} YT`,
  );
  console.log(`Total LP Supply: ${formattedData.balances.lp}`);
  console.log(`Liquidity: ${formattedData.metrics.liquidity}`);
  console.log(`TVL: ${formattedData.metrics.tvl}`);
  console.log(`YT Price: ${formattedData.metrics.ytPrice}`);
  console.log(`YT Yield Rate (7d avg): ${formattedData.metrics.ytYieldRate}`);
  console.log(`Implied APY: ${formattedData.metrics.impliedApy}`);
  console.log(`Fee-Adjusted APY: ${formattedData.metrics.feeAdjustedApy}`);
  console.log(`Utilization Rate: ${formattedData.metrics.utilizationRate}`);
  console.log(`Reserve Fee: ${formattedData.metrics.reserveFeePercent}`);
  if (formattedData.rewardTokens.length > 0) {
    console.log(
      `Reward Tokens: ${formattedData.rewardTokens
        .map((token) => `${token.symbol} (${token.address})`)
        .join(", ")}`,
    );
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
