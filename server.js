import express from "express";
import { promises as fs } from "fs";
import { formatStringsToScreens } from "./utils/formatStringsToScreens.js";
import { createCacheMiddleware } from "./utils/cache.js";
import { fetchNYTHeadlines } from "./sources/headlines.js";
import { sampleStrings } from "./sources/samples.js";
import { fetchSportsScoreboard } from "./sources/sports.js";
import { fetchWikipediaContent } from "./sources/wikipedia.js";

// Load configuration from JSON file
let config;
try {
  const configData = await fs.readFile("config.json", "utf8");
  config = JSON.parse(configData);
  console.log("Configuration loaded from config.json");
} catch (error) {
  console.error("Failed to load config.json:", error.message);
  console.error(
    "Server cannot start without configuration file. Please ensure config.json exists and is valid."
  );
  process.exit(1);
}

const app = express();
const port = 3115;

app.use(express.json());

const sourceHandlers = {
  sample: async () => sampleStrings,
  headlines: async () => await fetchNYTHeadlines(),
  sports: async (req) => {
    const league = (req.query.league || "mlb").toLowerCase();
    return await fetchSportsScoreboard(league);
  },
  wikipedia: async (req) => {
    const type = (req.query.type || "today-featured-article").toLowerCase();
    return await fetchWikipediaContent(type);
  }
};

// Function to get TTL for a specific source (converts minutes to milliseconds)
function getSourceTTL(source) {
  const ttlMinutes =
    config.cache.refreshMinutes[source] || config.cache.refreshMinutes.default;
  return ttlMinutes * 60 * 1000; // Convert minutes to milliseconds
}

app.get(
  "/screens",
  (req, res, next) => {
    const noCache = req.query.noCache === "true";
    const source = req.query.source || "sample";

    if (noCache) {
      next();
    } else {
      // Create cache middleware with source-specific TTL
      const sourceTTL = getSourceTTL(source);
      const sourceCacheMiddleware = createCacheMiddleware({
        ttl: sourceTTL
      });
      sourceCacheMiddleware(req, res, next);
    }
  },
  async (req, res) => {
    try {
      const source = req.query.source || "sample";

      if (!sourceHandlers[source]) {
        const errorScreens = formatStringsToScreens(
          ["ERROR: That source is not available"],
          config.screens.maxCharacters,
          config.screens.maxStrings
        );
        return res.status(400).json(errorScreens);
      }

      const sourceData = await sourceHandlers[source](req);

      const screens = formatStringsToScreens(
        sourceData,
        config.screens.maxCharacters,
        config.screens.maxStrings
      );

      res.json(screens);
    } catch (error) {
      console.error(
        `Error processing ${req.query.source || "sample"} source:`,
        error
      );
      const errorScreens = formatStringsToScreens(
        [
          `ERROR: Failed to process ${req.query.source || "sample"} source`,
          error?.message || "Unknown error"
        ],
        config.screens.maxCharacters,
        config.screens.maxStrings
      );
      res.status(500).json(errorScreens);
    }
  }
);

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
