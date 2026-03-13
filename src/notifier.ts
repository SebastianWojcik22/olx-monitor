import axios from 'axios';
import type { Deal, DealQuality } from './types.js';
import { QUALITY_LABELS, QUALITY_EMOJI } from './deal-detector.js';

const RISK_EMOJI: Record<string, string> = {
  low:    '🟢',
  medium: '🟡',
  high:   '🔴',
};

function qualityHeader(quality: DealQuality | undefined, discountPct: number | undefined): string {
  if (!quality || quality === 'normal') return '🔔 Nowa okazja';
  const emoji = QUALITY_EMOJI[quality];
  const label = QUALITY_LABELS[quality];
  const pct = discountPct ? ` −${discountPct}%` : '';
  return `${emoji} ${label.toUpperCase()}${pct}`;
}

function buildDiscord(deal: Deal): string {
  const q = deal.dealQuality;
  const header = qualityHeader(q, deal.dealScore);
  const risk = RISK_EMOJI[deal.analysis.riskScore] ?? '';
  const marketLine = deal.marketMedian
    ? `Rynek: **${deal.marketMedian.toLocaleString('pl-PL')} zł** → cena: **${deal.listing.priceText}**`
    : `Cena: **${deal.listing.priceText}**`;
  const flags = deal.analysis.riskFlags.length
    ? `\n⚠️ ${deal.analysis.riskFlags.slice(0, 3).join(' · ')}`
    : '';
  const condition = deal.listing.condition ? ` · ${deal.listing.condition}` : '';

  return JSON.stringify({
    content: [
      `**${header}** – ${deal.listing.title}`,
      marketLine,
      `${risk} Ryzyko: ${deal.analysis.riskScore}${condition} · ${deal.listing.location}`,
      flags,
      `🔗 ${deal.listing.url}`,
    ].filter(Boolean).join('\n'),
  });
}

function buildSlack(deal: Deal, threshold: number): string {
  const q = deal.dealQuality;
  const header = qualityHeader(q, deal.dealScore);
  const color = deal.analysis.riskScore === 'low' ? '#36a64f'
    : deal.analysis.riskScore === 'high' ? '#cc0000' : '#e6a817';

  const marketValue = deal.marketMedian
    ? `${deal.listing.price.toLocaleString('pl-PL')} zł (rynek: ${deal.marketMedian.toLocaleString('pl-PL')} zł)`
    : `${deal.listing.price.toLocaleString('pl-PL')} zł (próg: ${threshold.toLocaleString('pl-PL')} zł)`;

  return JSON.stringify({
    text: `${header} – ${deal.listing.title}`,
    attachments: [{
      color,
      fields: [
        { title: 'Cena', value: marketValue, short: true },
        { title: 'Ryzyko', value: `${RISK_EMOJI[deal.analysis.riskScore] ?? ''} ${deal.analysis.riskScore}`, short: true },
        { title: 'Podsumowanie', value: deal.analysis.summary, short: false },
        ...(deal.analysis.riskFlags.length > 0
          ? [{ title: 'Czerwone flagi', value: deal.analysis.riskFlags.join(', '), short: false }]
          : []),
      ],
      actions: [{ type: 'button', text: 'Otwórz ogłoszenie', url: deal.listing.url }],
    }],
  });
}

export async function notifyDeal(deal: Deal, threshold: number): Promise<void> {
  const webhookUrl = process.env.WEBHOOK_URL?.trim();
  if (!webhookUrl) return;

  const isDiscord = webhookUrl.includes('discord.com');
  const body = isDiscord ? buildDiscord(deal) : buildSlack(deal, threshold);

  try {
    await axios.post(webhookUrl, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 5_000,
    });
  } catch (err) {
    console.warn('[notifier] Webhook failed (non-fatal):', err instanceof Error ? err.message : err);
  }
}
