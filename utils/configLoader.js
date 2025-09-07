import { promises as fs } from "fs";
import path from "path";

/**
 * Generic configuration loader utility
 * @param {string} configPath - Path to the config file (relative to project root)
 * @param {Object} options - Configuration options
 * @param {boolean} options.required - Whether the config file is required (default: true)
 * @param {string} options.description - Description for error messages
 * @returns {Promise<Object>} Parsed configuration object
 */
export async function loadConfig(configPath, options = {}) {
  const { required = true, description = `configuration from ${configPath}` } =
    options;

  try {
    const fullPath = path.resolve(configPath);
    const configData = await fs.readFile(fullPath, "utf8");
    const config = JSON.parse(configData);

    console.log(`✅ Successfully loaded ${description}`);
    return config;
  } catch (error) {
    const errorMsg = `❌ Failed to load ${description}: ${error.message}`;
    console.error(errorMsg);

    if (required) {
      console.error(
        `Server cannot start without ${description}. Please ensure ${configPath} exists and contains valid JSON.`
      );
      process.exit(1);
    }

    return null;
  }
}

/**
 * Load all application config files in parallel
 * @returns {Promise<Object>} Object with loaded configurations: { global, devices }
 */
export async function loadConfigs() {
  const configSpecs = [
    {
      path: "config/global.json",
      key: "global",
      options: { description: "global configuration" }
    },
    {
      path: "config/devices.json",
      key: "devices",
      options: { description: "devices configuration" }
    }
  ];

  const loadPromises = configSpecs.map(async ({ path, key, options = {} }) => {
    const config = await loadConfig(path, options);
    return { key, config };
  });

  const results = await Promise.all(loadPromises);

  // Convert array of results to object
  const configObject = {};
  results.forEach(({ key, config }) => {
    configObject[key] = config;
  });

  return configObject;
}
