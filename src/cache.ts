import fs from "fs";
import path from "path";
import crypto from "crypto";

const CACHE_DIR = path.resolve(".cache");

interface CacheEntry {
  fetchedAt: number;
  data: unknown;
}

function cacheKey(url: string): string {
  return crypto.createHash("sha1").update(url).digest("hex");
}

function cachePath(url: string): string {
  return path.join(CACHE_DIR, `${cacheKey(url)}.json`);
}

export function readCache(url: string, ttlSeconds: number): unknown | null {
  const file = cachePath(url);
  if (!fs.existsSync(file)) return null;
  try {
    const entry: CacheEntry = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Date.now() - entry.fetchedAt < ttlSeconds * 1000) return entry.data;
  } catch {
    // corrupted entry — treat as miss
  }
  return null;
}

export function writeCache(url: string, data: unknown): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const entry: CacheEntry = { fetchedAt: Date.now(), data };
  fs.writeFileSync(cachePath(url), JSON.stringify(entry));
}

export async function fetchCached(
  url: string,
  ttlSeconds = 6 * 3600
): Promise<unknown> {
  const cached = readCache(url, ttlSeconds);
  if (cached !== null) return cached;

  const res = await fetch(url, {
    headers: { "User-Agent": "TeamCal/1.0 (self-hosted calendar feed)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const data = await res.json();
  writeCache(url, data);
  return data;
}
