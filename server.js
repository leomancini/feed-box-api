import express from "express";
import { promises as fs } from "fs";
import { formatStringsToScreens } from "./utils/formatStringsToScreens.js";
import { createCacheMiddleware, cache } from "./utils/cache.js";
import { fetchNYTHeadlines } from "./sources/headlines.js";
import { sampleStrings } from "./sources/samples.js";
import { fetchSportsScoreboard } from "./sources/sports.js";
import { fetchWikipediaContent } from "./sources/wikipedia.js";
import { fetchNASANews } from "./sources/nasa.js";

// Load configuration from JSON file
let config;
try {
  const configData = await fs.readFile("config.json", "utf8");
  config = JSON.parse(configData);
  console.log("✅ Global config loaded");
} catch (error) {
  console.error("❌ Failed to load global config:", error.message);
  console.error(
    "Server cannot start without configuration file. Please ensure config.json exists and is valid."
  );
  process.exit(1);
}

// Load devices configuration from JSON file
let devices;
let previousDevicesConfig = new Map(); // Track previous device sources for change detection
let lastDevicesCheck = 0;
const DEVICES_CHECK_INTERVAL = 30000; // Check every 30 seconds

async function loadDevicesConfig(force = false) {
  try {
    const devicesData = await fs.readFile("devices.json", "utf8");
    const newDevices = JSON.parse(devicesData);

    // Check for source changes if this isn't the initial load
    if (devices && previousDevicesConfig.size > 0) {
      for (const device of newDevices.devices) {
        const previousSource = previousDevicesConfig.get(device.serialNumber);
        if (previousSource && previousSource !== device.source) {
          console.log(
            `Device ${device.serialNumber} source changed from '${previousSource}' to '${device.source}' - invalidating cache`
          );
          await cache.invalidateDevice(device.serialNumber);
        }
      }
    }

    // Update the current devices and track sources
    devices = newDevices;
    previousDevicesConfig.clear();
    for (const device of devices.devices) {
      previousDevicesConfig.set(device.serialNumber, device.source);
    }

    lastDevicesCheck = Date.now();
    console.log("✅ Devices config loaded");
    return devices;
  } catch (error) {
    console.error("❌ Failed to load devices config:", error.message);
    if (!devices) {
      console.error(
        "Server cannot start without devices configuration file. Please ensure devices.json exists and is valid."
      );
      process.exit(1);
    }
    return devices; // Return existing config if reload fails
  }
}

// Check if we should reload device config (throttled)
async function checkAndReloadDevices() {
  const now = Date.now();
  if (now - lastDevicesCheck > DEVICES_CHECK_INTERVAL) {
    try {
      const stats = await fs.stat("devices.json");
      const fileModTime = stats.mtime.getTime();

      // If file was modified after our last check, reload
      if (fileModTime > lastDevicesCheck) {
        console.log("devices.json file modified, reloading configuration");
        await loadDevicesConfig();
      } else {
        lastDevicesCheck = now; // Update check time even if no reload needed
      }
    } catch (error) {
      console.error(
        "Error checking devices.json modification time:",
        error.message
      );
    }
  }
}

// Initial load
devices = await loadDevicesConfig();

const app = express();
const port = 3115;

app.use(express.json());

const sourceHandlers = {
  sample: async () => sampleStrings,
  headlines: async (req) => await fetchNYTHeadlines(req),
  sports: async (req) => {
    const league = (req.query.league || "mlb").toLowerCase();
    return await fetchSportsScoreboard(league, req);
  },
  wikipedia: async (req) => {
    const type = (req.query.type || "today-featured-article").toLowerCase();
    return await fetchWikipediaContent(type, req);
  },
  nasa: async (req) => await fetchNASANews(req)
};

// Function to get TTL for a specific source (converts minutes to milliseconds)
function getSourceTTL(source) {
  const ttlMinutes =
    config.cache.refreshMinutes[source] || config.cache.refreshMinutes.default;
  return ttlMinutes * 60 * 1000; // Convert minutes to milliseconds
}

app.get(
  "/test-source",
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

// Device-specific endpoint that uses device configuration
app.get(
  "/device/:serialNumber",
  async (req, res, next) => {
    const noCache = req.query.noCache === "true";
    const serialNumber = req.params.serialNumber;

    // Check for device config changes before processing
    await checkAndReloadDevices();

    // Find device configuration
    const device = devices.devices.find((d) => d.serialNumber === serialNumber);
    if (!device) {
      const errorScreens = formatStringsToScreens(
        [`ERROR: Device with serial number ${serialNumber} not found`],
        config.screens.maxCharacters,
        config.screens.maxStrings
      );
      return res.status(404).json(errorScreens);
    }

    if (noCache) {
      next();
    } else {
      // Create device-level cache key that includes the source
      const deviceCacheKey = cache.generateDeviceKey(
        serialNumber,
        device.source
      );
      const sourceTTL = getSourceTTL(device.source);

      const sourceCacheMiddleware = createCacheMiddleware({
        ttl: sourceTTL,
        keyGenerator: (req) => deviceCacheKey // Use device+source specific key
      });
      sourceCacheMiddleware(req, res, next);
    }
  },
  async (req, res) => {
    try {
      const serialNumber = req.params.serialNumber;

      // Find device configuration
      const device = devices.devices.find(
        (d) => d.serialNumber === serialNumber
      );
      if (!device) {
        const errorScreens = formatStringsToScreens(
          [`ERROR: Device with serial number ${serialNumber} not found`],
          config.screens.maxCharacters,
          config.screens.maxStrings
        );
        return res.status(404).json(errorScreens);
      }

      const source = device.source;

      if (!sourceHandlers[source]) {
        const errorScreens = formatStringsToScreens(
          [
            `ERROR: Source '${source}' is not available for device ${serialNumber}`
          ],
          config.screens.maxCharacters,
          config.screens.maxStrings
        );
        return res.status(400).json(errorScreens);
      }

      // Create a modified request object with device timezone for source handlers
      const deviceReq = {
        ...req,
        deviceTimezone: device.timezone
      };

      const sourceData = await sourceHandlers[source](deviceReq);

      const screens = formatStringsToScreens(
        sourceData,
        config.screens.maxCharacters,
        config.screens.maxStrings
      );

      res.json(screens);
    } catch (error) {
      console.error(
        `Error processing device ${req.params.serialNumber}:`,
        error
      );
      const errorScreens = formatStringsToScreens(
        [
          `ERROR: Failed to process device ${req.params.serialNumber}`,
          error?.message || "Unknown error"
        ],
        config.screens.maxCharacters,
        config.screens.maxStrings
      );
      res.status(500).json(errorScreens);
    }
  }
);

// Admin endpoint to reload device configuration
app.post("/admin/reload-devices", async (req, res) => {
  try {
    console.log("Manual device config reload requested");
    await loadDevicesConfig();

    const errorScreens = formatStringsToScreens(
      ["Device configuration reloaded successfully"],
      config.screens.maxCharacters,
      config.screens.maxStrings
    );
    res.json(errorScreens);
  } catch (error) {
    console.error("Failed to reload device configuration:", error);
    const errorScreens = formatStringsToScreens(
      [
        "ERROR: Failed to reload device configuration",
        error?.message || "Unknown error"
      ],
      config.screens.maxCharacters,
      config.screens.maxStrings
    );
    res.status(500).json(errorScreens);
  }
});

app.listen(port, () => {
  console.log(`✅ API started at port ${port}`);
});
