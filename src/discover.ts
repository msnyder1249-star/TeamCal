/**
 * Team ID discovery script.
 * Usage: npx ts-node src/discover.ts <sport> <league> [query]
 *
 * Examples:
 *   npx ts-node src/discover.ts football nfl panthers
 *   npx ts-node src/discover.ts football college-football "north carolina"
 *   npx ts-node src/discover.ts basketball mens-college-basketball unc
 *   npx ts-node src/discover.ts football college-football texas
 *
 * If no query is given, lists ALL teams in the league (paginated).
 */

import { listTeams, findTeam, ESPNTeam } from "./providers/espn";

function printTable(teams: ESPNTeam[]): void {
  if (teams.length === 0) {
    console.log("No teams found.");
    return;
  }
  const idW = Math.max(4, ...teams.map((t) => t.id.length));
  const abbrW = Math.max(4, ...teams.map((t) => t.abbreviation.length));
  const nameW = Math.max(11, ...teams.map((t) => t.displayName.length));

  const header =
    "ID".padEnd(idW) +
    "  " +
    "ABBR".padEnd(abbrW) +
    "  " +
    "DISPLAY NAME".padEnd(nameW);
  console.log(header);
  console.log("-".repeat(header.length));
  for (const t of teams) {
    console.log(
      t.id.padEnd(idW) + "  " + t.abbreviation.padEnd(abbrW) + "  " + t.displayName
    );
  }
}

async function main(): Promise<void> {
  const [, , sport, league, ...queryParts] = process.argv;

  if (!sport || !league) {
    console.error("Usage: npx ts-node src/discover.ts <sport> <league> [query]");
    process.exit(1);
  }

  const query = queryParts.join(" ").trim();

  console.log(
    `\nESPN ${sport}/${league}${query ? ` — searching "${query}"` : " — listing all"}\n`
  );

  if (query) {
    const results = await findTeam(sport, league, query);
    printTable(results);
  } else {
    // List all, paginate up to 3 pages
    const all: ESPNTeam[] = [];
    for (let page = 1; page <= 3; page++) {
      const page_teams = await listTeams(sport, league, page);
      if (page_teams.length === 0) break;
      all.push(...page_teams);
    }
    printTable(all);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
