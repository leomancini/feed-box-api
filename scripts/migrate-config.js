import fs from "fs/promises";
import path from "path";
import database from "../utils/database.js";
import Config from "../models/Config.js";

async function migrateConfiguration() {
  try {
    console.log("🚀 Starting configuration migration...");

    // Connect to database
    await database.connect();

    // Check for existing global.json (may have been deleted after migration)
    const configPath = path.resolve("config/global.json");
    let jsonConfig = {};
    let hasJsonFile = false;

    try {
      const configData = await fs.readFile(configPath, "utf8");
      jsonConfig = JSON.parse(configData);
      hasJsonFile = true;
      console.log("📋 Found existing global.json configuration");
    } catch (error) {
      console.log("⚠️  No global.json found, using default configuration");
      console.log(
        "   (This is normal if JSON config has been migrated and deleted)"
      );
    }

    // Define configuration mappings with metadata
    const configMappings = [
      {
        key: "screens.maxCharacters",
        value: jsonConfig.screens?.maxCharacters || 20,
        description: "Maximum characters per screen",
        category: "screens",
        validation: { type: "number", min: 1, max: 100 }
      },
      {
        key: "screens.maxStrings",
        value: jsonConfig.screens?.maxStrings || 20,
        description: "Maximum strings per screen",
        category: "screens",
        validation: { type: "number", min: 1, max: 50 }
      },
      {
        key: "cache.refreshMinutes.default",
        value: jsonConfig.cache?.refreshMinutes?.default || 10,
        description: "Default cache refresh interval in minutes",
        category: "cache",
        validation: { type: "number", min: 1, max: 1440 }
      },
      {
        key: "cache.refreshMinutes.sample",
        value: jsonConfig.cache?.refreshMinutes?.sample || 5,
        description: "Sample source cache refresh interval",
        category: "cache",
        validation: { type: "number", min: 1, max: 1440 }
      },
      {
        key: "cache.refreshMinutes.headlines",
        value: jsonConfig.cache?.refreshMinutes?.headlines || 15,
        description: "Headlines source cache refresh interval",
        category: "cache",
        validation: { type: "number", min: 1, max: 1440 }
      },
      {
        key: "cache.refreshMinutes.sports",
        value: jsonConfig.cache?.refreshMinutes?.sports || 2,
        description: "Sports source cache refresh interval",
        category: "cache",
        validation: { type: "number", min: 1, max: 1440 }
      },
      {
        key: "cache.refreshMinutes.wikipedia",
        value: jsonConfig.cache?.refreshMinutes?.wikipedia || 60,
        description: "Wikipedia source cache refresh interval",
        category: "cache",
        validation: { type: "number", min: 1, max: 1440 }
      },
      {
        key: "timezone",
        value: jsonConfig.timezone || "America/New_York",
        description: "Default timezone for the application",
        category: "general",
        validation: { type: "string" }
      }
    ];

    let migratedCount = 0;
    let skippedCount = 0;

    console.log(`📝 Migrating ${configMappings.length} configuration items...`);

    for (const configData of configMappings) {
      try {
        // Check if config already exists
        const existingConfig = await Config.getByKey(configData.key);

        if (existingConfig) {
          console.log(`⏭️  Config ${configData.key} already exists, skipping`);
          skippedCount++;
          continue;
        }

        // Create new configuration
        const config = await Config.setConfig(
          configData.key,
          configData.value,
          {
            description: configData.description,
            category: configData.category,
            validation: configData.validation
          }
        );

        console.log(
          `✅ Migrated: ${configData.key} = ${JSON.stringify(configData.value)}`
        );
        migratedCount++;
      } catch (error) {
        console.error(
          `❌ Error migrating config ${configData.key}:`,
          error.message
        );
      }
    }

    console.log("\n📊 Migration Summary:");
    console.log(`✅ Successfully migrated: ${migratedCount} configurations`);
    console.log(`⏭️  Skipped (already exist): ${skippedCount} configurations`);

    // Test the global config retrieval
    console.log("\n🧪 Testing global config retrieval...");
    const globalConfig = await Config.getGlobalConfig();
    console.log(
      "Global config structure:",
      JSON.stringify(globalConfig, null, 2)
    );

    if (migratedCount > 0 && hasJsonFile) {
      console.log("\n🔄 Creating backup of original global.json...");
      const backupPath = `config/global.json.backup.${Date.now()}`;
      try {
        await fs.copyFile(configPath, backupPath);
        console.log(`💾 Backup created: ${backupPath}`);
        console.log(
          "💡 You can now safely delete the original global.json file"
        );
      } catch (error) {
        console.log("⚠️  Could not create backup (file may not exist)");
      }
    } else if (migratedCount > 0) {
      console.log("📄 No JSON file to backup (already migrated and deleted)");
    }

    console.log("\n🎉 Configuration migration completed successfully!");
    console.log("\n📝 Next steps:");
    console.log("1. Update server.js to load config from MongoDB");
    console.log("2. Test the application with the new config system");
    console.log("3. Use the admin API endpoints to manage configuration");
  } catch (error) {
    console.error("❌ Configuration migration failed:", error);
    process.exit(1);
  } finally {
    await database.disconnect();
  }
}

// Helper function to flatten nested object for migration
function flattenObject(obj, prefix = "") {
  const flattened = {};

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const newKey = prefix ? `${prefix}.${key}` : key;

      if (
        typeof obj[key] === "object" &&
        obj[key] !== null &&
        !Array.isArray(obj[key])
      ) {
        Object.assign(flattened, flattenObject(obj[key], newKey));
      } else {
        flattened[newKey] = obj[key];
      }
    }
  }

  return flattened;
}

// Run migration if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateConfiguration().catch(console.error);
}

export default migrateConfiguration;
