import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

// Configure Google OAuth Strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "/auth/google/callback"
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Check if user already exists with this Google ID
        let user = await User.findByGoogleId(profile.id);

        if (user) {
          // Update last login
          await user.updateLastLogin();
          return done(null, user);
        }

        // Check if user exists with same email
        user = await User.findByEmail(profile.emails[0].value);

        if (user) {
          // Link Google account to existing user
          user.googleId = profile.id;
          user.picture = profile.photos[0]?.value;
          await user.updateLastLogin();
          await user.save();
          return done(null, user);
        }

        // Create new user
        user = new User({
          googleId: profile.id,
          email: profile.emails[0].value,
          name: profile.displayName,
          picture: profile.photos[0]?.value
        });

        await user.save();
        return done(null, user);
      } catch (error) {
        console.error("Google OAuth error:", error);
        return done(error, null);
      }
    }
  )
);

// Serialize user for session
passport.serializeUser((user, done) => {
  done(null, user._id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id).populate("devices");
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// JWT token generation
export const generateToken = (user) => {
  return jwt.sign(
    {
      userId: user._id,
      email: user.email,
      role: user.role
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
};

// JWT verification middleware
export const verifyToken = (req, res, next) => {
  const token =
    req.header("Authorization")?.replace("Bearer ", "") || req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(400).json({ error: "Invalid token." });
  }
};

// Middleware to check if user is authenticated (either session or JWT)
export const requireAuth = async (req, res, next) => {
  // Check JWT first
  const token =
    req.header("Authorization")?.replace("Bearer ", "") || req.cookies?.token;

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).populate("devices");
      if (user && user.isActive) {
        req.user = user;
        return next();
      }
    } catch (error) {
      // Token invalid, fall through to session check
    }
  }

  // Check session authentication
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }

  return res.status(401).json({ error: "Authentication required." });
};

// Middleware to check if user is admin
export const requireAdmin = async (req, res, next) => {
  await requireAuth(req, res, () => {
    if (req.user && req.user.role === "admin") {
      next();
    } else {
      res.status(403).json({ error: "Admin access required." });
    }
  });
};

// Middleware to check if user owns the device
export const requireDeviceOwnership = async (req, res, next) => {
  await requireAuth(req, res, async () => {
    try {
      const Device = (await import("../models/Device.js")).default;
      const device = await Device.findBySerialNumber(req.params.serialNumber);

      if (!device) {
        return res.status(404).json({ error: "Device not found." });
      }

      // Check ownership - handle null owner (unlinked devices)
      const isOwner = device.owner && device.owner.equals(req.user._id);
      const isAdmin = req.user.role === "admin";

      if (!isOwner && !isAdmin) {
        return res
          .status(403)
          .json({ error: "Access denied. You do not own this device." });
      }

      req.device = device;
      next();
    } catch (error) {
      console.error("Error in requireDeviceOwnership middleware:", error);
      res.status(500).json({ error: "Error checking device ownership." });
    }
  });
};

// Optional authentication middleware (doesn't require auth)
export const optionalAuth = async (req, res, next) => {
  const token =
    req.header("Authorization")?.replace("Bearer ", "") || req.cookies?.token;

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).populate("devices");
      if (user && user.isActive) {
        req.user = user;
      }
    } catch (error) {
      // Token invalid, continue without user
    }
  } else if (req.isAuthenticated && req.isAuthenticated()) {
    // User is authenticated via session
    req.user = req.user;
  }

  next();
};

export default passport;
