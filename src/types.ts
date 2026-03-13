export type DealQuality = 'normal' | 'good' | 'very_good' | 'extreme' | 'no_data';

// ── v2: Listing eligibility ──────────────────────────────────────────────────

// STABLE CORE – listing eligibility contract
export type ListingEligibility =
  | 'market_eligible'   // buduje medianę; może generować deale i powiadomienia
  | 'visible_only'      // widoczne pomocniczo w UI; NIE buduje mediany; NIE generuje deali
  | 'rejected';         // całkowicie poza systemem; niewidoczne

// Dwa różne powody braku wariantu
export type VariantCertainty =
  | 'confirmed'    // wariant wykryty jednoznacznie
  | 'base_model'   // brak wariantu = faktycznie model bazowy
  | 'ambiguous';   // parser widział sygnały wariantu ale nie rozstrzygnął

export type ProductCondition = 'new' | 'used' | 'unknown';

export interface MonitorRules {
  budgetMode?: { maxPrice: number };
  marketMode?: { minDiscountPct: number };
  // triggerLogic ma znaczenie TYLKO gdy oba tryby aktywne jednocześnie
  triggerLogic: 'any' | 'all';
}

export interface MonitoredItem {
  id: string;
  name: string;
  searchQuery: string;
  maxPrice: number;
  minPrice: number;        // filtruje akcesoria i naprawy (legacy – migrowane do monitorRules)
  categoryId?: number;     // ID kategorii OLX (np. 84 = Smartfony)
  requiredKeywords: string[]; // WSZYSTKIE słowa muszą być w tytule (case-insensitive)
  condition: 'new' | 'used' | 'all';
  intervalMinutes: number;
  enabled: boolean;
  customMessage?: string;       // własna wiadomość do sprzedawcy (opcjonalna)
  minDealQuality?: DealQuality; // legacy – migrowane do monitorRules
  createdAt: string;
  lastCheckedAt?: string;

  // v2 fields
  configKey?: string;
  monitorStatus?: 'resolved' | 'unresolved' | 'legacy';
  monitorRules?: MonitorRules;   // jedyne źródło reguł w runtime; migrowane przy loadItems()
  suggestedConfigKey?: string | null;        // propozycja od schedulera; null = wyczyszczone
  suggestedConfigKeyLabel?: string | null;   // human-readable label dla UI; null = wyczyszczone
}

export interface OlxListing {
  id: string;
  title: string;
  price: number;
  priceText: string;
  condition?: string;
  location: string;
  postedAt: string;
  url: string;
  imageUrl?: string;
  description: string;
  /** Dane techniczne wyciągnięte z sekcji parametrów OLX (np. memory, color, phone_model) */
  params?: Record<string, string>;
}

export interface DealAnalysis {
  defects: string[];
  technicalSpecs: Record<string, string>;
  hasSerialNumber: boolean;
  serialNumber?: string;       // IMEI / numer seryjny wyciągnięty z opisu
  hasProofOfPurchase: boolean;
  riskFlags: string[];
  summary: string;
  riskScore: 'low' | 'medium' | 'high';
}

export interface Deal {
  id: string;
  itemId: string;
  itemName: string;
  listing: OlxListing;
  analysis: DealAnalysis;
  foundAt: string;
  contactStatus: 'none' | 'contacted' | 'replied' | 'negotiating' | 'pass' | 'purchased' | 'sold';
  sellerReply?: string;
  notes?: string;
  dismissed: boolean;
  // Portfolio tracking
  purchasePrice?: number;   // cena zakupu (zł)
  salePrice?: number;       // cena sprzedaży (zł)
  purchasedAt?: string;     // ISO timestamp zakupu
  soldAt?: string;          // ISO timestamp sprzedaży
  // Deal scoring (legacy – backward compat)
  configKey?: string;       // klucz konfiguracji (np. apple_iphone_17_pro_max_256gb)
  dealScore?: number;       // % zniżki od mediany rynkowej (np. 27)
  dealQuality?: DealQuality;
  marketMedian?: number;    // mediana rynkowa dla tej konfiguracji (legacy)
  // v2 live/immutable fields
  marketMedianAtDiscovery?: number;  // IMMUTABLE – mediana gdy znaleziono deal
  marketMedianAtPurchase?: number;   // IMMUTABLE – mediana gdy kupiono
  liveMarketMedian?: number;         // przeliczane przy GET, nie zapisywane na dysku
  liveDiscount?: number;
  liveQuality?: DealQuality;
  liveDataConfidence?: 'high' | 'medium' | 'low' | 'no_data';
}

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface HandlerResult {
  status: number;
  body: unknown;
}

// ── IMEI / Serial verification ──────────────────────────────────────────────

export interface ImeiRecord {
  id: string;
  imei?: string;
  serial?: string;
  listingId?: string;
  listingTitle?: string;
  listingUrl?: string;
  listingDescription?: string;
  createdAt: string;
  verification?: DeviceVerification;
}

export interface DeviceVerification {
  verifiedAt: string;
  imeiValid?: boolean;
  imei?: string;
  decodedSerial?: SerialDecoded;
  appleData?: AppleDeviceData;
  imeiInfoData?: ImeiInfoData;
  imeiCheckData?: ImeiCheckData;
  tacData?: { manufacturer: string; modelHint?: string; tac: string };
  listingImeiFromDesc?: string;
  discrepancies: string[];
}

export interface SerialDecoded {
  model?: string;
  color?: string;
  capacity?: string;
  manufactureYear?: number;
  manufactureWeek?: number;
  factory?: string;
}

export interface AppleDeviceData {
  coverageEndDate?: string;
  activationStatus?: string;
  findMyStatus?: string;
  carrier?: string;
  simLockStatus?: string;
  repairCoverage?: string;
  error?: string;
}

export interface ImeiInfoData {
  manufacturer?: string;
  model?: string;
  blacklisted?: boolean;
  carrier?: string;
  error?: string;
}

export interface ImeiCheckData {
  // Device identity
  model?: string;           // "iPhone 17 Pro Max (A3526) [Global]"
  modelNumber?: string;     // "A3526"
  modelRegion?: string;     // "Global (Europe / Asia / Australia)"
  simConfig?: string;       // "Nano-SIM + eSIM"
  imei2?: string;           // second IMEI (eSIM)
  serialMasked?: string;    // "MMWCWV3***"
  // Status flags
  simLocked?: boolean;
  simLockCarrier?: string;
  activationStatus?: string;    // "Not Activated" | "Activated"
  validPurchaseDate?: boolean;
  registeredDevice?: boolean;
  replacedDevice?: boolean;
  loanerDevice?: boolean;
  refurbished?: boolean;
  blacklistClean?: boolean;
  fmiOff?: boolean;             // FMI/iCloud OFF = safe (no iCloud lock)
  chimeraBlocked?: boolean;
  error?: string;
}

// ── v2: NormalizedListing ────────────────────────────────────────────────────

// STABLE CORE – NormalizedListing contract
export interface NormalizedListing {
  // Raw (z OLX API)
  id: string; url: string; title: string; price: number; priceText: string;
  location: string; postedAt: string; imageUrl?: string; description?: string;
  olxCategory?: string;

  // Produktowe (z adaptera)
  brand?: string; model?: string; variant?: string; storage?: string;
  ram?: string; chip?: string; screenSize?: string; color?: string;
  condition: ProductCondition;
  variantCertainty?: VariantCertainty;
  configKey?: string;

  // Pre-market validation (bez snapshotu)
  parsingConfidence: number;          // 0.0–1.0
  eligibility: ListingEligibility;
  validationFlags: string[];          // ram_implausible, variant_ambiguous, accessory_bonus, ...
  isBundle: boolean;
  isAccessory: boolean;

  // Post-market flags (uzupełniane przez market-scanner PO obliczeniu mediany)
  isSuspiciousPrice?: boolean;        // price < 50% snapshot.stats.median
}

// ── v2: ProductVariant ───────────────────────────────────────────────────────

export interface ProductVariant {
  configKey: string;
  label: string;          // "iPhone 17 Pro Max 256GB"
  brand: string; model: string; variant?: string;
  storage?: string; ram?: string; chip?: string; screenSize?: string;
  keywords: string[];
  searchQuery: string;    // canonical query dla targeted fetch
}

// ── v2: MarketSnapshot ───────────────────────────────────────────────────────

// STABLE CORE – MarketSnapshot contract
// Klucz ZAWSZE = snapshotKey = `${configKey}:${condition}`
export interface MarketSnapshotStats {
  min: number; p10: number; p25: number; median: number;
  avg: number; p75: number; p90: number; max: number;
}

export interface MarketSnapshot {
  configKey: string;
  condition: 'new' | 'used' | 'all';
  snapshotKey: string;           // `${configKey}:${condition}` – STABLE
  computedAt: string; label: string; keywords: string[];

  rawCount: number; rejectedCount: number;
  visibleOnlyCount: number; marketEligibleCount: number; outlierRemovedCount: number;

  stats: MarketSnapshotStats;    // TYLKO z market_eligible po IQR

  // cheapestEligible: dane rynkowe – mogą być używane do okazji i % od mediany
  cheapestEligible: NormalizedListing[];  // top 10 market_eligible (z isSuspiciousPrice)

  // cheapestVisible: WYŁĄCZNIE diagnostyczne
  // NIE do: okazji, % od mediany, "najtańszych ofert rynkowych", CTA "świetna okazja"
  cheapestVisible: NormalizedListing[];   // top 5 visible_only (osobna sekcja)

  histogram: { from: number; to: number; count: number }[];

  // dataConfidence – wieloczynnikowa
  dataConfidence: 'high' | 'medium' | 'low';

  rejectionReasons: Record<string, number>;
  targetedFetchUsed: boolean;
  targetedFetchCount?: number;
}

export interface ScanResult {
  snapshots: MarketSnapshot[];
  query: string;
  condition: string;
}

// ── v2: DealScore ────────────────────────────────────────────────────────────

export interface DealScore {
  isNoScore: boolean;        // true gdy brak snapshotu lub inny brak danych
  configKey?: string;
  marketMedian: number;      // 0 gdy isNoScore=true
  discount: number;          // może być ujemny (listing droższy od mediany)
  quality: DealQuality;      // 'no_data' gdy isNoScore=true
  p25?: number; p75?: number;
}
