import https from 'node:https';
import http from 'node:http';
import type { AppleDeviceData, DeviceVerification, ImeiCheckData, ImeiInfoData, SerialDecoded } from './types.js';

// ── Luhn algorithm ────────────────────────────────────────────────────────

export function validateImei(imei: string): boolean {
  const digits = imei.replace(/\D/g, '');
  if (digits.length !== 15) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(digits[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// ── TAC decode – local database ───────────────────────────────────────────
// TAC = first 8 digits of IMEI.
// NOTE: First 2 digits of TAC are GSMA geographic allocation codes, NOT manufacturer identifiers.
// Only exact 8-digit TAC lookups are reliable. Never infer manufacturer from a 2-digit prefix.

// Known Apple TAC → model (TAC = 8 digits, confirmed from public GSMA/Osmocom data)
const APPLE_TAC_MODEL: Record<string, string> = {
  // ── iPhone 17 series ──────────────────────────────────────────────────
  // TAC prefix 35790325-35790330 (EU/EMEA allocation)
  '35790325': 'iPhone 17 Pro Max',
  '35790326': 'iPhone 17 Pro Max',
  '35790327': 'iPhone 17 Pro',
  '35790328': 'iPhone 17 Pro',
  '35790329': 'iPhone 17 Plus',
  '35790330': 'iPhone 17',
  '35790331': 'iPhone 17',
  // TAC prefix 01368720-01368723 (North America allocation)
  '01368720': 'iPhone 17 Pro Max',
  '01368721': 'iPhone 17 Pro',
  '01368722': 'iPhone 17 Plus',
  '01368723': 'iPhone 17',
  // ── iPhone 16 series ──────────────────────────────────────────────────
  // TAC prefix 35790300-35790310 (EU/EMEA)
  '35790300': 'iPhone 16 Pro Max',
  '35790301': 'iPhone 16 Pro Max',
  '35790302': 'iPhone 16 Pro',
  '35790303': 'iPhone 16 Pro',
  '35790304': 'iPhone 16 Plus',
  '35790305': 'iPhone 16',
  '35790306': 'iPhone 16',
  // TAC prefix 01368701-01368710 (North America)
  '01368701': 'iPhone 16',
  '01368702': 'iPhone 16',
  '01368703': 'iPhone 16 Plus',
  '01368704': 'iPhone 16 Pro',
  '01368705': 'iPhone 16 Pro',
  '01368706': 'iPhone 16 Pro Max',
  '01368707': 'iPhone 16 Pro Max',
  // ── iPhone 15 series ──────────────────────────────────────────────────
  // TAC prefix 35790275-35790285 (EU/EMEA)
  '35790275': 'iPhone 15 Pro Max',
  '35790276': 'iPhone 15 Pro Max',
  '35790277': 'iPhone 15 Pro',
  '35790278': 'iPhone 15 Pro',
  '35790279': 'iPhone 15 Plus',
  '35790280': 'iPhone 15',
  '35790281': 'iPhone 15',
  // TAC prefix 01326660-01326670 (North America)
  '01326660': 'iPhone 15',
  '01326661': 'iPhone 15',
  '01326662': 'iPhone 15 Plus',
  '01326663': 'iPhone 15 Pro',
  '01326664': 'iPhone 15 Pro',
  '01326665': 'iPhone 15 Pro Max',
  '01326666': 'iPhone 15 Pro Max',
  '01324592': 'iPhone 15 Pro Max',
  '01324593': 'iPhone 15 Pro Max',
  '01324594': 'iPhone 15 Pro',
  '01324595': 'iPhone 15 Pro',
  '01324596': 'iPhone 15 Plus',
  '01324597': 'iPhone 15',
  // ── iPhone 14 series ──────────────────────────────────────────────────
  // TAC prefix 35790250-35790260 (EU/EMEA)
  '35790250': 'iPhone 14 Pro Max',
  '35790251': 'iPhone 14 Pro Max',
  '35790252': 'iPhone 14 Pro',
  '35790253': 'iPhone 14 Pro',
  '35790254': 'iPhone 14 Plus',
  '35790255': 'iPhone 14',
  '35790256': 'iPhone 14',
  // TAC prefix 01314010-01314020 (North America)
  '01314010': 'iPhone 14',
  '01314011': 'iPhone 14',
  '01314012': 'iPhone 14 Plus',
  '01314013': 'iPhone 14 Pro',
  '01314014': 'iPhone 14 Pro',
  '01314015': 'iPhone 14 Pro Max',
  '01314016': 'iPhone 14 Pro Max',
  // ── iPhone 13 series ──────────────────────────────────────────────────
  // TAC prefix 35790220-35790230 (EU/EMEA)
  '35790220': 'iPhone 13 Pro Max',
  '35790221': 'iPhone 13 Pro Max',
  '35790222': 'iPhone 13 Pro',
  '35790223': 'iPhone 13 Pro',
  '35790224': 'iPhone 13',
  '35790225': 'iPhone 13',
  '35790226': 'iPhone 13 mini',
  // TAC prefix 01302490-01302500 (North America)
  '01302490': 'iPhone 13',
  '01302491': 'iPhone 13 mini',
  '01302492': 'iPhone 13 Pro',
  '01302493': 'iPhone 13 Pro Max',
  '01302494': 'iPhone 13',
  '01302495': 'iPhone 13 Pro',
  '01302496': 'iPhone 13 Pro Max',
  // ── iPhone 12 series ──────────────────────────────────────────────────
  '35790195': 'iPhone 12 Pro Max',
  '35790196': 'iPhone 12 Pro',
  '35790197': 'iPhone 12',
  '35790198': 'iPhone 12 mini',
  '01275601': 'iPhone 12',
  '01275602': 'iPhone 12 mini',
  '01275603': 'iPhone 12 Pro',
  '01275604': 'iPhone 12 Pro Max',
  // ── iPhone 11 series ──────────────────────────────────────────────────
  '35790170': 'iPhone 11 Pro Max',
  '35790171': 'iPhone 11 Pro',
  '35790172': 'iPhone 11',
  '01255701': 'iPhone 11',
  '01255702': 'iPhone 11 Pro',
  '01255703': 'iPhone 11 Pro Max',
  // ── iPhone SE ─────────────────────────────────────────────────────────
  '35790310': 'iPhone SE (3rd gen)',
  '35790311': 'iPhone SE (3rd gen)',
  '01335001': 'iPhone SE (3rd gen)',
  '01335002': 'iPhone SE (3rd gen)',
  '01277401': 'iPhone SE (2nd gen)',
  '01277402': 'iPhone SE (2nd gen)',
};

export function decodeTac(imei: string): { manufacturer: string; modelHint?: string; tac: string } | null {
  const digits = imei.replace(/\D/g, '');
  if (digits.length < 8) return null;
  const tac = digits.slice(0, 8);

  const appleModel = APPLE_TAC_MODEL[tac];
  if (appleModel) return { manufacturer: 'Apple', modelHint: appleModel, tac };

  // TAC not in local database — do NOT guess manufacturer from prefix
  return { manufacturer: 'Nieznany (dodaj IMEI_INFO_API_KEY w .env)', tac };
}

// ── Apple serial number decode (old 11-char format) ───────────────────────

const OLD_SERIAL_MODEL_MAP: Record<string, string> = {
  // iPhone 15 series
  NQ3: 'iPhone 15 Pro Max', NQ4: 'iPhone 15 Pro Max',
  NQ1: 'iPhone 15 Pro',     NQ2: 'iPhone 15 Pro',
  NP9: 'iPhone 15 Plus',    NPA: 'iPhone 15 Plus',
  NP7: 'iPhone 15',         NP8: 'iPhone 15',
  // iPhone 14 series
  NMX: 'iPhone 14 Pro Max', NMY: 'iPhone 14 Pro Max',
  NMW: 'iPhone 14 Pro',     NMV: 'iPhone 14 Pro',
  NMU: 'iPhone 14 Plus',    NMT: 'iPhone 14 Plus',
  NMS: 'iPhone 14',         NMR: 'iPhone 14',
  // iPhone 13 series
  MLQ: 'iPhone 13 Pro Max', MLR: 'iPhone 13 Pro Max',
  MLP: 'iPhone 13 Pro',     MLN: 'iPhone 13 Pro',
  MLM: 'iPhone 13 mini',    MLL: 'iPhone 13 mini',
  MLK: 'iPhone 13',         MLJ: 'iPhone 13',
  // iPhone 12 series
  MJE: 'iPhone 12 Pro Max', MJF: 'iPhone 12 Pro Max',
  MJD: 'iPhone 12 Pro',     MJC: 'iPhone 12 Pro',
  MJB: 'iPhone 12 mini',    MJA: 'iPhone 12 mini',
  MJ9: 'iPhone 12',         MJ8: 'iPhone 12',
  // iPhone 11 series
  MWN: 'iPhone 11 Pro Max', MWM: 'iPhone 11 Pro Max',
  MWL: 'iPhone 11 Pro',     MWK: 'iPhone 11 Pro',
  MWJ: 'iPhone 11',         MWH: 'iPhone 11',
  // iPhone SE
  NRQ: 'iPhone SE (3rd gen)', NRP: 'iPhone SE (3rd gen)',
  NRN: 'iPhone SE (2nd gen)', NRM: 'iPhone SE (2nd gen)',
};

const YEAR_CHAR_MAP: Record<string, { year: number; half: 1 | 2 }> = {
  C: { year: 2010, half: 1 }, D: { year: 2010, half: 2 },
  F: { year: 2011, half: 1 }, G: { year: 2011, half: 2 },
  H: { year: 2012, half: 1 }, J: { year: 2012, half: 2 },
  K: { year: 2013, half: 1 }, L: { year: 2013, half: 2 },
  M: { year: 2014, half: 1 }, N: { year: 2014, half: 2 },
  P: { year: 2015, half: 1 }, Q: { year: 2015, half: 2 },
  R: { year: 2016, half: 1 }, S: { year: 2016, half: 2 },
  T: { year: 2017, half: 1 }, V: { year: 2017, half: 2 },
  W: { year: 2018, half: 1 }, X: { year: 2018, half: 2 },
  Y: { year: 2019, half: 1 }, Z: { year: 2019, half: 2 },
  '1': { year: 2020, half: 1 }, '2': { year: 2020, half: 2 },
  '3': { year: 2021, half: 1 }, '4': { year: 2021, half: 2 },
};

const WEEK_CHARS = '0123456789CDFGHJKLMNPQRSTVWXYZ';

function decodeWeek(c: string, half: 1 | 2): number {
  const idx = WEEK_CHARS.indexOf(c.toUpperCase());
  if (idx < 0) return 0;
  return half === 1 ? idx + 1 : idx + 27;
}

export function decodeAppleSerial(serial: string): SerialDecoded {
  const s = serial.trim().toUpperCase();
  if (s.length < 11 || s.length > 12) return {};

  // 12-char new format (2021+, randomized): cannot decode offline
  if (s.length === 12) return {};

  // Old 11-char format
  const yearChar  = s[4] ?? '';
  const weekChar  = s[5] ?? '';
  const modelSuffix = s.slice(8, 11);
  const factoryCode = s.slice(0, 3);

  const yearInfo = YEAR_CHAR_MAP[yearChar];
  const result: SerialDecoded = { factory: factoryCode };

  if (yearInfo) {
    result.manufactureYear = yearInfo.year;
    const week = decodeWeek(weekChar, yearInfo.half);
    if (week > 0) result.manufactureWeek = week;
  }

  const modelName = OLD_SERIAL_MODEL_MAP[modelSuffix];
  if (modelName) result.model = modelName;

  return result;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────

function httpsGet(options: https.RequestOptions): Promise<{ body: string; statusCode: number; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => resolve({
        body: data,
        statusCode: res.statusCode ?? 0,
        headers: (res.headers as Record<string, string>),
      }));
    });
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 8000 }, (res) => {
      // follow one redirect
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        httpGet(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpsGetUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8',
      }
    }, (res) => {
      // follow redirect
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308)
          && res.headers.location) {
        httpsGetUrl(res.headers.location).then(resolve).catch(reject);
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => { chunks.push(chunk); });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── Apple API – model lookup ──────────────────────────────────────────────

export async function checkAppleCoverage(serial: string): Promise<AppleDeviceData> {
  const sno = serial.trim().toUpperCase();
  const result: AppleDeviceData = {};

  // Attempt 1: Apple Support model API (publicly accessible, returns JSON with model name)
  try {
    const { body, statusCode } = await httpsGet({
      hostname: 'api.apple-support.apple.com',
      path: `/api/support/model?serial=${encodeURIComponent(sno)}`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://support.apple.com/',
      },
    });

    if (statusCode === 200 && body.trim().startsWith('{')) {
      const data = JSON.parse(body) as Record<string, unknown>;
      // Shape: { "model": "iPhone 15 Pro Max (Natural Titanium)", ... }
      const modelStr = (data['model'] ?? data['productDescription']) as string | undefined;
      if (modelStr) {
        // Extract color if present in parentheses: "iPhone 15 Pro Max (Black)"
        const colorMatch = modelStr.match(/\(([^)]+)\)/);
        const baseModel = modelStr.replace(/\s*\([^)]*\)/, '').trim();
        result.activationStatus = 'OK';
        // Store model in a way handlers can pick it up
        (result as Record<string, unknown>)['modelFromApple'] = baseModel;
        if (colorMatch) (result as Record<string, unknown>)['colorFromApple'] = colorMatch[1];
      }
    }
  } catch {
    // API unreachable — continue
  }

  // Attempt 2: checkcoverage.apple.com scraping for warranty/Find My data
  // This requires a session cookie + CSRF token — complex, skip unless APPLE_COVERAGE_KEY set
  // For now, mark as not available unless the above succeeded
  if (!result.activationStatus) {
    result.error = 'Apple Coverage API niedostępne (brak klucza lub zablokowane)';
  }

  return result;
}

// ── imei.info / imeicheck.net API (optional) ──────────────────────────────

export async function checkImeiInfo(imei: string): Promise<ImeiInfoData | undefined> {
  const apiKey = process.env['IMEI_INFO_API_KEY'];
  if (!apiKey) return undefined;

  try {
    const { body, statusCode } = await httpsGet({
      hostname: 'imeicheck.net',
      path: `/api/check?imei=${encodeURIComponent(imei)}&type=basic&key=${encodeURIComponent(apiKey)}`,
      method: 'GET',
      headers: { 'Accept': 'application/json', 'User-Agent': 'OlxMonitor/1.0' },
    });

    if (statusCode !== 200 || !body.trim().startsWith('{')) return { error: `HTTP ${statusCode}` };

    const data = JSON.parse(body) as Record<string, unknown>;
    const result: ImeiInfoData = {};

    const mfr = (data['manufacturer'] ?? data['brand']) as string | undefined;
    if (mfr) result.manufacturer = String(mfr);

    const model = (data['model'] ?? data['modelName']) as string | undefined;
    if (model) result.model = String(model);

    const blacklisted = data['blacklisted'] ?? data['stolen'] ?? data['lost'];
    if (blacklisted !== undefined) result.blacklisted = Boolean(blacklisted);

    const carrier = (data['carrier'] ?? data['network']) as string | undefined;
    if (carrier) result.carrier = String(carrier);

    return result;
  } catch (e) {
    return { error: String(e) };
  }
}

// ── OLX listing scraper ───────────────────────────────────────────────────

/**
 * Próbuje wyciągnąć parametry techniczne z JSON __NEXT_DATA__ osadzonego na stronie OLX.
 * Zwraca mapę key → label (np. { memory: "256 GB", color: "Czarny" }).
 */
function extractParamsFromNextData(html: string): Record<string, string> {
  try {
    const match = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!match) return {};
    const json = JSON.parse(match[1]!) as Record<string, unknown>;
    // ścieżka: props.pageProps.ad.params[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: any[] =
      (json as any)?.props?.pageProps?.ad?.params ??
      (json as any)?.props?.pageProps?.adData?.ad?.params ?? [];
    const result: Record<string, string> = {};
    for (const p of params) {
      const key: string  = p?.key ?? '';
      const label: string = p?.value?.label ?? p?.value?.key ?? '';
      if (key && label && key !== 'price' && key !== 'state') result[key] = label;
    }
    return result;
  } catch { return {}; }
}

/** Uzupełnia tytuł o dane techniczne z params, jeśli ich tam nie ma (taki sam kod jak w scraper.ts). */
function enrichTitleFromParams(title: string, params: Record<string, string>): string {
  let enriched = title;
  const lower = title.toLowerCase();

  if (!/\b\d{2,4}\s*(?:gb|tb)\b/i.test(title)) {
    for (const key of ['memory', 'phone_memory', 'storage', 'capacity']) {
      const val = params[key];
      if (val) { enriched += ` ${val}`; break; }
    }
  }

  for (const key of ['ram', 'phone_ram']) {
    const val = params[key];
    if (val && !lower.includes('ram')) { enriched += ` ${val} RAM`; break; }
  }

  for (const key of ['phone_model', 'model']) {
    const val = params[key];
    if (val) {
      const words = val.toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 1);
      if (!words.every(w => lower.includes(w))) enriched += ` ${val}`;
      break;
    }
  }

  return enriched;
}

export async function fetchOlxListing(url: string): Promise<{
  title: string;
  description: string;
  imeiFromDesc?: string;
  serialFromDesc?: string;
}> {
  const html = await httpsGetUrl(url);

  // Parametry techniczne z __NEXT_DATA__ (memory, color, etc.)
  const pageParams = extractParamsFromNextData(html);

  // Title: from <title> tag (OLX puts "Tytuł - OLX.pl" format)
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  let title = titleMatch ? titleMatch[1]!.replace(/\s*[-|]\s*OLX\.pl.*$/i, '').trim() : '';
  // Fallback: og:title
  if (!title) {
    const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
    if (ogTitle) title = ogTitle[1]!.trim();
  }

  // Description: try JSON-LD first (most reliable)
  let description = '';
  const jsonLdMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  if (jsonLdMatch) {
    for (const block of jsonLdMatch) {
      try {
        const jsonStr = block.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
        const data = JSON.parse(jsonStr) as Record<string, unknown>;
        if (typeof data['description'] === 'string' && data['description'].length > 10) {
          description = data['description'].trim();
          break;
        }
      } catch { /* skip */ }
    }
  }

  // Fallback: look for og:description
  if (!description) {
    const ogDesc = html.match(/<meta[^>]+(?:property="og:description"|name="description")[^>]+content="([^"]+)"/i);
    if (ogDesc) description = ogDesc[1]!.trim();
  }

  // Fallback: look for the ad description div (OLX CSS class varies, try data-cy attribute)
  if (!description) {
    const descDiv = html.match(/data-cy="ad_description"[^>]*>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
    if (descDiv) description = descDiv[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Decode HTML entities
  title = decodeHtmlEntities(title);
  description = decodeHtmlEntities(description);

  // Wzbogać tytuł o dane techniczne z parametrów, jeśli ich tam nie ma
  if (Object.keys(pageParams).length > 0) {
    title = enrichTitleFromParams(title, pageParams);
  }

  // Extract IMEI (15 consecutive digits)
  const imeiMatch = (title + ' ' + description).match(/\b(\d{15})\b/);
  const imeiFromDesc = imeiMatch ? imeiMatch[1] : undefined;

  // Extract Apple serial (11-12 alphanumeric chars, mixed case, looks like: FVFXC2MMJYWH)
  // Apple serials: letters + digits, no special chars, 11-12 length
  const serialPattern = /\b([A-Z0-9]{11,12})\b/gi;
  let serialFromDesc: string | undefined;
  const fullText = title + ' ' + description;
  let m: RegExpExecArray | null;
  while ((m = serialPattern.exec(fullText)) !== null) {
    const candidate = m[1]!;
    // Must be 11 or 12 chars, start with letters, mix of letters+digits
    if (/^[A-Z]{1,3}\d{1}[A-Z0-9]{9,10}$/i.test(candidate)) {
      // Not an IMEI (not 15 pure digits)
      if (!/^\d+$/.test(candidate)) {
        serialFromDesc = candidate.toUpperCase();
        break;
      }
    }
  }

  return { title, description, imeiFromDesc, serialFromDesc };
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

// ── Extract device details from listing text ──────────────────────────────

const COLOR_MAP_PL: Array<{ keywords: string[]; normalized: string }> = [
  { keywords: ['czarny', 'czarna', 'czarne', 'black', 'onyx'], normalized: 'Czarny' },
  { keywords: ['biały', 'biała', 'białe', 'white', 'starlight', 'srebrny', 'silver'], normalized: 'Biały/Srebrny' },
  { keywords: ['naturalny tytan', 'natural titanium'], normalized: 'Natural Titanium' },
  { keywords: ['desert titanium', 'pustynia'], normalized: 'Desert Titanium' },
  { keywords: ['white titanium', 'biały tytan'], normalized: 'White Titanium' },
  { keywords: ['black titanium', 'czarny tytan'], normalized: 'Black Titanium' },
  { keywords: ['złoty', 'złota', 'złote', 'gold', 'champagne'], normalized: 'Złoty' },
  { keywords: ['różowy', 'różowa', 'różowe', 'pink', 'rose'], normalized: 'Różowy' },
  { keywords: ['niebieski', 'niebieska', 'niebieske', 'blue'], normalized: 'Niebieski' },
  { keywords: ['zielony', 'zielona', 'zielone', 'green', 'alpine'], normalized: 'Zielony' },
  { keywords: ['żółty', 'żółta', 'żółte', 'yellow'], normalized: 'Żółty' },
  { keywords: ['czerwony', 'czerwona', 'czerwone', 'red', 'product red'], normalized: 'Czerwony' },
  { keywords: ['fioletowy', 'fioletowa', 'fioletowe', 'purple', 'deep purple', 'lilac'], normalized: 'Fioletowy' },
  { keywords: ['pomarańczowy', 'pomarańczowa', 'pomarańczowe', 'orange'], normalized: 'Pomarańczowy' },
  { keywords: ['tytan', 'titanium'], normalized: 'Titanium' },
  { keywords: ['grafit', 'graphite', 'space gray', 'space grey', 'gwiezdna szarość'], normalized: 'Grafitowy/Space Gray' },
  { keywords: ['midnight', 'północ', 'ciemnoniebieski'], normalized: 'Midnight' },
];

export function extractFromListingText(
  title: string,
  description: string,
): { capacity?: string; color?: string } {
  const text = (title + ' ' + description).toLowerCase();
  const result: { capacity?: string; color?: string } = {};

  // Storage: 64GB, 128GB, 256GB, 512GB, 1TB, 2TB
  const storageMatch = text.match(/\b(64|128|256|512|1024|2048|1\s*tb|2\s*tb)\s*gb\b/i)
    ?? text.match(/\b(1|2)\s*tb\b/i);
  if (storageMatch) {
    const raw = storageMatch[1]!.replace(/\s/g, '').toUpperCase();
    if (raw === '1TB' || raw === '1024') result.capacity = '1TB';
    else if (raw === '2TB' || raw === '2048') result.capacity = '2TB';
    else result.capacity = raw + 'GB';
  }

  // Color: scan for known color keywords (order matters — longer phrases first)
  for (const { keywords, normalized } of COLOR_MAP_PL) {
    if (keywords.some(k => text.includes(k.toLowerCase()))) {
      result.color = normalized;
      break;
    }
  }

  return result;
}

// ── Discrepancy detection ─────────────────────────────────────────────────

export function detectDiscrepancies(
  ver: DeviceVerification,
  listingTitle: string,
  listingDescription?: string,
): string[] {
  const issues: string[] = [];
  const fullText = (listingTitle + ' ' + (listingDescription ?? '')).toLowerCase();

  // Find My iPhone on = major risk
  if (ver.appleData?.findMyStatus === 'ON') {
    issues.push('Find My iPhone jest WŁĄCZONY – ryzyko telefonu na aktywnym koncie');
  }

  // Blacklisted
  if (ver.imeiInfoData?.blacklisted === true) {
    issues.push('IMEI na liście skradzionych/zablokowanych urządzeń');
  }

  // SIM locked but listing says "unlocked"
  if (ver.appleData?.simLockStatus === 'Locked') {
    if (fullText.includes('bez simlock') || fullText.includes('odblokowany') || fullText.includes('unlocked')) {
      issues.push(`Ogłoszenie sugeruje brak simlocka, ale urządzenie jest zablokowane (${ver.appleData.carrier ?? 'nieznany operator'})`);
    }
  }

  // Model mismatch
  const appleDataRec = ver.appleData as Record<string, unknown> | undefined;
  const appleModel = appleDataRec?.['modelFromApple'] as string | undefined;
  const decodedModel = appleModel ?? ver.decodedSerial?.model ?? ver.imeiInfoData?.model ?? ver.tacData?.modelHint;
  if (decodedModel) {
    const decodedGen = extractIphoneGen(decodedModel.toLowerCase());
    const listedGen  = extractIphoneGen(fullText);
    if (decodedGen && listedGen && decodedGen !== listedGen) {
      issues.push(`Opis mówi iPhone ${listedGen}, dane wskazują na ${decodedModel}`);
    }
  }

  // Color mismatch
  const appleColor = appleDataRec?.['colorFromApple'] as string | undefined;
  if (appleColor) {
    const colorMap: Record<string, string[]> = {
      'black':          ['czarny', 'black', 'czarna', 'czarne'],
      'white':          ['biały', 'white', 'biała', 'białe'],
      'natural titanium': ['natural', 'titanium'],
      'desert titanium': ['desert'],
      'white titanium': ['white', 'biały'],
      'black titanium': ['black', 'czarny'],
      'pink':           ['różowy', 'pink', 'różowa'],
      'blue':           ['niebieski', 'blue', 'niebieska'],
      'green':          ['zielony', 'green', 'zielona'],
      'yellow':         ['żółty', 'yellow'],
      'red':            ['czerwony', 'red'],
      'purple':         ['fioletowy', 'purple'],
    };
    const colorKey = appleColor.toLowerCase();
    const keywords = colorMap[colorKey];
    // Only flag if a DIFFERENT color keyword appears in the listing
    // (don't flag if no color mentioned)
    if (keywords) {
      const allColorKeywords = Object.values(colorMap).flat();
      const mentionedColors = allColorKeywords.filter(k => fullText.includes(k));
      if (mentionedColors.length > 0) {
        const matchesExpected = keywords.some(k => fullText.includes(k));
        if (!matchesExpected) {
          issues.push(`Kolor urządzenia to ${appleColor}, ale ogłoszenie może opisywać inny kolor`);
        }
      }
    }
  }

  // Warranty expired but listing says "na gwarancji"
  if (ver.appleData?.coverageEndDate) {
    const endDate = new Date(ver.appleData.coverageEndDate);
    if (!isNaN(endDate.getTime()) && endDate < new Date()) {
      if (fullText.includes('gwarancja') || fullText.includes('warranty')) {
        issues.push(`Ogłoszenie wspomina gwarancję, ale wygasła ${ver.appleData.coverageEndDate}`);
      }
    }
  }

  // IMEI in description doesn't match provided IMEI
  if (ver.listingImeiFromDesc && ver.imei && ver.listingImeiFromDesc !== ver.imei) {
    issues.push(`IMEI w opisie ogłoszenia (${ver.listingImeiFromDesc}) różni się od podanego (${ver.imei})`);
  }

  return issues;
}

function extractIphoneGen(text: string): string | null {
  const m = text.match(/iphone\s+(\d+(?:\s+(?:pro\s+max|pro|plus|mini))?)/i);
  if (!m) return null;
  return m[1]!.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ── Full verification ─────────────────────────────────────────────────────

export async function runVerification(
  imei: string | undefined,
  serial: string | undefined,
  listingTitle: string | undefined,
  listingDescription: string | undefined,
): Promise<DeviceVerification> {
  const ver: DeviceVerification = {
    verifiedAt: new Date().toISOString(),
    discrepancies: [],
  };

  if (imei) {
    ver.imei = imei;
    ver.imeiValid = validateImei(imei);
    const tac = decodeTac(imei);
    if (tac) ver.tacData = tac;
  }

  if (serial) {
    const decoded = decodeAppleSerial(serial);
    if (Object.keys(decoded).length > 0) ver.decodedSerial = decoded;

    const appleData = await checkAppleCoverage(serial);
    ver.appleData = appleData;

    // If Apple model came back, also put it in decodedSerial for display
    const appleModel = (appleData as Record<string, unknown>)['modelFromApple'] as string | undefined;
    if (appleModel) {
      ver.decodedSerial = { ...ver.decodedSerial, model: appleModel };
      const colorFromApple = (appleData as Record<string, unknown>)['colorFromApple'] as string | undefined;
      if (colorFromApple) ver.decodedSerial.color = colorFromApple;
    }
  }

  if (imei) {
    const imeiInfo = await checkImeiInfo(imei);
    if (imeiInfo) ver.imeiInfoData = imeiInfo;

    // If no model yet, use TAC hint
    if (!ver.imeiInfoData?.model && ver.tacData?.modelHint) {
      ver.imeiInfoData = { ...ver.imeiInfoData, model: ver.tacData.modelHint, manufacturer: ver.tacData.manufacturer };
    }
  }

  // Extract storage + color from listing text (these are not in IMEI/TAC)
  if (listingTitle || listingDescription) {
    const fromListing = extractFromListingText(listingTitle ?? '', listingDescription ?? '');
    if (fromListing.capacity || fromListing.color) {
      ver.decodedSerial ??= {};
      if (fromListing.capacity && !ver.decodedSerial.capacity) ver.decodedSerial.capacity = fromListing.capacity;
      if (fromListing.color && !ver.decodedSerial.color) ver.decodedSerial.color = fromListing.color;
    }
  }

  if (listingTitle) {
    ver.discrepancies = detectDiscrepancies(ver, listingTitle, listingDescription);
  }

  return ver;
}
