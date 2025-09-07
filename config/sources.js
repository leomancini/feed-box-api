import { fetchNYTHeadlines } from "../sources/headlines.js";
import { sampleStrings } from "../sources/samples.js";
import { fetchSportsScoreboard } from "../sources/sports.js";
import { fetchWikipediaContent } from "../sources/wikipedia.js";
import { fetchNASANews } from "../sources/nasa.js";

export const sourceHandlers = {
  sample: async () => sampleStrings,
  headlines: async (req) => await fetchNYTHeadlines(req),
  sports: async (req) => {
    const league = (req.query.league || "mlb").toLowerCase();
    return await fetchSportsScoreboard(league, req);
  },
  wikipedia: async (req) => {
    const type = (req.query.type || "today-featured-article").toLowerCase();
    return await fetchWikipediaContent(type, req);
  },
  nasa: async (req) => await fetchNASANews(req)
};
