import type { NormalizedListing } from '../../types.js';
import type { BaseAdapter, AdapterInput, AdapterNormalizationResult, FieldRole } from '../base-adapter.js';

const BRAND_PATTERNS: { regex: RegExp; key: string }[] = [
  { regex: /\bplaystation\b|\bps\s*[345]\b/i, key: 'sony' },
  { regex: /\bxbox\b/i,                       key: 'microsoft' },
  { regex: /\bnintendo\b|\bswitch\b/i,         key: 'nintendo' },
];

const MODEL_PATTERNS: { regex: RegExp; key: string }[] = [
  { regex: /\bps\s*5\b|\bplaystation\s*5\b/i,       key: 'ps5' },
  { regex: /\bps\s*4\b|\bplaystation\s*4\b/i,       key: 'ps4' },
  { regex: /\bps\s*3\b|\bplaystation\s*3\b/i,       key: 'ps3' },
  { regex: /\bxbox\s*series\s*x\b/i,               key: 'xbox_series_x' },
  { regex: /\bxbox\s*series\s*s\b/i,               key: 'xbox_series_s' },
  { regex: /\bxbox\s*one\s*x\b/i,                  key: 'xbox_one_x' },
  { regex: /\bxbox\s*one\b/i,                      key: 'xbox_one' },
  { regex: /\bnintendo\s*switch\s*oled\b/i,        key: 'switch_oled' },
  { regex: /\bnintendo\s*switch\s*lite\b/i,        key: 'switch_lite' },
  { regex: /\bnintendo\s*switch\b|\bswitch\b/i,    key: 'switch' },
];

export const ConsoleAdapter: BaseAdapter = {
  name: 'console',

  fieldRoles: {
    brand:   'config_key',
    model:   'config_key',
    storage: 'config_key',
    color:   'display_only',
  } as Record<string, FieldRole>,

  requiredForConfigKey: ['brand', 'model'],

  canHandle(input: AdapterInput): boolean {
    const tl = input.title.toLowerCase();
    return (
      /\bps\s*[345]\b/i.test(tl) ||
      /\bplaystation\b/i.test(tl) ||
      /\bxbox\b/i.test(tl) ||
      /\bnintendo\s*switch\b/i.test(tl) ||
      /\bswitch\s*(oled|lite)?\b/i.test(tl)
    );
  },

  normalize(input: AdapterInput): AdapterNormalizationResult {
    const tl = input.title.toLowerCase();
    const fields: Partial<NormalizedListing> = {};
    const penalties: { flag: string; delta: number }[] = [];

    for (const { regex, key } of BRAND_PATTERNS) {
      if (regex.test(tl)) { fields.brand = key; break; }
    }

    for (const { regex, key } of MODEL_PATTERNS) {
      if (regex.test(tl)) { fields.model = key; break; }
    }

    // Storage (e.g. 825GB PS5, 1TB Xbox)
    const m = tl.match(/(\d+)\s*(gb|tb)/i);
    if (m) {
      const val = parseInt(m[1]!, 10);
      const isTb = /tb/i.test(m[2]!);
      fields.storage = `${isTb ? val * 1024 : val}gb`;
    }

    return { fields, penalties };
  },

  buildConfigKey(fields: Partial<NormalizedListing>): string | undefined {
    if (!fields.brand || !fields.model) return undefined;
    const storage = fields.storage ? `_${fields.storage}` : '';
    return `${fields.brand}_${fields.model}${storage}`;
  },

  buildSearchQuery(configKey: string): string {
    return configKey.replace(/_/g, ' ').trim();
  },
};
