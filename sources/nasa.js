import { parseString } from "xml2js";

// Function to fetch and parse NASA RSS feed
export async function fetchNASANews() {
  try {
    const response = await fetch("https://www.nasa.gov/news-release/feed/");

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const xmlData = await response.text();

    return new Promise((resolve, reject) => {
      parseString(xmlData, (err, result) => {
        if (err) {
          reject(new Error(`XML parsing error: ${err.message}`));
          return;
        }

        try {
          // Extract news items from RSS feed
          const items = result.rss?.channel?.[0]?.item || [];

          const newsItems = items
            .map((item) => {
              const title = item.title?.[0] || "";
              const description = item.description?.[0] || "";
              const pubDate = item.pubDate?.[0] || "";

              // Parse the publication date and format it
              let articleDateTime = "";
              if (pubDate) {
                try {
                  const date = new Date(pubDate);
                  articleDateTime =
                    date.toLocaleDateString("en-US", {
                      month: "2-digit",
                      day: "2-digit",
                      year: "numeric"
                    }) +
                    " " +
                    date.toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true
                    });
                } catch (error) {
                  // Fallback to current date if parsing fails
                  const now = new Date();
                  articleDateTime =
                    now.toLocaleDateString("en-US", {
                      month: "2-digit",
                      day: "2-digit",
                      year: "numeric"
                    }) +
                    " " +
                    now.toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true
                    });
                }
              }

              // Clean up any HTML entities or extra whitespace
              const cleanTitle = cleanHtmlAndEntities(title);
              const cleanDescription = cleanHtmlAndEntities(description);

              const lines = [];

              // Add title with timestamp
              if (cleanTitle && articleDateTime) {
                lines.push(`${articleDateTime} - ${cleanTitle}`);
              }

              // Add description if available and different from title
              if (
                cleanDescription &&
                cleanDescription !== cleanTitle &&
                articleDateTime
              ) {
                // Split long descriptions into chunks
                const chunks = splitIntoChunks(cleanDescription, 200);
                const timestampedChunks = chunks.map(
                  (chunk) => `${articleDateTime} - ${chunk}`
                );
                lines.push(...timestampedChunks);
              }

              return lines;
            })
            .flat()
            .filter((line) => line && line.length > 0);

          resolve(newsItems);
        } catch (parseError) {
          reject(
            new Error(`Error extracting NASA news: ${parseError.message}`)
          );
        }
      });
    });
  } catch (error) {
    throw new Error(`Failed to fetch NASA news: ${error.message}`);
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
      .replace(/&mdash;/g, "—")
      .replace(/&ndash;/g, "–")
      .replace(/&#8230;/g, "...")
      .replace(/&#\d+;/g, "")
      // Clean up extra whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}

function splitIntoChunks(text, maxLength) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    // If adding this sentence would make the chunk too long, start a new chunk
    if (currentChunk && (currentChunk + " " + sentence).length > maxLength) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk = currentChunk ? currentChunk + " " + sentence : sentence;
    }
  }

  // Add the last chunk if it exists
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
