#!/usr/bin/env node

/**
 * Simple debug script to test Config collection specifically
 */

import { mongoose } from "../utils/database.js";
import Config from "../models/Config.js";

async function debugConfigCollection() {
  try {
    console.log("🔍 Testing Config collection specifically...");
    
    // Test basic connection first
    console.log("📡 Database connection state:", mongoose.connection.readyState);
    
    // Test a simple count first (fastest query)
    console.log("\n1. Testing Config.countDocuments()...");
    const count = await Config.countDocuments();
    console.log(`✅ Config collection has ${count} documents`);
    
    // Test finding one config
    console.log("\n2. Testing Config.findOne()...");
    const oneConfig = await Config.findOne().lean();
    console.log(`✅ Found config:`, oneConfig?.key);
    
    // Test the specific query that's failing
    console.log("\n3. Testing Config.find({active: true})...");
    const activeConfigs = await Config.find({ active: true }).lean();
    console.log(`✅ Found ${activeConfigs.length} active configs`);
    
    // Test getGlobalConfig method
    console.log("\n4. Testing Config.getGlobalConfig()...");
    const globalConfig = await Config.getGlobalConfig();
    console.log(`✅ Global config keys:`, Object.keys(globalConfig));
    
    // Check if cache structure exists
    if (globalConfig.cache && globalConfig.cache.refreshMinutes) {
      console.log("✅ Cache refreshMinutes structure exists:", Object.keys(globalConfig.cache.refreshMinutes));
    } else {
      console.log("❌ Cache refreshMinutes structure missing");
      console.log("Available top-level keys:", Object.keys(globalConfig));
    }
    
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error("Stack:", error.stack);
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log("\n🔌 Database connection closed.");
    }
  }
}

// Run with timeout
const timeoutId = setTimeout(() => {
  console.log("❌ Debug script timed out after 30 seconds");
  process.exit(1);
}, 30000);

debugConfigCollection().finally(() => {
  clearTimeout(timeoutId);
});
