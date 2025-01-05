import axios from "axios";
import * as fs from "fs/promises";
import * as path from "path";

const PENDLE_API_URL = "https://api-v2.pendle.finance/core/v1/1/markets/active";
const OUTPUT_DIR = "data";
const OUTPUT_FILE = path.join(OUTPUT_DIR, "active-markets.json");

async function ensureDirectoryExists(dirPath: string) {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

async function fetchActiveMarkets() {
  try {
    console.log("Fetching active markets from Pendle API...");
    const response = await axios.get(PENDLE_API_URL);

    // Ensure the data directory exists
    await ensureDirectoryExists(OUTPUT_DIR);

    // Add timestamp to the data
    const dataWithTimestamp = {
      timestamp: new Date().toISOString(),
      data: response.data,
    };

    // Save the response to a JSON file
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(dataWithTimestamp, null, 2));

    console.log(
      `Successfully saved ${response.data.markets.length} active markets to ${OUTPUT_FILE}`,
    );
    console.log("Markets:");
    response.data.markets.forEach((market: any) => {
      console.log(
        `- ${market.name}: ${market.address} (Expires: ${market.expiry})`,
      );
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("Failed to fetch markets:", error.message);
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
fetchActiveMarkets()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  });
