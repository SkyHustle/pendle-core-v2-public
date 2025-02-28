import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

// Load environment variables from .env file
dotenv.config();

// Market Factory address on Ethereum mainnet
export const MARKET_FACTORY_V5 = ethers.getAddress(
  "0x6fcf753f2C67b83f7B09746Bbc4FA0047b35D050",
);

// ABI for the market factory
export const MARKET_FACTORY_ABI = [
  "function createNewMarket(address PT, int256 scalarRoot, int256 initialAnchor, uint80 lnFeeRateRoot) external returns (address market)",
  "function isValidMarket(address market) external view returns (bool)",
  "function getMarketConfig(address market, address router) external view returns (address _treasury, uint80 _overriddenFee, uint8 _reserveFeePercent)",
  "function treasury() external view returns (address)",
  "function reserveFeePercent() external view returns (uint8)",
  "function maxLnFeeRateRoot() external view returns (uint256)",
  "function maxReserveFeePercent() external view returns (uint8)",
  "function minInitialAnchor() external view returns (int256)",
  "event CreateNewMarket(address indexed market, address indexed PT, int256 scalarRoot, int256 initialAnchor, uint256 lnFeeRateRoot)",
] as const;

// ABI for the market contract (V3)
export const MARKET_ABI = [
  "function readState(address router) external view returns (tuple(int256 totalPt, int256 totalSy, int256 totalLp, address treasury, int256 scalarRoot, uint256 expiry, uint256 lnFeeRateRoot, uint256 reserveFeePercent, uint256 lastLnImpliedRate))",
  "function totalSupply() external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function isExpired() external view returns (bool)",
  "function readTokens() external view returns (address _SY, address _PT, address _YT)",
  "function PT() external view returns (address)",
  "function SY() external view returns (address)",
  "function YT() external view returns (address)",
  "function factory() external view returns (address)",
  "function expiry() external view returns (uint256)",
  "function scalarRoot() external view returns (int256)",
  "function initialAnchor() external view returns (int256)",
  "function lnFeeRateRoot() external view returns (uint80)",
  "function observations(uint256 index) external view returns (uint32 blockTimestamp, uint216 lnImpliedRateCumulative, bool initialized)",
  "function _storage() external view returns (int128 totalPt, int128 totalSy, uint96 lastLnImpliedRate, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext)",
];

// ABI for tokens
export const TOKEN_ABI = [
  "function symbol() external view returns (string)",
  "function name() external view returns (string)",
  "function decimals() external view returns (uint8)",
  "function totalSupply() external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) external returns (bool)",
];

export interface MarketInfo {
  address: string;
  sySymbol: string;
  ptSymbol: string;
  ytSymbol: string;
  expiry: number;
  totalLpSupply: string;
  timestamp: number;
  blockNumber: number;
}

export interface MarketData {
  source: string;
  factory: string;
  fetchTimestamp: number;
  markets: MarketInfo[];
}

export async function findValidNonExpiredMarkets(
  marketFactory: ethers.Contract,
  provider: ethers.Provider,
): Promise<MarketInfo[]> {
  console.log("\nLooking for CreateNewMarket events in the past 181 days...");

  const currentBlock = await provider.getBlockNumber();
  const currentBlockData = await provider.getBlock(currentBlock);
  if (!currentBlockData) throw new Error("Could not get current block data");

  const currentTimestamp = currentBlockData.timestamp;
  const daysInSeconds = 181 * 24 * 60 * 60;
  const startTimestamp = currentTimestamp - daysInSeconds;

  // Get the approximate block number from 181 days ago (assuming 12s block time)
  const blocksPerDay = (24 * 60 * 60) / 12;
  const startBlock = currentBlock - Math.floor(181 * blocksPerDay);

  const filter = marketFactory.filters.CreateNewMarket();
  const events = await marketFactory.queryFilter(
    filter,
    startBlock,
    currentBlock,
  );

  console.log(`Found ${events.length} market creation events\n`);

  const validMarkets: MarketInfo[] = [];

  for (const event of events) {
    if (!("args" in event) || !event.args) continue;
    const marketAddress = event.args[0];
    if (!marketAddress) continue;

    console.log(`Checking market: ${marketAddress}`);
    const isValid = await marketFactory.isValidMarket(marketAddress);

    if (isValid) {
      // Create market contract instance to check expiry
      const market = new ethers.Contract(marketAddress, MARKET_ABI, provider);
      const isExpired = await market.isExpired();

      if (!isExpired) {
        console.log(`Found valid non-expired market: ${marketAddress}`);
        try {
          const [syAddress, ptAddress, ytAddress] = await market.readTokens();
          const sy = new ethers.Contract(syAddress, TOKEN_ABI, provider);
          const pt = new ethers.Contract(ptAddress, TOKEN_ABI, provider);
          const yt = new ethers.Contract(ytAddress, TOKEN_ABI, provider);

          const sySymbol = await sy.symbol();
          const ptSymbol = await pt.symbol();
          const ytSymbol = await yt.symbol();

          console.log(`Tokens: SY=${sySymbol}, PT=${ptSymbol}, YT=${ytSymbol}`);

          const state = await market.readState(ethers.ZeroAddress);
          const expiry = Number(state.expiry);
          const totalLpSupply = await market.totalSupply();

          console.log(`Expiry: ${new Date(expiry * 1000).toLocaleString()}`);
          console.log(
            `Total LP Supply: ${ethers.formatEther(totalLpSupply)}\n`,
          );

          validMarkets.push({
            address: marketAddress,
            sySymbol,
            ptSymbol,
            ytSymbol,
            expiry,
            totalLpSupply: totalLpSupply.toString(),
            timestamp: currentTimestamp,
            blockNumber: currentBlock,
          });
        } catch (error) {
          console.log(`Error fetching market details: ${error}\n`);
        }
      } else {
        console.log(`Market is expired\n`);
      }
    } else {
      console.log(`Market is not valid\n`);
    }
  }

  return validMarkets;
}

export async function connectToProvider(
  rpcUrl: string,
): Promise<ethers.Provider> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  try {
    const blockNumber = await provider.getBlockNumber();
    console.log("Successfully connected to Ethereum network");
    console.log("Current block number:", blockNumber, "\n");
    return provider;
  } catch (error) {
    console.error(
      "Failed to connect to Ethereum network. Please check your RPC URL.",
    );
    throw error;
  }
}

export async function saveMarketsData(
  markets: MarketInfo[],
  outputPath: string,
) {
  const outputData: MarketData = {
    source: "on-chain",
    factory: MARKET_FACTORY_V5,
    fetchTimestamp: Math.floor(Date.now() / 1000),
    markets,
  };

  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
  console.log(`\nSaved market data to ${outputPath}`);
}

// Main function when script is run directly
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

  const markets = await findValidNonExpiredMarkets(marketFactory, provider);

  // Sort markets by expiry date
  markets.sort((a, b) => a.expiry - b.expiry);

  console.log("\n=== Summary of Valid Non-Expired Markets ===");
  console.log(`Total markets found: ${markets.length}\n`);

  markets.forEach((market, index) => {
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
    "onchain-active-markets.json",
  );
  await saveMarketsData(markets, outputPath);
}

// Only run main function if script is run directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
