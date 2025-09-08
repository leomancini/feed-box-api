// Central date formatting utility with timezone support

import Config from "../models/Config.js";

// Cache for config to avoid reading database repeatedly
let timezoneCache = null;
let cacheExpiry = null;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get the configured timezone from the database
 * @returns {Promise<string>} The timezone string (e.g., "America/New_York")
 */
async function getConfiguredTimezone() {
  const now = Date.now();

  // Return cached value if still valid
  if (timezoneCache && cacheExpiry && now < cacheExpiry) {
    return timezoneCache;
  }

  try {
    const config = await Config.getByKey("timezone");
    timezoneCache = config?.value || "America/New_York";
    cacheExpiry = now + CACHE_DURATION_MS;
    return timezoneCache;
  } catch (error) {
    console.warn(
      "Failed to load timezone from database, using default:",
      error.message
    );
    // Use cached value if available, otherwise use default
    timezoneCache = timezoneCache || "America/New_York";
    cacheExpiry = now + CACHE_DURATION_MS;
    return timezoneCache;
  }
}

/**
 * Format a date with timezone support using the configured timezone
 * @param {Date|string|number} date - The date to format (Date object, ISO string, or timestamp)
 * @param {Object} options - Formatting options
 * @param {boolean} options.includeTime - Whether to include time in the output (default: true)
 * @param {string} options.timezone - Timezone to use (if not provided, will query database)
 * @returns {Promise<string>} Formatted date string
 */
export async function formatDate(date, options = {}) {
  const {
    includeTime = true,
    timezone = options.timezone || (await getConfiguredTimezone())
  } = options;

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
 * @param {string} options.timezone - Timezone to use (if not provided, will query database)
 * @returns {Promise<string>} Formatted current date string
 */
export async function formatNow(options = {}) {
  return await formatDate(new Date(), options);
}

/**
 * Clear the timezone cache (useful for testing or config changes)
 */
export function clearTimezoneCache() {
  timezoneCache = null;
  cacheExpiry = null;
}
