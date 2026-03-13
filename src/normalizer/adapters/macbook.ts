import type { NormalizedListing } from '../../types.js';
import type { BaseAdapter, AdapterInput, AdapterNormalizationResult, FieldRole } from '../base-adapter.js';

const LEGAL_RAM_GB  = [8, 16, 24, 32, 48, 64, 96, 128, 192];
const LEGAL_SSD_GB  = [256, 512, 1024, 2048, 4096];

const MODEL_PATTERNS: { regex: RegExp; key: string }[] = [
  { regex: /\bmacbook\s*pro\b/i, key: 'pro' },
  { regex: /\bmacbook\s*air\b/i, key: 'air' },
  { regex: /\bmacbook\b/i,       key: 'macbook' },
];

const CHIP_PATTERNS: { regex: RegExp; key: string }[] = [
  { regex: /\bm4\s*pro\b/i,  key: 'm4_pro' },
  { regex: /\bm4\s*max\b/i,  key: 'm4_max' },
  { regex: /\bm4\b/i,        key: 'm4' },
  { regex: /\bm3\s*pro\b/i,  key: 'm3_pro' },
  { regex: /\bm3\s*max\b/i,  key: 'm3_max' },
  { regex: /\bm3\b/i,        key: 'm3' },
  { regex: /\bm2\s*pro\b/i,  key: 'm2_pro' },
  { regex: /\bm2\s*max\b/i,  key: 'm2_max' },
  { regex: /\bm2\b/i,        key: 'm2' },
  { regex: /\bm1\s*pro\b/i,  key: 'm1_pro' },
  { regex: /\bm1\s*max\b/i,  key: 'm1_max' },
  { regex: /\bm1\b/i,        key: 'm1' },
  { regex: /\bintel\b/i,     key: 'intel' },
];

const SCREEN_PATTERNS: { regex: RegExp; key: string }[] = [
  { regex: /\b16["\s]?\s*cal/i,  key: '16' },
  { regex: /\b15["\s]?\s*cal/i,  key: '15' },
  { regex: /\b14["\s]?\s*cal/i,  key: '14' },
  { regex: /\b13["\s]?\s*cali/i, key: '13' },
  { regex: /\b13["\s]/,          key: '13' },
  { regex: /\b16"/,              key: '16' },
  { regex: /\b15"/,              key: '15' },
  { regex: /\b14"/,              key: '14' },
  { regex: /\b13"/,              key: '13' },
];

export const MacBookAdapter: BaseAdapter = {
  name: 'macbook',

  fieldRoles: {
    model:      'config_key',
    chip:       'config_key',
    screenSize: 'config_key',
    ram:        'config_key',
    storage:    'config_key',
    color:      'display_only',
  } as Record<string, FieldRole>,

  requiredForConfigKey: ['model', 'chip', 'ram', 'storage'],

  canHandle(input: AdapterInput): boolean {
    return /\bmacbook\b/i.test(input.title);
  },

  normalize(input: AdapterInput): AdapterNormalizationResult {
    const tl = input.title.toLowerCase();
    const fields: Partial<NormalizedListing> = {};
    const penalties: { flag: string; delta: number }[] = [];

    fields.brand = 'Apple';

    // ── model ──
    for (const { regex, key } of MODEL_PATTERNS) {
      if (regex.test(tl)) { fields.model = key; break; }
    }

    // ── chip ──
    for (const { regex, key } of CHIP_PATTERNS) {
      if (regex.test(tl)) { fields.chip = key; break; }
    }

    // ── screen size ──
    for (const { regex, key } of SCREEN_PATTERNS) {
      if (regex.test(tl)) { fields.screenSize = key; break; }
    }

    // ── RAM ──
    const ramParam = input.olxParams['ram'] ?? input.olxParams['memory'];
    let ramGb: number | undefined;
    if (ramParam) {
      const m = ramParam.match(/(\d+)/);
      if (m) ramGb = parseInt(m[1]!, 10);
    } else {
      // title pattern: "16GB RAM" or "16GB/512GB"
      const m = tl.match(/(\d+)\s*gb\s*(ram|\/)/i);
      if (m) ramGb = parseInt(m[1]!, 10);
    }
    if (ramGb !== undefined) {
      fields.ram = `${ramGb}gb`;
      if (!LEGAL_RAM_GB.includes(ramGb)) {
        penalties.push({ flag: 'ram_implausible', delta: -0.40 });
      }
    }

    // ── Storage ──
    const storageParam = input.olxParams['storage'] ?? input.olxParams['ssd'];
    let ssdGb: number | undefined;
    if (storageParam) {
      const m = storageParam.match(/(\d+)/);
      if (m) ssdGb = parseInt(m[1]!, 10);
    } else {
      // title: "512GB SSD" or "1TB"
      const m = tl.match(/(\d+)\s*(?:gb|tb)\s*(?:ssd|nvme)?/i);
      if (m) {
        const val = parseInt(m[1]!, 10);
        const isTb = /tb/i.test(m[0]!);
        ssdGb = isTb ? val * 1024 : val;
      }
    }
    if (ssdGb !== undefined) {
      fields.storage = `${ssdGb}gb`;
      if (!LEGAL_SSD_GB.includes(ssdGb)) {
        penalties.push({ flag: 'storage_implausible', delta: -0.40 });
      }
    }

    // ── color ──
    if (input.olxParams['color']) {
      fields.color = input.olxParams['color'];
    }

    return { fields, penalties };
  },

  buildConfigKey(fields: Partial<NormalizedListing>): string | undefined {
    if (!fields.model || !fields.chip || !fields.ram || !fields.storage) return undefined;
    const screen = fields.screenSize ? `_${fields.screenSize}` : '';
    return `apple_macbook_${fields.model}_${fields.chip}${screen}_${fields.ram}_${fields.storage}`;
  },

  buildSearchQuery(configKey: string): string {
    return configKey
      .replace(/^apple_macbook_/, 'macbook ')
      .replace(/_/g, ' ')
      .trim();
  },
};
