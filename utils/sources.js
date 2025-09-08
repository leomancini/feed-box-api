import { fetchNYTHeadlines } from "../sources/headlines.js";
import { sampleStrings } from "../sources/samples.js";
import { fetchSportsScoreboard } from "../sources/sports.js";
import { fetchWikipediaContent } from "../sources/wikipedia.js";

export const sourceHandlers = {
  sample: async () => sampleStrings,
  headlines: async (deviceTimezone) => await fetchNYTHeadlines(deviceTimezone),
  sports: async (req, deviceTimezone) => {
    const league = (req.query.league || "mlb").toLowerCase();
    return await fetchSportsScoreboard(league, deviceTimezone);
  },
  wikipedia: async (req, deviceTimezone) => {
    const type = (req.query.type || "today-featured-article").toLowerCase();
    return await fetchWikipediaContent(type, deviceTimezone);
  }
};
