import { parseString } from "xml2js";
import { promisify } from "util";
import { formatDate, formatNow } from "../utils/dateFormatter.js";

const parseStringAsync = promisify(parseString);

// Function to fetch and parse NYT RSS feed
export async function fetchNYTHeadlines(deviceTimezone = "UTC") {
  try {
    const response = await fetch(
      "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const xmlData = await response.text();

    try {
      const result = await parseStringAsync(xmlData);

      // Extract headlines from RSS feed
      const items = result.rss?.channel?.[0]?.item || [];

      const headlinePromises = items.map(async (item) => {
        const title = item.title?.[0] || "";
        const pubDate = item.pubDate?.[0] || "";

        // Parse the publication date and format it
        let articleDateTime = "";
        if (pubDate) {
          try {
            const date = new Date(pubDate);
            // Always use device timezone for device feeds
            const formatOptions = { timezone: deviceTimezone };
            articleDateTime = await formatDate(date, formatOptions);
          } catch (error) {
            // Fallback to current date if parsing fails
            // Always use device timezone for device feeds
            const formatOptions = { timezone: deviceTimezone };
            articleDateTime = await formatNow(formatOptions);
          }
        }

        // Clean up any HTML entities or extra whitespace
        const cleanTitle = title
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\s+/g, " ")
          .trim();

        // Add date/time prefix to each headline
        if (cleanTitle && articleDateTime) {
          return `${articleDateTime} - ${cleanTitle}`;
        }
        return null;
      });

      const headlines = await Promise.all(headlinePromises);
      return headlines.filter((headline) => headline && headline.length > 0);
    } catch (parseError) {
      throw new Error(`Error extracting headlines: ${parseError.message}`);
    }
  } catch (error) {
    throw new Error(`Failed to fetch NYT headlines: ${error.message}`);
  }
}
