# docs/AI.md — AI Integration Architecture (v0.8.42)

## 1. Overview

CRYPTORA AI is a **secondary analytical layer** that explains structured market data.
It does NOT trade, execute orders, manage positions, or access private keys.

**Data flow:**
```
Market Data (Binance/KuCoin)
→ Deterministic Analytics (IndicatorEngine, DerivativesEngine, Radar)
→ StructuredFacts (typed, origin-tagged)
→ POST /api/ai/explain (server-side gateway)
→ OpenAI API (system prompt + facts)
→ Structured AiExplanation (JSON)
→ groundingGuard (number verification + forbidden phrase check)
→ User sees explanation
```

## 2. Key Invariants

1. **CRYPTORA does NOT trade.** AI never executes BUY/SELL/orders.
2. **Server-side only.** `OPENAI_API_KEY` never reaches browser/Vite/localStorage.
3. **User-initiated only.** AI is called by explicit button click, not on every tick.
4. **Grounding guard.** Every number in LLM output must exist in input facts.
5. **No trading commands.** Forbidden phrases: buy, sell, long, short, stop loss, take profit, price target.
6. **Failure = honest error.** Terminal continues working when AI fails.

## 3. StructuredFacts Contract

Each fact group has an `origin` tag:

| Origin | Meaning | Example |
|---|---|---|
| `FACTUAL` | Direct value from REST/WS API | price, funding rate |
| `DERIVED` | Computed deterministically | RSI, MACD, SMA |
| `MODEL_ESTIMATED` | Heuristic/model estimate | liquidation zones |
| `UNAVAILABLE` | Source did not respond | MVRV, NUPL |

Groups: `spot`, `derivatives`, `liquidations`, `indicators`, `radar`, `models`.

File: `src/services/ai/StructuredFacts.ts`

## 4. Output Contract

LLM returns structured JSON validated at runtime:

```json
{
  "summary": "1-2 sentences",
  "keyObservations": ["..."],
  "supportingFacts": ["..."],
  "counterEvidence": ["..."],
  "dataLimitations": ["..."],
  "riskNotes": ["..."]
}
```

All string arrays, max 20 items each. No trading recommendations.

File: `src/services/ai/AiOutputContract.ts`

## 5. Server Gateway

| Property | Value |
|---|---|
| Endpoint | `POST /api/ai/explain` |
| Port | `AI_GATEWAY_PORT` (default: 3100, NOT 3000) |
| SDK | `openai` npm package (v7.17+) |
| Model | `OPENAI_MODEL` (default: `gpt-4o-mini`) |
| Key | `OPENAI_API_KEY` (or legacy `AI_API_KEY`) |
| Response format | `json_object` (structured) |
| Temperature | 0.15 |
| Max output tokens | `AI_MAX_OUTPUT_TOKENS` (default: 800) |
| Request timeout | `AI_REQUEST_TIMEOUT_MS` (default: 30000ms) |
| Body size limit | `AI_MAX_BODY_BYTES` (default: 16384) |
| Rate limit | `AI_RATE_LIMIT_PER_MIN` (default: 10 per IP) |
| Concurrency | `AI_MAX_CONCURRENCY` (default: 3) |
| Cache | LRU by facts digest, `AI_CACHE_MAX_ENTRIES` (default: 100) |

If `OPENAI_API_KEY` is absent: endpoint returns `503 { status: 'NOT_CONFIGURED' }`.
Main CRYPTORA continues fully operational.

File: `server/ai/explain.mjs`

## 6. Security

- `OPENAI_API_KEY` never sent to browser (server env only)
- No user-controlled system prompt
- No stack traces in responses
- JSON-only, POST-only
- Body size limit (16KB)
- Per-IP rate limiting
- Concurrency limit
- No secret logging
- Input whitelist (only known StructuredFacts fields pass)

## 7. UI Integration

First integration point: **Coin Detail** page (`/coin/:symbol`).

- Button: «AI-разбор актива» (explicit user action)
- Panel shows structured explanation with sections
- Each section has colored bullets
- Meta line: model name, timestamp
- Disclaimer: «Не является инвестиционной рекомендацией»
- Error states: not configured, unavailable, timeout, rate limited, rejected

File: `src/components/ai/AiExplanationPanel.tsx`

## 8. ENV Variables

```
OPENAI_API_KEY=          # Required for LLM
OPENAI_MODEL=            # Default: gpt-4o-mini
AI_GATEWAY_PORT=3100     # NOT 3000
AI_REQUEST_TIMEOUT_MS=   # Default: 30000
AI_MAX_OUTPUT_TOKENS=    # Default: 800
AI_RATE_LIMIT_PER_MIN=   # Default: 10
AI_MAX_CONCURRENCY=      # Default: 3
AI_MAX_BODY_BYTES=       # Default: 16384
AI_CACHE_MAX_ENTRIES=    # Default: 100
```

## 9. Testing

- No real OpenAI API calls in tests
- Dependency injection: `explainWithLlm(facts, cfg, mockClient)`
- `sanitizeStructuredFacts` — input validation
- `validateAiExplanation` — output validation
- `checkGrounding` — number verification
- `RateLimiter`, `DigestCache`, `ConcurrencyLimiter` — isolated unit tests
- `buildCoinDetailFacts` — fact construction from UI data
- `marketContextFactToStructured` — legacy adapter
- `LlmExplainClient` — status mapping (503→NOT_CONFIGURED, 422→REJECTED, etc.)

## 10. Nginx Recommendation

```nginx
location /api/ai/ {
    proxy_pass http://localhost:3100;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 35s;
    client_max_body_size 16k;
}
```

## 11. Files

| File | Purpose |
|---|---|
| `server/ai/explain.mjs` | Gateway: config, validation, OpenAI SDK, rate limit, cache, HTTP handler |
| `server/ai/groundingGuard.mjs` | Number extraction + forbidden phrase check |
| `src/services/ai/StructuredFacts.ts` | Typed input contract |
| `src/services/ai/AiOutputContract.ts` | Typed output contract + validation |
| `src/services/ai/AiExplanationEngine.ts` | Deterministic local engine (no LLM) |
| `src/services/ai/LlmExplainClient.ts` | Browser client, fact builder, legacy adapter |
| `src/components/ai/AiExplanationPanel.tsx` | Coin Detail UI panel |
| `tests/unit/aiExplainServer.test.ts` | Server + client tests (33 tests) |
| `tests/unit/aiExplanation.test.ts` | Deterministic engine tests |
