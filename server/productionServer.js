/**
 * CRYPTORA — Production Static & Market Data Gateway Server
 *
 * Lightweight, zero-dependency Node.js production server for serving
 * the compiled Vite static assets (dist/) with SPA fallback, production
 * security headers, and minimal server-side market data proxy.
 *
 * Architecture:
 * Internet -> Nginx (80/443) -> Node.js production server (0.0.0.0:3000)
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleAiExplain } from './ai/explain.mjs';

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
const CACHE_TTL_MS = parseInt(process.env.MARKET_DATA_CACHE_TTL_MS || '10000', 10);

// In-memory cache for market-data proxy
const proxyCache = new Map();

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
  'https://api.binance.com',
  'https://fapi.binance.com',
  'https://api.kucoin.com',
  'wss://stream.binance.com:9443',
  'wss://fstream.binance.com', // фактические ликвидации Binance USD-M
  'wss://stream.bybit.com', // ликвидации Bybit V5
  'wss://ws.okx.com:8443', // ликвидации OKX
  'https://www.okx.com', // инструменты OKX (ctVal)
  'https://api.alternative.me', // Fear & Greed
  'https://api.llama.fi', // DeFiLlama TVL
  'https://mempool.space', // сеть Bitcoin
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

// Minimal server-side proxy forwarder
function proxyRequest(targetBaseUrl, targetPath, req, res) {
  const cacheKey = `${targetBaseUrl}${targetPath}`;
  const cached = proxyCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Cache': 'HIT',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(cached.body);
    return;
  }

  const targetUrl = new URL(targetPath, targetBaseUrl);
  const isHttps = targetUrl.protocol === 'https:';
  const transport = isHttps ? https : http;

  const proxyReq = transport.request(
    targetUrl,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CRYPTORA-Gateway/0.7.0',
      },
      timeout: 8000,
    },
    (proxyRes) => {
      let data = '';
      proxyRes.on('data', (chunk) => {
        data += chunk;
      });
      proxyRes.on('end', () => {
        if (proxyRes.statusCode && proxyRes.statusCode >= 200 && proxyRes.statusCode < 300) {
          proxyCache.set(cacheKey, { timestamp: now, body: data });
        }
        res.writeHead(proxyRes.statusCode || 200, {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Cache': 'MISS',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(data);
      });
    }
  );

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.writeHead(504, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        error: 'Gateway Timeout',
        message: `Exchange target ${targetBaseUrl} timed out after 8000ms`,
      })
    );
  });

  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        error: 'Bad Gateway',
        message: `Failed to reach exchange endpoint: ${err.message}`,
      })
    );
  });

  proxyReq.end();
}

const server = http.createServer((req, res) => {
  const startTime = Date.now();
  applySecurityHeaders(res);

  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

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

  // Endpoint: Binance Proxy Gateway
  if (pathname.startsWith('/api/proxy/binance')) {
    const targetPath = parsedUrl.searchParams.get('path');
    if (!targetPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing path query parameter' }));
      return;
    }
    proxyRequest('https://api.binance.com', targetPath, req, res);
    return;
  }

  // Endpoint: KuCoin Proxy Gateway
  if (pathname.startsWith('/api/proxy/kucoin')) {
    const targetPath = parsedUrl.searchParams.get('path');
    if (!targetPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing path query parameter' }));
      return;
    }
    proxyRequest('https://api.kucoin.com', targetPath, req, res);
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
  console.log(`  Public Exchange Proxy: /api/proxy/binance, /api/proxy/kucoin`);
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
