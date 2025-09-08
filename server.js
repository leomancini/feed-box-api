import express from "express";
import session from "express-session";
import cors from "cors";
import dotenv from "dotenv";
import { formatStringsToScreens } from "./utils/formatStringsToScreens.js";
import { createCacheMiddleware, cache } from "./utils/cache.js";
import { sourceHandlers } from "./utils/sources.js";
import { getSourceTTL } from "./utils/sourceUtils.js";
import database from "./utils/database.js";
import passport, { optionalAuth } from "./utils/auth.js";
import authRoutes from "./routes/auth.js";
import deviceRoutes from "./routes/devices.js";
import configRoutes from "./routes/config.js";
import Device from "./models/Device.js";
import Config from "./models/Config.js";

// Load environment variables
dotenv.config();

// Connect to database
await database.connect();

// Load global config from MongoDB
let config;
try {
  config = await Config.getGlobalConfig();
  console.log("✅ Successfully loaded configuration from MongoDB");
} catch (error) {
  console.error("❌ Failed to load config from MongoDB:", error.message);
  console.error(
    "Please ensure the database is connected and configuration is migrated."
  );
  process.exit(1);
}

const app = express();
const port = process.env.PORT || 3115;

// CORS configuration
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"]
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  })
);

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Mount routes
app.use("/auth", authRoutes);
app.use("/api/devices", deviceRoutes);
app.use("/api/config", configRoutes);

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
  optionalAuth, // Allow both authenticated and unauthenticated access
  async (req, res, next) => {
    const noCache = req.query.noCache === "true";
    const serialNumber = req.params.serialNumber;

    try {
      // Find device configuration in MongoDB
      const device = await Device.findBySerialNumber(serialNumber);
      if (!device || !device.isActive) {
        const errorScreens = formatStringsToScreens(
          [
            `ERROR: Device with serial number ${serialNumber} not found or inactive`
          ],
          config.screens.maxCharacters,
          config.screens.maxStrings
        );
        return res.status(404).json(errorScreens);
      }

      // Store device in request for next middleware
      req.device = device;

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
    } catch (error) {
      console.error(`Error finding device ${serialNumber}:`, error);
      const errorScreens = formatStringsToScreens(
        [`ERROR: Database error while finding device ${serialNumber}`],
        config.screens.maxCharacters,
        config.screens.maxStrings
      );
      return res.status(500).json(errorScreens);
    }
  },
  async (req, res) => {
    try {
      const serialNumber = req.params.serialNumber;

      const device = req.device; // Set by previous middleware

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

      // Get device timezone once and pass it directly to source handlers
      const deviceTimezone = device.timezone || "UTC";

      // Call source handler with timezone parameter directly
      let sourceData;
      if (source === "sample") {
        sourceData = await sourceHandlers[source]();
      } else if (source === "headlines") {
        sourceData = await sourceHandlers[source](deviceTimezone);
      } else {
        // sports and wikipedia still need req for query parameters
        sourceData = await sourceHandlers[source](req, deviceTimezone);
      }

      // Use device-specific settings if available, otherwise use global config
      const maxCharacters =
        device.settings.maxCharacters || config.screens.maxCharacters;
      const maxStrings =
        device.settings.maxStrings || config.screens.maxStrings;

      const screens = formatStringsToScreens(
        sourceData,
        maxCharacters,
        maxStrings
      );

      // Update device statistics (async, don't wait)
      device
        .incrementRequestCount()
        .catch((err) => console.error("Error updating device stats:", err));

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
