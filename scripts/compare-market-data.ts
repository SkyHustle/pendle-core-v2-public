import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";

interface OnChainMarket {
  address: string;
  sySymbol: string;
  ptSymbol: string;
  ytSymbol: string;
  expiry: number;
  totalLpSupply: string;
  timestamp: number;
  blockNumber: number;
}

interface ApiMarket {
  name: string;
  address: string;
  expiry: string;
  pt: string;
  yt: string;
  sy: string;
  underlyingAsset: string;
}

interface OnChainData {
  source: string;
  factory: string;
  fetchTimestamp: number;
  markets: OnChainMarket[];
}

interface ApiData {
  timestamp: string;
  totalMarkets: number;
  data: {
    markets: ApiMarket[];
  };
}

function normalizeAddress(address: string): string {
  return ethers.getAddress(address.toLowerCase().replace("1-", ""));
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

async function main() {
  // Read the JSON files
  const onchainData: OnChainData = JSON.parse(
    fs.readFileSync(path.join("data", "onchain-active-markets.json"), "utf-8"),
  );
  const apiData: ApiData = JSON.parse(
    fs.readFileSync(path.join("data", "active-markets.json"), "utf-8"),
  );

  // Normalize addresses for comparison
  const onchainAddresses = new Set(
    onchainData.markets.map((m) => normalizeAddress(m.address)),
  );
  const apiAddresses = new Set(
    apiData.data.markets.map((m) => normalizeAddress(m.address)),
  );

  // Find markets that are in onchain but not in API
  const onlyInOnchain = onchainData.markets.filter(
    (m) => !apiAddresses.has(normalizeAddress(m.address)),
  );

  // Find markets that are in API but not in onchain
  const onlyInApi = apiData.data.markets.filter(
    (m) => !onchainAddresses.has(normalizeAddress(m.address)),
  );

  // Find markets that are in both
  const inBoth = onchainData.markets.filter((m) =>
    apiAddresses.has(normalizeAddress(m.address)),
  );

  console.log("=== Market Data Comparison ===\n");
  console.log("Summary:");
  console.log(`Total markets in onchain data: ${onchainData.markets.length}`);
  console.log(`Total markets in API data: ${apiData.data.markets.length}`);
  console.log(`Markets present in both: ${inBoth.length}`);
  console.log(`Markets only in onchain data: ${onlyInOnchain.length}`);
  console.log(`Markets only in API data: ${onlyInApi.length}\n`);

  if (onlyInOnchain.length > 0) {
    console.log("Markets found onchain but missing from API:");
    onlyInOnchain.forEach((market) => {
      console.log(`\nMarket Address: ${market.address}`);
      console.log(`SY Symbol: ${market.sySymbol}`);
      console.log(`PT Symbol: ${market.ptSymbol}`);
      console.log(`YT Symbol: ${market.ytSymbol}`);
      console.log(`Expiry: ${formatDate(market.expiry)}`);
      console.log(
        `Total LP Supply: ${ethers.formatEther(market.totalLpSupply)}`,
      );
    });
  }

  if (onlyInApi.length > 0) {
    console.log("\nMarkets found in API but missing from onchain data:");
    onlyInApi.forEach((market) => {
      console.log(`\nMarket Address: ${market.address}`);
      console.log(`Name: ${market.name}`);
      console.log(`Expiry: ${market.expiry}`);
      console.log(`PT: ${market.pt}`);
      console.log(`YT: ${market.yt}`);
      console.log(`SY: ${market.sy}`);
    });
  }

  // Save detailed comparison to a new JSON file
  const comparisonData = {
    timestamp: new Date().toISOString(),
    onchainTimestamp: formatDate(onchainData.fetchTimestamp),
    apiTimestamp: apiData.timestamp,
    summary: {
      totalOnchain: onchainData.markets.length,
      totalApi: apiData.data.markets.length,
      inBoth: inBoth.length,
      onlyOnchain: onlyInOnchain.length,
      onlyApi: onlyInApi.length,
    },
    details: {
      marketsOnlyInOnchain: onlyInOnchain,
      marketsOnlyInApi: onlyInApi,
    },
  };

  const outputPath = path.join("data", "market-comparison.json");
  fs.writeFileSync(outputPath, JSON.stringify(comparisonData, null, 2));
  console.log(`\nSaved detailed comparison to ${outputPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
