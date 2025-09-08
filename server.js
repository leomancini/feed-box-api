import express from "express";
import session from "express-session";
import cors from "cors";
import dotenv from "dotenv";
import database from "./utils/database.js";
import passport from "./utils/auth.js";
import authRoutes from "./routes/auth.js";
import deviceRoutes from "./routes/devices.js";
import configRoutes from "./routes/config.js";
import sourcesRoutes from "./routes/sources.js";
import usersRoutes from "./routes/users.js";
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
const port = process.env.PORT;

// CORS configuration
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
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
    secret: process.env.SESSION_SECRET,
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
app.use("/devices", deviceRoutes);
app.use("/config", configRoutes);
app.use("/sources", sourcesRoutes);
app.use("/users", usersRoutes);

app.listen(port, () => {
  console.log(`✅ API started at port ${port}`);
});
