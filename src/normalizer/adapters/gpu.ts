import type { NormalizedListing } from '../../types.js';
import type { BaseAdapter, AdapterInput, AdapterNormalizationResult, FieldRole } from '../base-adapter.js';

const BRAND_PATTERNS: { regex: RegExp; key: string }[] = [
  { regex: /\brtx\b/i,        key: 'nvidia' },
  { regex: /\bgtx\b/i,        key: 'nvidia' },
  { regex: /\bnvidia\b/i,     key: 'nvidia' },
  { regex: /\bradeon\b/i,     key: 'amd' },
  { regex: /\brx\s*\d{4}/i,  key: 'amd' },
  { regex: /\bamd\b/i,        key: 'amd' },
  { regex: /\barc\b/i,        key: 'intel' },
  { regex: /\bintel\s*arc\b/i, key: 'intel' },
];

const MODEL_PATTERNS: { regex: RegExp; key: string }[] = [
  { regex: /\brtx\s*(\d{4}\s*(?:ti|super)?)\b/i, key: 'rtx_$1' },
  { regex: /\bgtx\s*(\d{4}\s*(?:ti|super)?)\b/i, key: 'gtx_$1' },
  { regex: /\brx\s*(\d{4}\s*(?:xt|gre)?)\b/i,    key: 'rx_$1' },
  { regex: /\barc\s*(a\d{3})\b/i,                 key: 'arc_$1' },
];

const VRAM_PATTERN = /\b(\d+)\s*gb\b/i;

export const GpuAdapter: BaseAdapter = {
  name: 'gpu',

  fieldRoles: {
    brand:   'config_key',
    model:   'config_key',
    storage: 'config_key',  // VRAM stored in storage field
    color:   'display_only',
  } as Record<string, FieldRole>,

  requiredForConfigKey: ['brand', 'model'],

  canHandle(input: AdapterInput): boolean {
    const tl = input.title.toLowerCase();
    return (
      /\bgpu\b/i.test(tl) ||
      /\bgraficzna\b/i.test(tl) ||
      /\bkarta\s+graficzna\b/i.test(tl) ||
      /\brtx\b/i.test(tl) ||
      /\bgtx\b/i.test(tl) ||
      /\bradeon\b/i.test(tl) ||
      (/\brx\s*\d{4}/i.test(tl) && !/iphone/i.test(tl))
    );
  },

  normalize(input: AdapterInput): AdapterNormalizationResult {
    const tl = input.title.toLowerCase();
    const fields: Partial<NormalizedListing> = {};
    const penalties: { flag: string; delta: number }[] = [];

    // brand
    for (const { regex, key } of BRAND_PATTERNS) {
      if (regex.test(tl)) { fields.brand = key; break; }
    }

    // model
    for (const { regex, key } of MODEL_PATTERNS) {
      const m = tl.match(regex);
      if (m) {
        fields.model = key.replace('$1', m[1]!.toLowerCase().replace(/\s+/g, '_'));
        break;
      }
    }

    // VRAM → stored in storage field for configKey purposes
    const vramMatch = tl.match(VRAM_PATTERN);
    if (vramMatch) {
      fields.storage = `${vramMatch[1]}gb`;
    }

    return { fields, penalties };
  },

  buildConfigKey(fields: Partial<NormalizedListing>): string | undefined {
    if (!fields.brand || !fields.model) return undefined;
    const vram = fields.storage ? `_${fields.storage}` : '';
    return `${fields.brand}_${fields.model}${vram}`;
  },

  buildSearchQuery(configKey: string): string {
    return configKey.replace(/_/g, ' ').trim();
  },
};
