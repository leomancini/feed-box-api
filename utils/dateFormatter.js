// Central date formatting utility with timezone support

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Cache for config to avoid reading file repeatedly
let configCache = null;

/**
 * Get the configured timezone from config.json
 * @returns {string} The timezone string (e.g., "America/New_York")
 */
function getConfiguredTimezone() {
  if (!configCache) {
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const configPath = join(__dirname, "..", "config.json");
      const configData = readFileSync(configPath, "utf8");
      configCache = JSON.parse(configData);
    } catch (error) {
      console.warn(
        "Failed to read config.json, using default timezone:",
        error.message
      );
      configCache = { timezone: "America/New_York" }; // Default fallback
    }
  }

  return configCache.timezone || "America/New_York";
}

/**
 * Format a date with timezone support using the configured timezone
 * @param {Date|string|number} date - The date to format (Date object, ISO string, or timestamp)
 * @param {Object} options - Formatting options
 * @param {boolean} options.includeTime - Whether to include time in the output (default: true)
 * @param {string} options.timezone - Override the configured timezone for this call
 * @returns {string} Formatted date string
 */
export function formatDate(date, options = {}) {
  const { includeTime = true, timezone = getConfiguredTimezone() } = options;

  let dateObj;

  // Handle different input types
  if (date instanceof Date) {
    dateObj = date;
  } else if (typeof date === "string" || typeof date === "number") {
    dateObj = new Date(date);
  } else {
    dateObj = new Date(); // Fallback to current date
  }

  // Check if date is valid
  if (isNaN(dateObj.getTime())) {
    console.warn("Invalid date provided to formatDate, using current date");
    dateObj = new Date();
  }

  try {
    // Format date part
    const dateString = dateObj.toLocaleDateString("en-US", {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
      timeZone: timezone
    });

    if (!includeTime) {
      return dateString;
    }

    // Format time part
    const timeString = dateObj.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: timezone
    });

    return `${dateString} ${timeString}`;
  } catch (error) {
    console.warn(
      "Error formatting date with timezone, falling back to local time:",
      error.message
    );

    // Fallback to the original formatting without timezone
    const dateString = dateObj.toLocaleDateString("en-US", {
      month: "2-digit",
      day: "2-digit",
      year: "numeric"
    });

    if (!includeTime) {
      return dateString;
    }

    const timeString = dateObj.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });

    return `${dateString} ${timeString}`;
  }
}

/**
 * Format the current date/time with timezone support
 * @param {Object} options - Formatting options (same as formatDate)
 * @returns {string} Formatted current date string
 */
export function formatNow(options = {}) {
  return formatDate(new Date(), options);
}

/**
 * Clear the config cache (useful for testing or config changes)
 */
export function clearConfigCache() {
  configCache = null;
}
