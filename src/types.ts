export interface Match {
  id: string;
  start: Date;          // UTC
  durationMinutes: number;
  title: string;        // e.g. "Panthers vs Falcons"
  venue: string;        // full venue name
  location: string;     // "City, State" or "City, Country"
  status: "scheduled" | "in_progress" | "final" | "postponed" | "cancelled";
  homeTeam: string;
  awayTeam: string;
}

export interface TeamConfig {
  id: string;           // slug used for output filename, e.g. "panthers"
  name: string;         // display name
  provider: "espn" | "openfootball";
  sport?: string;       // ESPN: "football", "basketball", etc.
  league?: string;      // ESPN: "nfl", "college-football", etc.
  teamId?: string;      // ESPN numeric team ID
  season?: number;      // ESPN: explicit season year (e.g. 2026); omit for auto
  filter?: string[];    // openfootball: team codes to include, empty = all
}

export interface Provider {
  getSchedule(team: TeamConfig): Promise<Match[]>;
}
