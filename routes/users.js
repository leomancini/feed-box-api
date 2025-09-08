import express from "express";
import User from "../models/User.js";
import { requireAuth, authenticateToken } from "../utils/auth.js";

const router = express.Router();

// Get list of users for owner selection (admin only)
router.get("/list", requireAuth, async (req, res) => {
  try {
    // Check admin permissions
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const users = await User.find({ isActive: true })
      .select("_id name email role createdAt")
      .sort({ name: 1 })
      .lean();

    res.json({
      message: "Users list retrieved successfully",
      users: users.map((user) => ({
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt
      }))
    });
  } catch (error) {
    console.error("Get users list error:", error);
    res.status(500).json({ error: "Failed to fetch users list" });
  }
});

export default router;
