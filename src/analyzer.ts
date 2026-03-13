import OpenAI from 'openai';
import type { OlxListing, DealAnalysis } from './types.js';

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

const FALLBACK_ANALYSIS: DealAnalysis = {
  defects: [],
  technicalSpecs: {},
  hasSerialNumber: false,
  hasProofOfPurchase: false,
  riskFlags: ['Brak opisu – niemożliwa analiza'],
  summary: 'Brak opisu ogłoszenia.',
  riskScore: 'medium',
};

export async function analyzeListing(
  listing: OlxListing,
  marketMedian = 0,
  discountPct = 0,
): Promise<DealAnalysis> {
  if (!listing.description && !listing.title) {
    return FALLBACK_ANALYSIS;
  }

  const marketContext = marketMedian > 0
    ? `Cena rynkowa (mediana): ${marketMedian.toLocaleString('pl-PL')} zł\nZniżka od rynku: ${discountPct}%\n`
    : '';

  const prompt = `Jesteś ekspertem od oceny ogłoszeń sprzedaży używanych urządzeń elektronicznych.
Przeanalizuj poniższe ogłoszenie OLX i zwróć WYŁĄCZNIE obiekt JSON (bez markdown, bez komentarzy).

Struktura JSON:
{
  "defects": ["lista wad/uszkodzeń wymienionych w opisie"],
  "technicalSpecs": {"klucz": "wartość", "np. pamięć": "256GB", "kolor": "czarny"},
  "hasSerialNumber": true/false,
  "serialNumber": "numer IMEI lub seryjny jeśli podany w opisie, np. 356789012345678 – lub null jeśli brak",
  "hasProofOfPurchase": true/false,
  "riskFlags": ["czerwone flagi dla kupującego, np. brak paragonu, sprzedawca pilnie sprzedaje, zdjęcia z internetu"],
  "summary": "2-3 zdania podsumowania po polsku – stan telefonu, co warto wiedzieć przed zakupem",
  "riskScore": "low" | "medium" | "high"
}

riskScore:
- low = dobry stan, brak wad, cena zgodna z rynkiem lub niższa, dowód zakupu
- medium = drobne wady lub brak dowodu zakupu
- high = poważne wady, podejrzane ogłoszenie, brak informacji, lub cena >35% poniżej mediany rynkowej bez wyjaśnienia

Uwaga: jeśli cena jest podejrzanie niska (>35% poniżej mediany rynkowej) bez wyraźnego powodu w opisie, dodaj red flag "podejrzanie niska cena" i podwyższ riskScore.

---
Tytuł: ${listing.title}
Cena: ${listing.priceText}
${marketContext}Stan: ${listing.condition ?? 'nieznany'}
Lokalizacja: ${listing.location}
Opis:
${listing.description || '(brak opisu)'}
---`;

  try {
    const response = await getClient().chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 800,
      response_format: { type: 'json_object' },
    });

    const raw = response.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as Partial<DealAnalysis>;

    return {
      defects: Array.isArray(parsed.defects) ? parsed.defects : [],
      technicalSpecs:
        parsed.technicalSpecs && typeof parsed.technicalSpecs === 'object'
          ? parsed.technicalSpecs
          : {},
      hasSerialNumber: Boolean(parsed.hasSerialNumber),
      serialNumber: typeof parsed.serialNumber === 'string' && parsed.serialNumber.trim()
        ? parsed.serialNumber.trim()
        : undefined,
      hasProofOfPurchase: Boolean(parsed.hasProofOfPurchase),
      riskFlags: Array.isArray(parsed.riskFlags) ? parsed.riskFlags : [],
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      riskScore:
        parsed.riskScore === 'low' || parsed.riskScore === 'high'
          ? parsed.riskScore
          : 'medium',
    };
  } catch (err) {
    console.error('[analyzer] GPT-4o error:', err);
    return { ...FALLBACK_ANALYSIS, riskFlags: ['Błąd analizy AI'] };
  }
}
