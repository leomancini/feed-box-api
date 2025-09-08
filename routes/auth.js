import express from "express";
import passport, { generateToken, requireAuth } from "../utils/auth.js";
import User from "../models/User.js";

const router = express.Router();

// Google OAuth routes
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/auth/failure"
  }),
  async (req, res) => {
    try {
      // Generate JWT token
      const token = generateToken(req.user);

      // Set token as HTTP-only cookie
      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: "/"
      });

      // Redirect to frontend application with success
      const frontendUrl = process.env.FRONTEND_URL;
      res.redirect(`${frontendUrl}/auth/success`);
    } catch (error) {
      console.error("OAuth callback error:", error);
      res.redirect("/auth/failure");
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
router.put("/me", requireAuth, async (req, res) => {
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
router.post("/logout", (req, res) => {
  // Clear cookie
  res.clearCookie("token");

  // Logout from session if using session
  if (req.logout) {
    req.logout((err) => {
      if (err) {
        console.error("Logout error:", err);
      }
    });
  }

  res.json({ message: "Logged out successfully" });
});

// Check authentication status
router.get("/status", async (req, res) => {
  try {
    // Check JWT token first
    const token =
      req.header("Authorization")?.replace("Bearer ", "") || req.cookies?.token;

    if (token) {
      try {
        const jwt = (await import("jsonwebtoken")).default;
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId).select(
          "name email role isActive"
        );

        if (user && user.isActive) {
          return res.json({
            authenticated: true,
            user: {
              id: user._id,
              name: user.name,
              email: user.email,
              role: user.role
            }
          });
        }
      } catch (error) {
        // JWT invalid, continue to session check
        console.error("JWT verification failed:", error.message);
      }
    }

    // Check session authentication
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
      const user = await User.findById(req.user._id).select(
        "name email role isActive"
      );

      if (user && user.isActive) {
        return res.json({
          authenticated: true,
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role
          }
        });
      }
    }

    // Not authenticated
    res.json({ authenticated: false });
  } catch (error) {
    console.error("Auth status check error:", error);
    res.json({ authenticated: false });
  }
});

// Get user statistics (admin only)
router.get("/users/stats", requireAuth, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

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

// OAuth failure page
router.get("/failure", (req, res) => {
  res.status(400).json({
    success: false,
    message: "Authentication failed",
    instructions: "Please try again or contact support if the problem persists."
  });
});

export default router;
