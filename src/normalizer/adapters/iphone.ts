import type { NormalizedListing } from '../../types.js';
import type { BaseAdapter, AdapterInput, AdapterNormalizationResult, FieldRole } from '../base-adapter.js';

// ── iPhone model number patterns ─────────────────────────────────────────────

const MODEL_PATTERNS: { regex: RegExp; key: string }[] = [
  { regex: /\biphone\s*17\b/i,  key: 'iphone_17' },
  { regex: /\biphone\s*16\b/i,  key: 'iphone_16' },
  { regex: /\biphone\s*15\b/i,  key: 'iphone_15' },
  { regex: /\biphone\s*14\b/i,  key: 'iphone_14' },
  { regex: /\biphone\s*13\b/i,  key: 'iphone_13' },
  { regex: /\biphone\s*12\b/i,  key: 'iphone_12' },
  { regex: /\biphone\s*11\b/i,  key: 'iphone_11' },
  { regex: /\biphone\s*xs?\b/i, key: 'iphone_x' },
  { regex: /\biphone\s*8\b/i,   key: 'iphone_8' },
  { regex: /\biphone\s*7\b/i,   key: 'iphone_7' },
  { regex: /\biphone\s*6s?\b/i, key: 'iphone_6' },
  { regex: /\biphone\s*se\b/i,  key: 'iphone_se' },
];

const LEGAL_STORAGE_GB = [64, 128, 256, 512, 1024];

// Models where minimum RAM is 6GB
const HIGH_RAM_MODELS = ['iphone_15', 'iphone_16', 'iphone_17'];
// Models where minimum RAM is 4GB
const MID_RAM_MODELS  = ['iphone_11', 'iphone_12', 'iphone_13', 'iphone_14'];
// Models where maximum RAM is 3GB (older)
const LOW_RAM_MODELS  = ['iphone_6', 'iphone_7', 'iphone_8', 'iphone_x', 'iphone_se'];

// ── IPhoneAdapter ─────────────────────────────────────────────────────────────

export const IPhoneAdapter: BaseAdapter = {
  name: 'iphone',

  fieldRoles: {
    model:       'config_key',
    variant:     'config_key',
    storage:     'config_key',
    ram:         'confidence_only',
    color:       'display_only',
  } as Record<string, FieldRole>,

  requiredForConfigKey: ['model', 'storage'],

  canHandle(input: AdapterInput): boolean {
    return /\biphone\b/i.test(input.title);
  },

  normalize(input: AdapterInput): AdapterNormalizationResult {
    const tl = input.title.toLowerCase();
    const fields: Partial<NormalizedListing> = {};
    const penalties: { flag: string; delta: number }[] = [];

    // ── brand ──
    fields.brand = 'Apple';

    // ── model ──
    for (const { regex, key } of MODEL_PATTERNS) {
      if (regex.test(tl)) {
        fields.model = key;
        break;
      }
    }

    // ── variant (priority order – STABLE) ──
    if (/\bpro\s*max\b/i.test(tl)) {
      fields.variant = 'pro_max';
      fields.variantCertainty = 'confirmed';
    } else if (/\bpro\b/i.test(tl)) {
      fields.variant = 'pro';
      fields.variantCertainty = 'confirmed';
    } else if (/\bair\b/i.test(tl)) {
      fields.variant = 'air';
      fields.variantCertainty = 'confirmed';
    } else if (/\bplus\b/i.test(tl)) {
      fields.variant = 'plus';
      fields.variantCertainty = 'confirmed';
    } else if (/\bmini\b/i.test(tl)) {
      fields.variant = 'mini';
      fields.variantCertainty = 'confirmed';
    } else if (/\bmax\b/i.test(tl)) {
      // 'max' without 'pro' = ambiguous
      fields.variant = undefined;
      fields.variantCertainty = 'ambiguous';
      penalties.push({ flag: 'variant_ambiguous', delta: -0.25 });
    } else {
      fields.variant = undefined;
      fields.variantCertainty = 'base_model';
    }

    // ── storage ──
    const storageMatch = tl.match(/\b(\d+)\s*gb\b/i);
    if (storageMatch) {
      const gb = parseInt(storageMatch[1]!, 10);
      if (LEGAL_STORAGE_GB.includes(gb)) {
        fields.storage = `${gb}gb`;
      } else {
        // Likely a RAM value mistaken for storage – or truly illegal storage
        penalties.push({ flag: 'storage_implausible', delta: -0.30 });
      }
    }

    // ── RAM (from title or olxParams) ──
    const ramParam = input.olxParams['memory'] ?? input.olxParams['ram'];
    let ramGb: number | undefined;
    if (ramParam) {
      const m = ramParam.match(/(\d+)/);
      if (m) ramGb = parseInt(m[1]!, 10);
    } else {
      // Try to find RAM in title: "6GB RAM" pattern
      const m = tl.match(/(\d+)\s*gb\s*ram/i);
      if (m) ramGb = parseInt(m[1]!, 10);
    }

    if (ramGb !== undefined) {
      fields.ram = `${ramGb}gb`;
      // RAM plausibility checks
      if (fields.model) {
        if (HIGH_RAM_MODELS.includes(fields.model) && ramGb < 6) {
          penalties.push({ flag: 'ram_implausible', delta: -0.35 });
        } else if (MID_RAM_MODELS.includes(fields.model) && ramGb < 4) {
          penalties.push({ flag: 'ram_implausible', delta: -0.35 });
        } else if (LOW_RAM_MODELS.includes(fields.model) && ramGb > 3) {
          penalties.push({ flag: 'ram_implausible', delta: -0.20 });
        }
      }
    }

    // ── color (from olxParams or title) ──
    if (input.olxParams['color']) {
      fields.color = input.olxParams['color'];
    }

    // ── accessory_bonus flag ──
    const BONUS_WORDS = ['gratis', 'w zestawie', 'w komplecie', 'w pudełku'];
    const ACCESSORY_WORDS = ['etui', 'case', 'folia', 'kabel', 'ładowarka', 'szkło'];
    const hasBonus = BONUS_WORDS.some(b => tl.includes(b));
    const hasAccessory = ACCESSORY_WORDS.some(a => tl.includes(a));
    if (hasBonus && hasAccessory) {
      // Informational only – delta 0
      penalties.push({ flag: 'accessory_bonus', delta: 0 });
    }

    return { fields, penalties };
  },

  buildConfigKey(fields: Partial<NormalizedListing>): string | undefined {
    if (!fields.model || !fields.storage) return undefined;
    // variant omitted when base_model
    if (fields.variant) {
      return `apple_${fields.model}_${fields.variant}_${fields.storage}`;
    }
    return `apple_${fields.model}_${fields.storage}`;
  },

  buildSearchQuery(configKey: string): string {
    // apple_iphone_17_pro_max_256gb → "iphone 17 pro max 256gb"
    return configKey
      .replace(/^apple_/, '')
      .replace(/_/g, ' ')
      .replace('pro max', 'pro max')
      .trim();
  },
};
