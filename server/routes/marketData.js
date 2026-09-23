import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requestMarketData } from '../services/marketDataGateway.js';

const router = Router();

// Exchange APIs are public but can be polled by the client-side signal scanner.
// Keep a dedicated, bounded per-IP budget separate from auth/user APIs.
export const marketDataLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Market-data request budget exceeded; retry shortly.' },
});

router.use(async (req, res) => {
  if (req.method !== 'GET') {
    res.set('Allow', 'GET').status(405).json({ error: 'Method not allowed' });
    return;
  }

  const prefix = '/api/market';
  const routePath = req.path.startsWith(prefix) ? req.path.slice(prefix.length) : req.path;
  const result = await requestMarketData(routePath, new URLSearchParams(req.originalUrl.split('?')[1] ?? ''));
  res.set('Cache-Control', result.cacheSeconds ? `public, max-age=${result.cacheSeconds}` : 'no-store');
  res.status(result.status).json(result.body);
});

export default router;
