import express from "express";
import { formatStringsToScreens } from "./utils/formatStringsToScreens.js";
import { createCacheMiddleware, cache } from "./utils/cache.js";
import { sourceHandlers } from "./config/sources.js";
import { loadConfigs } from "./utils/configLoader.js";
import { getSourceTTL } from "./utils/sourceUtils.js";

const { global: config, devices } = await loadConfigs();

const app = express();
const port = 3115;

app.use(express.json());

// Get data from a source
app.get("/source/:sourceName", async (req, res) => {
  try {
    const source = req.params.sourceName;

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

// Get screens for a specific device
app.get(
  "/device/:serialNumber",
  async (req, res, next) => {
    const noCache = req.query.noCache === "true";
    const serialNumber = req.params.serialNumber;

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
      const sourceTTL = getSourceTTL(device.source, config);

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
      if (!res.headersSent) {
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
  }
);

app.listen(port, () => {
  console.log(`✅ API started at port ${port}`);
});
