# OLX Monitor

A web application that continuously monitors OLX.pl listings for electronics and notifies you when a great deal appears — with AI-powered analysis and real market pricing intelligence.

## What it does

OLX Monitor scrapes OLX.pl search results on a configurable schedule, scores each listing against live market median prices, and sends instant notifications when a discount exceeds your threshold. It also uses GPT-4o to analyze listing descriptions for red flags (missing IMEI, suspicious vagueness, defects) and grades deal quality from **Good** to **Extreme**.

### Key features

- **Real-time market scanner** – fetches fresh OLX listings and computes market median via IQR outlier removal (eliminates bait prices)
- **Deal scoring** – compares each listing price to the market median; grades: Normal / Good / Very Good / Extreme
- **AI listing analysis** – GPT-4o reads the full description and flags defects, missing proof of purchase, suspicious wording, and extracts serial numbers
- **IMEI checker** – validates iPhone/Samsung IMEI (blacklist + carrier lock status)
- **Smart normalization** – category-specific adapters (iPhone, MacBook, GPU, gaming consoles) parse titles into canonical config keys (e.g. `apple_iphone_16_pro_256gb`) so market stats are never mixed across variants
- **Background monitoring** – each monitored item runs on its own interval; scheduler sends webhook notifications to Slack, Discord, Make.com, or n8n
- **Web dashboard** – single-page dark-theme UI for browsing market, managing monitors, reviewing deals, and checking IMEI

---

## Architecture

```
OLX.pl
  └─ Scraper (src/scraper.ts)
       └─ Normalizer (src/normalizer/)
            ├─ iPhone adapter    – parses model/variant/storage into configKey
            ├─ MacBook adapter   – parses chip/RAM/SSD
            ├─ GPU adapter       – parses brand/model/VRAM
            └─ Console adapter   – PS3/4/5, Xbox, Nintendo Switch
       └─ Market Scanner (src/market/)
            ├─ market-scanner.ts – IQR median, dataConfidence, histogram
            └─ snapshot-store.ts – cache + disk persistence (data/snapshots/)
       └─ Deal Detector (src/deal-detector.ts)
            └─ scoreDealFromNormalized() – discount %, DealQuality, DealScore
       └─ Scheduler (src/scheduler.ts)
            └─ checkItem() per monitor + refreshSnapshots() cycle
       └─ REST API + Dashboard (src/server.ts + src/dashboard.html)
```

### Listing eligibility

Every scraped listing gets one of three eligibility tags:

| Tag | Meaning |
|-----|---------|
| `market_eligible` | Counted in market median; can trigger deals and notifications |
| `visible_only` | Shown in UI as context only; does NOT affect market stats |
| `rejected` | Filtered out entirely (accessories, repair services, bundles) |

### Market snapshots

Market stats (`MarketSnapshot`) are computed per `configKey:condition` pair (e.g. `apple_iphone_16_pro_256gb:used`). Snapshots are cached in memory and on disk under `data/snapshots/`. They expire after 6 hours by default. Only `market_eligible` listings contribute to the median.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ with TypeScript (`tsx`) |
| Scraping | `axios` + `cheerio` |
| AI analysis | OpenAI GPT-4o (`openai` SDK) |
| Notifications | HTTP webhook (Slack / Discord / Make.com / n8n) |
| Storage | JSON files on disk (no database required) |
| Dashboard | Vanilla JS + HTML (zero frontend dependencies) |

---

## Getting started

### Prerequisites

- Node.js 20+
- OpenAI API key (GPT-4o access)
- Webhook URL for notifications (Slack, Discord, or any HTTP endpoint)

### Installation

```bash
git clone https://github.com/SebastianWojcik22/olx-monitor.git
cd olx-monitor
npm install
cp .env.example .env
# Edit .env and fill in your keys
```

### Configuration

```env
OPENAI_API_KEY=sk-...          # Required – GPT-4o for listing analysis
WEBHOOK_URL=https://...        # Slack/Discord/Make.com/n8n webhook
PORT=3001                      # Dashboard port (default: 3001)
OLX_CHECK_INTERVAL=15          # Default monitor interval in minutes
```

### Run

```bash
npm start
```

Opens the dashboard at `http://localhost:3001`

On Windows, double-click **`start.bat`** — it launches the server and opens the browser automatically.

---

## Dashboard tabs

### Rynek (Market)
Search any product and see live market pricing: median, P25/P75 range, histogram, and all current listings color-coded by deal quality.

### Monitory (Monitors)
Create and manage monitoring rules. Each monitor has:
- Search query + required keywords
- Condition filter (`new` / `used` / `all`)
- Trigger rules: budget cap, minimum discount %, or both
- Check interval (minutes)

When a match is found, a webhook notification is sent instantly.

### Deale (Deals)
History of all discovered deals with deal quality badge, AI analysis summary, and one-click link to the listing.

### IMEI
Paste an OLX listing URL or IMEI number directly. Returns:
- Blacklist status
- Carrier lock status
- Device model confirmation

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/market-scan` | Scan OLX for a query, returns normalized listings + stats |
| `GET` | `/api/price-stats` | Market median + P25/P75 for a configKey:condition |
| `GET` | `/api/price-analysis` | Analyze a single listing price vs market |
| `GET` | `/api/items` | List all monitors |
| `POST` | `/api/items` | Create or update a monitor |
| `GET` | `/api/deals` | List all discovered deals |
| `GET` | `/api/imei` | Check IMEI status |
| `POST` | `/api/imei` | Fetch listing and extract IMEI |

---

## Project structure

```
olx-monitor/
├── src/
│   ├── types.ts                  – all TypeScript interfaces (source of truth)
│   ├── scraper.ts                – OLX.pl HTML scraper
│   ├── normalizer/
│   │   ├── index.ts              – normalizeListing() entry point
│   │   ├── base-adapter.ts       – BaseAdapter interface contract
│   │   ├── validation.ts         – 6-step validation pipeline
│   │   └── adapters/
│   │       ├── iphone.ts         – Apple iPhone (model/variant/storage)
│   │       ├── macbook.ts        – Apple MacBook (chip/RAM/SSD)
│   │       ├── gpu.ts            – NVIDIA / AMD / Intel GPUs
│   │       └── console.ts        – PS3/4/5, Xbox, Nintendo Switch
│   ├── market/
│   │   ├── market-scanner.ts     – IQR median, snapshots, dataConfidence
│   │   └── snapshot-store.ts     – in-memory + disk snapshot cache
│   ├── deal-detector.ts          – deal scoring, DealQuality grades
│   ├── scheduler.ts              – background monitor loop + webhook dispatch
│   ├── store.ts                  – JSON persistence for monitors + deals
│   ├── analyzer.ts               – GPT-4o listing analysis
│   ├── imei-checker.ts           – IMEI validation
│   ├── handlers.ts               – pure API handler functions
│   ├── server.ts                 – Node.js HTTP server
│   ├── dashboard.html            – single-file web UI
│   └── notifier.ts               – webhook notification sender
├── scripts/
│   ├── start.ts                  – server entry point
│   └── diagnose.ts               – diagnostic tool
├── data/                         – runtime data (gitignored)
│   ├── items.json                – saved monitors
│   ├── deals.json                – discovered deals
│   └── snapshots/                – market snapshot cache
├── .env.example
├── start.bat                     – Windows one-click launcher
└── tsconfig.json
```

---

## How deal scoring works

1. Scraper fetches listings for the monitor's search query
2. Each listing goes through the normalizer and gets a `configKey` (e.g. `apple_iphone_16_pro_256gb`)
3. Market scanner computes median price from all `market_eligible` listings for that configKey + condition
4. Discount = `(median - listingPrice) / median * 100`
5. Deal quality thresholds:

| Quality | Discount |
|---------|----------|
| Normal | < 10% |
| Good 🟡 | 10%+ |
| Very Good 🔥 | 20%+ |
| Extreme 🚨 | 35%+ |

6. If `monitorRules` are met, GPT-4o analyzes the description and a webhook notification is sent

---

## License

MIT
