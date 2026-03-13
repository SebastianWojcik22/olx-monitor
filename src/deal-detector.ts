/**
 * Deal Detector – ocenia jakość okazji cenowej na podstawie mediany rynkowej.
 *
 * Pipeline:
 *   OlxListing → config-parser → price-cache → DealScore
 */

import { parseConfig, buildVariantQuery } from './config-parser.js';
import { getPriceStats } from './price-cache.js';
import { getSnapshot } from './market/snapshot-store.js';
import type { OlxListing, DealQuality, NormalizedListing, DealScore as NewDealScore } from './types.js';

export type { DealQuality };

export interface DealScore {
  configKey: string;
  marketMedian: number;           // mediana rynkowa dla tej konfiguracji
  marketP25: number;              // dolna granica "normalnych" cen
  marketP75: number;              // górna granica "normalnych" cen
  discount: number;               // (median - price) / median, np. 0.27
  discountPct: number;            // zaokrąglone do całości: 27
  quality: DealQuality;
}

// ── Progi klasyfikacji ────────────────────────────────────────────────────────

const THRESHOLDS: Array<{ max: number; quality: DealQuality }> = [
  { max: 0.05, quality: 'normal'    },
  { max: 0.15, quality: 'good'      },
  { max: 0.30, quality: 'very_good' },
  { max: Infinity, quality: 'extreme' },
];

function classify(discount: number): DealQuality {
  for (const t of THRESHOLDS) {
    if (discount <= t.max) return t.quality;
  }
  return 'extreme';
}

// ── Główna funkcja ────────────────────────────────────────────────────────────

/**
 * Ocenia jakość okazji dla danego ogłoszenia.
 * @param listing   - ogłoszenie OLX
 * @param keywords  - słowa kluczowe z MonitoredItem (do zawężenia price-cache fetch)
 * @param condition - stan ('new' | 'used' | 'all')
 * @param query     - fraza wyszukiwania z MonitoredItem
 */
export async function scoreDeal(
  listing: OlxListing,
  keywords: string[],
  condition: string,
  query: string,
): Promise<DealScore> {
  const config = parseConfig(listing.title);
  const configKey = config.configKey;
  // Kanoniczne zapytanie wariantu – nie zapytanie użytkownika.
  // "apple_iphone_17_256gb" → "iphone 17 256gb", nie "iphone 17 pro max"
  const variantQuery = buildVariantQuery(config);

  // Pobierz statystyki (z cache lub scrapera)
  const stats = await getPriceStats(configKey, variantQuery, condition, []);

  if (!stats || stats.median <= 0) {
    // Brak danych rynkowych – nie możemy ocenić
    return {
      configKey,
      marketMedian: 0,
      marketP25: 0,
      marketP75: 0,
      discount: 0,
      discountPct: 0,
      quality: 'normal',
    };
  }

  const discount = (stats.median - listing.price) / stats.median;
  const discountPct = Math.round(discount * 100);

  return {
    configKey,
    marketMedian: stats.median,
    marketP25: stats.p25,
    marketP75: stats.p75,
    discount,
    discountPct,
    quality: discount <= 0 ? 'normal' : classify(discount),
  };
}

// ── v2: scoreDealFromNormalized ───────────────────────────────────────────────

function noScore(): NewDealScore {
  return {
    isNoScore: true,
    configKey: undefined,
    marketMedian: 0,
    discount: 0,
    quality: 'no_data',
    p25: undefined,
    p75: undefined,
  };
}

function classifyDiscount(discount: number): DealQuality {
  if (discount <= 0) return 'normal';
  return classify(discount);
}

/**
 * Scores a deal for a NormalizedListing using the MarketSnapshot.
 * Only market_eligible listings can produce a valid score.
 * condition matching: new→new|all, used→used|all, unknown→all only
 */
export async function scoreDealFromNormalized(
  listing: NormalizedListing,
  condition: string,
): Promise<NewDealScore> {
  if (listing.eligibility !== 'market_eligible') return noScore();

  // Condition compatibility check
  const lc = listing.condition;
  const mc = condition;
  const conditionCompatible =
    (lc === 'new'     && (mc === 'new'  || mc === 'all')) ||
    (lc === 'used'    && (mc === 'used' || mc === 'all')) ||
    (lc === 'unknown' &&  mc === 'all');

  if (!conditionCompatible) return noScore();
  if (!listing.configKey) return noScore();

  const snap = getSnapshot(listing.configKey, condition);
  if (!snap || snap.stats.median <= 0) return noScore();

  const discount = (snap.stats.median - listing.price) / snap.stats.median;

  return {
    isNoScore: false,
    configKey: listing.configKey,
    marketMedian: snap.stats.median,
    discount: Math.round(discount * 100),
    quality: classifyDiscount(discount),
    p25: snap.stats.p25,
    p75: snap.stats.p75,
  };
}

// ── Etykiety UI ────────────────────────────────────────────────────────────────

export const QUALITY_LABELS: Record<DealQuality, string> = {
  normal:    'Normalna cena',
  good:      'Good Deal',
  very_good: 'Very Good Deal',
  extreme:   'Extreme Deal',
  no_data:   'Brak danych',
};

export const QUALITY_EMOJI: Record<DealQuality, string> = {
  normal:    '',
  good:      '🟡',
  very_good: '🔥',
  extreme:   '🚨',
  no_data:   '',
};
