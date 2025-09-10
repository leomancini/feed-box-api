import express from "express";
import Config from "../models/Config.js";
import { cache } from "../utils/cache.js";
import {
  requireAuth,
  requireAdmin,
  authenticateToken,
  authenticateAdmin
} from "../utils/auth.js";

const router = express.Router();

// Get all configuration (public - for app functionality)
router.get("/", async (req, res) => {
  try {
    const globalConfig = await Config.getGlobalConfig();
    res.json({ config: globalConfig });
  } catch (error) {
    console.error("Get config error:", error);
    res.status(500).json({ error: "Failed to fetch configuration" });
  }
});

// Get configuration by category (public)
router.get("/category/:category", async (req, res) => {
  try {
    const { category } = req.params;
    const configs = await Config.getByCategory(category);

    res.json({
      category,
      configs: configs.map((config) => ({
        key: config.key,
        value: config.value,
        description: config.description
      }))
    });
  } catch (error) {
    console.error("Get config by category error:", error);
    res.status(500).json({ error: "Failed to fetch configuration" });
  }
});

// Get specific configuration by key (public)
router.get("/key/:key", async (req, res) => {
  try {
    const { key } = req.params;
    const config = await Config.getByKey(key);

    if (!config) {
      return res.status(404).json({ error: "Configuration not found" });
    }

    res.json({
      key: config.key,
      value: config.value,
      description: config.description,
      category: config.category
    });
  } catch (error) {
    console.error("Get config by key error:", error);
    res.status(500).json({ error: "Failed to fetch configuration" });
  }
});

// Admin routes - require admin authentication
router.use(authenticateAdmin);

// Get all configurations with metadata (admin only)
router.get("/admin/all", async (req, res) => {
  try {
    const configs = await Config.getAllActive()
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email");

    res.json({
      configs: configs.map((config) => ({
        id: config._id,
        key: config.key,
        value: config.value,
        description: config.description,
        category: config.category,
        validation: config.validation,
        createdBy: config.createdBy,
        updatedBy: config.updatedBy,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt
      }))
    });
  } catch (error) {
    console.error("Get all configs error:", error);
    res.status(500).json({ error: "Failed to fetch configurations" });
  }
});

// Create or update configuration (admin only)
router.put("/admin/:key", async (req, res) => {
  try {
    const { key } = req.params;
    const { value, description, category, validation } = req.body;

    if (value === undefined) {
      return res.status(400).json({ error: "Value is required" });
    }

    const config = await Config.setConfig(key, value, {
      description,
      category,
      validation,
      updatedBy: req.user._id || req.user.userId
    });

    res.json({
      message: "Configuration updated successfully",
      config: {
        id: config._id,
        key: config.key,
        value: config.value,
        description: config.description,
        category: config.category,
        updatedAt: config.updatedAt
      }
    });
  } catch (error) {
    console.error("Update config error:", error);
    if (error.message.includes("must be")) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Failed to update configuration" });
    }
  }
});

// Bulk update configurations (admin only)
router.put("/admin/bulk", async (req, res) => {
  try {
    const { configs } = req.body;

    if (!Array.isArray(configs)) {
      return res.status(400).json({ error: "Configs must be an array" });
    }

    const results = [];
    const errors = [];

    for (const configData of configs) {
      try {
        const { key, value, description, category, validation } = configData;

        if (!key || value === undefined) {
          errors.push({ key, error: "Key and value are required" });
          continue;
        }

        const config = await Config.setConfig(key, value, {
          description,
          category,
          validation,
          updatedBy: req.user._id || req.user.userId
        });

        results.push({
          key: config.key,
          value: config.value,
          success: true
        });
      } catch (error) {
        errors.push({ key: configData.key, error: error.message });
      }
    }

    res.json({
      message: `Updated ${results.length} configurations`,
      results,
      errors
    });
  } catch (error) {
    console.error("Bulk update config error:", error);
    res.status(500).json({ error: "Failed to update configurations" });
  }
});

// Delete configuration (admin only)
router.delete("/admin/:key", async (req, res) => {
  try {
    const { key } = req.params;

    const config = await Config.findOneAndUpdate(
      { key },
      {
        isActive: false,
        updatedBy: req.user._id || req.user.userId
      },
      { new: true }
    );

    if (!config) {
      return res.status(404).json({ error: "Configuration not found" });
    }

    res.json({
      message: "Configuration deleted successfully",
      key: config.key
    });
  } catch (error) {
    console.error("Delete config error:", error);
    res.status(500).json({ error: "Failed to delete configuration" });
  }
});

// Get configuration statistics (admin only)
router.get("/admin/stats", async (req, res) => {
  try {
    // Batch database operations for better performance
    const [categoriesStats, recentUpdates] = await Promise.all([
      Config.aggregate([
        { $match: { isActive: true } },
        {
          $facet: {
            totalCount: [{ $count: "count" }],
            categoryStats: [
              { $group: { _id: "$category", count: { $sum: 1 } } },
              { $sort: { count: -1 } }
            ]
          }
        }
      ]),
      Config.find({ isActive: true })
        .sort({ updatedAt: -1 })
        .limit(5)
        .populate("updatedBy", "name email")
        .select("key value category updatedAt updatedBy")
    ]);

    const totalConfigs = categoriesStats[0]?.totalCount[0]?.count || 0;
    const categoryBreakdown = categoriesStats[0]?.categoryStats || [];

    res.json({
      totalConfigs,
      categoriesStats: categoryBreakdown,
      recentUpdates: recentUpdates.map((config) => ({
        key: config.key,
        value: config.value,
        category: config.category,
        updatedAt: config.updatedAt,
        updatedBy: config.updatedBy
      }))
    });
  } catch (error) {
    console.error("Get config stats error:", error);
    res.status(500).json({ error: "Failed to fetch configuration statistics" });
  }
});

// Reset to default configuration (admin only)
router.post("/admin/reset", async (req, res) => {
  try {
    // Define default configurations
    const defaultConfigs = [
      {
        key: "screens.maxCharacters",
        value: 20,
        description: "Maximum characters per screen",
        category: "screens",
        validation: { type: "number", min: 1, max: 100 }
      },
      {
        key: "screens.maxStrings",
        value: 20,
        description: "Maximum strings per screen",
        category: "screens",
        validation: { type: "number", min: 1, max: 50 }
      },
      {
        key: "cache.refreshMinutes.default",
        value: 10,
        description: "Default cache refresh interval in minutes",
        category: "cache",
        validation: { type: "number", min: 1, max: 1440 }
      },
      {
        key: "cache.refreshMinutes.sample",
        value: 5,
        description: "Sample source cache refresh interval",
        category: "cache",
        validation: { type: "number", min: 1, max: 1440 }
      },
      {
        key: "cache.refreshMinutes.headlines",
        value: 15,
        description: "Headlines source cache refresh interval",
        category: "cache",
        validation: { type: "number", min: 1, max: 1440 }
      },
      {
        key: "cache.refreshMinutes.sports",
        value: 2,
        description: "Sports source cache refresh interval",
        category: "cache",
        validation: { type: "number", min: 1, max: 1440 }
      },
      {
        key: "cache.refreshMinutes.wikipedia",
        value: 60,
        description: "Wikipedia source cache refresh interval",
        category: "cache",
        validation: { type: "number", min: 1, max: 1440 }
      },
      {
        key: "timezone",
        value: "America/New_York",
        description: "Default timezone for the application",
        category: "general",
        validation: { type: "string" }
      }
    ];

    const results = [];
    for (const configData of defaultConfigs) {
      const config = await Config.setConfig(configData.key, configData.value, {
        description: configData.description,
        category: configData.category,
        validation: configData.validation,
        updatedBy: req.user._id || req.user.userId
      });
      results.push(config.key);
    }

    res.json({
      message: "Configuration reset to defaults successfully",
      resetConfigs: results
    });
  } catch (error) {
    console.error("Reset config error:", error);
    res.status(500).json({ error: "Failed to reset configuration" });
  }
});

// Cache management endpoints (admin only)

// Get cache statistics (admin only)
router.get("/admin/cache/stats", async (req, res) => {
  try {
    const stats = cache.getStats();
    res.json({
      message: "Cache statistics retrieved successfully",
      stats
    });
  } catch (error) {
    console.error("Get cache stats error:", error);
    res.status(500).json({ error: "Failed to fetch cache statistics" });
  }
});

// Clear all cache entries (admin only)
router.delete("/admin/cache/clear", async (req, res) => {
  try {
    const statsBefore = cache.getStats();
    await cache.clear();
    
    res.json({
      message: "All cache entries cleared successfully",
      clearedEntries: statsBefore.size
    });
  } catch (error) {
    console.error("Clear cache error:", error);
    res.status(500).json({ error: "Failed to clear cache" });
  }
});

// Clear cache for a specific device (admin only)
router.delete("/admin/cache/device/:serialNumber", async (req, res) => {
  try {
    const { serialNumber } = req.params;
    const result = await cache.invalidateDevice(serialNumber);
    
    res.json({
      message: `Cache cleared for device ${serialNumber}`,
      entriesDeleted: result.entriesDeleted,
      filesDeleted: result.filesDeleted
    });
  } catch (error) {
    console.error("Clear device cache error:", error);
    res.status(500).json({ error: "Failed to clear device cache" });
  }
});

// Clear cache for a specific device and source (admin only)
router.delete("/admin/cache/device/:serialNumber/source/:source", async (req, res) => {
  try {
    const { serialNumber, source } = req.params;
    const cacheKey = cache.generateDeviceKey(serialNumber, source);
    const deleted = cache.delete(cacheKey);
    
    res.json({
      message: `Cache cleared for device ${serialNumber} source ${source}`,
      deleted,
      key: cacheKey
    });
  } catch (error) {
    console.error("Clear device source cache error:", error);
    res.status(500).json({ error: "Failed to clear device source cache" });
  }
});

export default router;
