/**
 * POST /api/ai/explain — LLM-объяснение поверх структурированных фактов (Этап 7, docs/AI.md).
 * Ключ провайдера только на сервере (env). Без ключа — 503 {configured:false}; клиент остаётся на детерминированном движке.
 * Ответ LLM проходит groundingGuard; при провале — 422, текст не отдаётся.
 */
import https from 'node:https';
import http from 'node:http';
import { checkGrounding } from './groundingGuard.mjs';

export const SYSTEM_PROMPT = [
  'Ты — объясняющий слой аналитического терминала CRYPTORA. Терминал НЕ исполняет сделки.',
  'Тебе передан JSON с фактами, рассчитанными детерминированным движком. Твоя задача — объяснить взаимосвязь этих метрик простым русским языком.',
  'СТРОГО ЗАПРЕЩЕНО: называть любые числа, которых нет в JSON фактов; прогнозировать цену; обещать доходность; давать торговые рекомендации (покупать/продавать/открывать/закрывать позиции); упоминать цели по цене, стоп-лоссы, тейк-профиты.',
  'Если факт помечен source=ESTIMATED — прямо скажи, что это оценка, а не фактический ряд.',
  'Формат: 3–5 предложений сплошным текстом, без списков, без заголовков, без markdown. Не добавляй дисклеймер — его добавит терминал.',
].join(' ');

export function readAiConfig(env = process.env) {
  const apiKey = env.AI_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.AI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: env.AI_MODEL?.trim() || 'gpt-4o-mini',
    timeoutMs: Number(env.AI_TIMEOUT_MS) || 20000,
  };
}

function postJson(url, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const transport = u.protocol === 'https:' ? https : http;
    const data = JSON.stringify(body);
    const req = transport.request(
      u,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers }, timeout: timeoutMs },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`upstream HTTP ${res.statusCode}`));
          try {
            resolve(JSON.parse(buf));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('upstream timeout')));
    req.on('error', reject);
    req.end(data);
  });
}

/** Валидация входа: только whitelisted поля фактов, никаких свободных строк от клиента. */
export function sanitizeFacts(input) {
  if (!input || typeof input !== 'object') return null;
  const f = {};
  if (typeof input.symbol === 'string' && /^[A-Z0-9]{2,12}$/.test(input.symbol)) f.symbol = input.symbol;
  else return null;
  for (const k of ['price', 'change24h', 'fundingRate8h', 'openInterestDelta24h', 'rsi14']) {
    if (typeof input[k] === 'number' && Number.isFinite(input[k])) f[k] = input[k];
  }
  if (input.openInterestDeltaSource === 'ACTUAL' || input.openInterestDeltaSource === 'ESTIMATED') f.openInterestDeltaSource = input.openInterestDeltaSource;
  if (Array.isArray(input.anomalies)) {
    f.anomalies = input.anomalies
      .slice(0, 10)
      .filter((a) => a && typeof a.type === 'string' && /^[A-Z_]{3,40}$/.test(a.type))
      .map((a) => ({ type: a.type, metricValue: typeof a.metricValue === 'string' ? a.metricValue.slice(0, 40) : undefined }));
  }
  if (typeof f.price !== 'number' || typeof f.change24h !== 'number') return null;
  return f;
}

/**
 * @param {object} facts — уже sanitized
 * @param {ReturnType<typeof readAiConfig>} cfg
 * @param {(url, headers, body, timeoutMs) => Promise<any>} post — инъекция для тестов
 */
export async function explainWithLlm(facts, cfg, post = postJson) {
  const body = {
    model: cfg.model,
    temperature: 0.2,
    max_tokens: 400,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Факты (JSON): ${JSON.stringify(facts)}` },
    ],
  };
  const json = await post(`${cfg.baseUrl}/chat/completions`, { Authorization: `Bearer ${cfg.apiKey}` }, body, cfg.timeoutMs);
  const text = json?.choices?.[0]?.message?.content;
  const guard = checkGrounding(typeof text === 'string' ? text.trim() : '', facts);
  if (!guard.ok) return { ok: false, reason: guard.reason };
  return { ok: true, text: text.trim(), model: cfg.model };
}

/** HTTP-обработчик для productionServer. */
export function handleAiExplain(req, res, env = process.env) {
  const cfg = readAiConfig(env);
  const send = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  if (req.method !== 'POST') return send(405, { error: 'Method Not Allowed' });
  if (!cfg) return send(503, { configured: false, error: 'LLM не настроен на сервере (AI_API_KEY отсутствует)' });
  let raw = '';
  req.on('data', (c) => {
    raw += c;
    if (raw.length > 16_384) req.destroy();
  });
  req.on('end', async () => {
    let facts;
    try {
      facts = sanitizeFacts(JSON.parse(raw));
    } catch {
      facts = null;
    }
    if (!facts) return send(400, { error: 'Некорректные факты' });
    try {
      const r = await explainWithLlm(facts, cfg);
      if (!r.ok) return send(422, { configured: true, grounded: false, reason: r.reason });
      return send(200, { configured: true, grounded: true, text: r.text, model: r.model, generatedAt: new Date().toISOString() });
    } catch (e) {
      return send(502, { configured: true, error: `LLM недоступен: ${e instanceof Error ? e.message : String(e)}` });
    }
  });
}
