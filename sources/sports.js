// Fetch ESPN scoreboard data and return concise strings for display

import { formatDate, formatNow } from "../utils/dateFormatter.js";

/**
 * Fetch scoreboard data for a given league and format as strings
 * Currently supports MLB via ESPN public API.
 * @param {string} league - League identifier, e.g., "mlb"
 * @returns {Promise<string[]>}
 */
export async function fetchSportsScoreboard(
  league = "mlb",
  deviceTimezone = "UTC"
) {
  const { sportPath, leaguePath, label } = resolveLeaguePaths(league);

  const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/${leaguePath}/scoreboard`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const events = Array.isArray(data?.events) ? data.events : [];

    const linePromises = events
      .map(async (event) => await formatEventLine(event, deviceTimezone))
      .filter(Boolean);

    const lines = await Promise.all(linePromises);

    // Fallback if no events
    if (lines.length === 0) {
      // Always use device timezone for device feeds
      const formatOptions = { timezone: deviceTimezone };
      const currentDateTime = await formatNow(formatOptions);
      return [`${currentDateTime} - ${label} - No games found`];
    }

    return lines;
  } catch (error) {
    throw new Error(`Failed to fetch ${label} scoreboard: ${error.message}`);
  }
}

function resolveLeaguePaths(league) {
  const normalized = String(league || "").toLowerCase();
  switch (normalized) {
    case "mlb":
    default:
      return { sportPath: "baseball", leaguePath: "mlb", label: "MLB" };
  }
}

async function formatEventLine(event, deviceTimezone = "UTC") {
  try {
    const eventName = event?.name || ""; // e.g., "Toronto Blue Jays at New York Yankees"
    const status =
      event?.status?.type?.detail || event?.status?.type?.description || "";

    // Use event date instead of current date
    const eventDate = event?.date ? new Date(event.date) : new Date();
    // Always use device timezone for device feeds
    const formatOptions = { timezone: deviceTimezone };
    const eventDateTime = await formatDate(eventDate, formatOptions);

    // Extract scores and team details if present
    const comp = Array.isArray(event?.competitions)
      ? event.competitions[0]
      : null;
    const competitors = Array.isArray(comp?.competitors)
      ? comp.competitors
      : [];

    const away = competitors.find((c) => c.homeAway === "away");
    const home = competitors.find((c) => c.homeAway === "home");

    // Use full team names instead of abbreviations
    const awayName = away?.team?.displayName || away?.team?.name || "";
    const homeName = home?.team?.displayName || home?.team?.name || "";
    const awayScore =
      typeof away?.score === "string"
        ? away.score
        : away?.score?.toString?.() || "";
    const homeScore =
      typeof home?.score === "string"
        ? home.score
        : home?.score?.toString?.() || "";

    const hasScores = awayScore !== "" && homeScore !== "";
    const hasTeamNames = awayName && homeName;
    const isScheduled = status.toLowerCase().includes("scheduled");

    // Build matchup string with scores in traditional format (but not for scheduled games)
    let matchup;
    if (hasTeamNames && hasScores && !isScheduled) {
      matchup = `${awayName} vs ${homeName} ${awayScore}-${homeScore}`;
    } else if (hasTeamNames) {
      matchup = `${awayName} vs ${homeName}`;
    } else {
      matchup = eventName;
    }

    // Build event string without redundant inning info
    // Example: "09/06/2025 1:05 PM - Toronto Blue Jays vs New York Yankees 2-3 - Final"
    // Example: "09/06/2025 1:05 PM - Toronto Blue Jays vs New York Yankees 2-3 - Bottom 4th"
    // Example: "09/06/2025 1:05 PM - Toronto Blue Jays vs New York Yankees - Scheduled"
    const parts = [eventDateTime, matchup, status].filter(
      (p) => p && String(p).trim()
    );

    return parts.join(" - ");
  } catch (_) {
    return null;
  }
}
