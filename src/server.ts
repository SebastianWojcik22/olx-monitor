import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleGetItems,
  handleCreateItem,
  handleUpdateItem,
  handleDeleteItem,
  handleCheckNow,
  handleGetDeals,
  handleUpdateDeal,
  handleDeleteDeal,
  handleReanalyzeDeal,
  handleHealth,
  handlePriceAnalysis,
  handleMarketScan,
  handleGetPriceStats,
  handleBrowseItem,
  handleImeiList,
  handleImeiCreate,
  handleImeiVerify,
  handleImeiDelete,
  handleFetchListing,
} from './handlers.js';
import type { HandlerResult } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_PATH = path.join(__dirname, 'dashboard.html');

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString();
      if (data.length > 1_048_576) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, result: HandlerResult): void {
  res.writeHead(result.status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(result.body));
}

function sendHtml(res: http.ServerResponse, filePath: string): void {
  try {
    const html = fs.readFileSync(filePath, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch {
    res.writeHead(500);
    res.end('Dashboard not found');
  }
}

export function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', `http://localhost`);
    const p = url.pathname;

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*' });
      res.end();
      return;
    }

    // Dashboard
    if (method === 'GET' && p === '/') {
      sendHtml(res, DASHBOARD_PATH);
      return;
    }

    // Health
    if (method === 'GET' && p === '/health') {
      send(res, handleHealth());
      return;
    }

    // Market scan
    if (method === 'GET' && p === '/api/market-scan') {
      const query = url.searchParams.get('query') ?? '';
      const condition = url.searchParams.get('condition') ?? 'all';
      const minPrice = Number(url.searchParams.get('minPrice') ?? 0);
      send(res, await handleMarketScan(query, condition, minPrice));
      return;
    }

    // Price stats cache lookup (for edit form)
    if (method === 'GET' && p === '/api/price-stats') {
      const configKey = url.searchParams.get('configKey') ?? '';
      const condition = url.searchParams.get('condition') ?? 'all';
      send(res, handleGetPriceStats(configKey, condition));
      return;
    }

    // Browse item (live OLX scan for budget view)
    const browseMatch = p.match(/^\/api\/items\/([^/]+)\/browse$/);
    if (browseMatch && method === 'GET') {
      send(res, await handleBrowseItem(browseMatch[1]!));
      return;
    }

    // Price analysis
    if (method === 'GET' && p === '/api/price-analysis') {
      const query = url.searchParams.get('query') ?? '';
      const condition = url.searchParams.get('condition') ?? 'all';
      const minPrice = Number(url.searchParams.get('minPrice') ?? 0);
      const keywords = url.searchParams.get('keywords') ?? '';
      send(res, await handlePriceAnalysis(query, condition, minPrice, keywords));
      return;
    }

    // ── Items ────────────────────────────────────────────────────────────────

    if (method === 'GET' && p === '/api/items') {
      send(res, handleGetItems());
      return;
    }

    if (method === 'POST' && p === '/api/items') {
      try {
        const body = await readBody(req);
        send(res, handleCreateItem(body));
      } catch (e) {
        send(res, { status: 400, body: { ok: false, error: String(e) } });
      }
      return;
    }

    const itemMatch = p.match(/^\/api\/items\/([^/]+)$/);
    if (itemMatch) {
      const id = itemMatch[1]!;
      if (method === 'PUT') {
        try {
          const body = await readBody(req);
          send(res, handleUpdateItem(id, body));
        } catch (e) {
          send(res, { status: 400, body: { ok: false, error: String(e) } });
        }
        return;
      }
      if (method === 'DELETE') {
        send(res, handleDeleteItem(id));
        return;
      }
    }

    const checkMatch = p.match(/^\/api\/check\/([^/]+)$/);
    if (checkMatch && method === 'POST') {
      send(res, await handleCheckNow(checkMatch[1]!));
      return;
    }

    // ── Deals ────────────────────────────────────────────────────────────────

    if (method === 'GET' && p === '/api/deals') {
      send(res, handleGetDeals());
      return;
    }

    const dealMatch = p.match(/^\/api\/deals\/([^/]+)$/);
    if (dealMatch) {
      const id = dealMatch[1]!;
      if (method === 'PUT') {
        try {
          const body = await readBody(req);
          send(res, handleUpdateDeal(id, body));
        } catch (e) {
          send(res, { status: 400, body: { ok: false, error: String(e) } });
        }
        return;
      }
      if (method === 'DELETE') {
        send(res, handleDeleteDeal(id));
        return;
      }
    }

    const analyzeMatch = p.match(/^\/api\/deals\/([^/]+)\/analyze$/);
    if (analyzeMatch && method === 'POST') {
      send(res, await handleReanalyzeDeal(analyzeMatch[1]!));
      return;
    }

    // ── IMEI / Serial verification ──────────────────────────────────────────

    if (method === 'GET' && p === '/api/imei/fetch-listing') {
      const listingUrl = url.searchParams.get('url') ?? '';
      if (!listingUrl) {
        send(res, { status: 400, body: { ok: false, error: 'Brak parametru url' } });
      } else {
        send(res, await handleFetchListing(listingUrl));
      }
      return;
    }

    if (method === 'GET' && p === '/api/imei') {
      send(res, handleImeiList());
      return;
    }

    if (method === 'POST' && p === '/api/imei') {
      try {
        const body = await readBody(req);
        send(res, await handleImeiCreate(body));
      } catch (e) {
        send(res, { status: 400, body: { ok: false, error: String(e) } });
      }
      return;
    }

    const imeiVerifyMatch = p.match(/^\/api\/imei\/([^/]+)\/verify$/);
    if (imeiVerifyMatch && method === 'POST') {
      send(res, await handleImeiVerify(imeiVerifyMatch[1]!));
      return;
    }

    const imeiDeleteMatch = p.match(/^\/api\/imei\/([^/]+)$/);
    if (imeiDeleteMatch && method === 'DELETE') {
      send(res, handleImeiDelete(imeiDeleteMatch[1]!));
      return;
    }

    // 404
    send(res, { status: 404, body: { ok: false, error: 'Not found' } });
  });
}

export function startServer(port: number): void {
  const server = createServer();
  server.listen(port, () => {
    console.log(`[server] OLX Monitor running at http://localhost:${port}`);
  });
}
