import express from "express";
import { formatStringsToScreens } from "../utils/formatStringsToScreens.js";
import { sourceHandlers } from "../utils/sources.js";
import { requireAuth } from "../utils/auth.js";
import Config from "../models/Config.js";

const router = express.Router();

// Get all available sources
router.get("/list", requireAuth, async (req, res) => {
  try {
    const availableSources = Object.keys(sourceHandlers);

    res.json({
      sources: availableSources.map((source) => ({
        name: source,
        description: getSourceDescription(source)
      }))
    });
  } catch (error) {
    console.error("Error getting available sources:", error);
    res.status(500).json({ error: "Failed to fetch available sources" });
  }
});

// Helper function to get source descriptions
function getSourceDescription(source) {
  const descriptions = {
    headlines: "Latest news headlines and current events",
    sports: "Sports scores, schedules, and news",
    wikipedia: "Wikipedia articles and featured content",
    sample: "Sample data for testing and demonstration"
  };
  return descriptions[source] || "No description available";
}

// Get data from a source
router.get("/:sourceName", async (req, res) => {
  try {
    const source = req.params.sourceName;

    // Load global config from MongoDB
    const config = await Config.getGlobalConfig();

    if (!sourceHandlers[source]) {
      const errorScreens = formatStringsToScreens(
        [`ERROR: Source '${source}' is not available`],
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
    console.error(`Error processing ${req.params.sourceName} source:`, error);

    // Load config for error formatting
    let config;
    try {
      config = await Config.getGlobalConfig();
    } catch (configError) {
      // Fallback to basic error response if config load fails
      return res.status(500).json({
        error: `Failed to process ${req.params.sourceName} source`,
        message: error?.message || "Unknown error"
      });
    }

    const errorScreens = formatStringsToScreens(
      [
        `ERROR: Failed to process ${req.params.sourceName} source`,
        error?.message || "Unknown error"
      ],
      config.screens.maxCharacters,
      config.screens.maxStrings
    );
    res.status(500).json(errorScreens);
  }
});

export default router;
