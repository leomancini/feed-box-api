import { parseString } from "xml2js";

// Function to fetch and parse NYT RSS feed
export async function fetchNYTHeadlines() {
  try {
    const response = await fetch(
      "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"
    );

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
          // Extract headlines from RSS feed
          const items = result.rss?.channel?.[0]?.item || [];

          const headlines = items
            .map((item) => {
              const title = item.title?.[0] || "";
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
              const cleanTitle = title
                .replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .trim();

              // Add date/time prefix to each headline
              if (cleanTitle && articleDateTime) {
                return `${articleDateTime} - ${cleanTitle}`;
              }
              return null;
            })
            .filter((headline) => headline && headline.length > 0);

          resolve(headlines);
        } catch (parseError) {
          reject(
            new Error(`Error extracting headlines: ${parseError.message}`)
          );
        }
      });
    });
  } catch (error) {
    throw new Error(`Failed to fetch NYT headlines: ${error.message}`);
  }
}
