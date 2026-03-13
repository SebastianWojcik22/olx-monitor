import type { NormalizedListing } from '../types.js';

export interface AdapterInput {
  title: string;
  description?: string;
  olxParams: Record<string, string>;
  olxCategory?: string;
  price: number;                      // pomocniczo jako sygnał walidacji
}

// Typ techniczny normalizer/ – eksportowany wewnątrz normalizer/, NIE re-eksportowany na zewnątrz
export interface AdapterNormalizationResult {
  fields: Partial<NormalizedListing>;             // pola produktowe dla NormalizedListing
  penalties: { flag: string; delta: number }[];   // penalty dla validateNormalized
}

export type FieldRole = 'config_key' | 'price_driver' | 'confidence_only' | 'display_only';

// STABLE CORE – BaseAdapter contract
export interface BaseAdapter {
  readonly name: string;
  readonly fieldRoles: Record<string, FieldRole>;
  readonly requiredForConfigKey: string[];               // brak któregoś → configKey = undefined

  canHandle(input: AdapterInput): boolean;               // title + olxParams + olxCategory
  normalize(input: AdapterInput): AdapterNormalizationResult; // zwraca fields + penalties
  buildConfigKey(fields: Partial<NormalizedListing>): string | undefined; // TYLKO 'config_key' pola
  buildSearchQuery(configKey: string): string;
}
