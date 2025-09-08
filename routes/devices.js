import express from "express";
import Device from "../models/Device.js";
import User from "../models/User.js";
import {
  requireAuth,
  requireAdmin,
  requireDeviceOwnership
} from "../utils/auth.js";

const router = express.Router();

// Get all devices for current user
router.get("/", requireAuth, async (req, res) => {
  try {
    // Use populated devices from auth middleware if available
    let devices;
    if (
      req.user.devices &&
      req.user.devices.length > 0 &&
      typeof req.user.devices[0] === "object"
    ) {
      // User has populated devices, filter for active ones
      devices = req.user.devices.filter((device) => device.isActive);
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
        isActive: device.isActive,
        lastSeen: device.lastSeen,
        stats: device.stats,
        settings: device.settings,
        createdAt: device.createdAt,
        updatedAt: device.updatedAt
      }))
    });
  } catch (error) {
    console.error("Get devices error:", error);
    res.status(500).json({ error: "Failed to fetch devices" });
  }
});

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
        isActive: device.isActive,
        lastSeen: device.lastSeen,
        stats: device.stats,
        settings: device.settings,
        owner: {
          id: device.owner._id,
          name: device.owner.name,
          email: device.owner.email
        },
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
      name: name || `Device ${serialNumber}`,
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
        isActive: device.isActive,
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
router.put("/:serialNumber", requireDeviceOwnership, async (req, res) => {
  try {
    const device = req.device;
    const { name, source, timezone, settings } = req.body;

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

    await device.save();

    res.json({
      message: "Device updated successfully",
      device: {
        id: device._id,
        serialNumber: device.serialNumber,
        name: device.name,
        source: device.source,
        timezone: device.timezone,
        isActive: device.isActive,
        settings: device.settings,
        updatedAt: device.updatedAt
      }
    });
  } catch (error) {
    console.error("Update device error:", error);
    res.status(500).json({ error: "Failed to update device" });
  }
});

// Toggle device active status
router.patch(
  "/:serialNumber/toggle",
  requireDeviceOwnership,
  async (req, res) => {
    try {
      const device = req.device;
      device.isActive = !device.isActive;
      await device.save();

      res.json({
        message: `Device ${
          device.isActive ? "activated" : "deactivated"
        } successfully`,
        device: {
          id: device._id,
          serialNumber: device.serialNumber,
          isActive: device.isActive,
          updatedAt: device.updatedAt
        }
      });
    } catch (error) {
      console.error("Toggle device error:", error);
      res.status(500).json({ error: "Failed to toggle device status" });
    }
  }
);

// Delete device
router.delete("/:serialNumber", requireDeviceOwnership, async (req, res) => {
  try {
    const device = req.device;

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
router.get("/admin/stats", requireAdmin, async (req, res) => {
  try {
    // Batch multiple database operations for better performance
    const [stats, deviceCounts, recentDevices] = await Promise.all([
      Device.getDeviceStats(),
      Device.aggregate([
        {
          $group: {
            _id: null,
            totalDevices: { $sum: 1 },
            activeDevices: {
              $sum: { $cond: [{ $eq: ["$isActive", true] }, 1, 0] }
            }
          }
        }
      ]),
      Device.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("owner", "name email")
        .lean()
    ]);

    const { totalDevices = 0, activeDevices = 0 } = deviceCounts[0] || {};

    res.json({
      overview: {
        totalDevices,
        activeDevices,
        inactiveDevices: totalDevices - activeDevices
      },
      sourceStats: stats,
      recentDevices: recentDevices.map((device) => ({
        serialNumber: device.serialNumber,
        name: device.name,
        source: device.source,
        owner: device.owner,
        createdAt: device.createdAt,
        lastSeen: device.lastSeen
      }))
    });
  } catch (error) {
    console.error("Get device stats error:", error);
    res.status(500).json({ error: "Failed to fetch device statistics" });
  }
});

// Get all devices (admin only)
router.get("/admin/all", requireAdmin, async (req, res) => {
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
        isActive: device.isActive,
        lastSeen: device.lastSeen,
        stats: device.stats,
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
