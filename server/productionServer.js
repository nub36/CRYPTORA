/**
 * CRYPTORA — Production Static Server
 *
 * Lightweight, zero-dependency Node.js production server for serving
 * the compiled Vite static assets (dist/) with SPA fallback and
 * production security headers.
 *
 * Architecture:
 * Internet -> Nginx (80/443) -> Node.js production server (0.0.0.0:3000)
 *
 * Arbitrary /api/proxy/* endpoints remain removed (SSRF risk). Public exchange
 * reads use the narrow allowlisted /api/market gateway below.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleAiExplain } from './ai/explain.mjs';
import { requestMarketData } from './services/marketDataGateway.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DIST_DIR = path.resolve(__dirname, '../dist');
// Версия — из package.json, чтобы /api/health не отставал от релиза.
const APP_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.webp': 'image/webp',
};

// Внешние источники, к которым обращается браузер (см. docs/DATA_SOURCES.md §1.1).
// Каждый новый адаптер/поток ОБЯЗАН быть добавлен сюда, иначе CSP молча заблокирует его в production.
// Список проверяется тестом tests/unit/cspConnectSrc.test.ts против URL в src/.
const CONNECT_SRC = [
  "'self'",
  'wss://stream.binance.com:9443',
  'wss://fstream.binance.com', // фактические ликвидации Binance USD-M
  'wss://stream.bybit.com', // ликвидации Bybit V5
  'wss://ws.okx.com:8443', // ликвидации OKX
  'https://www.okx.com', // инструменты OKX (ctVal)
  'https://api.alternative.me', // Fear & Greed
  'https://api.llama.fi', // DeFiLlama TVL
  'https://mempool.space', // сеть Bitcoin
  'https://api.coingecko.com', // CoinGecko: глобальный market cap, ATH/ATL metadata
  'https://api.telegram.org', // доставка алертов Telegram Bot (по настройке пользователя)
];
const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; " +
  `connect-src ${CONNECT_SRC.join(' ')}; frame-ancestors 'self';`;

// Standard production security headers
function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
}

// P0: proxy routes removed (dead code, SSRF risk, unbounded cache).
// Frontend connects to exchanges directly from the browser (CSP allows it).

const server = http.createServer(async (req, res) => {
  const startTime = Date.now();
  applySecurityHeaders(res);

  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // Narrow same-origin exchange gateway; requestMarketData accepts only a fixed
  // provider/endpoint allowlist and never derives an upstream host from user input.
  if (pathname === '/api/market' || pathname.startsWith('/api/market/')) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    const result = await requestMarketData(pathname.slice('/api/market'.length), parsedUrl.searchParams);
    res.setHeader('Cache-Control', result.cacheSeconds ? `public, max-age=${result.cacheSeconds}` : 'no-store');
    res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result.body));
    return;
  }

  // Endpoint: Health check
  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        status: 'ok',
        app: 'CRYPTORA Market Intelligence Terminal',
        version: APP_VERSION,
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      })
    );
    console.log(`[${new Date().toISOString()}] GET /api/health 200 ${Date.now() - startTime}ms`);
    return;
  }

  // Endpoint: LLM-объяснение поверх фактов (Этап 7). Ключ только в env сервера.
  if (pathname === '/api/ai/explain') {
    handleAiExplain(req, res);
    return;
  }

  // Static File Serving
  let relativeFilePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let resolvedFilePath = path.join(DIST_DIR, relativeFilePath);

  // Security: Prevent directory traversal
  if (!resolvedFilePath.startsWith(DIST_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  // Check if file exists; if not, fallback to index.html for SPA routing
  let stat;
  try {
    stat = fs.statSync(resolvedFilePath);
    if (stat.isDirectory()) {
      resolvedFilePath = path.join(resolvedFilePath, 'index.html');
      stat = fs.statSync(resolvedFilePath);
    }
  } catch {
    // SPA Fallback: non-asset routes fallback to dist/index.html
    resolvedFilePath = path.join(DIST_DIR, 'index.html');
    try {
      stat = fs.statSync(resolvedFilePath);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Build output missing. Please run npm run build first.');
      return;
    }
  }

  const ext = path.extname(resolvedFilePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  // Cache-Control headers
  if (pathname.startsWith('/assets/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }

  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
  });

  const readStream = fs.createReadStream(resolvedFilePath);
  readStream.pipe(res);

  readStream.on('error', (err) => {
    console.error(`Stream error for ${resolvedFilePath}:`, err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
    }
  });

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] ${req.method} ${pathname} ${res.statusCode} ${duration}ms`);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`=======================================================`);
  console.log(`  CRYPTORA Production Server Started`);
  console.log(`  Listening on: http://${HOST}:${PORT}`);
  console.log(`  Serving static: ${DIST_DIR}`);
  console.log(`  SPA Fallback: enabled -> /index.html`);
  console.log(`  Security Headers: active`);
  console.log(`=======================================================`);
});

// Graceful termination
const shutdown = (signal) => {
  console.log(`\nReceived ${signal}. Gracefully shutting down CRYPTORA production server...`);
  server.close(() => {
    console.log('HTTP server closed. Exiting process.');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Forceful shutdown after timeout.');
    process.exit(1);
  }, 5000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
