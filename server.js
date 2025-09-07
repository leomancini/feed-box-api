import express from "express";
import { formatStringsToScreens } from "./utils/formatStringsToScreens.js";
import { createCacheMiddleware } from "./utils/cache.js";
import { fetchNYTHeadlines } from "./sources/headlines.js";
import { sampleStrings } from "./sources/samples.js";

const app = express();
const port = 3115;

const config = {
  screens: {
    maxCharacters: 20,
    maxStrings: 20
  },
  cache: {
    ttl: 10 * 60 * 1000
  }
};

app.use(express.json());

const cacheMiddleware = createCacheMiddleware({
  ttl: config.cache.ttl
});

const sourceHandlers = {
  sample: async () => sampleStrings,
  headlines: async () => await fetchNYTHeadlines()
};

app.get(
  "/screens",
  (req, res, next) => {
    const noCache = req.query.noCache === "true";

    if (noCache) {
      next();
    } else {
      cacheMiddleware(req, res, next);
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

      const sourceData = await sourceHandlers[source]();

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
