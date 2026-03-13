/**
 * Price Cache – przechowuje statystyki cenowe per configKey + condition.
 * Klucz cache: `${configKey}:${condition}` (np. "apple_iphone_17_256gb:new")
 * Dzięki temu nowe i używane mają oddzielne mediany, a dane są zawsze
 * pobierane kanonicznym zapytaniem wariantu – nie zapytaniem użytkownika.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchPriceData } from './scraper.js';
import { parseConfig } from './config-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, '..', 'data', 'price-cache.json');
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 godzin

export interface PriceStats {
  configKey: string;
  query: string;
  condition: string;
  sampleCount: number;
  median: number;
  avg: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
  updatedAt: string;
}

type CacheStore = Record<string, PriceStats>;

// ── Persistence ──────────────────────────────────────────────────────────────

function loadCache(): CacheStore {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf-8');
    return JSON.parse(raw) as CacheStore;
  } catch {
    return {};
  }
}

function saveCache(store: CacheStore): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  } catch (e) {
    console.error('[price-cache] Błąd zapisu cache:', e);
  }
}

// ── Statystyki ────────────────────────────────────────────────────────────────

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx]!;
}

function computeStats(prices: number[]): Omit<PriceStats, 'configKey' | 'query' | 'condition' | 'updatedAt'> {
  const sorted = [...prices].sort((a, b) => a - b);
  const q1 = pct(sorted, 25);
  const q3 = pct(sorted, 75);
  const iqr = q3 - q1;
  const lowerFence = Math.max(0, q1 - 1.5 * iqr);
  const upperFence = q3 + 1.5 * iqr;
  const clean = sorted.filter(p => p >= lowerFence && p <= upperFence);
  const working = clean.length >= 5 ? clean : sorted;

  return {
    sampleCount: working.length,
    median: pct(working, 50),
    avg: Math.round(working.reduce((s, v) => s + v, 0) / working.length),
    p25: pct(working, 25),
    p75: pct(working, 75),
    min: working[0]!,
    max: working[working.length - 1]!,
  };
}

// ── Refresh ──────────────────────────────────────────────────────────────────

const SUSPICIOUS = [
  'uszkodzon', 'do naprawy', 'niesprawny', 'niesprawna', 'zepsuty', 'na części',
  'jako części', 'bez ekranu', 'pęknięty', 'nie włącza', 'nie działa', 'usterka',
  'do serwisu', 'blokada icloud',
];

function isSuspicious(title: string): boolean {
  const l = title.toLowerCase();
  return SUSPICIOUS.some(p => l.includes(p));
}

async function refreshStats(
  configKey: string,
  variantQuery: string,  // kanoniczne zapytanie wariantu (buildVariantQuery), NIE zapytanie użytkownika
  condition: string,
): Promise<PriceStats | null> {
  try {
    console.log(`[price-cache] Odświeżam statystyki dla "${configKey}" (${condition})…`);
    // skipKeywordFilter=true – zapytanie jest już specyficzne, nie potrzebujemy dodatkowego filtrowania
    const listings = await fetchPriceData(variantQuery, condition, 0, 0, [], true);
    const reliable = listings
      .filter(l => !isSuspicious(l.title))
      // Filtruj wyłącznie ogłoszenia pasujące do tego dokładnego configKey
      // (np. "iphone 17 256gb" nie wciągnie Pro Maxa do mediany iPhone 17 256GB)
      .filter(l => parseConfig(l.title).configKey === configKey);

    if (reliable.length < 5) {
      console.warn(`[price-cache] Za mało ogłoszeń (${reliable.length}) dla "${configKey}:${condition}"`);
      return null;
    }
    const prices = reliable.map(l => l.price);
    const stats: PriceStats = {
      configKey, query: variantQuery, condition,
      ...computeStats(prices),
      updatedAt: new Date().toISOString(),
    };
    const store = loadCache();
    store[`${configKey}:${condition}`] = stats;
    saveCache(store);
    console.log(`[price-cache] "${configKey}:${condition}": mediana=${stats.median} zł (n=${stats.sampleCount})`);
    return stats;
  } catch (err) {
    console.error(`[price-cache] Błąd odświeżania "${configKey}":`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Zwraca statystyki cenowe dla danego configKey + condition.
 * Jeśli cache jest nieaktualny (>6h) lub brakuje wpisu – pobiera dane ze scrapera.
 * Jeśli cache jest stale – odświeża w tle (nie blokuje).
 *
 * @param variantQuery  Kanoniczne zapytanie wariantu z buildVariantQuery() – NIE zapytanie użytkownika.
 */
export async function getPriceStats(
  configKey: string,
  variantQuery: string,
  condition: string,
  _keywords: string[], // nieużywane – zachowane dla kompatybilności API
): Promise<PriceStats | null> {
  const cacheKey = `${configKey}:${condition}`;
  const store = loadCache();
  const cached = store[cacheKey];

  if (cached) {
    const age = Date.now() - new Date(cached.updatedAt).getTime();
    if (age < CACHE_TTL_MS) return cached;
    // Odśwież w tle, zwróć stare dane
    void refreshStats(configKey, variantQuery, condition);
    return cached;
  }

  // Brak wpisu – pobierz synchronicznie
  return refreshStats(configKey, variantQuery, condition);
}

/**
 * Zapisuje gotowe statystyki do cache (używane przez handleMarketScan
 * żeby deal-scorer mógł od razu skorzystać z wyników zakładki Rynek).
 */
export function setPriceStats(stats: PriceStats): void {
  const store = loadCache();
  store[`${stats.configKey}:${stats.condition}`] = stats;
  saveCache(store);
}

export function invalidatePriceCache(configKey: string): void {
  const store = loadCache();
  for (const key of Object.keys(store)) {
    if (key === configKey || key.startsWith(`${configKey}:`)) delete store[key];
  }
  saveCache(store);
}

export function getAllCachedKeys(): string[] {
  return [...new Set(Object.keys(loadCache()).map(k => k.split(':')[0]!))];
}

export function getCachedStats(configKey: string, condition: string): PriceStats | null {
  const store = loadCache();
  return store[`${configKey}:${condition}`] ?? null;
}
