/**
 * Config Parser – wyciąga konfigurację produktu z tytułu ogłoszenia OLX.
 * Normalizuje zapisy (256 gb → 256GB, 1000gb → 1TB) i generuje unikalny configKey.
 */

export interface ProductConfig {
  brand?: string;       // apple, nvidia, sony, microsoft
  model?: string;       // iphone_17, macbook_air, rtx_5090, ps5
  variant?: string;     // pro_max, pro, plus, ultra (iPhone / iPad)
  chip?: string;        // m1, m2, m3, m4, m4_pro, m4_max (Apple Silicon)
  storage?: string;     // 128gb, 256gb, 512gb, 1tb
  ram?: string;         // 8gb, 16gb, 32gb (laptopy)
  screenSize?: string;  // 13, 14, 15, 16 (cale)
  configKey: string;    // np. apple_iphone_17_pro_max_256gb
  rawTitle: string;
}

// ── Normalizacja pamięci ────────────────────────────────────────────────────

export function normalizeStorage(raw: string): string {
  const s = raw.toLowerCase().replace(/\s/g, '');
  // 1000gb / 1024gb → 1TB
  const gbMatch = s.match(/^(\d+)gb$/);
  if (gbMatch) {
    const n = Number(gbMatch[1]);
    if (n >= 1800) return '2TB';
    if (n >= 900)  return '1TB';
    return `${n}GB`;
  }
  const tbMatch = s.match(/^(\d+)tb$/);
  if (tbMatch) return `${tbMatch[1]}TB`;
  return raw.toUpperCase().replace(/\s/g, '');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function slug(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

// Wyciąga storage z tytułu (pierwsza dopasowana wartość)
function extractStorage(title: string): string | undefined {
  // np. 256GB, 512 GB, 1TB, 1 TB, 256g
  const m = title.match(/\b(\d{2,4})\s*(gb|tb|g)\b/i);
  if (!m) return undefined;
  const val = m[1]!;
  const unit = m[2]!.toLowerCase();
  if (unit === 'g' || unit === 'gb') return normalizeStorage(`${val}GB`);
  return normalizeStorage(`${val}TB`);
}

// Wyciąga RAM (szuka wzorca z "ram" lub formatu "16GB RAM" lub "16/512" w MacBookach)
function extractRam(title: string): string | undefined {
  // Wzorzec "16GB RAM" lub "RAM 16GB"
  const ramExplicit = title.match(/\b(\d+)\s*gb\s*ram\b/i) ?? title.match(/\bram\s*(\d+)\s*gb\b/i);
  if (ramExplicit) return `${ramExplicit[1]}GB`;
  // MacBook format: "16/256", "16/512", "16/1TB" – RAM/Storage
  const macSlash = title.match(/\b(\d+)\s*\/\s*\d+\s*(?:gb|tb)?\b/i);
  if (macSlash && ['8','16','32','64'].includes(macSlash[1]!)) return `${macSlash[1]}GB`;
  return undefined;
}

// ── Baza produktów ──────────────────────────────────────────────────────────

interface ProductRule {
  brand: string;
  model: string;
  patterns: RegExp[];
}

const PRODUCT_RULES: ProductRule[] = [
  // Apple – iPhone
  { brand: 'apple', model: 'iphone_16e', patterns: [/\biphone\s*16e\b/i] },
  { brand: 'apple', model: 'iphone_17', patterns: [/\biphone\s*17\b/i] },
  { brand: 'apple', model: 'iphone_16', patterns: [/\biphone\s*16\b/i] },
  { brand: 'apple', model: 'iphone_15', patterns: [/\biphone\s*15\b/i] },
  { brand: 'apple', model: 'iphone_14', patterns: [/\biphone\s*14\b/i] },
  { brand: 'apple', model: 'iphone_13', patterns: [/\biphone\s*13\b/i] },
  { brand: 'apple', model: 'iphone_12', patterns: [/\biphone\s*12\b/i] },
  { brand: 'apple', model: 'iphone_11', patterns: [/\biphone\s*11\b/i] },
  // Apple – MacBook
  { brand: 'apple', model: 'macbook_pro', patterns: [/\bmacbook\s*pro\b/i] },
  { brand: 'apple', model: 'macbook_air', patterns: [/\bmacbook\s*air\b/i] },
  { brand: 'apple', model: 'macbook', patterns: [/\bmacbook\b/i] },
  // Apple – iPad
  { brand: 'apple', model: 'ipad_pro', patterns: [/\bipad\s*pro\b/i] },
  { brand: 'apple', model: 'ipad_air', patterns: [/\bipad\s*air\b/i] },
  { brand: 'apple', model: 'ipad_mini', patterns: [/\bipad\s*mini\b/i] },
  { brand: 'apple', model: 'ipad', patterns: [/\bipad\b/i] },
  // Apple – Mac Mini / Studio / Pro
  { brand: 'apple', model: 'mac_mini', patterns: [/\bmac\s*mini\b/i] },
  { brand: 'apple', model: 'mac_studio', patterns: [/\bmac\s*studio\b/i] },
  { brand: 'apple', model: 'mac_pro', patterns: [/\bmac\s*pro\b/i] },
  // Nvidia GPU
  { brand: 'nvidia', model: 'rtx_5090', patterns: [/\brtx\s*5090\b/i] },
  { brand: 'nvidia', model: 'rtx_5080', patterns: [/\brtx\s*5080\b/i] },
  { brand: 'nvidia', model: 'rtx_5070_ti', patterns: [/\brtx\s*5070\s*ti\b/i] },
  { brand: 'nvidia', model: 'rtx_5070', patterns: [/\brtx\s*5070\b/i] },
  { brand: 'nvidia', model: 'rtx_4090', patterns: [/\brtx\s*4090\b/i] },
  { brand: 'nvidia', model: 'rtx_4080_super', patterns: [/\brtx\s*4080\s*super\b/i] },
  { brand: 'nvidia', model: 'rtx_4080', patterns: [/\brtx\s*4080\b/i] },
  { brand: 'nvidia', model: 'rtx_4070_ti_super', patterns: [/\brtx\s*4070\s*ti\s*super\b/i] },
  { brand: 'nvidia', model: 'rtx_4070_ti', patterns: [/\brtx\s*4070\s*ti\b/i] },
  { brand: 'nvidia', model: 'rtx_4070_super', patterns: [/\brtx\s*4070\s*super\b/i] },
  { brand: 'nvidia', model: 'rtx_4070', patterns: [/\brtx\s*4070\b/i] },
  // Sony PlayStation
  { brand: 'sony', model: 'ps5_pro', patterns: [/\bps5\s*pro\b/i, /\bplaystation\s*5\s*pro\b/i] },
  { brand: 'sony', model: 'ps5', patterns: [/\bps5\b/i, /\bplaystation\s*5\b/i] },
  { brand: 'sony', model: 'ps4_pro', patterns: [/\bps4\s*pro\b/i, /\bplaystation\s*4\s*pro\b/i] },
  { brand: 'sony', model: 'ps4', patterns: [/\bps4\b/i, /\bplaystation\s*4\b/i] },
  // Microsoft Xbox
  { brand: 'microsoft', model: 'xbox_series_x', patterns: [/\bxbox\s*series\s*x\b/i] },
  { brand: 'microsoft', model: 'xbox_series_s', patterns: [/\bxbox\s*series\s*s\b/i] },
  // Nintendo Switch (szczegółowe przed ogólnym)
  { brand: 'nintendo', model: 'switch_oled', patterns: [/\bswitch\s*oled\b/i] },
  { brand: 'nintendo', model: 'switch_lite', patterns: [/\bswitch\s*lite\b/i] },
  { brand: 'nintendo', model: 'switch_2',    patterns: [/\bnintendo\s*switch\s*2\b/i, /\bswitch\s*2\b/i] },
  { brand: 'nintendo', model: 'switch',      patterns: [/\bnintendo\s*switch\b/i] },
  // Nvidia RTX 3000-series (Ti przed base)
  { brand: 'nvidia', model: 'rtx_3090_ti', patterns: [/\brtx\s*3090\s*ti\b/i] },
  { brand: 'nvidia', model: 'rtx_3090',    patterns: [/\brtx\s*3090\b/i] },
  { brand: 'nvidia', model: 'rtx_3080_ti', patterns: [/\brtx\s*3080\s*ti\b/i] },
  { brand: 'nvidia', model: 'rtx_3080',    patterns: [/\brtx\s*3080\b/i] },
  { brand: 'nvidia', model: 'rtx_3070_ti', patterns: [/\brtx\s*3070\s*ti\b/i] },
  { brand: 'nvidia', model: 'rtx_3070',    patterns: [/\brtx\s*3070\b/i] },
  { brand: 'nvidia', model: 'rtx_3060_ti', patterns: [/\brtx\s*3060\s*ti\b/i] },
  { brand: 'nvidia', model: 'rtx_3060',    patterns: [/\brtx\s*3060\b/i] },
  { brand: 'nvidia', model: 'rtx_3050',    patterns: [/\brtx\s*3050\b/i] },
  // AMD Radeon RX (7000-series → 6000-series; XTX/XT przed base)
  { brand: 'amd', model: 'rx_7900_xtx', patterns: [/\brx\s*7900\s*xtx\b/i] },
  { brand: 'amd', model: 'rx_7900_xt',  patterns: [/\brx\s*7900\s*xt\b/i] },
  { brand: 'amd', model: 'rx_7800_xt',  patterns: [/\brx\s*7800\s*xt\b/i] },
  { brand: 'amd', model: 'rx_7700_xt',  patterns: [/\brx\s*7700\s*xt\b/i] },
  { brand: 'amd', model: 'rx_7600_xt',  patterns: [/\brx\s*7600\s*xt\b/i] },
  { brand: 'amd', model: 'rx_7600',     patterns: [/\brx\s*7600\b/i] },
  { brand: 'amd', model: 'rx_6950_xt',  patterns: [/\brx\s*6950\s*xt\b/i] },
  { brand: 'amd', model: 'rx_6900_xt',  patterns: [/\brx\s*6900\s*xt\b/i] },
  { brand: 'amd', model: 'rx_6800_xt',  patterns: [/\brx\s*6800\s*xt\b/i] },
  { brand: 'amd', model: 'rx_6800',     patterns: [/\brx\s*6800\b/i] },
  { brand: 'amd', model: 'rx_6700_xt',  patterns: [/\brx\s*6700\s*xt\b/i] },
  { brand: 'amd', model: 'rx_6700',     patterns: [/\brx\s*6700\b/i] },
  { brand: 'amd', model: 'rx_6600_xt',  patterns: [/\brx\s*6600\s*xt\b/i] },
  { brand: 'amd', model: 'rx_6600',     patterns: [/\brx\s*6600\b/i] },
  // AMD Ryzen CPUs (3D V-Cache i X-warianty przed base; nowsze serie pierwsze)
  { brand: 'amd', model: 'ryzen_9_9950x3d', patterns: [/\bryzen\s*9\s*9950x3d\b/i] },
  { brand: 'amd', model: 'ryzen_9_9900x3d', patterns: [/\bryzen\s*9\s*9900x3d\b/i] },
  { brand: 'amd', model: 'ryzen_9_9950x',   patterns: [/\bryzen\s*9\s*9950x\b/i] },
  { brand: 'amd', model: 'ryzen_9_9900x',   patterns: [/\bryzen\s*9\s*9900x\b/i] },
  { brand: 'amd', model: 'ryzen_7_9800x3d', patterns: [/\bryzen\s*7\s*9800x3d\b/i] },
  { brand: 'amd', model: 'ryzen_7_9700x',   patterns: [/\bryzen\s*7\s*9700x\b/i] },
  { brand: 'amd', model: 'ryzen_5_9600x',   patterns: [/\bryzen\s*5\s*9600x\b/i] },
  { brand: 'amd', model: 'ryzen_9_7950x3d', patterns: [/\bryzen\s*9\s*7950x3d\b/i] },
  { brand: 'amd', model: 'ryzen_9_7900x3d', patterns: [/\bryzen\s*9\s*7900x3d\b/i] },
  { brand: 'amd', model: 'ryzen_9_7950x',   patterns: [/\bryzen\s*9\s*7950x\b/i] },
  { brand: 'amd', model: 'ryzen_9_7900x',   patterns: [/\bryzen\s*9\s*7900x\b/i] },
  { brand: 'amd', model: 'ryzen_9_7900',    patterns: [/\bryzen\s*9\s*7900\b/i] },
  { brand: 'amd', model: 'ryzen_7_7800x3d', patterns: [/\bryzen\s*7\s*7800x3d\b/i] },
  { brand: 'amd', model: 'ryzen_7_7700x',   patterns: [/\bryzen\s*7\s*7700x\b/i] },
  { brand: 'amd', model: 'ryzen_7_7700',    patterns: [/\bryzen\s*7\s*7700\b/i] },
  { brand: 'amd', model: 'ryzen_5_7600x',   patterns: [/\bryzen\s*5\s*7600x\b/i] },
  { brand: 'amd', model: 'ryzen_5_7600',    patterns: [/\bryzen\s*5\s*7600\b/i] },
  // Intel Core CPUs – KS przed K, K przed base (13th + 14th gen)
  { brand: 'intel', model: 'core_i9_14900ks', patterns: [/\bi9[-\s]*14900ks\b/i] },
  { brand: 'intel', model: 'core_i9_14900k',  patterns: [/\bi9[-\s]*14900k\b/i] },
  { brand: 'intel', model: 'core_i9_14900',   patterns: [/\bi9[-\s]*14900\b/i] },
  { brand: 'intel', model: 'core_i7_14700k',  patterns: [/\bi7[-\s]*14700k\b/i] },
  { brand: 'intel', model: 'core_i7_14700',   patterns: [/\bi7[-\s]*14700\b/i] },
  { brand: 'intel', model: 'core_i5_14600k',  patterns: [/\bi5[-\s]*14600k\b/i] },
  { brand: 'intel', model: 'core_i5_14600',   patterns: [/\bi5[-\s]*14600\b/i] },
  { brand: 'intel', model: 'core_i9_13900ks', patterns: [/\bi9[-\s]*13900ks\b/i] },
  { brand: 'intel', model: 'core_i9_13900k',  patterns: [/\bi9[-\s]*13900k\b/i] },
  { brand: 'intel', model: 'core_i7_13700k',  patterns: [/\bi7[-\s]*13700k\b/i] },
  { brand: 'intel', model: 'core_i5_13600k',  patterns: [/\bi5[-\s]*13600k\b/i] },
  // Intel Core Ultra (Arrow Lake)
  { brand: 'intel', model: 'core_ultra_9_285k', patterns: [/\bcore\s*ultra\s*9\s*285k\b/i] },
  { brand: 'intel', model: 'core_ultra_7_265k', patterns: [/\bcore\s*ultra\s*7\s*265k\b/i] },
  { brand: 'intel', model: 'core_ultra_5_245k', patterns: [/\bcore\s*ultra\s*5\s*245k\b/i] },
  // Samsung Galaxy
  { brand: 'samsung', model: 'galaxy_s25_ultra', patterns: [/\bgalaxy\s*s25\s*ultra\b/i] },
  { brand: 'samsung', model: 'galaxy_s25_plus', patterns: [/\bgalaxy\s*s25\s*\+/i, /\bgalaxy\s*s25\s*plus\b/i] },
  { brand: 'samsung', model: 'galaxy_s25', patterns: [/\bgalaxy\s*s25\b/i] },
  { brand: 'samsung', model: 'galaxy_s24_ultra', patterns: [/\bgalaxy\s*s24\s*ultra\b/i] },
  { brand: 'samsung', model: 'galaxy_s24_plus', patterns: [/\bgalaxy\s*s24\s*\+/i, /\bgalaxy\s*s24\s*plus\b/i] },
  { brand: 'samsung', model: 'galaxy_s24', patterns: [/\bgalaxy\s*s24\b/i] },
];

// iPhone/iPad warianty (ważna kolejność – Pro Max przed Pro)
const IPHONE_VARIANTS: Array<{ key: string; pattern: RegExp }> = [
  { key: 'pro_max', pattern: /\bpro\s*max\b/i },
  { key: 'pro',     pattern: /\bpro\b/i },
  { key: 'plus',    pattern: /\bplus\b/i },
  { key: 'ultra',   pattern: /\bultra\b/i },
  { key: 'mini',    pattern: /\bmini\b/i },
];

// Apple Silicon chips (ważna kolejność – bardziej szczegółowe warianty pierwsze)
const APPLE_CHIPS: Array<{ key: string; pattern: RegExp }> = [
  { key: 'm5_ultra', pattern: /\bm5\s*ultra\b/i },
  { key: 'm5_max',   pattern: /\bm5\s*max\b/i },
  { key: 'm5_pro',   pattern: /\bm5\s*pro\b/i },
  { key: 'm5',       pattern: /\bm5\b/i },
  { key: 'm4_ultra', pattern: /\bm4\s*ultra\b/i },
  { key: 'm4_max',   pattern: /\bm4\s*max\b/i },
  { key: 'm4_pro',   pattern: /\bm4\s*pro\b/i },
  { key: 'm4',       pattern: /\bm4\b/i },
  { key: 'm3_ultra', pattern: /\bm3\s*ultra\b/i },
  { key: 'm3_max',   pattern: /\bm3\s*max\b/i },
  { key: 'm3_pro',   pattern: /\bm3\s*pro\b/i },
  { key: 'm3',       pattern: /\bm3\b/i },
  { key: 'm2_ultra', pattern: /\bm2\s*ultra\b/i },
  { key: 'm2_max',   pattern: /\bm2\s*max\b/i },
  { key: 'm2_pro',   pattern: /\bm2\s*pro\b/i },
  { key: 'm2',       pattern: /\bm2\b/i },
  { key: 'm1_ultra', pattern: /\bm1\s*ultra\b/i },
  { key: 'm1_max',   pattern: /\bm1\s*max\b/i },
  { key: 'm1_pro',   pattern: /\bm1\s*pro\b/i },
  { key: 'm1',       pattern: /\bm1\b/i },
];

// Rozmiary ekranu (cale)
const SCREEN_SIZES = ['16', '15', '14', '13', '12', '11'];

// ── Główna funkcja ──────────────────────────────────────────────────────────

export function parseConfig(title: string): ProductConfig {
  const result: ProductConfig = { configKey: '', rawTitle: title };

  // 1. Dopasuj produkt
  for (const rule of PRODUCT_RULES) {
    if (rule.patterns.some(p => p.test(title))) {
      result.brand = rule.brand;
      result.model = rule.model;
      break;
    }
  }

  // Obetnij tekst po separatorach bundle ("A oraz B", "A + B") — tylko pierwsza sztuka jest parsowana
  // Zapobiega błędnemu rozpoznaniu wariantu z drugiego produktu (np. "Air 256 oraz iPhone 11 Pro Max")
  const titleClean = title
    .replace(/\s+oraz\s+.*/i, '')
    .replace(/\s*\+\s+(?=[A-ZŁŚÓĄĘĆŃŹ])/g, ' ')
    .trim();

  // 2. Wariant (iPhone / iPad)
  // Usuń negowane frazy przed dopasowywaniem (np. "nie PRO", "non pro max", "not Pro")
  // żeby "apple iPhone 17 256GB - nie PRO" nie był błędnie klasyfikowany jako iPhone 17 Pro
  const titleForVariant = titleClean.replace(/\b(nie|non|not|bez)\s+(pro\s*max|pro|plus|ultra|mini)\b/gi, ' ');
  if (result.brand === 'apple' && (result.model?.startsWith('iphone') || result.model?.startsWith('ipad'))) {
    for (const v of IPHONE_VARIANTS) {
      if (v.pattern.test(titleForVariant)) { result.variant = v.key; break; }
    }
    // "Air" jako wariant tylko dla iPhone (dla iPada "air" jest częścią nazwy modelu ipad_air)
    if (!result.variant && result.model.startsWith('iphone') && /\bair\b/i.test(titleForVariant)) {
      result.variant = 'air';
    }
  }

  // 3. Apple Silicon chip (MacBook / Mac Mini / iPad Pro)
  if (result.brand === 'apple') {
    for (const c of APPLE_CHIPS) {
      if (c.pattern.test(titleClean)) { result.chip = c.key; break; }
    }
  }

  // 4. Screen size (ekran w calach) – dla MacBooków
  if (result.model?.startsWith('macbook')) {
    for (const size of SCREEN_SIZES) {
      // np. "15"" lub "15 cali" lub "15-inch" lub po prostu " 15 "
      if (new RegExp(`\\b${size}[\\s"'\\-]*(cali|inch|")?\\b`, 'i').test(titleClean)) {
        result.screenSize = size;
        break;
      }
    }
  }

  // 5. Storage – wyciągnij drugą wartość gb jeśli jest RAM/storage (większa = storage)
  // Używamy titleClean żeby bundle ("Apple iPhone 17 256 oraz iPhone 11") nie mieszał pojemności
  const allGb = [...titleClean.matchAll(/\b(\d{2,4})\s*(?:gb|g)\b/gi)].map(m => Number(m[1]));
  const allTb = [...titleClean.matchAll(/\b(\d+)\s*tb\b/gi)].map(m => Number(m[1]) * 1024);
  const allSizes = [...allGb, ...allTb].sort((a, b) => a - b);

  if (allSizes.length >= 2) {
    // Pierwsza (mniejsza) to RAM, druga (większa) to storage
    result.ram = normalizeStorage(`${allSizes[0]}GB`);
    result.storage = allSizes[allSizes.length - 1]! >= 900
      ? normalizeStorage(`${allSizes[allSizes.length - 1]}GB`)
      : normalizeStorage(`${allSizes[allSizes.length - 1]}GB`);
  } else if (allSizes.length === 1) {
    // Jedna wartość – storage (RAM rzadko podawany osobno dla telefonów)
    const size = allSizes[0]!;
    // Dla MacBooków wartości ≤ 64 mogą być RAM
    if (result.model?.startsWith('macbook') && size <= 64) {
      result.ram = normalizeStorage(`${size}GB`);
    } else {
      result.storage = normalizeStorage(`${size}GB`);
    }
  }

  // Fallback – explicit RAM extraction (titleClean – bez bundle)
  if (!result.ram) result.ram = extractRam(titleClean);

  // 6. Buduj configKey
  const parts: string[] = [];
  if (result.brand) parts.push(result.brand);
  if (result.model) parts.push(result.model);
  if (result.variant) parts.push(result.variant);
  if (result.chip) parts.push(result.chip);
  if (result.screenSize) parts.push(result.screenSize);
  if (result.ram) parts.push(slug(result.ram));
  if (result.storage) parts.push(slug(result.storage));

  result.configKey = parts.length > 0 ? parts.join('_') : slug(title.slice(0, 40));

  return result;
}

/**
 * Buduje kanoniczne zapytanie OLX dla danego wariantu produktu.
 * Używane przez price-cache i deal-detector do pobierania danych cenowych
 * dla konkretnej konfiguracji (np. "iphone 17 256gb", "iphone 17 pro max 256gb").
 * Celowo pomija brand (Apple, Samsung) — OLX zwraca lepsze wyniki bez niego.
 */
export function buildVariantQuery(c: ProductConfig): string {
  const parts: string[] = [];
  if (c.model)   parts.push(c.model.replace(/_/g, ' '));
  if (c.variant) parts.push(c.variant.replace(/_/g, ' '));
  if (c.chip)    parts.push(c.chip.replace(/_/g, ' '));
  if (c.storage) parts.push(c.storage);
  if (c.ram)     parts.push(c.ram);
  return parts.filter(Boolean).join(' ');
}
