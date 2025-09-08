#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");

async function setupProject() {
  console.log("🚀 Setting up Feed Box API with MongoDB and Google Auth...\n");

  try {
    // Check if .env file exists
    const envPath = path.join(projectRoot, ".env");
    const envExamplePath = path.join(projectRoot, "config", "env.example");

    try {
      await fs.access(envPath);
      console.log("✅ .env file already exists");
    } catch {
      // Copy env.example to .env
      try {
        const envExample = await fs.readFile(envExamplePath, "utf8");
        await fs.writeFile(envPath, envExample);
        console.log("📋 Created .env file from config/env.example");
        console.log("⚠️  Please update .env file with your actual values");
      } catch (error) {
        console.log(
          "⚠️  Could not create .env file. Please create it manually from config/env.example"
        );
      }
    }

    console.log("\n📝 Setup checklist:");
    console.log("");
    console.log("1. 📦 Install dependencies:");
    console.log("   npm install");
    console.log("");
    console.log("2. 🗄️  Set up MongoDB:");
    console.log("   - Install MongoDB locally OR use MongoDB Atlas");
    console.log("   - Update MONGODB_URI in .env file");
    console.log("");
    console.log("3. 🔑 Set up Google OAuth:");
    console.log("   - Go to https://console.developers.google.com/");
    console.log("   - Create a new project or select existing one");
    console.log("   - Enable Google+ API");
    console.log("   - Create OAuth 2.0 credentials");
    console.log(
      "   - Add authorized redirect URI: http://localhost:3115/auth/google/callback"
    );
    console.log(
      "   - Update GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env"
    );
    console.log("");
    console.log("4. 🔐 Update secrets in .env file:");
    console.log("   - SESSION_SECRET: Generate a random string");
    console.log("   - JWT_SECRET: Generate a random string");
    console.log("");
    console.log("5. 🔄 Migrate existing data:");
    console.log("   npm run migrate         # Migrate devices");
    console.log("   npm run migrate-config  # Migrate configuration");
    console.log("");
    console.log("6. 🚀 Start the server:");
    console.log("   npm run dev");
    console.log("");
    console.log("🌟 New API endpoints:");
    console.log("   Auth:");
    console.log("   - GET  /auth/google           - Start Google OAuth");
    console.log("   - GET  /auth/me               - Get current user");
    console.log("   - POST /auth/logout           - Logout");
    console.log("   - GET  /auth/status           - Check auth status");
    console.log("");
    console.log("   Devices:");
    console.log("   - GET  /api/devices           - Get user devices");
    console.log("   - POST /api/devices           - Create device");
    console.log("   - GET  /api/devices/:serial   - Get device details");
    console.log("   - PUT  /api/devices/:serial   - Update device");
    console.log("   - DELETE /api/devices/:serial - Delete device");
    console.log("");
    console.log("   Configuration:");
    console.log("   - GET  /api/config            - Get current config");
    console.log("   - PUT  /api/config/admin/:key - Update config (admin)");
    console.log(
      "   - POST /api/config/admin/reset - Reset to defaults (admin)"
    );
    console.log("");
    console.log("   Legacy (still works):");
    console.log("   - GET  /source/:name          - Get source data");
    console.log("   - GET  /device/:serial        - Get device screens");
    console.log("");
    console.log("✨ The existing device endpoints will continue to work");
    console.log("   but will now use MongoDB instead of the JSON file.");
  } catch (error) {
    console.error("❌ Setup failed:", error.message);
    process.exit(1);
  }
}

setupProject();
