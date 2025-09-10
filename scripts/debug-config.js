#!/usr/bin/env node

/**
 * Debug script to check how getGlobalConfig is working
 */

import { mongoose } from "../utils/database.js";
import Config from "../models/Config.js";

async function debugConfig() {
  try {
    console.log("🔍 Debugging configuration structure...");
    
    // Get all active configs from database
    const rawConfigs = await Config.find({ isActive: true });
    console.log("\n📋 Raw configs from database:");
    rawConfigs.forEach(config => {
      console.log(`   ${config.key}: ${JSON.stringify(config.value)}`);
    });
    
    // Get the global config structure
    console.log("\n🏗️  Built global config structure:");
    const globalConfig = await Config.getGlobalConfig();
    console.log(JSON.stringify(globalConfig, null, 2));
    
    // Test specific cache structure
    console.log("\n🔍 Cache structure test:");
    console.log("globalConfig.cache:", globalConfig.cache);
    console.log("globalConfig.cache?.refreshMinutes:", globalConfig.cache?.refreshMinutes);
    
    if (globalConfig.cache && globalConfig.cache.refreshMinutes) {
      console.log("✅ Cache refreshMinutes structure exists");
      Object.keys(globalConfig.cache.refreshMinutes).forEach(source => {
        console.log(`   ${source}: ${globalConfig.cache.refreshMinutes[source]}`);
      });
    } else {
      console.log("❌ Cache refreshMinutes structure is missing");
    }
    
    // Test getSourceTTL function
    console.log("\n🧪 Testing getSourceTTL function:");
    const { getSourceTTL } = await import("../utils/sourceUtils.js");
    
    const testSources = ['headlines', 'sports', 'wikipedia', 'sample'];
    testSources.forEach(source => {
      try {
        const ttl = getSourceTTL(source, globalConfig);
        console.log(`✅ ${source}: ${ttl}ms (${ttl/60000}min)`);
      } catch (error) {
        console.log(`❌ ${source}: Error - ${error.message}`);
      }
    });
    
  } catch (error) {
    console.error("❌ Debug failed:", error.message);
    console.error("Stack:", error.stack);
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log("\n🔌 Database connection closed.");
    }
  }
}

// Run the debug
debugConfig();
