import fs from "fs/promises";
import path from "path";
import database from "../utils/database.js";
import User from "../models/User.js";
import Device from "../models/Device.js";

async function migrateDevices() {
  try {
    console.log("🚀 Starting device migration...");

    // Connect to database
    await database.connect();

    // Read existing devices.json (may have been deleted after migration)
    const devicesPath = path.resolve("config/devices.json");
    let devices = [];
    let hasJsonFile = false;

    try {
      const devicesData = await fs.readFile(devicesPath, "utf8");
      const parsed = JSON.parse(devicesData);
      devices = parsed.devices || [];
      hasJsonFile = true;
      console.log(`📋 Found ${devices.length} devices to migrate`);
    } catch (error) {
      console.log("⚠️  No devices.json found");
      console.log(
        "   (This is normal if devices have been migrated and JSON file deleted)"
      );
      console.log("   Checking for existing devices in database...");

      const existingDevices = await Device.find({});
      if (existingDevices.length > 0) {
        console.log(
          `📋 Found ${existingDevices.length} devices already in database`
        );
        console.log("✅ Migration appears to be complete");
        return;
      } else {
        console.log("⚠️  No devices found in database or JSON file");
        return;
      }
    }

    // Create a default admin user for existing devices
    let adminUser = await User.findOne({ email: "admin@feedbox.local" });

    if (!adminUser) {
      adminUser = new User({
        email: "admin@feedbox.local",
        name: "System Administrator",
        role: "admin",
        isActive: true
      });
      await adminUser.save();
      console.log("👤 Created default admin user");
    }

    let migratedCount = 0;
    let skippedCount = 0;

    for (const deviceData of devices) {
      try {
        // Check if device already exists
        const existingDevice = await Device.findBySerialNumber(
          deviceData.serialNumber
        );

        if (existingDevice) {
          console.log(
            `⏭️  Device ${deviceData.serialNumber} already exists, skipping`
          );
          skippedCount++;
          continue;
        }

        // Create new device
        const device = new Device({
          serialNumber: deviceData.serialNumber,
          name: `Device ${deviceData.serialNumber}`,
          source: deviceData.source,
          timezone: deviceData.timezone,
          owner: adminUser._id,
          isActive: true
        });

        await device.save();

        // Add device to admin user's devices array
        await adminUser.addDevice(device._id);

        console.log(
          `✅ Migrated device: ${deviceData.serialNumber} (${deviceData.source})`
        );
        migratedCount++;
      } catch (error) {
        console.error(
          `❌ Error migrating device ${deviceData.serialNumber}:`,
          error.message
        );
      }
    }

    console.log("\n📊 Migration Summary:");
    console.log(`✅ Successfully migrated: ${migratedCount} devices`);
    console.log(`⏭️  Skipped (already exist): ${skippedCount} devices`);
    console.log(`👤 Admin user: ${adminUser.email}`);

    if (migratedCount > 0 && hasJsonFile) {
      console.log("\n🔄 Creating backup of original devices.json...");
      const backupPath = `config/devices.json.backup.${Date.now()}`;
      try {
        await fs.copyFile(devicesPath, backupPath);
        console.log(`💾 Backup created: ${backupPath}`);
        console.log(
          "💡 You can now safely delete the original devices.json file"
        );
      } catch (error) {
        console.log("⚠️  Could not create backup (file may not exist)");
      }
    } else if (migratedCount > 0) {
      console.log("📄 No JSON file to backup (already migrated and deleted)");
    }

    console.log("\n🎉 Migration completed successfully!");
    console.log("\n📝 Next steps:");
    console.log("1. Update your .env file with database and OAuth credentials");
    console.log("2. The admin user can create new accounts and manage devices");
    console.log("3. Consider updating server.js to use the new MongoDB system");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  } finally {
    await database.disconnect();
  }
}

// Run migration if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateDevices().catch(console.error);
}

export default migrateDevices;
