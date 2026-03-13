import type { NormalizedListing, ListingEligibility } from '../types.js';
import type { AdapterInput, BaseAdapter } from './base-adapter.js';

export interface ValidationResult {
  eligibility: ListingEligibility;
  confidence: number;
  flags: string[];
}

// ── Hard reject helpers ───────────────────────────────────────────────────────

const ACCESSORY_PREFIXES = [
  'etui', 'case', 'folia', 'kabel', 'ładowarka', 'szkło', 'szkiełko', 'ochronne',
  'tempered', 'protector', 'cover', 'bumper', 'nakładka',
];

const ACCESSORY_KEYWORDS = [
  'etui do', 'case do', 'folia do', 'kabel do', 'ładowarka do', 'szkło do',
  'szkło ochronne', 'tempered glass', 'case for', 'cover for',
];

const ACCESSORY_CATEGORIES = [
  'akcesoria', 'etui', 'kable', 'ładowarki', 'folie', 'szkła ochronne',
];

const SERVICE_KEYWORDS = [
  'naprawa', 'serwis', 'wymiana', 'usługa', 'repair service', 'wyświetlacza wymiana',
  'baterii wymiana', 'szybki serwis',
];

const DAMAGED_KEYWORDS = [
  'na części', 'nie działa', 'uszkodzony', 'uszkodzona', 'uszkodzone',
  'do naprawy', 'defekt', 'zbita szybka', 'martwy ekran', 'parts only',
];

const BONUS_WORDS = ['gratis', 'w zestawie', 'w komplecie', 'w pudełku', 'bonus', 'extra'];

function titleLower(input: AdapterInput): string {
  return input.title.toLowerCase();
}

function categoryLower(input: AdapterInput): string {
  return (input.olxCategory ?? '').toLowerCase();
}

function isMainProductAccessory(input: AdapterInput): boolean {
  const tl = titleLower(input);
  const cat = categoryLower(input);

  // Category hard-match
  if (ACCESSORY_CATEGORIES.some(c => cat.includes(c))) {
    // Check if title suggests device+bonus
    if (BONUS_WORDS.some(b => tl.includes(b))) return false;
    return true;
  }

  // Title starts with accessory name (primary product is accessory)
  if (ACCESSORY_PREFIXES.some(p => tl.startsWith(p + ' '))) {
    if (BONUS_WORDS.some(b => tl.includes(b))) return false;
    return true;
  }

  // Title contains accessory keyword phrase indicating it's the main subject
  if (ACCESSORY_KEYWORDS.some(kw => tl.includes(kw))) {
    if (BONUS_WORDS.some(b => tl.includes(b))) return false;
    return true;
  }

  return false;
}

function isServiceListing(input: AdapterInput): boolean {
  const tl = titleLower(input);
  return SERVICE_KEYWORDS.some(kw => tl.includes(kw));
}

function isDamagedForParts(input: AdapterInput): boolean {
  const tl = titleLower(input);
  return DAMAGED_KEYWORDS.some(kw => tl.includes(kw));
}

function isImpossibleModel(fields: Partial<NormalizedListing>): boolean {
  // Adapter-specific impossible model checks are embedded in adapter penalties.
  // This is a generic guard – currently no cross-adapter impossible models known.
  // Adapters can push 'impossible_model' flag via penalties instead.
  void fields;
  return false;
}

// ── Main validation ───────────────────────────────────────────────────────────

// KROK 1–6 używa fields (z AdapterNormalizationResult), penalties, adapter, isBundle
// Sygnatura kanoniczna (STABLE CORE – zgodna z planem F2 + F7)
export function validateNormalized(
  fields: Partial<NormalizedListing>,
  penalties: { flag: string; delta: number }[],
  input: AdapterInput,
  adapter: BaseAdapter,
  isBundle: boolean,       // przekazywane jawnie z normalizeListing(), nie z fields
): ValidationResult {
  // KROK 1: Hard reject (title + description + olxCategory)
  if (isMainProductAccessory(input)) return { eligibility: 'rejected', confidence: 0, flags: ['accessory'] };
  if (isServiceListing(input))       return { eligibility: 'rejected', confidence: 0, flags: ['service'] };
  if (isDamagedForParts(input))      return { eligibility: 'rejected', confidence: 0, flags: ['parts_only'] };
  if (isImpossibleModel(fields))     return { eligibility: 'rejected', confidence: 0, flags: ['impossible_model'] };

  // KROK 2: Confidence + flags z penalties adaptera
  let confidence = 1.0;
  const flags: string[] = [];
  for (const p of penalties) {
    if (p.flag === 'accessory_bonus') {
      // accessory_bonus jest WYŁĄCZNIE informacyjny – NIE obniża confidence
      flags.push(p.flag);
    } else {
      confidence += p.delta;
      flags.push(p.flag);
    }
  }

  // KROK 3: requiredForConfigKey
  const missing = adapter.requiredForConfigKey.filter(
    f => !fields[f as keyof NormalizedListing]
  );
  if (missing.length > 0) {
    flags.push('incomplete_config');
    return { eligibility: 'visible_only', confidence, flags };
  }

  // KROK 4: VariantCertainty
  if (fields.variantCertainty === 'ambiguous') {
    return { eligibility: 'visible_only', confidence, flags: [...flags, 'variant_ambiguous'] };
  }

  // KROK 5: Bundle (jawne przekazanie, nie z fields)
  if (isBundle) return { eligibility: 'visible_only', confidence, flags: [...flags, 'bundle'] };

  // KROK 6: Confidence threshold
  if (confidence < 0.6) return { eligibility: 'visible_only', confidence, flags };

  return { eligibility: 'market_eligible', confidence, flags };
}

// ── detectBundle ─────────────────────────────────────────────────────────────

const BUNDLE_PATTERNS = [
  /\braz(em|y)\b/i,
  /\boraz\b.{1,30}\biphone\b/i,
  /\biphone\b.{1,30}\boraz\b.{1,30}\biphone\b/i,
  /\d+\s*(szt|sztuk)\b/i,
  /zestaw\s+\d/i,
  /\bkomplet\b/i,
  /\bi\s+(iphone|ipad|macbook)\b/i,   // "iPhone 17 i iPhone 11"
];

export function detectBundle(input: AdapterInput): boolean {
  const tl = titleLower(input);
  return BUNDLE_PATTERNS.some(r => r.test(tl));
}
