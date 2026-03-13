import { randomUUID } from 'node:crypto';
import {
  loadItems,
  upsertItem,
  deleteItem,
  loadDeals,
  upsertDeal,
  deleteDeal,
  getDeal,
  loadImeiRecords,
  upsertImeiRecord,
  deleteImeiRecord,
  getImeiRecord,
} from './store.js';
import { checkItem, rescheduleItem, removeItemSchedule } from './scheduler.js';
import { analyzeListing } from './analyzer.js';
import { fetchPriceData } from './scraper.js';
import { parseConfig, buildVariantQuery } from './config-parser.js';
import type { ProductConfig } from './config-parser.js';
import { setPriceStats, getCachedStats } from './price-cache.js';
import { scrapeListings } from './scraper.js';
import type { MonitoredItem, Deal, DealQuality, HandlerResult, OlxListing, ImeiRecord } from './types.js';
import { runVerification, fetchOlxListing } from './imei-checker.js';
import { computeSnapshot } from './market/market-scanner.js';
import { findSnapshot } from './market/snapshot-store.js';

const DEFAULT_INTERVAL = Number(process.env.OLX_CHECK_INTERVAL ?? 15);

function parseKeywords(val: string | string[] | undefined): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(k => k.trim()).filter(Boolean);
  return val.split(',').map(k => k.trim()).filter(Boolean);
}

function ok(data: unknown): HandlerResult {
  return { status: 200, body: { ok: true, data } };
}
function created(data: unknown): HandlerResult {
  return { status: 201, body: { ok: true, data } };
}
function notFound(msg = 'Not found'): HandlerResult {
  return { status: 404, body: { ok: false, error: msg } };
}
function badRequest(msg: string): HandlerResult {
  return { status: 400, body: { ok: false, error: msg } };
}
function err500(msg: string): HandlerResult {
  return { status: 500, body: { ok: false, error: msg } };
}

// ── Items ──────────────────────────────────────────────────────────────────

export function handleGetItems(): HandlerResult {
  return ok(loadItems());
}

export function handleCreateItem(body: unknown): HandlerResult {
  const b = body as Partial<MonitoredItem> & { requiredKeywords?: string | string[] };
  if (!b.name || !b.searchQuery || !b.maxPrice) {
    return badRequest('name, searchQuery i maxPrice są wymagane');
  }

  const item: MonitoredItem = {
    id: randomUUID(),
    name: b.name,
    searchQuery: b.searchQuery,
    maxPrice: Number(b.maxPrice),
    minPrice: Number(b.minPrice ?? 0),
    categoryId: b.categoryId ? Number(b.categoryId) : undefined,
    requiredKeywords: parseKeywords(b.requiredKeywords),
    condition: b.condition ?? 'all',
    intervalMinutes: Number(b.intervalMinutes ?? DEFAULT_INTERVAL),
    enabled: b.enabled ?? true,
    customMessage: b.customMessage ? String(b.customMessage).trim() || undefined : undefined,
    minDealQuality: (['normal','good','very_good','extreme'] as const).includes(b.minDealQuality as never)
      ? b.minDealQuality : 'good',
    createdAt: new Date().toISOString(),
  };

  upsertItem(item);
  rescheduleItem(item);
  return created(item);
}

export function handleUpdateItem(id: string, body: unknown): HandlerResult {
  const items = loadItems();
  const existing = items.find(i => i.id === id);
  if (!existing) return notFound(`Item ${id} nie istnieje`);

  const b = body as Partial<MonitoredItem>;
  const bk = body as Partial<MonitoredItem> & { requiredKeywords?: string | string[] };
  const updated: MonitoredItem = {
    ...existing,
    ...(bk.name !== undefined && { name: bk.name }),
    ...(bk.searchQuery !== undefined && { searchQuery: bk.searchQuery }),
    ...(bk.maxPrice !== undefined && { maxPrice: Number(bk.maxPrice) }),
    ...(bk.minPrice !== undefined && { minPrice: Number(bk.minPrice) }),
    ...(bk.categoryId !== undefined && { categoryId: bk.categoryId ? Number(bk.categoryId) : undefined }),
    ...(bk.requiredKeywords !== undefined && { requiredKeywords: parseKeywords(bk.requiredKeywords) }),
    ...(bk.condition !== undefined && { condition: bk.condition }),
    ...(bk.intervalMinutes !== undefined && { intervalMinutes: Number(bk.intervalMinutes) }),
    ...(bk.enabled !== undefined && { enabled: Boolean(bk.enabled) }),
    ...(bk.customMessage !== undefined && { customMessage: bk.customMessage ? String(bk.customMessage).trim() || undefined : undefined }),
    ...(bk.minDealQuality !== undefined && { minDealQuality: bk.minDealQuality }),
  };

  upsertItem(updated);
  rescheduleItem(updated);
  return ok(updated);
}

export function handleDeleteItem(id: string): HandlerResult {
  const removed = deleteItem(id);
  if (!removed) return notFound(`Item ${id} nie istnieje`);
  removeItemSchedule(id);
  return ok({ deleted: id });
}

export async function handleCheckNow(itemId: string): Promise<HandlerResult> {
  const items = loadItems();
  const item = items.find(i => i.id === itemId);
  if (!item) return notFound(`Item ${itemId} nie istnieje`);

  try {
    const newDeals = await checkItem(item);
    return ok({ newDeals });
  } catch (err) {
    return err500(err instanceof Error ? err.message : 'Błąd podczas sprawdzania');
  }
}

// ── Deals ──────────────────────────────────────────────────────────────────

function classifyLiveDiscount(discount: number): DealQuality {
  if (discount <= 0.05) return 'normal';
  if (discount <= 0.15) return 'good';
  if (discount <= 0.30) return 'very_good';
  return 'extreme';
}

export function handleGetDeals(): HandlerResult {
  const itemsList = loadItems();
  const deals = loadDeals()
    .sort((a, b) => new Date(b.foundAt).getTime() - new Date(a.foundAt).getTime())
    .map(deal => {
      if (!deal.configKey) return { ...deal, liveDataConfidence: 'no_data' as const };
      // Use monitor condition for lookup, but fall back to compatible conditions
      // (snapshot may be stored under 'used'/'new' while monitor condition is 'all')
      const monitorCondition = itemsList.find(i => i.id === deal.itemId)?.condition ?? 'all';
      const snap = findSnapshot(deal.configKey, monitorCondition);
      if (!snap) return { ...deal, liveMarketMedian: undefined, liveDataConfidence: 'no_data' as const };
      const discount = (snap.stats.median - deal.listing.price) / snap.stats.median;
      return {
        ...deal,
        liveMarketMedian: snap.stats.median,
        liveDiscount: Math.round(discount * 100),
        liveQuality: classifyLiveDiscount(discount),
        liveDataConfidence: snap.dataConfidence,
      };
    });
  return ok(deals);
}

export function handleUpdateDeal(id: string, body: unknown): HandlerResult {
  const deal = getDeal(id);
  if (!deal) return notFound(`Deal ${id} nie istnieje`);

  const b = body as Partial<Deal> & { salePrice?: number; purchasePrice?: number; soldAt?: string };
  const purchasePrice = b.purchasePrice !== undefined ? Number(b.purchasePrice) : undefined;
  const salePrice     = b.salePrice     !== undefined ? Number(b.salePrice)     : undefined;

  // Build update — price=0 or soldAt='' means "clear the field" (used for sale revert)
  const updated = { ...deal } as Deal;
  if (b.contactStatus !== undefined) updated.contactStatus = b.contactStatus;
  if (b.sellerReply   !== undefined) updated.sellerReply   = b.sellerReply;
  if (b.notes         !== undefined) updated.notes         = b.notes;
  if (b.dismissed     !== undefined) updated.dismissed     = Boolean(b.dismissed);
  if (purchasePrice   !== undefined) {
    if (purchasePrice > 0) updated.purchasePrice = purchasePrice;
    else delete updated.purchasePrice;
  }
  if (salePrice !== undefined) {
    if (salePrice > 0) updated.salePrice = salePrice;
    else delete updated.salePrice;
  }
  if (b.purchasedAt !== undefined) {
    if (b.purchasedAt) updated.purchasedAt = b.purchasedAt;
    else delete updated.purchasedAt;
  }
  if (b.soldAt !== undefined) {
    if (b.soldAt) updated.soldAt = b.soldAt;
    else delete updated.soldAt;
  }

  // Save immutable market median at time of purchase
  if (b.contactStatus === 'purchased' && updated.configKey) {
    const condition = loadItems().find(i => i.id === updated.itemId)?.condition ?? 'all';
    const snap = findSnapshot(updated.configKey, condition);
    updated.marketMedianAtPurchase =
      snap?.stats.median ?? updated.liveMarketMedian ?? updated.marketMedian ?? 0;
  }

  upsertDeal(updated);
  return ok(updated);
}

export function handleDeleteDeal(id: string): HandlerResult {
  const removed = deleteDeal(id);
  if (!removed) return notFound(`Deal ${id} nie istnieje`);
  return ok({ deleted: id });
}

export async function handleReanalyzeDeal(id: string): Promise<HandlerResult> {
  const deal = getDeal(id);
  if (!deal) return notFound(`Deal ${id} nie istnieje`);

  try {
    const analysis = await analyzeListing(deal.listing);
    const updated: Deal = { ...deal, analysis };
    upsertDeal(updated);
    return ok(updated);
  } catch (err) {
    return err500(err instanceof Error ? err.message : 'Błąd analizy AI');
  }
}

export function handleHealth(): HandlerResult {
  return ok({ uptime: process.uptime(), timestamp: new Date().toISOString() });
}

// ── Price Stats (cache lookup) ───────────────────────────────────────────────

/** Zwraca cached statystyki cenowe dla danego configKey+condition (do formularza edycji). */
export function handleGetPriceStats(configKey: string, condition: string): HandlerResult {
  if (!configKey) return badRequest('configKey jest wymagane');
  const stats = getCachedStats(configKey, condition);
  if (!stats) return { status: 404, body: { ok: false, error: 'Brak danych w cache' } };
  return ok({ median: stats.median, p25: stats.p25, p75: stats.p75, sampleCount: stats.sampleCount, updatedAt: stats.updatedAt });
}

// ── Browse Item (live OLX scan for budget view) ───────────────────────────────

/** Zwraca aktualne ogłoszenia OLX dla danego przedmiotu (do widoku "W budżecie"). */
export async function handleBrowseItem(itemId: string): Promise<HandlerResult> {
  const item = loadItems().find(i => i.id === itemId);
  if (!item) return { status: 404, body: { ok: false, error: 'Przedmiot nie znaleziony' } };
  try {
    const listings = await scrapeListings(item);
    return ok({ listings, itemName: item.name, maxPrice: item.maxPrice });
  } catch (err) {
    return err500(err instanceof Error ? err.message : 'Błąd skanowania');
  }
}

// ── Price Analysis ──────────────────────────────────────────────────────────

const SUSPICIOUS_PHRASES = [
  'uszkodzon', 'do naprawy', 'niesprawny', 'niesprawna', 'zepsuty', 'zepsuta',
  'rozbity', 'rozbita', 'stłuczony', 'stłuczona', 'na części', 'jako części',
  'bez ekranu', 'pęknięty', 'pęknięta', 'mokry', 'zalany', 'zalana',
  'nie włącza', 'nie działa', 'usterka', 'defekt', 'wymaga naprawy', 'po naprawie',
  'do serwisu', 'martwy', 'blokada icloud', 'icloud lock',
];

function isSuspicious(title: string): boolean {
  const lower = title.toLowerCase();
  return SUSPICIOUS_PHRASES.some(p => lower.includes(p));
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx]!;
}

export async function handlePriceAnalysis(
  query: string,
  condition: string,
  _minPrice = 0,   // STABLE RULE: minPrice never used – market always from 0 PLN
  _keywords = '',
): Promise<HandlerResult> {
  if (!query.trim()) return badRequest('query jest wymagane');

  try {
    const { snapshots } = await computeSnapshot(query, condition);

    if (!snapshots.length) {
      return ok({ variants: [], message: 'Nie znaleziono wariantów', requiresSelection: false });
    }

    const formatVariant = (snap: (typeof snapshots)[0]) => ({
      configKey: snap.configKey,
      label: snap.label,
      sampleCount: snap.marketEligibleCount,
      stats: snap.stats,
      cheapest: snap.cheapestEligible,
      cheapestVisible: snap.cheapestVisible,
      histogram: snap.histogram,
      dataConfidence: snap.dataConfidence,
    });

    if (snapshots.length === 1) {
      return ok({
        variant: formatVariant(snapshots[0]!),
        variants: null,
        requiresSelection: false,
        dataConfidence: snapshots[0]!.dataConfidence,
      });
    }

    return ok({
      variant: null,
      variants: snapshots.map(formatVariant),
      requiresSelection: true,
      message: `Znaleziono ${snapshots.length} wariantów. Wybierz.`,
    });
  } catch (err) {
    return err500(err instanceof Error ? err.message : 'Błąd analizy cen');
  }
}

// ── Market Scan ─────────────────────────────────────────────────────────────

const ACCESSORY_PHRASES = [
  // Jednoznaczne nazwy akcesorii (polskie)
  'etui', 'nakładka', 'nakładki', 'obudowa', 'obudowy',
  'szkło ochronne', 'szkiełko', 'szkło hartowane',
  'folia ochronna', 'folia do', 'folie do',
  'ładowarka', 'ładowarki', 'kabel usb', 'kabel do', 'kable do',
  'kabura', 'słuchawki', 'uchwyt', 'smycz', 'podstawka',
  'powerbank', 'futerał', 'pokrowiec', 'pokrowce', 'zaślepki',
  'ochraniacz', 'szkło prywatyzuj',
  // Zwroty wskazujące na akcesorium (nie telefon)
  'do iphone', 'na iphone', 'do samsung', 'na samsung',
  'do macbook', 'na macbook', 'do ipad', 'na ipad',
  'pasuje do', 'kompatybilny z', 'dedykowane do',
  // Angielskie (jednoznaczne akcesoria)
  'tempered glass', 'screen protector', 'phone case', 'back cover',
  'charger cable', 'tpu case', 'leather case', 'wallet case',
  'bumper case', 'sleeve for',
];

function isAccessory(title: string): boolean {
  const lower = title.toLowerCase();
  return ACCESSORY_PHRASES.some(p => lower.includes(p));
}


function buildVariantLabel(c: ProductConfig): string {
  const parts: string[] = [];
  if (c.model) {
    parts.push(c.model.split('_').map(w => {
      if (w === 'rtx')  return 'RTX';
      if (w === 'rx')   return 'RX';
      if (w === 'xt')   return 'XT';
      if (w === 'xtx')  return 'XTX';
      if (w === 'x3d')  return 'X3D';
      if (w === 'oled') return 'OLED';
      if (/^m\d$/.test(w)) return w.toUpperCase();  // m1 → M1, m4 → M4
      if (w === 'i3' || w === 'i5' || w === 'i7' || w === 'i9') return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' '));
  }
  if (c.variant) {
    parts.push(c.variant.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
  }
  if (c.chip)       parts.push(c.chip.toUpperCase().replace(/_/g, ' '));
  if (c.screenSize) parts.push(`${c.screenSize}"`);
  if (c.ram)        parts.push(c.ram.toUpperCase());
  if (c.storage)    parts.push(c.storage.toUpperCase());
  return parts.join(' ') || c.configKey;
}

export async function handleMarketScan(
  query: string,
  condition: string,
  _minPrice = 0,  // STABLE RULE: minPrice ignored – market always from 0 PLN
): Promise<HandlerResult> {
  if (!query.trim()) return badRequest('query jest wymagane');

  try {
    const { snapshots } = await computeSnapshot(query, condition);
    return ok({
      query,
      condition,
      totalFetched: snapshots.reduce((s, n) => s + n.rawCount, 0),
      variants: snapshots.map(snap => ({
        configKey: snap.configKey,
        label: snap.label,
        sampleCount: snap.marketEligibleCount,
        stats: snap.stats,
        cheapest: snap.cheapestEligible,
        cheapestVisible: snap.cheapestVisible,
        histogram: snap.histogram,
        keywords: snap.keywords,
        dataConfidence: snap.dataConfidence,
        diagnostics: {
          raw: snap.rawCount,
          rejected: snap.rejectedCount,
          visibleOnly: snap.visibleOnlyCount,
        },
      })),
    });
  } catch (err) {
    return err500(err instanceof Error ? err.message : 'Błąd skanowania rynku');
  }
}

// ── handleMarketScan_legacy (kept for backward compat reference only) ─────────
async function _legacyMarketScan(
  query: string,
  condition: string,
  minPrice = 0,
): Promise<HandlerResult> {
  if (!query.trim()) return badRequest('query jest wymagane');

  try {
    // Przekazuj minPrice bezpośrednio do OLX API (server-side filter)
    const raw = await fetchPriceData(query, condition, minPrice, 0, [], true, 10, 4, 3);

    // Odrzuć akcesoria (jako dodatkowy filtr na wypadek gdyby minPrice nie wystarczył)
    const listings = raw.filter(l => !isAccessory(l.title));

    console.log(`[market-scan] "${query}": ${raw.length} raw → ${listings.length} po filtrze akcesorii`);

    // Grupowanie po configKey
    const groups = new Map<string, { config: ProductConfig; prices: number[]; cheapest: OlxListing[] }>();
    for (const listing of listings) {
      const config = parseConfig(listing.title);
      if (!config.configKey) continue;

      // Odrzuć listingi z RAM <4GB dla nowoczesnych smartfonów (iPhone 15+, Galaxy S24+, iPad Pro)
      // Takie ogłoszenia to albo starszy model błędnie pasujący do zapytania, albo zanieczyszczony tytuł
      if (config.ram) {
        const ramGb = Number(config.ram.replace(/[^0-9]/g, ''));
        const isModernPhone = /^(iphone_1[5-9]|iphone_2\d|galaxy_s2[4-9]|galaxy_s[3-9]\d|ipad_pro)/.test(config.model ?? '');
        if (isModernPhone && ramGb < 4) continue;
      }

      const key = config.configKey;
      if (!groups.has(key)) groups.set(key, { config, prices: [], cheapest: [] });
      const g = groups.get(key)!;
      g.prices.push(listing.price);
      g.cheapest.push(listing);
    }

    // Zbierz ogłoszenia bez podanej pojemności (np. "iPhone 17 Pro Max" bez "256GB")
    // Będą dołączone do cheapest każdego wariantu o tym samym modelu+wariancie
    const noStoragePool = new Map<string, OlxListing[]>();
    for (const [, g] of groups) {
      const needsStorage = /^(iphone|ipad|macbook|mac_mini|mac_studio|mac_pro|galaxy)/.test(g.config.model ?? '');
      if (needsStorage && !g.config.storage && g.config.model) {
        const parentKey = [g.config.brand, g.config.model, g.config.variant].filter(Boolean).join('_');
        if (!noStoragePool.has(parentKey)) noStoragePool.set(parentKey, []);
        noStoragePool.get(parentKey)!.push(...g.cheapest);
      }
    }

    // Pass 2: ukierunkowane wyszukiwanie per wariant (price:asc) dla najtańszych
    // Problem: przy szerokim zapytaniu "iPhone 17" strony price:asc są zdominowane przez
    // najtańsze modele (base 256GB). Droższe warianty (Pro Max) pojawiają się dopiero
    // na dalszych stronach, gdzie ich najtańsze egzemplarze mogą nie trafić do naszej próbki.
    // Rozwiązanie: dla każdego zidentyfikowanego wariantu robimy celowane zapytanie.
    const validForTargeted = [...groups.entries()].filter(([, g]) => {
      const needsStorage = /^(iphone|ipad|macbook|mac_mini|mac_studio|mac_pro|galaxy)/.test(g.config.model ?? '');
      return needsStorage ? !!g.config.storage && g.prices.length >= 3 : !!g.config.model && g.prices.length >= 3;
    });

    const targetedResults = await Promise.all(
      validForTargeted.map(([key, g]) =>
        fetchPriceData(buildVariantQuery(g.config), condition, minPrice, 0, [], true, 4, 0, 0)
          .then(res => ({
            key,
            listings: res.filter(l => !isAccessory(l.title) && parseConfig(l.title).configKey === key),
          }))
          .catch(() => ({ key, listings: [] as OlxListing[] }))
      )
    );

    // Mapa dodatkowych tanich ogłoszeń per configKey (nie wchodzą do g.prices – nie zmieniają statystyk)
    const targetedCheapest = new Map<string, OlxListing[]>();
    for (const { key, listings } of targetedResults) {
      targetedCheapest.set(key, listings);
    }

    // Statystyki per wariant (min. 3 próbki)
    const variants = [...groups.entries()]
      .filter(([, g]) => {
        // Telefony, tablety i laptopy wymagają storage jako różnicatora wariantów
        const needsStorage = /^(iphone|ipad|macbook|mac_mini|mac_studio|mac_pro|galaxy)/.test(g.config.model ?? '');
        if (needsStorage) return !!g.config.storage && g.prices.length >= 3;
        // GPU, konsole, CPU – model IS wariantem, storage nie wymagany
        return !!g.config.model && g.prices.length >= 3;
      })
      .map(([configKey, g]) => {
        // Merge broad + targeted → jeden spójny zbiór dla stats I cheapest
        const targeted = targetedCheapest.get(configKey) ?? [];
        const seenForStats = new Set<string>();
        const allListings = [...g.cheapest, ...targeted].filter(l => {
          if (seenForStats.has(l.id)) return false;
          seenForStats.add(l.id);
          return true;
        });

        // Stats z MERGED set – min będzie równe cheapest[0].price
        const sorted = allListings.map(l => l.price).sort((a, b) => a - b);
        const q1 = percentile(sorted, 25), q3 = percentile(sorted, 75), iqr = q3 - q1;
        const lo = Math.max(0, q1 - 1.5 * iqr), hi = q3 + 1.5 * iqr;
        const clean = sorted.filter(p => p >= lo && p <= hi);
        const work = clean.length >= 3 ? clean : sorted;

        const stats = {
          min: sorted[0]!,              // PRAWDZIWE minimum z merged set
          max: work[work.length - 1]!,  // max po IQR (eliminuje fałszywe szczyty)
          median: percentile(work, 50),
          avg: Math.round(work.reduce((s, p) => s + p, 0) / work.length),
          p25: percentile(work, 25),
          p75: percentile(work, 75),
        };

        // Słowa kluczowe specyficzne dla tego wariantu
        const c = g.config;
        const kw: string[] = [];
        if (c.model)      kw.push(...c.model.split('_').filter(Boolean));
        if (c.variant)    kw.push(...c.variant.split('_').filter(Boolean));
        if (c.chip)       kw.push(...c.chip.split('_').filter(Boolean));
        if (c.storage)    kw.push(c.storage.toLowerCase());
        if (c.screenSize) kw.push(c.screenSize);
        const keywords = [...new Set(kw)];

        // 7 najtańszych z tego samego merged set + noStoragePool
        const parentKey = [c.brand, c.model, c.variant].filter(Boolean).join('_');
        const extra = noStoragePool.get(parentKey) ?? [];
        const seenIds = new Set<string>();
        const cheapest = [
          ...allListings.map(l => ({ ...l, storageUnspecified: false })),
          ...extra.map(l => ({ ...l, storageUnspecified: true })),
        ]
          .sort((a, b) => a.price - b.price)
          .filter(l => { if (seenIds.has(l.id)) return false; seenIds.add(l.id); return true; })
          .slice(0, 7)
          .map(l => ({
            title: l.title,
            price: l.price,
            priceText: l.priceText,
            url: l.url,
            location: l.location,
            postedAt: l.postedAt,
            suspiciouslyLow: l.price < stats.median * 0.50,
            storageUnspecified: l.storageUnspecified,
          }));

        // Histogram cenowy – pełny zakres (sorted[0]..sorted[last]), bez piling outlierów
        // Każdy bucket to równy przedział cenowy; nie ma sztucznych skoków na krawędziach
        const BUCKETS = 10;
        const hMin = sorted[0]!;
        const hMax = sorted[sorted.length - 1]!;
        const bucketSize = Math.max(1, (hMax - hMin) / BUCKETS);
        const histogram = Array.from({ length: BUCKETS }, (_, i) => ({
          from: Math.round(hMin + i * bucketSize),
          to: Math.round(hMin + (i + 1) * bucketSize),
          count: 0,
        }));
        for (const price of sorted) {
          const idx = Math.min(BUCKETS - 1, Math.floor((price - hMin) / bucketSize));
          histogram[idx]!.count++;
        }

        // Zapisz do cache – deal scorer będzie mógł od razu skorzystać z tych danych
        setPriceStats({
          configKey,
          query: buildVariantQuery(c),
          condition,
          sampleCount: g.prices.length,
          median: stats.median,
          avg: stats.avg,
          p25: stats.p25,
          p75: stats.p75,
          min: stats.min,
          max: stats.max,
          updatedAt: new Date().toISOString(),
        });

        return { configKey, label: buildVariantLabel(c), sampleCount: g.prices.length, stats, keywords, cheapest, histogram };
      })
      .sort((a, b) => b.sampleCount - a.sampleCount);

    return ok({ query, condition, totalFetched: listings.length, variants });
  } catch (err) {
    return err500(err instanceof Error ? err.message : 'Błąd skanowania rynku');
  }
}

// ── IMEI / Serial verification ────────────────────────────────────────────

export function handleImeiList(): HandlerResult {
  const records = loadImeiRecords().sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return ok(records);
}

export async function handleFetchListing(url: string): Promise<HandlerResult> {
  try {
    const data = await fetchOlxListing(url);
    return ok(data);
  } catch (e) {
    return err500(e instanceof Error ? e.message : 'Błąd pobierania ogłoszenia');
  }
}

export async function handleImeiCreate(body: unknown): Promise<HandlerResult> {
  const b = body as Record<string, unknown>;
  const imei = typeof b['imei'] === 'string' ? b['imei'].trim() : undefined;
  const serial = typeof b['serial'] === 'string' ? b['serial'].trim() : undefined;

  if (!imei && !serial) {
    return { status: 400, body: { ok: false, error: 'Podaj IMEI lub numer seryjny' } };
  }

  const listingTitle       = typeof b['listingTitle']       === 'string' ? b['listingTitle']       : undefined;
  const listingId          = typeof b['listingId']          === 'string' ? b['listingId']          : undefined;
  const listingUrl         = typeof b['listingUrl']         === 'string' ? b['listingUrl']         : undefined;
  const listingDescription = typeof b['listingDescription'] === 'string' ? b['listingDescription'] : undefined;

  const record: ImeiRecord = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...(imei    ? { imei }    : {}),
    ...(serial  ? { serial }  : {}),
    ...(listingId          ? { listingId }          : {}),
    ...(listingTitle       ? { listingTitle }       : {}),
    ...(listingUrl         ? { listingUrl }         : {}),
    ...(listingDescription ? { listingDescription } : {}),
  };

  record.verification = await runVerification(imei, serial, listingTitle, listingDescription);
  upsertImeiRecord(record);
  return created(record);
}

export async function handleImeiVerify(id: string): Promise<HandlerResult> {
  const record = getImeiRecord(id);
  if (!record) return { status: 404, body: { ok: false, error: 'Rekord nie znaleziony' } };

  record.verification = await runVerification(record.imei, record.serial, record.listingTitle, record.listingDescription);
  upsertImeiRecord(record);
  return ok(record);
}

export function handleImeiDelete(id: string): HandlerResult {
  const deleted = deleteImeiRecord(id);
  if (!deleted) return { status: 404, body: { ok: false, error: 'Rekord nie znaleziony' } };
  return ok({ deleted: true });
}
