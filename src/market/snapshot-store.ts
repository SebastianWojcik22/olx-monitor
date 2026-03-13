import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MarketSnapshot } from '../types.js';

// ── Storage ───────────────────────────────────────────────────────────────────

const DATA_DIR = join(process.cwd(), 'data', 'snapshots');

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function snapshotFile(snapshotKey: string): string {
  // snapshotKey = "apple_iphone_17_pro_max_256gb:used"
  // replace ':' with '--' for filename safety
  const safe = snapshotKey.replace(/[:/\\]/g, '--');
  return join(DATA_DIR, `${safe}.json`);
}

// ── In-memory cache ───────────────────────────────────────────────────────────

const cache = new Map<string, MarketSnapshot>();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get a snapshot by snapshotKey = `${configKey}:${condition}`.
 * Returns undefined if not found in cache or disk.
 */
export function getSnapshot(configKey: string, condition: string): MarketSnapshot | undefined {
  const key = `${configKey}:${condition}`;
  if (cache.has(key)) return cache.get(key)!;

  // Try disk
  const path = snapshotFile(key);
  if (existsSync(path)) {
    try {
      const snap = JSON.parse(readFileSync(path, 'utf-8')) as MarketSnapshot;
      cache.set(key, snap);
      return snap;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Save a snapshot. Always uses snapshotKey = `${configKey}:${condition}`.
 */
export function saveSnapshot(snap: MarketSnapshot): void {
  const key = snap.snapshotKey;
  cache.set(key, snap);
  ensureDir();
  writeFileSync(snapshotFile(key), JSON.stringify(snap, null, 2), 'utf-8');
}

/**
 * Check if a snapshot is stale (older than maxAgeHours, default 6h).
 */
export function isStale(snap: MarketSnapshot, maxAgeHours = 6): boolean {
  const age = Date.now() - new Date(snap.computedAt).getTime();
  return age > maxAgeHours * 60 * 60 * 1000;
}

/**
 * Decide whether to refresh a snapshot synchronously or skip.
 * Policy per plan:
 *   - Not exists → must fetch synchronously
 *   - Fresh (<6h) + high → use cache
 *   - Fresh (<6h) + low → use cache (caller can trigger background refresh)
 *   - Stale (>6h) → must refresh
 */
export type RefreshPolicy = 'sync' | 'cache' | 'background';

export function refreshPolicy(
  snap: MarketSnapshot | undefined,
  monitorActive: boolean,
): RefreshPolicy {
  if (!snap) return 'sync';
  if (isStale(snap)) {
    return monitorActive ? 'sync' : 'background';
  }
  // Fresh
  if (snap.dataConfidence === 'low') return 'background';
  return 'cache';
}

/**
 * Get all cached snapshots (for scheduler priority ranking).
 */
export function getAllSnapshots(): MarketSnapshot[] {
  // Load any on-disk snapshots not yet in cache
  ensureDir();
  return Array.from(cache.values());
}
