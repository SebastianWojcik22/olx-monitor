import axios from 'axios';
import type { MonitoredItem, OlxListing } from './types.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BASE = 'https://www.olx.pl/api/v1/offers/';
const PAGE_SIZE = 40;
const MAX_PAGES = 10; // max 400 ogłoszeń na jedno wyszukiwanie

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OlxApiOffer = any;

function buildUrl(item: MonitoredItem, offset: number): string {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(PAGE_SIZE),
    query: item.searchQuery,
    sort_by: 'created_at:desc',
  });

  // Filtr ceny – API filtruje po stronie serwera
  params.append('filter_float_price:to', String(item.maxPrice));
  if (item.minPrice > 0) {
    params.append('filter_float_price:from', String(item.minPrice));
  }

  if (item.condition === 'used') params.append('filter_enum_state[0]', 'used');
  if (item.condition === 'new') params.append('filter_enum_state[0]', 'new');

  return `${BASE}?${params.toString()}`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Słowa ignorowane przy auto-derywacji z frazy (zbyt generyczne)
const STOP_WORDS = new Set(['i', 'w', 'z', 'do', 'na', 'pro', 'max', 'plus', 'mini', 'ultra', 'gb', 'tb']);

function getEffectiveKeywords(item: MonitoredItem): string[] {
  if (item.requiredKeywords.length > 0) return item.requiredKeywords;
  // Auto-derywuj z frazy wyszukiwania: każde słowo >=3 znaki musi być w tytule
  return item.searchQuery
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

function titleMatchesKeywords(title: string, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const lower = title.toLowerCase();
  const normalized = lower.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
  // Spaceless: "256gb" matches "256 gb" and vice versa
  const spaceless = lower.replace(/\s+/g, '');
  return keywords.every(kw => {
    const k = kw.toLowerCase().trim();
    return lower.includes(k) || normalized.includes(k) || spaceless.includes(k.replace(/\s+/g, ''));
  });
}

// Klucze parametrów OLX, które zawierają dane techniczne produktu
const PARAM_KEYS_STORAGE = ['memory', 'phone_memory', 'storage', 'capacity'];
const PARAM_KEYS_COLOR   = ['color', 'colour', 'phone_color'];
const PARAM_KEYS_RAM     = ['ram', 'phone_ram'];
const PARAM_KEYS_MODEL   = ['phone_model', 'model'];

function extractParams(offer: OlxApiOffer): Record<string, string> {
  const result: Record<string, string> = {};
  const params: OlxApiOffer[] = offer.params ?? [];
  for (const p of params) {
    const key: string = p.key ?? '';
    if (!key || key === 'price' || key === 'state') continue;
    const label: string = p.value?.label ?? p.value?.key ?? '';
    if (label) result[key] = label;
  }
  return result;
}

/**
 * Wzbogaca tytuł ogłoszenia o dane techniczne z sekcji parametrów OLX,
 * jeśli danych tych nie ma już w tytule. Dzięki temu config-parser,
 * keyword-matcher i price-cache dostają kompletne dane bez zmian w logice.
 */
function enrichTitle(title: string, params: Record<string, string>): string {
  let enriched = title;
  const lower = title.toLowerCase();

  // Storage (pamięć wewnętrzna) – np. "256 GB", "128GB", "1 TB"
  if (!/\b\d{2,4}\s*(?:gb|tb)\b/i.test(title)) {
    for (const key of PARAM_KEYS_STORAGE) {
      const val = params[key];
      if (val) { enriched += ` ${val}`; break; }
    }
  }

  // RAM – tylko gdy wyraźnie nie ma w tytule i param ma "RAM" w wartości
  for (const key of PARAM_KEYS_RAM) {
    const val = params[key];
    if (val && !lower.includes('ram')) { enriched += ` ${val} RAM`; break; }
  }

  // Model – jeśli tytuł nie zawiera słowa kluczowego z wartości params
  for (const key of PARAM_KEYS_MODEL) {
    const val = params[key];
    if (val) {
      const modelSlug = val.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
      const words = modelSlug.split(/\s+/).filter(w => w.length > 1);
      const alreadyIn = words.every(w => lower.includes(w));
      if (!alreadyIn) enriched += ` ${val}`;
      break;
    }
  }

  return enriched;
}

function mapOffer(offer: OlxApiOffer): OlxListing | null {
  const id = String(offer.id ?? '');
  if (!id) return null;

  const priceParam = offer.params?.find((p: OlxApiOffer) => p.key === 'price');
  const price: number = priceParam?.value?.value ?? 0;
  const priceText: string = priceParam?.value?.label ?? `${price} zł`;

  const stateParam = offer.params?.find((p: OlxApiOffer) => p.key === 'state');
  const condition: string | undefined = stateParam?.value?.label;

  const location: string =
    offer.location?.city?.name
      ? `${offer.location.city.name}${offer.location.region?.name ? `, ${offer.location.region.name}` : ''}`
      : offer.location?.region?.name ?? '';

  const postedAt: string = offer.created_time ?? offer.last_refresh_time ?? new Date().toISOString();
  const url: string = offer.url ?? '';

  const rawPhoto: string = offer.photos?.[0]?.link ?? '';
  const imageUrl = rawPhoto ? rawPhoto.replace('{width}x{height}', '300x300') : undefined;

  const description = offer.description ? stripHtml(String(offer.description)) : '';

  const params = extractParams(offer);
  const title = enrichTitle(offer.title ?? '', params);

  return { id, title, price, priceText, condition, location, postedAt, url, imageUrl, description, params };
}

async function fetchPages(
  query: string,
  condition: string,
  minPrice: number,
  maxPrice: number,
  sortBy: string,
  maxPages: number,
): Promise<OlxListing[]> {
  const all: OlxListing[] = [];

  for (let page = 0; page < maxPages; page++) {
    const offset = page * PAGE_SIZE;
    const params = new URLSearchParams({
      offset: String(offset),
      limit: String(PAGE_SIZE),
      query,
      sort_by: sortBy,
    });
    if (maxPrice > 0) params.append('filter_float_price:to', String(maxPrice));
    if (minPrice > 0) params.append('filter_float_price:from', String(minPrice));
    if (condition === 'used') params.append('filter_enum_state[0]', 'used');
    if (condition === 'new')  params.append('filter_enum_state[0]', 'new');

    const url = `${BASE}?${params.toString()}`;
    const res = await axios.get<{ data: OlxApiOffer[] }>(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json', 'Accept-Language': 'pl-PL,pl;q=0.9' },
      timeout: 15_000,
    });

    const offers: OlxApiOffer[] = res.data?.data ?? [];
    for (const offer of offers) {
      const listing = mapOffer(offer);
      if (!listing || listing.price <= 0) continue;
      all.push(listing);
    }
    if (offers.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * Pobiera ogłoszenia dla analizy cenowej:
 * - sortuje po cenie ASC (najtańsze pierwsze)
 * - brak filtrowania po słowach kluczowych w tytule
 * - łączy dwa przebiegi: cena rosnąco + cena malejąco, żeby uchwycić środek rozkładu
 */
export async function fetchPriceData(
  query: string,
  condition: string,
  minPrice: number,
  maxPrice: number,
  explicitKeywords: string[] = [],
  skipKeywordFilter = false,
  ascPages = 5,
  descPages = 5,
  recentPages = 0,
): Promise<OlxListing[]> {
  // Pobieramy strony najtańszych + najdroższych + (opcjonalnie) najnowszych
  const tasks: Promise<OlxListing[]>[] = [
    fetchPages(query, condition, minPrice, maxPrice, 'filter_float_price:asc',  ascPages),
    fetchPages(query, condition, minPrice, maxPrice, 'filter_float_price:desc', descPages),
  ];
  if (recentPages > 0) {
    tasks.push(fetchPages(query, condition, minPrice, maxPrice, 'created_at:desc', recentPages));
  }
  const results = await Promise.all(tasks);

  // Deduplikacja po id
  const seen = new Set<string>();
  const merged: OlxListing[] = [];
  for (const l of results.flat()) {
    if (!seen.has(l.id)) { seen.add(l.id); merged.push(l); }
  }

  if (skipKeywordFilter) {
    console.log(`[scraper] market-scan "${query}": ${merged.length} ogłoszeń (bez filtrowania)`);
    return merged;
  }

  // Explicit keywords z formularza mają pierwszeństwo; fallback → auto-derywacja z query
  const keywords = explicitKeywords.length > 0
    ? explicitKeywords
    : query.toLowerCase().split(/\s+/).filter(w => w.length >= 2 && !STOP_WORDS.has(w));

  const filtered = keywords.length
    ? merged.filter(l => titleMatchesKeywords(l.title, keywords))
    : merged;

  console.log(`[scraper] price-analysis "${query}": ${filtered.length} po filtrze [${keywords}] (raw=${merged.length})`);
  return filtered;
}

export async function scrapeListings(item: MonitoredItem): Promise<OlxListing[]> {
  const allListings: OlxListing[] = [];
  let totalFetched = 0;
  let totalFromApi = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE;
    const url = buildUrl(item, offset);

    const res = await axios.get<{ data: OlxApiOffer[]; metadata?: { total_elements?: number } }>(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
        'Accept-Language': 'pl-PL,pl;q=0.9',
      },
      timeout: 15_000,
    });

    const offers: OlxApiOffer[] = res.data?.data ?? [];
    if (page === 0) {
      totalFromApi = res.data?.metadata?.total_elements ?? 0;
    }

    totalFetched += offers.length;

    for (const offer of offers) {
      const listing = mapOffer(offer);
      if (!listing) continue;
      if (listing.price <= 0) continue;
      if (listing.price > item.maxPrice) continue;
      if (item.minPrice > 0 && listing.price < item.minPrice) continue;

      const effectiveKeywords = getEffectiveKeywords(item);
      if (!titleMatchesKeywords(listing.title, effectiveKeywords)) {
        console.log(`[scraper] Pominięto (brak słów [${effectiveKeywords}]): "${listing.title}"`);
        continue;
      }

      allListings.push(listing);
    }

    // Koniec wyników
    if (offers.length < PAGE_SIZE) break;

    // Doszliśmy do końca zakresu cenowego (oferty posortowane po dacie, nie cenie – nie break wcześnie)
  }

  console.log(
    `[scraper] "${item.name}": API zwróciło ~${totalFromApi} ofert, pobrano ${totalFetched}, ` +
    `po filtrach: ${allListings.length}`
  );

  return allListings;
}
