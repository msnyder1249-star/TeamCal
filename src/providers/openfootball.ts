import { Match, Provider, TeamConfig } from "../types";
import { fetchCached } from "../cache";

// World Cup 2026 JSON feed — openfootball public-domain data
// Repo: https://github.com/openfootball/worldcup.json
const WC2026_URL =
  "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";

// openfootball match shape (actual API as of 2026):
// { round, date, time, team1, team2, group, ground, score? }
// team1/team2 are plain strings; time includes UTC offset: "13:00 UTC-6"
interface OFBMatch {
  round?: string;
  date: string;        // "YYYY-MM-DD"
  time?: string;       // "HH:MM UTC±N" or "HH:MM"
  team1: string;
  team2: string;
  score?: unknown;
  ground?: string;     // usually a city name
  group?: string;
}

interface OFBData {
  name?: string;
  matches?: OFBMatch[];
  // legacy round-grouped format (kept for forward-compat)
  rounds?: Array<{ name: string; matches: OFBMatch[] }>;
  groups?: Array<{ name: string; matches?: OFBMatch[] }>;
}

// Parse "13:00 UTC-6" → UTC Date offset applied
function parseMatchTime(date: string, time: string | undefined): Date {
  if (!time) return new Date(`${date}T00:00:00Z`);

  // Match "HH:MM UTC±N" or "HH:MM UTC±N:MM"
  const m = time.match(/^(\d{2}):(\d{2})\s*UTC([+-]\d+(?::\d+)?)?/);
  if (!m) return new Date(`${date}T00:00:00Z`);

  const hours = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  const offsetStr = m[3] ?? "+0";
  const offsetParts = offsetStr.replace("+", "").split(":");
  const offsetHours = parseInt(offsetParts[0], 10);
  const offsetMins = offsetParts[1] ? parseInt(offsetParts[1], 10) : 0;
  const totalOffsetMins = offsetHours * 60 + (offsetHours < 0 ? -offsetMins : offsetMins);

  // Local time in minutes since midnight, minus offset = UTC
  const localMins = hours * 60 + mins;
  const utcMins = localMins - totalOffsetMins;

  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + utcMins);
  return d;
}

function buildMatchId(match: OFBMatch): string {
  const t1 = match.team1.toLowerCase().replace(/\s+/g, "-");
  const t2 = match.team2.toLowerCase().replace(/\s+/g, "-");
  return `wc2026-${match.date}-${t1}-vs-${t2}`;
}

function parseMatch(match: OFBMatch): Match {
  const start = parseMatchTime(match.date, match.time);
  const venueName = match.ground ?? "TBD";
  const status: Match["status"] = match.score != null ? "final" : "scheduled";

  return {
    id: buildMatchId(match),
    start,
    durationMinutes: 120,
    title: `${match.team1} vs ${match.team2}`,
    venue: venueName,
    location: venueName,   // ground is usually a city; good enough for LOCATION
    status,
    homeTeam: match.team1,
    awayTeam: match.team2,
  };
}

export class OpenFootballProvider implements Provider {
  async getSchedule(team: TeamConfig): Promise<Match[]> {
    const data = (await fetchCached(WC2026_URL, 6 * 3600)) as OFBData;

    const allMatches: Match[] = [];

    // Flat matches array (current format)
    for (const m of data.matches ?? []) {
      allMatches.push(parseMatch(m));
    }

    // Round-grouped format (legacy / fallback)
    for (const round of data.rounds ?? []) {
      for (const m of round.matches ?? []) {
        allMatches.push(parseMatch(m));
      }
    }

    // Group-grouped format
    for (const group of data.groups ?? []) {
      for (const m of group.matches ?? []) {
        allMatches.push(parseMatch(m));
      }
    }

    // If filter is set, include only matches where one team matches
    const filter = team.filter ?? [];
    if (filter.length === 0) return allMatches;

    const codes = filter.map((c) => c.toLowerCase());
    return allMatches.filter((m) => {
      const t1 = m.homeTeam.toLowerCase();
      const t2 = m.awayTeam.toLowerCase();
      return codes.some((c) => t1.includes(c) || t2.includes(c));
    });
  }
}
