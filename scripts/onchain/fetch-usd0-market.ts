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
}

async function getMarketDetails(
  marketAddress: string,
  provider: ethers.Provider,
): Promise<MarketDetails> {
  const market = new ethers.Contract(marketAddress, MARKET_ABI, provider);
  const block = await provider.getBlock("latest");

  if (!block) throw new Error("Failed to get latest block");

  const [tokens, state] = await Promise.all([
    market.readTokens(),
    market.readState(ethers.ZeroAddress),
  ]);

  const [syAddress, ptAddress, ytAddress] = [
    tokens._SY,
    tokens._PT,
    tokens._YT,
  ];

  // Get token symbols
  const [syContract, ptContract, ytContract] = [
    syAddress,
    ptAddress,
    ytAddress,
  ].map((address) => new ethers.Contract(address, TOKEN_ABI, provider));

  const [sySymbol, ptSymbol, ytSymbol] = await Promise.all([
    syContract.symbol(),
    ptContract.symbol(),
    ytContract.symbol(),
  ]);

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
  };
}

function formatMarketData(market: MarketDetails) {
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
    balances: {
      sy: formatBigNumber(market.state.totalSy),
      pt: formatBigNumber(market.state.totalPt),
      lp: formatBigNumber(market.state.totalLp),
    },
    metrics: {
      scalarRoot: formatBigNumber(market.state.scalarRoot),
      impliedApy: calculateImpliedApy(market.state.lastLnImpliedRate),
      reserveFeePercent: market.state.reserveFeePercent + "%",
    },
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
  const formattedData = formatMarketData(marketDetails);

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
  console.log(`Expiry: ${formattedData.expiry}`);
  console.log(
    `Balances: ${formattedData.balances.sy} SY, ${formattedData.balances.pt} PT`,
  );
  console.log(`Total LP Supply: ${formattedData.balances.lp}`);
  console.log(`Implied APY: ${formattedData.metrics.impliedApy}`);
  console.log(`Reserve Fee: ${formattedData.metrics.reserveFeePercent}`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
