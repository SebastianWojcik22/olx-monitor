import { randomUUID } from 'node:crypto';
import { scrapeListings } from './scraper.js';
import { analyzeListing } from './analyzer.js';
import { notifyDeal } from './notifier.js';
import { scoreDealFromNormalized } from './deal-detector.js';
import { normalizeListing, type OlxRawListing } from './normalizer/index.js';
import {
  computeVariantSnapshot,
  discoverAndBuildSnapshots,
} from './market/market-scanner.js';
import { getSnapshot, isStale } from './market/snapshot-store.js';
import {
  loadItems,
  upsertItem,
  upsertDeal,
  dealExistsForListing,
} from './store.js';
import type { MonitoredItem, Deal, ProductVariant, OlxListing } from './types.js';

// Map of itemId → timer handle
const timers = new Map<string, ReturnType<typeof setInterval>>();

// ── OlxListing → OlxRawListing adapter ───────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRaw(l: OlxListing): OlxRawListing {
  return {
    id:          l.id,
    title:       l.title,
    price:       l.price,
    priceText:   l.priceText,
    location:    l.location,
    postedAt:    l.postedAt,
    url:         l.url,
    imageUrl:    l.imageUrl,
    description: l.description,
    params:      l.params ?? {},
    category:    undefined,
  };
}

function buildVariantFromItem(item: MonitoredItem): ProductVariant {
  return {
    configKey:   item.configKey!,
    label:       item.name,
    brand:       '',
    model:       item.configKey!,
    keywords:    [],
    searchQuery: item.searchQuery,
  };
}

// ── v2 checkItem ──────────────────────────────────────────────────────────────

export async function checkItem(item: MonitoredItem): Promise<number> {
  console.log(`[scheduler] Checking "${item.name}"…`);
  upsertItem({ ...item, lastCheckedAt: new Date().toISOString() });

  let newDeals = 0;
  try {
    const rawListings = await scrapeListings(item);
    const normalized = rawListings.map(l => normalizeListing(toRaw(l)));

    // ONLY market_eligible candidates can generate deals
    const candidates = normalized.filter(l => l.eligibility === 'market_eligible');

    const rules = item.monitorRules;

    for (const listing of candidates) {
      if (dealExistsForListing(listing.id)) continue;

      const score = await scoreDealFromNormalized(listing, item.condition);
      const hasValidScore = !score.isNoScore && score.marketMedian > 0;

      // budgetMode: works on price only, no score needed
      const passesBudget = rules?.budgetMode
        ? listing.price <= rules.budgetMode.maxPrice
        : false;

      // marketMode: requires valid score
      const passesMarket = hasValidScore && rules?.marketMode
        ? score.discount >= rules.marketMode.minDiscountPct
        : false;

      // triggerLogic only meaningful when BOTH modes are active
      let passes: boolean;
      if (rules?.budgetMode && rules?.marketMode) {
        passes = rules.triggerLogic === 'all'
          ? (passesMarket && passesBudget)
          : (passesMarket || passesBudget);
      } else {
        passes = passesMarket || passesBudget;
      }

      if (!passes) {
        console.log(`[scheduler] Skip (rules not met): "${listing.title}" ${listing.price} zł`);
        continue;
      }

      // Find original OlxListing for analysis (needed for description etc.)
      const rawListing = rawListings.find(r => r.id === listing.id);
      if (!rawListing) continue;

      const analysis = await analyzeListing(rawListing, score.marketMedian, score.discount);

      const deal: Deal = {
        id: randomUUID(),
        itemId: item.id,
        itemName: item.name,
        listing: rawListing,
        analysis,
        foundAt: new Date().toISOString(),
        contactStatus: 'none',
        dismissed: false,
        configKey: score.configKey,
        dealScore: score.discount,
        dealQuality: score.quality,
        marketMedian: score.marketMedian,
        marketMedianAtDiscovery: score.marketMedian,
      };

      upsertDeal(deal);
      await notifyDeal(deal, rules?.budgetMode?.maxPrice ?? 0);
      newDeals++;
      console.log(`[scheduler] 🔥 ${score.quality} −${score.discount}%: "${listing.title}" – ${listing.price} zł (median: ${score.marketMedian} zł)`);
    }
  } catch (err) {
    console.error(`[scheduler] Error checking "${item.name}":`, err instanceof Error ? err.message : err);
  }

  return newDeals;
}

// ── refreshSnapshots – separate cycle, never called inside checkItem() ────────

async function refreshSnapshots(): Promise<void> {
  const activeItems = loadItems().filter(i => i.enabled);
  for (const item of activeItems) {
    try {
      if (item.monitorStatus === 'resolved' && item.configKey) {
        // Resolved: use dedicated snapshot by configKey (not broad query)
        const snap = getSnapshot(item.configKey, item.condition);
        if (!snap || isStale(snap) || snap.dataConfidence === 'low') {
          const variant = buildVariantFromItem(item);
          await computeVariantSnapshot(variant, item.condition);
        }
      } else {
        // Unresolved/legacy: broad scan, attempt auto-resolve
        const result = await discoverAndBuildSnapshots(item.searchQuery, item.condition);
        // If exactly one high-confidence variant found → suggest resolved upgrade
        if (
          result.snapshots.length === 1 &&
          result.snapshots[0]!.dataConfidence === 'high' &&
          !item.configKey
        ) {
          const snap = result.snapshots[0]!;
          item.suggestedConfigKey = snap.configKey;
          item.suggestedConfigKeyLabel = snap.label;
          upsertItem(item);
        }
      }
    } catch (err) {
      console.error(`[scheduler] refreshSnapshots error for "${item.name}":`, err instanceof Error ? err.message : err);
    }
  }
}

// ── Scheduling ────────────────────────────────────────────────────────────────

function scheduleItem(item: MonitoredItem): void {
  if (timers.has(item.id)) {
    clearInterval(timers.get(item.id)!);
    timers.delete(item.id);
  }
  if (!item.enabled) return;

  const ms = Math.max(item.intervalMinutes, 10) * 60 * 1000;
  const handle = setInterval(() => {
    void checkItem(item);
  }, ms);
  timers.set(item.id, handle);
}

export function startScheduler(): void {
  const items = loadItems();
  for (const item of items) {
    if (item.enabled) {
      scheduleItem(item);
      setTimeout(() => void checkItem(item), 5_000 + Math.random() * 10_000);
    }
  }
  console.log(`[scheduler] Started. Monitoring ${items.filter(i => i.enabled).length} item(s).`);

  // Separate cycle for snapshot refresh (every 6h) – never blocks checkItem()
  setInterval(() => {
    void refreshSnapshots();
  }, 6 * 60 * 60 * 1000);
  // Initial refresh after 30s stagger
  setTimeout(() => void refreshSnapshots(), 30_000);
}

export function rescheduleItem(item: MonitoredItem): void {
  scheduleItem(item);
}

export function removeItemSchedule(itemId: string): void {
  if (timers.has(itemId)) {
    clearInterval(timers.get(itemId)!);
    timers.delete(itemId);
  }
}
