import express from "express";
import Device from "../models/Device.js";
import User from "../models/User.js";
import Config from "../models/Config.js";
import { formatStringsToScreens } from "../utils/formatStringsToScreens.js";
import { createCacheMiddleware, cache } from "../utils/cache.js";
import { sourceHandlers } from "../utils/sources.js";
import { getSourceTTL } from "../utils/sourceUtils.js";
import {
  requireAuth,
  requireAdmin,
  requireDeviceOwnership,
  optionalAuth,
  authenticateToken,
  authenticateAdmin
} from "../utils/auth.js";

const router = express.Router();

// Get all devices for current user
router.get("/", authenticateToken, async (req, res) => {
  try {
    // Use populated devices from auth middleware if available
    let devices;
    if (
      req.user.devices &&
      req.user.devices.length > 0 &&
      typeof req.user.devices[0] === "object"
    ) {
      // User has populated devices
      devices = req.user.devices;
    } else {
      // Fallback to database query
      devices = await Device.findByOwner(req.user._id || req.user.userId);
    }

    res.json({
      devices: devices.map((device) => ({
        id: device._id,
        serialNumber: device.serialNumber,
        name: device.name,
        source: device.source,
        timezone: device.timezone,
        createdAt: device.createdAt,
        updatedAt: device.updatedAt
      }))
    });
  } catch (error) {
    console.error("Get devices error:", error);
    res.status(500).json({ error: "Failed to fetch devices" });
  }
});

// Get screens for a specific device (public endpoint)
router.get(
  "/:serialNumber/data",
  optionalAuth, // Allow both authenticated and unauthenticated access
  async (req, res, next) => {
    const noCache = req.query.noCache === "true";
    const serialNumber = req.params.serialNumber;

    try {
      // Load global config from MongoDB with timeout
      let config;
      try {
        config = await Promise.race([
          Config.getGlobalConfig(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Config load timeout")), 5000)
          )
        ]);
      } catch (configError) {
        console.warn(
          `Config load failed for device ${serialNumber}, using defaults:`,
          configError.message
        );
        // Fallback to default config
        config = {
          screens: {
            maxCharacters: 20,
            maxStrings: 20
          },
          cache: {
            refreshMinutes: {
              default: 10,
              sample: 5,
              headlines: 15,
              sports: 2,
              wikipedia: 60
            }
          }
        };
      }

      // Find device configuration in MongoDB
      const device = await Device.findBySerialNumber(serialNumber);
      if (!device) {
        const errorScreens = formatStringsToScreens(
          [`ERROR: Device with serial number ${serialNumber} not found`],
          config.screens.maxCharacters,
          config.screens.maxStrings
        );
        return res.status(404).json(errorScreens);
      }

      // Store device and config in request for next middleware
      req.device = device;
      req.config = config;

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

      // Load config for error formatting
      let config;
      try {
        config = await Config.getGlobalConfig();

        // Verify config has required structure
        if (
          !config.screens ||
          !config.screens.maxCharacters ||
          !config.screens.maxStrings
        ) {
          throw new Error("Config missing required screens properties");
        }
      } catch (configError) {
        // Fallback to basic error response if config load fails
        return res.status(500).json({
          error: `Database error while finding device ${serialNumber}`,
          message: error?.message || "Unknown error"
        });
      }

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
      const config = req.config; // Set by previous middleware
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

      // Note: Device statistics tracking removed

      res.json(screens);
    } catch (error) {
      if (!res.headersSent) {
        console.error(
          `Error processing device ${req.params.serialNumber}:`,
          error
        );

        // Load config for error formatting
        let config = req.config;
        if (!config) {
          try {
            config = await Config.getGlobalConfig();

            // Verify config has required structure
            if (
              !config.screens ||
              !config.screens.maxCharacters ||
              !config.screens.maxStrings
            ) {
              throw new Error("Config missing required screens properties");
            }
          } catch (configError) {
            // Fallback to basic error response if config load fails
            return res.status(500).json({
              error: `Failed to process device ${req.params.serialNumber}`,
              message: error?.message || "Unknown error"
            });
          }
        }

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

// Get specific device by serial number
router.get("/:serialNumber", requireDeviceOwnership, async (req, res) => {
  try {
    const device = req.device; // Set by requireDeviceOwnership middleware

    res.json({
      device: {
        id: device._id,
        serialNumber: device.serialNumber,
        name: device.name,
        source: device.source,
        timezone: device.timezone,
        owner: device.owner
          ? {
              id: device.owner._id,
              name: device.owner.name,
              email: device.owner.email
            }
          : null,
        createdAt: device.createdAt,
        updatedAt: device.updatedAt
      }
    });
  } catch (error) {
    console.error("Get device error:", error);
    res.status(500).json({ error: "Failed to fetch device" });
  }
});

// Create new device
router.post("/", requireAuth, async (req, res) => {
  try {
    const { serialNumber, name, source, timezone } = req.body;

    // Validate required fields
    if (!serialNumber || !source) {
      return res.status(400).json({
        error: "Serial number and source are required"
      });
    }

    // Validate source
    const validSources = ["headlines", "sports", "wikipedia", "sample"];
    if (!validSources.includes(source)) {
      return res.status(400).json({
        error: `Invalid source. Must be one of: ${validSources.join(", ")}`
      });
    }

    // Check if device already exists
    const existingDevice = await Device.findBySerialNumber(serialNumber);
    if (existingDevice) {
      return res.status(409).json({
        error: "Device with this serial number already exists"
      });
    }

    // Create new device
    const device = new Device({
      serialNumber: serialNumber.toUpperCase(),
      name: name || null,
      source,
      timezone: timezone || "UTC",
      owner: req.user._id || req.user.userId
    });

    await device.save();

    // Add device to user's devices array using the user already loaded by auth middleware
    if (req.user.addDevice) {
      // User object has the method, use it directly
      await req.user.addDevice(device._id);
    } else {
      // Fallback: fetch user and add device
      const user = await User.findById(req.user._id || req.user.userId);
      await user.addDevice(device._id);
    }

    res.status(201).json({
      message: "Device created successfully",
      device: {
        id: device._id,
        serialNumber: device.serialNumber,
        name: device.name,
        source: device.source,
        timezone: device.timezone,
        createdAt: device.createdAt
      }
    });
  } catch (error) {
    console.error("Create device error:", error);
    if (error.code === 11000) {
      res
        .status(409)
        .json({ error: "Device with this serial number already exists" });
    } else {
      res.status(500).json({ error: "Failed to create device" });
    }
  }
});

// Update device
router.put("/:serialNumber", requireAuth, async (req, res) => {
  try {
    const serialNumber = req.params.serialNumber;
    const { name, source, timezone, settings, ownerId } = req.body;

    // Find the device
    const device = await Device.findBySerialNumber(serialNumber);
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    // Check permissions: admins can update any device, users can only update their own
    const isAdmin = req.user.role === "admin";
    const currentUserId = (req.user._id || req.user.userId).toString();
    // Handle both populated and non-populated owner field
    const deviceOwnerId = device.owner
      ? device.owner._id
        ? device.owner._id.toString()
        : device.owner.toString()
      : null;
    const isOwner = device.owner && deviceOwnerId === currentUserId;

    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        error: "Access denied. You can only update devices you own.",
        debug: {
          currentUserId,
          deviceOwnerId,
          isAdmin,
          isOwner
        }
      });
    }

    // Only admins can update device ownership
    if (ownerId !== undefined && !isAdmin) {
      return res.status(403).json({
        error: "Only administrators can change device ownership."
      });
    }

    // Serial numbers cannot be edited by non-admin users
    if (req.body.serialNumber && !isAdmin) {
      return res.status(403).json({
        error:
          "Serial number cannot be modified. Contact administrator if needed."
      });
    }

    // Validate source if provided
    if (source) {
      const validSources = ["headlines", "sports", "wikipedia", "sample"];
      if (!validSources.includes(source)) {
        return res.status(400).json({
          error: `Invalid source. Must be one of: ${validSources.join(", ")}`
        });
      }
      device.source = source;
    }

    // Update fields if provided
    if (name !== undefined) device.name = name;
    if (timezone !== undefined) device.timezone = timezone;
    if (settings !== undefined) {
      device.settings = { ...device.settings, ...settings };
    }

    // Allow admins to update device owner
    if (ownerId !== undefined && isAdmin) {
      if (ownerId === null || ownerId === "") {
        // Remove owner (unlink device)
        const oldOwnerId = device.owner;
        device.owner = null;

        // Remove device from old owner's devices array
        if (oldOwnerId) {
          await User.updateOne(
            { _id: oldOwnerId },
            { $pull: { devices: device._id } }
          );
        }
      } else {
        // Validate new owner exists
        const newOwner = await User.findById(ownerId);
        if (!newOwner) {
          return res.status(400).json({ error: "New owner not found" });
        }

        const oldOwnerId = device.owner;
        device.owner = ownerId;

        // Remove device from old owner's devices array
        if (oldOwnerId && oldOwnerId.toString() !== ownerId.toString()) {
          await User.updateOne(
            { _id: oldOwnerId },
            { $pull: { devices: device._id } }
          );
        }

        // Add device to new owner's devices array
        await User.updateOne(
          { _id: ownerId },
          { $addToSet: { devices: device._id } }
        );
      }
    }

    // Allow admins to update serial number if needed
    if (req.body.serialNumber && isAdmin) {
      // Check if new serial number already exists
      const existingDevice = await Device.findBySerialNumber(
        req.body.serialNumber
      );
      if (
        existingDevice &&
        existingDevice._id.toString() !== device._id.toString()
      ) {
        return res.status(409).json({
          error: "A device with this serial number already exists"
        });
      }
      device.serialNumber = req.body.serialNumber.toUpperCase();
    }

    await device.save();

    // Populate owner information for response
    await device.populate("owner", "name email");

    res.json({
      message: "Device updated successfully",
      device: {
        id: device._id,
        serialNumber: device.serialNumber,
        name: device.name,
        source: device.source,
        timezone: device.timezone,
        owner: device.owner
          ? {
              id: device.owner._id,
              name: device.owner.name,
              email: device.owner.email
            }
          : null,
        updatedAt: device.updatedAt
      }
    });
  } catch (error) {
    console.error("Update device error:", error);
    res.status(500).json({ error: "Failed to update device" });
  }
});

// Create unlinked device (admin only)
router.post("/admin/create-unlinked", authenticateAdmin, async (req, res) => {
  try {
    const { serialNumber, name, source, timezone } = req.body;

    // Validate required fields
    if (!serialNumber || !source) {
      return res.status(400).json({
        error: "Serial number and source are required"
      });
    }

    // Validate source
    const validSources = ["headlines", "sports", "wikipedia", "sample"];
    if (!validSources.includes(source)) {
      return res.status(400).json({
        error: `Invalid source. Must be one of: ${validSources.join(", ")}`
      });
    }

    // Check if device already exists
    const existingDevice = await Device.findBySerialNumber(serialNumber);
    if (existingDevice) {
      return res.status(409).json({
        error: "Device with this serial number already exists"
      });
    }

    // Create new unlinked device
    const device = new Device({
      serialNumber: serialNumber.toUpperCase(),
      name: name || null,
      source,
      timezone: timezone || "UTC"
      // owner is intentionally omitted (null)
    });

    await device.save();

    res.status(201).json({
      message: "Unlinked device created successfully",
      device: {
        id: device._id,
        serialNumber: device.serialNumber,
        name: device.name,
        source: device.source,
        timezone: device.timezone,
        owner: null,
        createdAt: device.createdAt
      }
    });
  } catch (error) {
    console.error("Create unlinked device error:", error);
    if (error.code === 11000) {
      res
        .status(409)
        .json({ error: "Device with this serial number already exists" });
    } else {
      res.status(500).json({ error: "Failed to create unlinked device" });
    }
  }
});

// Link existing device to user account
router.post("/link", requireAuth, async (req, res) => {
  try {
    const { serialNumber } = req.body;

    // Validate required fields
    if (!serialNumber) {
      return res.status(400).json({
        error: "Serial number is required"
      });
    }

    // Find the device by serial number
    const device = await Device.findBySerialNumber(serialNumber);
    if (!device) {
      return res.status(404).json({
        error: "Device not found with the provided serial number"
      });
    }

    // Check if device is already linked to the current user
    const currentUserId = (req.user._id || req.user.userId).toString();
    if (device.owner && device.owner.toString() === currentUserId) {
      return res.status(409).json({
        error: "Device is already linked to your account"
      });
    }

    // Check if device is already linked to another user
    if (device.owner && device.owner.toString() !== currentUserId) {
      return res.status(409).json({
        error:
          "Device is already linked to another account. Please contact support if you believe this is an error."
      });
    }

    // Link device to current user
    device.owner = req.user._id || req.user.userId;
    await device.save();

    // Add device to user's devices array using the user already loaded by auth middleware
    if (req.user.addDevice) {
      // User object has the method, use it directly
      await req.user.addDevice(device._id);
    } else {
      // Fallback: fetch user and add device
      const user = await User.findById(req.user._id || req.user.userId);
      await user.addDevice(device._id);
    }

    res.status(200).json({
      message: "Device linked successfully to your account",
      device: {
        id: device._id,
        serialNumber: device.serialNumber,
        name: device.name,
        source: device.source,
        timezone: device.timezone,
        linkedAt: new Date(),
        createdAt: device.createdAt
      }
    });
  } catch (error) {
    console.error("Link device error:", error);
    res.status(500).json({ error: "Failed to link device to account" });
  }
});

// Unlink device from current user
router.post(
  "/:serialNumber/unlink",
  requireDeviceOwnership,
  async (req, res) => {
    try {
      const device = req.device; // Set by requireDeviceOwnership middleware
      const currentUserId = (req.user._id || req.user.userId).toString();

      // Check if user owns the device
      const deviceOwnerId = device.owner
        ? device.owner._id
          ? device.owner._id.toString()
          : device.owner.toString()
        : null;

      if (!device.owner || deviceOwnerId !== currentUserId) {
        return res.status(403).json({
          error: "You can only unlink devices that you own"
        });
      }

      // Unlink device from user
      const oldOwnerId = device.owner;
      device.owner = null;
      await device.save();

      // Remove device from user's devices array
      await User.updateOne(
        { _id: oldOwnerId },
        { $pull: { devices: device._id } }
      );

      res.json({
        message: "Device unlinked successfully from your account",
        device: {
          id: device._id,
          serialNumber: device.serialNumber,
          name: device.name,
          source: device.source,
          timezone: device.timezone,
          owner: null,
          unlinkedAt: new Date()
        }
      });
    } catch (error) {
      console.error("Unlink device error:", error);
      res.status(500).json({ error: "Failed to unlink device" });
    }
  }
);

// Delete device (admin only)
router.delete("/:serialNumber", authenticateAdmin, async (req, res) => {
  try {
    const Device = (await import("../models/Device.js")).default;
    const device = await Device.findBySerialNumber(req.params.serialNumber);

    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    // Remove device (this will trigger pre-remove middleware to clean up user references)
    await device.deleteOne();

    res.json({
      message: "Device deleted successfully",
      serialNumber: device.serialNumber
    });
  } catch (error) {
    console.error("Delete device error:", error);
    res.status(500).json({ error: "Failed to delete device" });
  }
});

// Get device statistics (admin only)
router.get("/admin/stats", authenticateAdmin, async (req, res) => {
  try {
    // Batch multiple database operations for better performance
    const [stats, deviceCounts, recentDevices] = await Promise.all([
      Device.getDeviceStats(),
      Device.aggregate([
        {
          $group: {
            _id: null,
            totalDevices: { $sum: 1 }
          }
        }
      ]),
      Device.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("owner", "name email")
        .lean()
    ]);

    const { totalDevices = 0 } = deviceCounts[0] || {};

    res.json({
      overview: {
        totalDevices
      },
      sourceStats: stats,
      recentDevices: recentDevices.map((device) => ({
        serialNumber: device.serialNumber,
        name: device.name,
        source: device.source,
        owner: device.owner,
        createdAt: device.createdAt
      }))
    });
  } catch (error) {
    console.error("Get device stats error:", error);
    res.status(500).json({ error: "Failed to fetch device statistics" });
  }
});

// Get unlinked devices (admin only)
router.get("/admin/unlinked", authenticateAdmin, async (req, res) => {
  try {
    const unlinkedDevices = await Device.find({ owner: null })
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      message: "Unlinked devices retrieved successfully",
      devices: unlinkedDevices.map((device) => ({
        id: device._id,
        serialNumber: device.serialNumber,
        name: device.name,
        source: device.source,
        timezone: device.timezone,
        owner: null,
        createdAt: device.createdAt,
        updatedAt: device.updatedAt
      })),
      count: unlinkedDevices.length
    });
  } catch (error) {
    console.error("Get unlinked devices error:", error);
    res.status(500).json({ error: "Failed to fetch unlinked devices" });
  }
});

// Get all devices (admin only)
router.get("/admin/all", authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Batch the device query and count for better performance
    const [devices, totalDevices] = await Promise.all([
      Device.find()
        .populate("owner", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Device.countDocuments()
    ]);
    const totalPages = Math.ceil(totalDevices / limit);

    res.json({
      devices: devices.map((device) => ({
        id: device._id,
        serialNumber: device.serialNumber,
        name: device.name,
        source: device.source,
        timezone: device.timezone,
        owner: device.owner,
        createdAt: device.createdAt,
        updatedAt: device.updatedAt
      })),
      pagination: {
        currentPage: page,
        totalPages,
        totalDevices,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error("Get all devices error:", error);
    res.status(500).json({ error: "Failed to fetch devices" });
  }
});

export default router;
