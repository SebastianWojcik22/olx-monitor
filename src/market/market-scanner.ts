import { fetchPriceData } from '../scraper.js';
import { normalizeListing, type OlxRawListing } from '../normalizer/index.js';
import { saveSnapshot, getSnapshot, isStale } from './snapshot-store.js';
import type {
  NormalizedListing,
  MarketSnapshot,
  MarketSnapshotStats,
  ScanResult,
  ProductVariant,
} from '../types.js';

// ── Stats helpers ─────────────────────────────────────────────────────────────

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx]!;
}

function computeStats(prices: number[]): MarketSnapshotStats {
  if (!prices.length) {
    return { min: 0, p10: 0, p25: 0, median: 0, avg: 0, p75: 0, p90: 0, max: 0 };
  }
  const sorted = [...prices].sort((a, b) => a - b);
  // IQR outlier removal
  const q1 = pct(sorted, 25);
  const q3 = pct(sorted, 75);
  const iqr = q3 - q1;
  const lower = Math.max(0, q1 - 1.5 * iqr);
  const upper = q3 + 1.5 * iqr;
  const clean = sorted.filter(p => p >= lower && p <= upper);
  const working = clean.length >= 5 ? clean : sorted;

  return {
    min:    working[0]!,
    p10:    pct(working, 10),
    p25:    pct(working, 25),
    median: pct(working, 50),
    avg:    Math.round(working.reduce((s, v) => s + v, 0) / working.length),
    p75:    pct(working, 75),
    p90:    pct(working, 90),
    max:    working[working.length - 1]!,
  };
}

function computeDataConfidence(
  marketEligibleCount: number,
  visibleOnlyCount: number,
  rawCount: number,
  rejectedCount: number,
  stats: MarketSnapshotStats,
  avgConfidence: number,
  targetedFetchCount: number | undefined,
): 'high' | 'medium' | 'low' {
  let degradeCount = 0;

  if (marketEligibleCount < 5) return 'low';
  if (visibleOnlyCount / Math.max(rawCount, 1) > 0.6) degradeCount++;
  if (rejectedCount / Math.max(rawCount, 1) > 0.8) degradeCount++;
  if (avgConfidence < 0.75) degradeCount++;
  if (targetedFetchCount !== undefined && targetedFetchCount < 3) degradeCount++;
  if (stats.p25 > 0 && stats.p75 / stats.p25 > 2.5) degradeCount++;

  if (marketEligibleCount >= 20 && degradeCount === 0) return 'high';
  if (degradeCount === 0) return 'medium';
  if (degradeCount === 1) return 'medium';
  return 'low';
}

function buildHistogram(prices: number[], buckets = 10): { from: number; to: number; count: number }[] {
  if (!prices.length) return [];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) return [{ from: min, to: max, count: prices.length }];
  const step = Math.ceil((max - min) / buckets);
  const result = [];
  for (let i = 0; i < buckets; i++) {
    const from = min + i * step;
    const to   = from + step;
    const count = prices.filter(p => p >= from && p < to + (i === buckets - 1 ? 1 : 0)).length;
    result.push({ from, to, count });
  }
  return result.filter(b => b.count > 0);
}

// ── OlxListing → OlxRawListing adapter ───────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRaw(l: any): OlxRawListing {
  return {
    id:          String(l.id ?? ''),
    title:       l.title ?? '',
    price:       l.price ?? 0,
    priceText:   l.priceText ?? '',
    location:    l.location ?? '',
    postedAt:    l.postedAt ?? new Date().toISOString(),
    url:         l.url ?? '',
    imageUrl:    l.imageUrl,
    description: l.description,
    params:      l.params ?? {},
    category:    l.olxCategory ?? l.category,
  };
}

// ── Build snapshot from a set of normalized listings ─────────────────────────

function buildSnapshotFromNormalized(
  configKey: string,
  label: string,
  condition: 'new' | 'used' | 'all',
  listings: NormalizedListing[],
  allForKey: NormalizedListing[],
  targetedFetchCount?: number,
): MarketSnapshot {
  const eligible  = listings.filter(l => l.eligibility === 'market_eligible');
  const visible   = listings.filter(l => l.eligibility === 'visible_only');
  const rejected  = listings.filter(l => l.eligibility === 'rejected');

  const prices    = eligible.map(l => l.price).filter(p => p > 0);
  const stats     = computeStats(prices);

  // Mark isSuspiciousPrice (post-market flag)
  const medianPrice = stats.median;
  eligible.forEach(l => {
    l.isSuspiciousPrice = medianPrice > 0 && l.price < medianPrice * 0.5;
  });

  // Rejection reasons
  const rejectionReasons: Record<string, number> = {};
  for (const l of rejected) {
    for (const flag of l.validationFlags) {
      rejectionReasons[flag] = (rejectionReasons[flag] ?? 0) + 1;
    }
  }

  // Average parsing confidence for eligible
  const avgConf = eligible.length > 0
    ? eligible.reduce((s, l) => s + l.parsingConfidence, 0) / eligible.length
    : 0;

  const snapshotKey = `${configKey}:${condition}`;

  return {
    configKey,
    condition,
    snapshotKey,
    computedAt: new Date().toISOString(),
    label,
    keywords: [],

    rawCount: allForKey.length,
    rejectedCount: rejected.length,
    visibleOnlyCount: visible.length,
    marketEligibleCount: eligible.length,
    outlierRemovedCount: 0, // computed inside computeStats (not tracked separately)

    stats,

    cheapestEligible: eligible
      .sort((a, b) => a.price - b.price)
      .slice(0, 10),
    cheapestVisible: visible
      .sort((a, b) => a.price - b.price)
      .slice(0, 5),

    histogram: buildHistogram(prices),

    dataConfidence: computeDataConfidence(
      eligible.length,
      visible.length,
      listings.length,
      rejected.length,
      stats,
      avgConf,
      targetedFetchCount,
    ),

    rejectionReasons,
    targetedFetchUsed: targetedFetchCount !== undefined,
    targetedFetchCount,
  };
}

// ── makeLabel ─────────────────────────────────────────────────────────────────

function makeLabel(configKey: string): string {
  return configKey
    .replace(/^apple_/, 'Apple ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ── POZIOM 2: computeVariantSnapshot ─────────────────────────────────────────

/**
 * Dedicated snapshot for a specific variant (used by scheduler for resolved monitors).
 * Uses buildSearchQuery(configKey) – NOT the user's raw search query.
 */
export async function computeVariantSnapshot(
  variant: ProductVariant,
  condition: string,
): Promise<MarketSnapshot> {
  const olxCondition = condition === 'new' || condition === 'used' ? condition : 'all';

  console.log(`[market-scanner] computeVariantSnapshot "${variant.configKey}" (${olxCondition})…`);

  const raw = await fetchPriceData(
    variant.searchQuery,
    olxCondition === 'all' ? 'all' : olxCondition,
    0, 0, [], true, 3, 3, 2,
  );

  const normalized = raw.map(l => normalizeListing(toRaw(l)));

  // Filter to only listings matching this configKey
  const forKey = normalized.filter(l => l.configKey === variant.configKey);

  // Build condition-specific subset
  let conditionListings: NormalizedListing[];
  if (olxCondition === 'all') {
    conditionListings = forKey;
  } else {
    conditionListings = forKey.filter(l =>
      l.condition === olxCondition || l.condition === 'unknown',
    );
  }

  const snap = buildSnapshotFromNormalized(
    variant.configKey,
    variant.label,
    olxCondition as 'new' | 'used' | 'all',
    conditionListings,
    forKey,
    raw.length,
  );

  saveSnapshot(snap);
  return snap;
}

// ── POZIOM 1: discoverAndBuildSnapshots ───────────────────────────────────────

/**
 * Discover variants from a broad user query, build a MarketSnapshot per variant.
 * Used by UI (Rynek tab) and scheduler for unresolved/legacy monitors.
 */
export async function discoverAndBuildSnapshots(
  query: string,
  condition: string,
): Promise<ScanResult> {
  const olxCondition = condition === 'new' || condition === 'used' ? condition : 'all';

  console.log(`[market-scanner] discoverAndBuildSnapshots "${query}" (${olxCondition})…`);

  const raw = await fetchPriceData(
    query,
    olxCondition === 'all' ? 'all' : olxCondition,
    0, 0, [], true, 5, 5, 2,
  );

  const normalized = raw.map(l => normalizeListing(toRaw(l)));

  // Group by configKey (only non-undefined)
  const groups = new Map<string, NormalizedListing[]>();
  for (const l of normalized) {
    if (!l.configKey) continue;
    const arr = groups.get(l.configKey) ?? [];
    arr.push(l);
    groups.set(l.configKey, arr);
  }

  const snapshots: MarketSnapshot[] = [];

  for (const [configKey, listings] of groups) {
    // Apply condition filtering
    let conditionListings: NormalizedListing[];
    if (olxCondition === 'all') {
      conditionListings = listings;
    } else {
      conditionListings = listings.filter(l =>
        l.condition === olxCondition || l.condition === 'unknown',
      );
    }

    const snap = buildSnapshotFromNormalized(
      configKey,
      makeLabel(configKey),
      olxCondition as 'new' | 'used' | 'all',
      conditionListings,
      listings,
    );

    saveSnapshot(snap);
    snapshots.push(snap);
  }

  // Sort by eligible count descending (most data first)
  snapshots.sort((a, b) => b.marketEligibleCount - a.marketEligibleCount);

  return { snapshots, query, condition: olxCondition };
}

// ── computeSnapshot (used by handleMarketScan + handlePriceAnalysis) ──────────

export async function computeSnapshot(
  query: string,
  condition: string,
): Promise<ScanResult> {
  return discoverAndBuildSnapshots(query, condition);
}

// ── getSnapshot re-export for convenience ─────────────────────────────────────

export { getSnapshot, isStale } from './snapshot-store.js';
