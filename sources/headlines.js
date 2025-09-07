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
          const now = new Date();
          const currentDateTime =
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

          const headlines = items
            .map((item) => {
              const title = item.title?.[0] || "";
              // Clean up any HTML entities or extra whitespace
              const cleanTitle = title
                .replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .trim();

              // Add date/time prefix to each headline
              return `${currentDateTime} - ${cleanTitle}`;
            })
            .filter((headline) => headline.length > 0);

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
