import fs from "fs";
import path from "path";
import ical, {
  ICalCalendarMethod,
  ICalEventStatus,
  ICalEventBusyStatus,
} from "ical-generator";
import { TeamConfig, Match, Provider } from "./types";
import { ESPNProvider } from "./providers/espn";
import { OpenFootballProvider } from "./providers/openfootball";

const DIST_DIR = path.resolve("dist");
const CONFIG_PATH = path.resolve("teams.config.json");

const providers: Record<string, Provider> = {
  espn: new ESPNProvider(),
  openfootball: new OpenFootballProvider(),
};

function buildUID(match: Match, teamId: string): string {
  // Stable UID: same game + same feed = same UID, so calendar apps update in place
  return `${match.id}-${teamId}@teamcal`;
}

function matchToEvent(
  cal: ReturnType<typeof ical>,
  match: Match,
  teamId: string
): void {
  const end = new Date(match.start.getTime() + match.durationMinutes * 60_000);

  cal.createEvent({
    id: buildUID(match, teamId),
    start: match.start,
    end,
    summary: match.title,
    location: [...new Set([match.venue, match.location].filter(Boolean))].join(" — "),
    status: match.status === "cancelled" ? ICalEventStatus.CANCELLED : undefined,
    busystatus:
      match.status === "scheduled"
        ? ICalEventBusyStatus.TENTATIVE
        : ICalEventBusyStatus.BUSY,
  });
}

async function fetchTeam(team: TeamConfig): Promise<Match[]> {
  const provider = providers[team.provider];
  if (!provider) throw new Error(`Unknown provider: ${team.provider}`);
  console.log(`  Fetching ${team.name}...`);
  const matches = await provider.getSchedule(team);
  console.log(`    → ${matches.length} matches`);
  return matches;
}

export async function generate(): Promise<void> {
  fs.mkdirSync(DIST_DIR, { recursive: true });

  const teams: TeamConfig[] = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

  const combinedCal = ical({
    name: "TeamCal — All Teams",
    method: ICalCalendarMethod.PUBLISH,
    prodId: "//TeamCal//All//EN",
  });

  for (const team of teams) {
    console.log(`\n[${team.id}] ${team.name}`);
    let matches: Match[];
    try {
      matches = await fetchTeam(team);
    } catch (err) {
      console.error(`  ERROR: ${(err as Error).message}`);
      continue;
    }

    // Per-team calendar
    const teamCal = ical({
      name: team.name,
      method: ICalCalendarMethod.PUBLISH,
      prodId: `//TeamCal//${team.id}//EN`,
    });

    for (const match of matches) {
      matchToEvent(teamCal, match, team.id);
      matchToEvent(combinedCal, match, team.id);
    }

    const outPath = path.join(DIST_DIR, `${team.id}.ics`);
    fs.writeFileSync(outPath, teamCal.toString(), "utf8");
    console.log(`  → wrote ${outPath}`);
  }

  const allPath = path.join(DIST_DIR, "all.ics");
  fs.writeFileSync(allPath, combinedCal.toString(), "utf8");
  console.log(`\n→ wrote ${allPath}`);
}
