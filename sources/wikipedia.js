// Fetch Wikipedia featured article data and return concise strings for display

import { formatDate } from "../utils/dateFormatter.js";

/**
 * Fetch Wikipedia featured content for a given type and format as strings
 * Currently supports "today-featured-article" via Wikipedia's featured feed API.
 * @param {string} type - Content type, e.g., "today-featured-article"
 * @returns {Promise<string[]>}
 */
export async function fetchWikipediaContent(
  type = "today-featured-article",
  deviceTimezone = "UTC"
) {
  const { apiPath, label } = resolveContentType(type);

  // Use today's date for the API call
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  const url = `https://en.wikipedia.org/api/rest_v1/feed/featured/${year}/${month}/${day}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    let lines = [];

    if (type === "today-featured-article" && data.tfa) {
      // Create the article date from the URL parameters (the featured date)
      const articleDate = new Date(year, month - 1, day);
      lines = await formatFeaturedArticle(
        data.tfa,
        articleDate,
        deviceTimezone
      );
    }

    // Fallback if no content
    if (lines.length === 0) {
      return [`${label} - No content found`];
    }

    return lines;
  } catch (error) {
    throw new Error(`Failed to fetch ${label}: ${error.message}`);
  }
}

function resolveContentType(type) {
  const normalized = String(type || "").toLowerCase();
  switch (normalized) {
    case "today-featured-article":
    default:
      return {
        apiPath: "featured",
        label: "Wikipedia Today's Featured Article"
      };
  }
}

async function formatFeaturedArticle(tfa, articleDate, deviceTimezone = "UTC") {
  try {
    const rawTitle = tfa.displaytitle || tfa.title || "Unknown Article";
    // Clean HTML tags and entities from title
    const title = cleanHtmlAndEntities(rawTitle);
    const extract = tfa.extract || "";

    // Format the article date (date only, no time) - always use device timezone
    const formatOptions = {
      includeTime: false,
      timezone: deviceTimezone
    };
    const articleDateTime = await formatDate(articleDate, formatOptions);

    const lines = [];

    // Add title with single date
    lines.push(`${articleDateTime} - Featured Wikipedia Article: ${title}`);

    // Split the extract into smaller chunks for better display
    if (extract) {
      const sentences = extract.split(/(?<=[.!?])\s+/);
      let currentChunk = "";

      for (const sentence of sentences) {
        // If adding this sentence would make the chunk too long, start a new chunk
        if (currentChunk && (currentChunk + " " + sentence).length > 200) {
          lines.push(currentChunk.trim());
          currentChunk = sentence;
        } else {
          currentChunk = currentChunk
            ? currentChunk + " " + sentence
            : sentence;
        }
      }

      // Add the last chunk if it exists
      if (currentChunk.trim()) {
        lines.push(currentChunk.trim());
      }
    }

    return lines;
  } catch (error) {
    return [`Error formatting featured article: ${error.message}`];
  }
}

function cleanHtmlAndEntities(text) {
  return (
    text
      // Remove HTML tags
      .replace(/<[^>]*>/g, "")
      // Clean up HTML entities
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      // Clean up extra whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}
