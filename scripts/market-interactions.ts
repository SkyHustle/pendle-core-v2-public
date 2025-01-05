import { ethers } from "ethers";
import * as dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Latest Market Factory on Ethereum mainnet
const MARKET_FACTORY_V5 = ethers.getAddress(
  "0x6fcf753f2C67b83f7B09746Bbc4FA0047b35D050",
);

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

async function findFirstValidMarket(
  marketFactory: ethers.Contract,
  provider: ethers.Provider,
): Promise<string | null> {
  console.log("Looking for CreateNewMarket events...");

  const filter = marketFactory.filters.CreateNewMarket();
  const events = await marketFactory.queryFilter(filter);

  console.log(`Found ${events.length} market creation events\n`);

  for (const event of events) {
    if (!("args" in event) || !event.args) continue;
    const marketAddress = event.args[0];
    if (!marketAddress) continue;

    console.log(`Checking market: ${marketAddress}`);
    const isValid = await marketFactory.isValidMarket(marketAddress);

    if (isValid) {
      console.log(`Found valid market: ${marketAddress}\n`);
      return marketAddress;
    } else {
      console.log(`Market is not valid\n`);
    }
  }

  return null;
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

  // Connect to the market factory
  const marketFactory = new ethers.Contract(
    MARKET_FACTORY_V5,
    MARKET_FACTORY_ABI,
    provider,
  );

  // Find first valid market
  console.log("Searching for a valid market...");
  const marketAddress = await findFirstValidMarket(marketFactory, provider);

  if (!marketAddress) {
    throw new Error("No valid markets found");
  }

  // Create market contract instance
  const market = new ethers.Contract(marketAddress, MARKET_ABI, provider);

  console.log("Fetching market information...\n");

  try {
    // Get market tokens
    const [syAddress, ptAddress, ytAddress] = await market.readTokens();

    // Ensure proper checksum for token addresses
    const syChecksummed = ethers.getAddress(syAddress);
    const ptChecksummed = ethers.getAddress(ptAddress);
    const ytChecksummed = ethers.getAddress(ytAddress);

    console.log("Got token addresses:");
    console.log("SY:", syChecksummed);
    console.log("PT:", ptChecksummed);
    console.log("YT:", ytChecksummed);
    console.log();

    const sy = new ethers.Contract(syChecksummed, TOKEN_ABI, provider);
    const pt = new ethers.Contract(ptChecksummed, TOKEN_ABI, provider);
    const yt = new ethers.Contract(ytChecksummed, TOKEN_ABI, provider);

    console.log("Market Tokens:");
    console.log("SY Symbol:", await sy.symbol());
    console.log("PT Symbol:", await pt.symbol());
    console.log("YT Symbol:", await yt.symbol());
    console.log();

    // Get market state
    const state = await market.readState(ethers.ZeroAddress);
    console.log("Market State:");
    console.log("Total PT:", ethers.formatEther(state.totalPt));
    console.log("Total SY:", ethers.formatEther(state.totalSy));
    console.log("Total LP:", ethers.formatEther(state.totalLp));
    console.log("Treasury:", ethers.getAddress(state.treasury));
    console.log(
      "Expiry:",
      new Date(Number(state.expiry) * 1000).toLocaleString(),
    );
    console.log(
      "Last Implied Rate:",
      ethers.formatEther(state.lastLnImpliedRate),
    );
    console.log();

    // Check if market is expired
    const isExpired = await market.isExpired();
    console.log("Market Expired:", isExpired);

    // Get total liquidity
    const totalSupply = await market.totalSupply();
    console.log("Total LP Supply:", ethers.formatEther(totalSupply));
  } catch (error) {
    console.error("Error fetching market data:", error);
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
