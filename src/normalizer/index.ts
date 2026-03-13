import type { NormalizedListing, ProductCondition } from '../types.js';
import type { AdapterInput, BaseAdapter } from './base-adapter.js';
import { validateNormalized, detectBundle } from './validation.js';
import { IPhoneAdapter } from './adapters/iphone.js';
import { MacBookAdapter } from './adapters/macbook.js';
import { GpuAdapter } from './adapters/gpu.js';
import { ConsoleAdapter } from './adapters/console.js';

// AdapterNormalizationResult is NOT re-exported – internal to this module
export type { NormalizedListing } from '../types.js';

// ── Raw listing shape from OLX scraper ───────────────────────────────────────

export interface OlxRawListing {
  id: string;
  title: string;
  price: number;
  priceText: string;
  location: string;
  postedAt: string;
  url: string;
  imageUrl?: string;
  description?: string;
  params?: Record<string, string>;
  category?: string;
}

// ── Adapters registry (order matters – first match wins) ─────────────────────

const ADAPTERS: BaseAdapter[] = [
  IPhoneAdapter,
  MacBookAdapter,
  GpuAdapter,
  ConsoleAdapter,
];

// ── determineCondition ────────────────────────────────────────────────────────

// REGUŁA: adaptery NIE ustawiają condition.
// condition wyznaczane wyłącznie tutaj przez determineCondition(input).
export function determineCondition(input: AdapterInput): ProductCondition {
  // Priority 1: olxParams (most reliable)
  const param = input.olxParams['state'] ?? input.olxParams['condition'];
  if (param) {
    const pl = param.toLowerCase();
    if (pl.includes('nowy') || pl.includes('new') || pl.includes('nowe')) return 'new';
    if (pl.includes('używany') || pl.includes('used') || pl.includes('używana')) return 'used';
  }

  const tl = input.title.toLowerCase();

  // Priority 2: title signals → new
  if (/\b(nowy|nowa|nowe|new|fabrycznie\s+nowy|zapakowany|zafoliowany)\b/i.test(tl)) return 'new';

  // Priority 3: title signals → used
  if (/\b(używany|używana|używane|second\s+hand|po\s+naprawie|refurbished)\b/i.test(tl)) return 'used';

  return 'unknown';
}

// ── rawToBase ────────────────────────────────────────────────────────────────

function rawToBase(raw: OlxRawListing): Pick<NormalizedListing,
  'id' | 'url' | 'title' | 'price' | 'priceText' | 'location' | 'postedAt' | 'imageUrl' | 'description' | 'olxCategory'
> {
  return {
    id: raw.id,
    url: raw.url,
    title: raw.title,
    price: raw.price,
    priceText: raw.priceText,
    location: raw.location,
    postedAt: raw.postedAt,
    imageUrl: raw.imageUrl,
    description: raw.description,
    olxCategory: raw.category,
  };
}

// ── STABLE CORE – single normalization pipeline ───────────────────────────────

export function normalizeListing(raw: OlxRawListing): NormalizedListing {
  const input: AdapterInput = {
    title: raw.title,
    description: raw.description,
    olxParams: raw.params ?? {},
    olxCategory: raw.category,
    price: raw.price,
  };

  // isAccessory check uses title + description + olxCategory (inside validateNormalized KROK 1)
  // Fast-path rejected accessories before adapter lookup
  const adapter = ADAPTERS.find(a => a.canHandle(input)) ?? null;

  if (!adapter) {
    // Unknown category → visible_only
    return {
      ...rawToBase(raw),
      eligibility: 'visible_only',
      isAccessory: false,
      isBundle: detectBundle(input),
      parsingConfidence: 0.1,
      validationFlags: ['no_adapter'],
      configKey: undefined,
      condition: determineCondition(input),
    };
  }

  // Finalny flow zgodny z F2 + F7
  const { fields, penalties } = adapter.normalize(input);  // AdapterNormalizationResult
  const isBundle = detectBundle(input);                    // PRZED validateNormalized
  const { eligibility, confidence, flags } = validateNormalized(fields, penalties, input, adapter, isBundle);
  const configKey = eligibility !== 'rejected' ? adapter.buildConfigKey(fields) : undefined;

  return {
    ...rawToBase(raw),
    ...fields,
    configKey,
    parsingConfidence: confidence,
    eligibility,
    isAccessory: false,
    isBundle,
    validationFlags: flags,
    condition: determineCondition(input),
    // REGUŁA: adaptery NIE ustawiają condition – zawsze nadpisywane przez determineCondition(input)
    // isSuspiciousPrice: BRAK tutaj – uzupełniane przez market-scanner po obliczeniu mediany
  };
}
