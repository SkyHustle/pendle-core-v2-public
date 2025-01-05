import { ethers } from "ethers";
import * as dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Market Factory addresses on Ethereum mainnet
const MARKET_FACTORIES = {
  V3: ethers.getAddress("0x1A6fCc85557BC4fB7B534ed835a03EF056552D52"),
  V4: ethers.getAddress("0x3d75Bd20C983edb5fD218A1b7e0024F1056c7A2F"),
} as const;

// ABI for the market factory
const MARKET_FACTORY_ABI = [
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
const MARKET_ABI = [
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
const TOKEN_ABI = [
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

interface MarketInfo {
  address: string;
  factory: keyof typeof MARKET_FACTORIES;
  sySymbol: string;
  ptSymbol: string;
  ytSymbol: string;
  expiry: number;
  totalLpSupply: bigint;
}

async function findValidNonExpiredMarkets(
  marketFactory: ethers.Contract,
  provider: ethers.Provider,
  factoryVersion: keyof typeof MARKET_FACTORIES,
): Promise<MarketInfo[]> {
  console.log(
    `\nLooking for CreateNewMarket events in the past 181 days for factory ${factoryVersion}...`,
  );

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

  console.log(
    `Found ${events.length} market creation events for ${factoryVersion}\n`,
  );

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
            factory: factoryVersion,
            sySymbol,
            ptSymbol,
            ytSymbol,
            expiry,
            totalLpSupply,
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

async function main() {
  // Debug environment variables
  console.log("Environment variables:");
  console.log(
    "ETH_RPC_URL:",
    process.env.ETH_RPC_URL
      ? "Set (starts with " + process.env.ETH_RPC_URL.substring(0, 10) + "...)"
      : "Not set",
  );

  if (!process.env.ETH_RPC_URL) {
    throw new Error(
      "Please set ETH_RPC_URL in your environment variables. You can do this by:\n" +
        "1. Creating a .env file with ETH_RPC_URL=your_url, or\n" +
        "2. Setting it in your terminal with: export ETH_RPC_URL=your_url",
    );
  }

  // Connect to Ethereum mainnet
  const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);

  try {
    // Test the connection
    const blockNumber = await provider.getBlockNumber();
    console.log("Successfully connected to Ethereum network");
    console.log("Current block number:", blockNumber, "\n");
  } catch (error) {
    console.error(
      "Failed to connect to Ethereum network. Please check your RPC URL.",
    );
    throw error;
  }

  const allMarkets: MarketInfo[] = [];

  // Check each factory version
  for (const [version, address] of Object.entries(MARKET_FACTORIES)) {
    const marketFactory = new ethers.Contract(
      address,
      MARKET_FACTORY_ABI,
      provider,
    );

    const markets = await findValidNonExpiredMarkets(
      marketFactory,
      provider,
      version as keyof typeof MARKET_FACTORIES,
    );
    allMarkets.push(...markets);
  }

  // Sort markets by expiry date
  allMarkets.sort((a, b) => a.expiry - b.expiry);

  console.log("\n=== Summary of All Valid Non-Expired Markets ===");
  console.log(`Total markets found: ${allMarkets.length}\n`);

  // Group markets by factory version
  const marketsByFactory = allMarkets.reduce(
    (acc, market) => {
      if (!acc[market.factory]) {
        acc[market.factory] = [];
      }
      acc[market.factory].push(market);
      return acc;
    },
    {} as Record<keyof typeof MARKET_FACTORIES, MarketInfo[]>,
  );

  // Print summary by factory version
  for (const [version, markets] of Object.entries(marketsByFactory)) {
    if (markets.length > 0) {
      console.log(`\n${version} Markets (${markets.length} total):`);
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
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
