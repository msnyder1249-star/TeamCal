import { Match, Provider, TeamConfig } from "../types";
import { fetchCached } from "../cache";

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

// Default game durations in minutes by sport
const DURATION: Record<string, number> = {
  football: 180,
  basketball: 120,
  baseball: 180,
  hockey: 150,
  soccer: 120,
};

function parseStatus(
  typeName: string
): Match["status"] {
  if (typeName.includes("FINAL")) return "final";
  if (typeName.includes("IN_PROGRESS") || typeName.includes("LIVE")) return "in_progress";
  if (typeName.includes("POSTPONE")) return "postponed";
  if (typeName.includes("CANCEL")) return "cancelled";
  return "scheduled";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseEvent(event: any, sport: string): Match | null {
  try {
    const competition = event.competitions?.[0];
    if (!competition) return null;

    const competitors: Array<{ homeAway: string; team: { displayName: string } }> =
      competition.competitors ?? [];
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");

    const homeTeam = home?.team.displayName ?? "Home";
    const awayTeam = away?.team.displayName ?? "Away";

    const venue = competition.venue;
    const venueName: string = venue?.fullName ?? "TBD";
    const city: string = venue?.address?.city ?? "";
    const state: string = venue?.address?.state ?? "";
    const country: string = venue?.address?.country ?? "";
    const locationParts = [city, state || country].filter(Boolean);

    const start = new Date(event.date);
    const statusType: string = competition.status?.type?.name ?? "STATUS_SCHEDULED";

    return {
      id: event.id,
      start,
      durationMinutes: DURATION[sport] ?? 150,
      title: `${awayTeam} at ${homeTeam}`,
      venue: venueName,
      location: locationParts.join(", "),
      status: parseStatus(statusType),
      homeTeam,
      awayTeam,
    };
  } catch {
    return null;
  }
}

export class ESPNProvider implements Provider {
  async getSchedule(team: TeamConfig): Promise<Match[]> {
    const { sport, league, teamId } = team;
    if (!sport || !league || !teamId) {
      throw new Error(`ESPNProvider: team "${team.id}" missing sport, league, or teamId`);
    }

    const baseUrl = `${ESPN_BASE}/${sport}/${league}/teams/${teamId}/schedule`;
    let data: { events?: unknown[]; season?: { year: number; type: number } };

    if (team.season != null) {
      // Explicit season requested — fetch it and never fall back
      const url = `${baseUrl}?season=${team.season}`;
      data = (await fetchCached(url)) as typeof data;
      if ((data.events ?? []).length === 0) {
        console.log(`    (no games found for ${team.name} season ${team.season})`);
      }
    } else {
      // Auto mode (NFL): fetch current season; if preseason/empty fall back one year
      data = (await fetchCached(baseUrl)) as typeof data;
      if ((data.events ?? []).length === 0 || data.season?.type === 1) {
        const year = (data.season?.year ?? new Date().getFullYear()) - 1;
        const fallback = (await fetchCached(`${baseUrl}?season=${year}`)) as typeof data;
        if ((fallback.events ?? []).length > 0) data = fallback;
      }
    }

    const events = data.events ?? [];
    const matches: Match[] = [];

    for (const event of events) {
      const match = parseEvent(event, sport);
      if (match) matches.push(match);
    }

    return matches;
  }
}

// ----- Team discovery helpers (used by discover.ts) -----

export interface ESPNTeam {
  id: string;
  displayName: string;
  abbreviation: string;
  location: string;
  nickname: string;
}

export async function listTeams(
  sport: string,
  league: string,
  page = 1
): Promise<ESPNTeam[]> {
  const url = `${ESPN_BASE}/${sport}/${league}/teams?limit=100&page=${page}`;
  const data = (await fetchCached(url, 24 * 3600)) as {
    sports?: Array<{
      leagues?: Array<{
        teams?: Array<{ team: ESPNTeam }>;
      }>;
    }>;
  };

  const league0 = data.sports?.[0]?.leagues?.[0];
  return (league0?.teams ?? []).map((t) => t.team);
}

export async function findTeam(
  sport: string,
  league: string,
  query: string
): Promise<ESPNTeam[]> {
  const q = query.toLowerCase();
  // Paginate until we get an empty page (college sports have 700+ teams)
  for (let page = 1; page <= 15; page++) {
    const teams = await listTeams(sport, league, page);
    if (teams.length === 0) break;
    const hits = teams.filter(
      (t) =>
        (t.displayName ?? "").toLowerCase().includes(q) ||
        (t.nickname ?? "").toLowerCase().includes(q) ||
        (t.abbreviation ?? "").toLowerCase().includes(q) ||
        (t.location ?? "").toLowerCase().includes(q)
    );
    if (hits.length > 0) return hits;
  }
  return [];
}
