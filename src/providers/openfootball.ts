import { Match, Provider, TeamConfig } from "../types";
import { fetchCached } from "../cache";

const WC2026_URL =
  "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";

// ── Flags ────────────────────────────────────────────────────────────────────

// Convert ISO 3166-1 alpha-2 code → regional indicator emoji pair
function isoToFlag(iso2: string): string {
  const A = 0x1f1e6;
  const base = "A".codePointAt(0)!;
  return [...iso2.toUpperCase()]
    .map((c) => String.fromCodePoint(A + c.codePointAt(0)! - base))
    .join("");
}

// Name → ISO2 for all 2026 qualified nations.
// England and Scotland use subdivision tag sequences (no ISO2 regional indicator).
const TEAM_ISO2: Record<string, string> = {
  Algeria:              "DZ",
  Argentina:            "AR",
  Australia:            "AU",
  Austria:              "AT",
  Belgium:              "BE",
  "Bosnia & Herzegovina": "BA",
  Brazil:               "BR",
  Canada:               "CA",
  "Cape Verde":         "CV",
  Colombia:             "CO",
  Croatia:              "HR",
  "Curaçao":            "CW",
  "Czech Republic":     "CZ",
  "DR Congo":           "CD",
  Ecuador:              "EC",
  Egypt:                "EG",
  France:               "FR",
  Germany:              "DE",
  Ghana:                "GH",
  Haiti:                "HT",
  Iran:                 "IR",
  Iraq:                 "IQ",
  "Ivory Coast":        "CI",
  Japan:                "JP",
  Jordan:               "JO",
  Mexico:               "MX",
  Morocco:              "MA",
  Netherlands:          "NL",
  "New Zealand":        "NZ",
  Norway:               "NO",
  Panama:               "PA",
  Paraguay:             "PY",
  Portugal:             "PT",
  Qatar:                "QA",
  "Saudi Arabia":       "SA",
  Senegal:              "SN",
  "South Africa":       "ZA",
  "South Korea":        "KR",
  Spain:                "ES",
  Sweden:               "SE",
  Switzerland:          "CH",
  Tunisia:              "TN",
  Turkey:               "TR",
  USA:                  "US",
  Uruguay:              "UY",
  Uzbekistan:           "UZ",
};

// Subdivision-tag flags for nations without an ISO2 regional indicator
const TEAM_FLAG_OVERRIDE: Record<string, string> = {
  England: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  Scotland: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
};

function teamFlag(name: string): string {
  if (TEAM_FLAG_OVERRIDE[name]) return TEAM_FLAG_OVERRIDE[name];
  const iso2 = TEAM_ISO2[name];
  return iso2 ? isoToFlag(iso2) : "";
}

function teamLabel(name: string): string {
  const flag = teamFlag(name);
  return flag ? `${flag} ${name}` : name;
}

// ── Round labels ─────────────────────────────────────────────────────────────

function roundLabel(round: string): string {
  if (/^Matchday\s/i.test(round)) return "Group Stage";
  if (round === "Match for third place") return "Third Place";
  // Round of 32 / Round of 16 / Quarter-final / Semi-final / Final pass through
  return round;
}

// ── Venue lookup ─────────────────────────────────────────────────────────────

// Maps openfootball's `ground` value → "{Stadium}, {City}, {Region}"
const GROUND_VENUE: Record<string, string> = {
  "Atlanta":                               "Mercedes-Benz Stadium, Atlanta, Georgia",
  "Boston (Foxborough)":                   "Gillette Stadium, Foxborough, Massachusetts",
  "Dallas (Arlington)":                    "AT&T Stadium, Arlington, Texas",
  "Guadalajara (Zapopan)":                 "Estadio Akron, Zapopan, Mexico",
  "Houston":                               "NRG Stadium, Houston, Texas",
  "Kansas City":                           "Arrowhead Stadium, Kansas City, Missouri",
  "Los Angeles (Inglewood)":               "SoFi Stadium, Inglewood, California",
  "Mexico City":                           "Estadio Azteca, Mexico City, Mexico",
  "Miami (Miami Gardens)":                 "Hard Rock Stadium, Miami Gardens, Florida",
  "Monterrey (Guadalupe)":                 "Estadio BBVA, Guadalupe, Mexico",
  "New York/New Jersey (East Rutherford)": "MetLife Stadium, East Rutherford, New Jersey",
  "Philadelphia":                          "Lincoln Financial Field, Philadelphia, Pennsylvania",
  "San Francisco Bay Area (Santa Clara)":  "Levi's Stadium, Santa Clara, California",
  "Seattle":                               "Lumen Field, Seattle, Washington",
  "Toronto":                               "BMO Field, Toronto, Ontario",
  "Vancouver":                             "BC Place, Vancouver, British Columbia",
};

// ── Time parsing ─────────────────────────────────────────────────────────────

function parseMatchTime(date: string, time: string | undefined): Date {
  if (!time) return new Date(`${date}T00:00:00Z`);

  const m = time.match(/^(\d{2}):(\d{2})\s*UTC([+-]\d+(?::\d+)?)?/);
  if (!m) return new Date(`${date}T00:00:00Z`);

  const hours = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  const offsetStr = m[3] ?? "+0";
  const offsetParts = offsetStr.replace("+", "").split(":");
  const offsetHours = parseInt(offsetParts[0], 10);
  const offsetMins = offsetParts[1] ? parseInt(offsetParts[1], 10) : 0;
  const totalOffsetMins = offsetHours * 60 + (offsetHours < 0 ? -offsetMins : offsetMins);

  const localMins = hours * 60 + mins;
  const utcMins = localMins - totalOffsetMins;

  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + utcMins);
  return d;
}

// ── Match parsing ─────────────────────────────────────────────────────────────

interface OFBMatch {
  round?: string;
  date: string;
  time?: string;
  team1: string;
  team2: string;
  score?: unknown;
  ground?: string;
  group?: string;
}

interface OFBData {
  name?: string;
  matches?: OFBMatch[];
  rounds?: Array<{ name: string; matches: OFBMatch[] }>;
  groups?: Array<{ name: string; matches?: OFBMatch[] }>;
}

function buildMatchId(match: OFBMatch): string {
  const t1 = match.team1.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const t2 = match.team2.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return `wc2026-${match.date}-${t1}-vs-${t2}`;
}

function parseMatch(match: OFBMatch): Match {
  const start = parseMatchTime(match.date, match.time);
  const ground = match.ground ?? "TBD";
  const venue = GROUND_VENUE[ground] ?? ground;
  const status: Match["status"] = match.score != null ? "final" : "scheduled";
  const label = roundLabel(match.round ?? "");
  const title = `${teamLabel(match.team1)} vs ${teamLabel(match.team2)} | ${label}`;

  return {
    id: buildMatchId(match),
    start,
    durationMinutes: 120,
    title,
    venue,
    location: venue,
    status,
    homeTeam: match.team1,
    awayTeam: match.team2,
  };
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class OpenFootballProvider implements Provider {
  async getSchedule(team: TeamConfig): Promise<Match[]> {
    const data = (await fetchCached(WC2026_URL, 6 * 3600)) as OFBData;

    const allMatches: Match[] = [];

    for (const m of data.matches ?? []) {
      allMatches.push(parseMatch(m));
    }
    for (const round of data.rounds ?? []) {
      for (const m of round.matches ?? []) allMatches.push(parseMatch(m));
    }
    for (const group of data.groups ?? []) {
      for (const m of group.matches ?? []) allMatches.push(parseMatch(m));
    }

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
