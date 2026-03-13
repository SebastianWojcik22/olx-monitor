import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MonitoredItem, Deal, ImeiRecord, DealQuality } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');

const ITEMS_FILE = path.join(DATA_DIR, 'items.json');
const DEALS_FILE = path.join(DATA_DIR, 'deals.json');

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown): void {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

// ── monitorRules migration ─────────────────────────────────────────────────

function qualityToPercent(q: DealQuality): number {
  switch (q) {
    case 'good':      return 10;
    case 'very_good': return 20;
    case 'extreme':   return 35;
    default:          return 0;
  }
}

function migrateItem(item: MonitoredItem): MonitoredItem {
  // Migrate legacy fields → monitorRules (idempotent)
  if (!item.monitorRules) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacy = item as any;
    item.monitorRules = {
      budgetMode: legacy.maxPrice ? { maxPrice: legacy.maxPrice as number } : undefined,
      marketMode: legacy.minDealQuality && legacy.minDealQuality !== 'normal'
        ? { minDiscountPct: qualityToPercent(legacy.minDealQuality as DealQuality) }
        : undefined,
      triggerLogic: 'any',
    };
  }
  // Migrate monitorStatus
  if (!item.monitorStatus) {
    item.monitorStatus = item.configKey ? 'resolved' : 'legacy';
  }
  // Ensure suggestedConfigKey/Label are null (not undefined) if absent
  if (item.suggestedConfigKey === undefined) item.suggestedConfigKey = null;
  if (item.suggestedConfigKeyLabel === undefined) item.suggestedConfigKeyLabel = null;
  return item;
}

// ── Items ──────────────────────────────────────────────────────────────────

export function loadItems(): MonitoredItem[] {
  const raw = readJson<MonitoredItem[]>(ITEMS_FILE, []);
  return raw.map(migrateItem);
}

export function saveItems(items: MonitoredItem[]): void {
  writeJson(ITEMS_FILE, items);
}

export function getItem(id: string): MonitoredItem | undefined {
  return loadItems().find(i => i.id === id);
}

export function upsertItem(item: MonitoredItem): void {
  const items = loadItems();
  const idx = items.findIndex(i => i.id === item.id);
  if (idx >= 0) items[idx] = item;
  else items.push(item);
  saveItems(items);
}

export function deleteItem(id: string): boolean {
  const items = loadItems();
  const filtered = items.filter(i => i.id !== id);
  if (filtered.length === items.length) return false;
  saveItems(filtered);
  return true;
}

// ── Deals ──────────────────────────────────────────────────────────────────

export function loadDeals(): Deal[] {
  return readJson<Deal[]>(DEALS_FILE, []);
}

export function saveDeals(deals: Deal[]): void {
  writeJson(DEALS_FILE, deals);
}

export function getDeal(id: string): Deal | undefined {
  return loadDeals().find(d => d.id === id);
}

export function upsertDeal(deal: Deal): void {
  const deals = loadDeals();
  const idx = deals.findIndex(d => d.id === deal.id);
  if (idx >= 0) deals[idx] = deal;
  else deals.push(deal);
  saveDeals(deals);
}

export function deleteDeal(id: string): boolean {
  const deals = loadDeals();
  const filtered = deals.filter(d => d.id !== id);
  if (filtered.length === deals.length) return false;
  saveDeals(filtered);
  return true;
}

export function dealExistsForListing(listingId: string): boolean {
  return loadDeals().some(d => d.listing.id === listingId);
}

// ── IMEI Records ────────────────────────────────────────────────────────────

const IMEI_FILE = path.join(DATA_DIR, 'imei-records.json');

export function loadImeiRecords(): ImeiRecord[] {
  return readJson<ImeiRecord[]>(IMEI_FILE, []);
}

export function saveImeiRecords(records: ImeiRecord[]): void {
  writeJson(IMEI_FILE, records);
}

export function getImeiRecord(id: string): ImeiRecord | undefined {
  return loadImeiRecords().find(r => r.id === id);
}

export function upsertImeiRecord(record: ImeiRecord): void {
  const records = loadImeiRecords();
  const idx = records.findIndex(r => r.id === record.id);
  if (idx >= 0) records[idx] = record;
  else records.push(record);
  saveImeiRecords(records);
}

export function deleteImeiRecord(id: string): boolean {
  const records = loadImeiRecords();
  const filtered = records.filter(r => r.id !== id);
  if (filtered.length === records.length) return false;
  saveImeiRecords(filtered);
  return true;
}
