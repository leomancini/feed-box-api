import express from "express";
import jwt from "jsonwebtoken";
import passport, {
  generateToken,
  requireAuth,
  authenticateToken,
  authenticateAdmin
} from "../utils/auth.js";
import User from "../models/User.js";

const router = express.Router();

// Google OAuth routes
router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    accessType: "offline",
    prompt: "consent"
  })
);

router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/auth/failure",
    failureMessage: true
  }),
  (req, res) => {
    console.log("OAuth callback triggered");
    console.log("Request user:", req.user ? "User present" : "No user");
    console.log("Request query:", req.query);
    console.log("Request params:", req.params);

    try {
      if (req.user) {
        console.log("User details:", {
          id: req.user.id || req.user._id,
          email: req.user.email,
          name: req.user.name,
          fullUser: req.user
        });

        // Verify JWT_SECRET exists
        if (!process.env.JWT_SECRET) {
          console.error("JWT_SECRET is not set in environment variables");
          const frontendUrl = process.env.FRONTEND_URL;
          return res.redirect(
            `${frontendUrl}/auth/failure?error=jwt_secret_missing`
          );
        }

        // Create JWT token
        const tokenPayload = {
          userId: req.user.id || req.user._id,
          email: req.user.email,
          name: req.user.name,
          role: req.user.role
        };

        console.log("Creating JWT with payload:", tokenPayload);

        const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
          expiresIn: "24h"
        });

        console.log("JWT token created successfully");

        // Redirect with token in URL
        const frontendUrl = process.env.FRONTEND_URL;
        console.log(
          "Redirecting to:",
          `${frontendUrl}/auth/success?token=${token.substring(0, 20)}...`
        );
        res.redirect(`${frontendUrl}/auth/success?token=${token}`);
      } else {
        console.error("OAuth callback: No user in request");
        console.error("Request session:", req.session);
        console.error(
          "Request isAuthenticated:",
          req.isAuthenticated ? req.isAuthenticated() : "N/A"
        );
        const frontendUrl = process.env.FRONTEND_URL;
        res.redirect(`${frontendUrl}/auth/failure?error=no_user`);
      }
    } catch (error) {
      console.error("OAuth callback error:", error);
      console.error("Error stack:", error.stack);
      const frontendUrl = process.env.FRONTEND_URL;
      res.redirect(
        `${frontendUrl}/auth/failure?error=callback_error&details=${encodeURIComponent(
          error.message
        )}`
      );
    }
  }
);

// Get current user info
router.get("/me", requireAuth, async (req, res) => {
  try {
    // Use user data already loaded by auth middleware
    let user = req.user;

    // If user doesn't have populated devices, populate them
    if (
      !user.devices ||
      user.devices.length === 0 ||
      typeof user.devices[0] === "string"
    ) {
      user = await User.findById(user._id || user.userId)
        .populate("devices")
        .select("-googleId");
    }

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        role: user.role,
        deviceCount: user.devices.length,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ error: "Failed to fetch user data" });
  }
});

// Update user profile
router.put("/me", authenticateToken, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: "Name is required" });
    }

    // Use user data already loaded by auth middleware, but get fresh copy for update
    const user = await User.findById(req.user._id || req.user.userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.name = name.trim();
    await user.save();

    res.json({
      message: "Profile updated successfully",
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        role: user.role
      }
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// Logout
router.post("/logout", authenticateToken, (req, res) => {
  // With JWT, logout is handled client-side by removing the token
  // Optionally, you can maintain a blacklist of tokens here
  res.json({ success: true, message: "Logged out successfully" });
});

// Check authentication status
router.get("/status", authenticateToken, (req, res) => {
  res.json({
    authenticated: true,
    user: {
      id: req.user.userId,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role
    }
  });
});

// Get user statistics (admin only)
router.get("/users/stats", authenticateAdmin, async (req, res) => {
  try {
    const stats = await User.aggregate([
      {
        $group: {
          _id: null,
          totalUsers: { $sum: 1 },
          activeUsers: {
            $sum: { $cond: [{ $eq: ["$isActive", true] }, 1, 0] }
          },
          adminUsers: {
            $sum: { $cond: [{ $eq: ["$role", "admin"] }, 1, 0] }
          }
        }
      }
    ]);

    const recentUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select("name email createdAt lastLogin")
      .lean();

    res.json({
      stats: stats[0] || { totalUsers: 0, activeUsers: 0, adminUsers: 0 },
      recentUsers
    });
  } catch (error) {
    console.error("Get user stats error:", error);
    res.status(500).json({ error: "Failed to fetch user statistics" });
  }
});

// Generate test token for development (admin user)
router.get("/test-token", async (req, res) => {
  try {
    // Find an admin user (or create a test one)
    let adminUser = await User.findOne({ role: "admin" });

    if (!adminUser) {
      return res.status(404).json({
        error:
          "No admin user found. Please create an admin user first via Google OAuth."
      });
    }

    // Generate JWT token
    const token = generateToken(adminUser);

    res.json({
      message: "Test token generated for development",
      token: token,
      user: {
        id: adminUser._id,
        name: adminUser.name,
        email: adminUser.email,
        role: adminUser.role
      },
      usage: `Include this token in your requests: Authorization: Bearer ${token}`
    });
  } catch (error) {
    console.error("Test token generation error:", error);
    res.status(500).json({ error: "Failed to generate test token" });
  }
});

// OAuth success page
router.get("/success", (req, res) => {
  res.json({
    success: true,
    message: "Authentication successful!",
    instructions:
      "You are now logged in. Use the JWT token from your cookies to make authenticated requests."
  });
});

// Debug endpoint to test database connection
router.get("/debug/db", async (req, res) => {
  try {
    console.log("Testing database connection...");
    const User = (await import("../models/User.js")).default;
    const userCount = await User.countDocuments();
    console.log("Database connection successful, user count:", userCount);

    res.json({
      success: true,
      message: "Database connection working",
      userCount: userCount,
      mongoUri: process.env.MONGODB_URI ? "Set" : "Not set"
    });
  } catch (error) {
    console.error("Database test error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      mongoUri: process.env.MONGODB_URI ? "Set" : "Not set"
    });
  }
});

// OAuth failure page
router.get("/failure", (req, res) => {
  res.status(400).json({
    success: false,
    message: "Authentication failed",
    instructions: "Please try again or contact support if the problem persists."
  });
});

export default router;
