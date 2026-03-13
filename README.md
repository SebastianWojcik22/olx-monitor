# OLX Monitor

> Real-time market intelligence for OLX.pl electronics — AI-powered deal scoring, variant normalization, and instant webhook alerts.

---

## What problem does this solve?

Finding a genuinely good deal on OLX is hard. Prices vary wildly between models, conditions, and storage variants. Without a reference point you either overpay or miss real bargains. OLX Monitor solves this by:

1. **Building real market baselines** — scrapes live listings, removes outliers via IQR, computes median per exact product variant and condition
2. **Scoring every listing** — compares price to market median, grades quality from Good to Extreme
3. **Alerting you instantly** — sends a webhook notification the moment a monitored listing beats your rules
4. **Flagging risk** — GPT-4o reads the description for defects, missing proof of purchase, IMEI issues, and suspicious language

---

## Key features

| Feature | Details |
|---------|---------|
| **Market scanner** | Fetches live OLX listings, IQR outlier removal, computes median / P25 / P75 / histogram |
| **Variant normalization** | Parses titles into canonical config keys: `apple_iphone_16_pro_256gb`, `nvidia_rtx_5080_16gb` — no mixing of variants |
| **Deal scoring** | Discount = `(median − price) / median`; grades: Fair / Good 🟡 / Very Good 🔥 / Extreme 🚨 |
| **AI listing analysis** | GPT-4o extracts defects, risk flags, serial numbers, proof of purchase from description |
| **IMEI checker** | Validates iPhone/Samsung IMEI — blacklist status + carrier lock |
| **Background monitoring** | Each monitor runs on its own interval; fires webhook on match |
| **Web dashboard** | Dark-theme single-page app — Market / Monitors / Deals / IMEI tabs |
| **Webhook notifications** | Slack, Discord, Make.com, n8n — any HTTP endpoint |

---

## Project highlights

**Listing eligibility system** — every scraped listing gets classified before touching market stats:
- `market_eligible` — counted in median, can generate deals and alerts
- `visible_only` — shown in UI for context, never affects median
- `rejected` — accessories, repair listings, bundles — filtered out entirely

**Single source of truth for market data** — `MarketSnapshot` per `configKey:condition` pair. All sections (Market, Deals, Portfolio) read from the same snapshot. No independent median recalculations.

**Condition-aware snapshot lookup** — monitor condition `all` transparently falls back to available `used`/`new` snapshots so deals always show real market data when it exists.

**Category adapters** — iPhone, MacBook, GPU, gaming consoles each have a dedicated adapter that extracts structured fields from messy OLX titles and builds a stable config key used throughout the pipeline.

---

## Tech stack

| | |
|--|--|
| **Runtime** | Node.js 20 + TypeScript (no transpile step — `tsx`) |
| **Scraping** | `axios` + `cheerio` |
| **AI** | OpenAI GPT-4o via `openai` SDK |
| **Storage** | JSON files — no database needed |
| **Frontend** | Vanilla JS — zero build tooling |
| **Notifications** | HTTP webhook |

---

## Quick start

```bash
git clone https://github.com/SebastianWojcik22/olx-monitor.git
cd olx-monitor
npm install
cp .env.example .env
# Fill in OPENAI_API_KEY and WEBHOOK_URL
npm start
# Open http://localhost:3001
```

**Windows:** double-click `start.bat` — launches server and opens browser automatically.

### Environment variables

```env
OPENAI_API_KEY=sk-...       # Required — GPT-4o for listing analysis
WEBHOOK_URL=https://...     # Slack / Discord / Make.com / n8n
PORT=3001                   # Dashboard port (default: 3001)
OLX_CHECK_INTERVAL=15       # Monitor check interval in minutes
```

---

## How it works

```
OLX.pl search results
  └─ Scraper          – fetches raw HTML listings
  └─ Normalizer       – category adapter → configKey + eligibility tag
  └─ Market Scanner   – IQR median, histogram, dataConfidence per variant
  └─ Snapshot Store   – 6h cache (memory + disk) per configKey:condition
  └─ Deal Detector    – discount %, DealQuality, DealScore
  └─ Scheduler        – per-monitor timer → webhook on match
  └─ REST API         – pure handlers, no framework
  └─ Dashboard        – single HTML file, no build step
```

### Deal quality thresholds

| Label | Discount from median |
|-------|----------------------|
| Fair Deal | 0–4% |
| Good Deal 🟡 | 5–14% |
| Very Good Deal 🔥 | 15–29% |
| Extreme Deal 🚨 | 30%+ |

---

## Project structure

```
src/
├── types.ts                   – all interfaces (source of truth)
├── normalizer/
│   ├── base-adapter.ts        – adapter contract
│   ├── validation.ts          – 6-step eligibility pipeline
│   └── adapters/              – iphone · macbook · gpu · console
├── market/
│   ├── market-scanner.ts      – IQR median, snapshots, confidence scoring
│   └── snapshot-store.ts      – cache + condition-fallback lookup
├── deal-detector.ts           – DealScore, quality classification
├── scheduler.ts               – monitor loop + refreshSnapshots cycle
├── analyzer.ts                – GPT-4o listing analysis
├── handlers.ts                – API handler functions
├── server.ts                  – Node.js HTTP server
└── dashboard.html             – web UI (single file)
```

---

## License

MIT
