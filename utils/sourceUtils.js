/**
 * Source-related utility functions
 */

/**
 * Get TTL (Time To Live) for a specific source in milliseconds
 * @param {string} source - The source name (e.g., 'headlines', 'sports', etc.)
 * @param {Object} config - Global configuration object containing cache settings
 * @returns {number} TTL in milliseconds
 */
export function getSourceTTL(source, config) {
  const ttlMinutes =
    config.cache.refreshMinutes[source] || config.cache.refreshMinutes.default;
  return ttlMinutes * 60 * 1000; // Convert minutes to milliseconds
}

/**
 * Get all available source names
 * @param {Object} sourceHandlers - Object containing all source handlers
 * @returns {string[]} Array of available source names
 */
export function getAvailableSources(sourceHandlers) {
  return Object.keys(sourceHandlers);
}

/**
 * Check if a source is valid/available
 * @param {string} source - The source name to check
 * @param {Object} sourceHandlers - Object containing all source handlers
 * @returns {boolean} True if source is available
 */
export function isValidSource(source, sourceHandlers) {
  return source in sourceHandlers;
}
