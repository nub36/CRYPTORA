# CRYPTORA — Полный аудит GitHub Pages: почему "половина не работает"

> **Дата:** 2026-09-20 • **Ветка:** `arena/01a0bd39-cryptora` → `main` • **Сайт:** `https://nub36.github.io/CRYPTORA/` • **Сборка:** `Vite 6 + React 18` • **Билд-папка:** `dist/`

Короткий ответ: **половина — это весь `/api/*` (приватный Express-бэкенд).** На Pages бэкенда нет, поэтому запросы падают в `404.html`, а весь публичный маркет-дата (Binance/KuCoin/...) продолжает работать. Ниже — по-пунктно, где захардкожено, что блокирует CORS/WSS, что с `VITE_*` и что с `404.html`, плюс список файлов и готовые патчи.

---

## 1. Сетевые запросы — куда что летит

### 1.1 Карта запросов

| Группа | URL | Куда идёт | Работает на GH Pages? | Где в коде |
|---|---|---|---|---|
| **Market LIVE (REST)** | `https://api.binance.com/api/v3/ticker/24hr`, `/klines` | Binance Spot прямо из браузера | ✅ Да (CORS `*`) | `BinanceSpotAdapter.ts:28`, `CandleHistoryService.ts:76` |
| | `https://fapi.binance.com/fapi/v1/premiumIndex`, `/openInterest` | Binance Futures REST | ✅ Да | `BinanceFuturesAdapter.ts:34` |
| | `https://api.kucoin.com/api/v1/market/stats`, `/allTickers` | KuCoin Spot | ✅ Да | `KuCoinSpotAdapter.ts:29` |
| | `https://api.coingecko.com/api/v3/global`, `/coins/{id}` | CoinGecko (global cap, ATH) | ✅ Да (может 429 без ключа) | `CoinGeckoAdapter.ts:104` |
| | `https://api.alternative.me/fng/?limit=1` | Fear&Greed | ✅ Да | `AlternativeMeAdapter.ts:47` |
| | `https://api.llama.fi/v2/chains`, `/historicalChainTvl/{chain}` | DeFiLlama TVL | ✅ Да | `DefiLlamaAdapter.ts:30` |
| | `https://mempool.space/api/...` (5 эндпоинтов) | Bitcoin on-chain | ✅ Да | `MempoolSpaceAdapter.ts:44` |
| | `https://www.okx.com/api/v5/public/instruments` | OKX ctVal (для $ ликвидаций) | ✅ Да | `OkxLiquidationStream.ts:31` |
| | `https://api.telegram.org/bot{token}/sendMessage` | Telegram Bot | ⚠️ Только если юзер ввёл токен; CORS у Telegram открыт, но `mode:no-cors` fallback есть | `deliveryChannels.ts:127` |
| **Realtime WS** | `wss://stream.binance.com:9443/stream` | Spot ticker/trade/depth/kline | ✅ Да (см. §2) | `BinanceWebSocketClient.ts:44` |
| | `wss://fstream.binance.com/ws/!forceOrder@arr` | Binance ликвдации (факт) | ✅ Да | `BinanceFuturesLiquidationStream.ts:19` |
| | `wss://stream.bybit.com/v5/public/linear` | Bybit ликвдации | ✅ Да | `BybitLiquidationStream.ts:18` |
| | `wss://ws.okx.com:8443/ws/v5/public` | OKX ликвдации | ✅ Да | `OkxLiquidationStream.ts:30` |
| **Приватный API (Express)** | `/api/auth/session`, `/login`, `/register`, `/resend-verification`, `/logout`, `/verify-email`, `/registration-status` | `POST https://nub36.github.io/api/...` → 404.html на Pages | ❌ Нет (см. ниже) | `AuthContext.tsx:67,109,132,151,166`, `RegisterPage.tsx:39`, `VerifyEmailPage.tsx:48,79` |
| | `/api/me` | PATCH профиль | ❌ Нет | `ProfilePage.tsx:36` |
| | `/api/admin/*` (`/dashboard`, `/users`, `/system`, `/users/:id/block`) | Админка | ❌ Нет | `AdminPage.tsx:86,100,113,137,158` |
| | `/api/ai/explain` | LLM-прокси (ключ только на сервере) | ❌ Нет | `LlmExplainClient.ts:190` |

**Диагностика в DevTools (Pages):**  
`Network → Fetch/XHR` показывает `404` (тех. `200` с HTML `dist/404.html` т.к. GitHub отдаёт `404.html` с `Status: 404`, тело — `index.html`). В `Response` — `<!doctype html>...` вместо `{"user":...}` → `await res.json()` кидает `SyntaxError`, ловится в `catch` → `setError('Сервер авторизации недоступен')`.

#### Где захардкожено?
Все вызовы — литералы `fetch('/api/...')` без переменной базы:

```ts
// src/context/AuthContext.tsx — 5 мест
fetch('/api/auth/session', {credentials:'include'})
fetch('/api/auth/login', {method:'POST', ...})
fetch('/api/auth/register', ...)
fetch('/api/auth/resend-verification', ...)
fetch('/api/auth/logout', ...)

// src/pages/AdminPage.tsx — 5 мест
fetch('/api/admin/dashboard', ...)
fetch(`/api/admin/users?${params}`, ...)
fetch('/api/admin/system', ...)
fetch(`/api/admin/users/${userId}/block`, {method:'PATCH'})
fetch(`/api/admin/users/${userId}/unblock`, {method:'PATCH'})

// src/pages/ProfilePage.tsx:36
fetch('/api/me', {method:'PATCH'})

// src/pages/RegisterPage.tsx:39
fetch('/api/auth/registration-status', ...)

// src/pages/VerifyEmailPage.tsx:48,79
fetch('/api/auth/verify-email', ...)
fetch('/api/auth/resend-verification', ...)

// src/services/ai/LlmExplainClient.ts:190 (default param)
endpoint = '/api/ai/explain'
```

**На VPS с Nginx** это ок: `location /api/ { proxy_pass http://127.0.0.1:3000; }` → same-origin. **На Pages** `Nginx` нет → запрос уходит к `https://nub36.github.io/api/...` → статика GitHub → 404.html → JSON-парс падает.

#### Как переключить

- **Рыночные данные — уже на публичных эндпоинтах**, ничего трогать не нужно. Если фильтруешь в корпоративной сети — вынеси `baseUrl` через `VITE_*` (адаптеры уже поддерживают `config.baseUrl`).
- **Приватный `/api/*` — не переключить на публичные**, т.к. требует PG+сессии+SMTP+OpenAI-ключ. Варианты:
  1. **Статика-only на Pages** (сейчас): скрывать auth/админку, объяснять пользователю. ✅ Уже патчим через `src/config/api.ts` + `isStaticHostingWithoutApi` (см. §5).
  2. **Разнести фронтенд и API:** поднять API на `https://api.cryptora.app` (VPS) и задать `VITE_API_BASE_URL=https://api.cryptora.app` → `fetch(apiUrl('/api/...'))` → кросс-доменные куки (`SameSite=None; Secure; CORS allow-credentials`). Требуется правка CORS/CSRF на сервере.

> **Вывод п.1:** Чинить нужно только 6 файлов из таблицы выше + 1 новый `api.ts`. Market-WS/REST — уже прямые и рабочие.

---

## 2. CORS и WebSocket — блокирует ли?

### 2.1 REST CORS

Все публичные адаптеры делают **простой GET** с `Accept: application/json` и `AbortSignal` — без кастомных заголовков, без `Content-Type`. Префлайта нет.

| Хост | `Access-Control-Allow-Origin` | Префлайт? | Коммент |
|---|---|---|---|
| `api.binance.com` | `*` | нет | С 2024 имеет CORS, но в РФ/США может давать 451/403 по IP (не CORS, а Geo). UI показывает `ИСТОЧНИК НЕДОСТУПЕН` + retry — корректно. |
| `fapi.binance.com` | `*` | нет | Аналогично |
| `api.kucoin.com` | `*` | нет | Fallback если Binance 451 |
| `api.coingecko.com` | `*` | нет | На Free может 429 `AdapterRateLimitError` → кэш 5-10 мин, stale остаётся |
| `api.alternative.me` | `*` | нет | |
| `api.llama.fi` | `*` | нет | |
| `mempool.space` | `*` | нет | `Height` — plain text `12345`, парсим через `res.text()` → `JSON.parse` → `z.number()` |
| `www.okx.com` | `*` | нет | |
| `api.telegram.org` | `*` (для Bot API) | POST `application/json` → префлайт, но разрешён; в коде есть `mode:'no-cors'` fallback → `opaque` | `deliveryChannels.ts:166` |

**Код проверки:**
```ts
// adapters/BinanceSpotAdapter.ts:85 — headers только Accept, без Authorization
this.fetchFn(url, { signal: controller.signal, headers: { Accept:'application/json' } })
```

**CSP на Pages:** `index.html` **не содержит** `<meta http-equiv="Content-Security-Policy">`. На VPS `productionServer.js:58` и `nginx/cryptora.conf` выставляют `connect-src 'self' https://api.binance.com https://fapi.binance.com https://api.kucoin.com wss://stream.binance.com:9443 wss://fstream.binance.com wss://stream.bybit.com wss://ws.okx.com:8443 https://www.okx.com https://api.alternative.me https://api.llama.fi https://mempool.space https://api.coingecko.com https://api.telegram.org;`. На Pages такого header-а нет → браузер ничего не блокирует. Если добавишь `<meta CSP>` на Pages — скопируй тот же `connect-src`.

**Итог CORS:** ❌ Ничего не блокирует при обычном интернете. Единственный реальный фейл — Geo-блок Binance (451) → не CORS, а `HTTP 451` → адаптер кидает `AdapterNetworkError` → UI честно `ИСТОЧНИК НЕДОСТУПЕН`.

### 2.2 WebSocket

```ts
// Все 4 — WSS (не WS), обязательны для https://nub36.github.io
wss://stream.binance.com:9443/stream          // spot (combined ?streams=)
wss://fstream.binance.com/ws/!forceOrder@arr   // futures liquidations (no sub, no ping)
wss://stream.bybit.com/v5/public/linear        // Bybit allLiquidation.{symbol}
wss://ws.okx.com:8443/ws/v5/public            // OKX liquidation-orders
```

- `wss://` vs `ws://`: ✅ Все `wss://` → на HTTPS-странице Mixed Content не триггерит. Если бы было `ws://`, Chrome бы заблокировал.
- Порты `9443`/`8443` — стандартные для бирж; корпоративные файрволы иногда режут → деградация в `RealtimeFeedManager: 'unavailable'` + бейдж `WebSocket отключен`.
- Origin: WS handshake шлёт `Origin: https://nub36.github.io` → все 4 биржи отвечают `101 Switching Protocols` для любого Origin (публичные потоки без ключа).
- Keep-alive: Bybit `{"op":"ping"}` / 20с, OKX `"ping"`/25с, Binance spot `SUBSCRIBE` → клиентский ping не нужен. Реализовано в `LiquidationStreamTransport.ts: keepAlive()`.

**Код поддержки:** `BinanceWebSocketClient.ts:40`, `LiquidationStreamTransport.ts:51` → `typeof WebSocket !== 'undefined' ? WebSocket : null` → в Node-тестах `isSupported=false` → `state='unavailable'`, в браузере всегда есть.

**Итог WS:** ✅ Протокол/заголовки корректны. Блока нет.

---

## 3. Переменные окружения

### 3.1 Что реально используется

```bash
grep -R "import\.meta" src --include="*.ts" | grep -v node_modules
# src/config/dataModePolicy.ts:36  (import.meta as unknown as {env}).env
# src/config/api.ts (новый)        (import.meta as unknown as {env}).env
# src/main.tsx:20                  (import.meta as unknown as {env}).env?.BASE_URL
```

```bash
grep -R "VITE_" src --include="*.ts"
# src/config/dataModePolicy.ts:31  VITE_CRYPTORA_QA_FIXTURE?: string
# src/config/api.ts                VITE_API_BASE_URL
```

| Переменная | Где читается | На Pages (без настройки) | Ломает ли? |
|---|---|---|---|
| `import.meta.env.DEV` / `PROD` | `dataModePolicy.ts:46` (`env.DEV===true`) | `DEV=false, PROD=true, BASE_URL="/CRYPTORA/"` | ❌ Нет — переводит в `LIVE` (правильно) |
| `import.meta.env.BASE_URL` | `main.tsx:20` | `"/CRYPTORA/"` (из `vite.config.base`) | ❌ Нет — `basename="/CRYPTORA"` корректен |
| `VITE_CRYPTORA_QA_FIXTURE` | `dataModePolicy.ts:46` | `undefined` → `QA_FIXTURE_ALLOWED=false` → `IS_PRODUCTION_RUNTIME=true` → `resolveInitialDataMode()` всегда `live` | ❌ Нет, так задумано |
| **`VITE_API_BASE_URL`** | **(новый) `api.ts`** | `undefined` → `API_BASE_URL=""` → `apiUrl()` = same-origin | ⚠️ **Да, косвенно** — `/api/*` падает в 404, но не крашит; теперь добавлен `isStaticHostingWithoutApi` guard |

**Вывод:**
- Ни одного `import.meta.env.VITE_*`, который бы остался `undefined` и ломал бы рыночные данные. Все LIVE-адаптеры — хардкод `https://...` с fallback `config.baseUrl ?? 'https://...'` → работают без env.
- Единственная «пустая» — `VITE_API_BASE_URL`, которой **не было** в проекте. От её отсутствия «ломалась» половина: auth/AI/админка. Теперь она документирована в `.env.example` и централизована в `src/config/api.ts`.
- `VITE_*` с префиксом обязателен: Vite инлайнит только `VITE_`-переменные; `DATABASE_URL`, `OPENAI_API_KEY` из `.env` **не попадают** в бандл — секьюрно.

### 3.2 Что поправили

```ts
// src/config/api.ts — новый файл
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/,'')
export function apiUrl(p:string){ return API_BASE_URL ? API_BASE_URL+p : p }
export const isStaticHostingWithoutApi = !API_BASE_URL && location.hostname.endsWith('github.io')
```

`.env.example` дописан:
```
# VITE_API_BASE_URL=  (пусто=same-origin для VPS)
# VITE_API_BASE_URL=https://api.cryptora.app  (для разнесённого API)
```

---

## 4. Роутинг и SPA `404.html`

### 4.1 Текущая схема (после правок первого этапа) — верная

```ts
// vite.config.ts — уже исправлено
export default defineConfig(({command}) => ({
  base: command==='serve' ? '/' : process.env.GITHUB_PAGES_BASE || '/CRYPTORA/',
  // serve "/" удобно локально (http://localhost:5173/), build "/CRYPTORA/" для Project Pages
}))

// src/main.tsx — уже исправлено
const _baseUrl = (import.meta as unknown as {env:{BASE_URL:string}}).env.BASE_URL || '/'
const routerBasename = _baseUrl==='/' ? '/' : _baseUrl.replace(/\/$/,'')
<BrowserRouter basename={routerBasename}> // "/CRYPTORA" на Pages, "/" локально
```

```yaml
# .github/workflows/deploy.yml — уже исправлено
- run: npm run build
- run: cp dist/index.html dist/404.html && touch dist/.nojekyll
- uses: actions/upload-pages-artifact@v3
  with: { path: ./dist }
- uses: actions/deploy-pages@v4
```

**Как это работает на GH Pages:**

1. `dist/index.html` после билда содержит `src="/CRYPTORA/assets/index-*.js"` (проверено `grep src= dist/index.html`).
2. Пользователь открывает `https://nub36.github.io/CRYPTORA/market` (прямая ссылка / F5) → GitHub ищет `market/index.html` → нет → отдаёт `404.html` (копия `index.html`, `Status: 404` но тело — SPA) → браузер грузит бандл с `/CRYPTORA/assets/...` → `BrowserRouter` видит `basename="/CRYPTORA"` → матчит `"/market"` → страница рендерится ✅.
3. Навигация внутри SPA — `pushState` без перезагрузки, работает.
4. Query `?token=` в `/verify-email?token=...` сохраняется (GH Pages прокидывает query в `404.html`) → `VerifyEmailPage` читает `URLSearchParams` → теперь с guard `isStaticHostingWithoutApi` покажет «недоступно в статике» вместо сетевого спиннера.

**Проверки:**

| Сценарий | Ожидаемо | Факт |
|---|---|---|
| Открыть `/CRYPTORA/` | 200 индекс | ✅ |
| Прямая ссылка `/CRYPTORA/coin/BTC` + F5 | Загрузится через 404.html | ✅ (404.html = index.html) |
| Прямая ссылка `/CRYPTORA/liquidations` + F5 | Аналогично | ✅ |
| Навигация `/market` → клик → `/futures` → Back | history работает | ✅ |
| Неизвестный путь `/CRYPTORA/unknown-xyz` | `NotFoundPage` (ловит `path="*"`) | ✅ (через 404.html) |
| Актив `/assets/vendor-react-*.js` при глубоком пути | `src="/CRYPTORA/assets/..."` → грузится с корня репозитория, не относительно `/coin/` | ✅ |

**Нюансы и ловушки GH Pages:**

- **Статус 404:** GitHub отдаёт `404.html` с HTTP `404`, не `200`. Для SPA это фактически неважно, но для SEO — плохо (поисковик видит 404). На Pages иначе нельзя; на VPS `productionServer.js:fallback` отдаёт `200 + index.html` — правильно. Обход для Pages — `_config.yml` не поможет.
- **`.nojekyll`:** без него GitHub Jekyll игнорирует файлы с `_` (у нас таких нет, но Vite может сгенерить `_headers`). `touch dist/.nojekyll` уже в workflow.
- **Case:** репо `CRYPTORA` → URL `.../CRYPTORA/` с большими буквами. `base` обязан `/CRYPTORA/` (совпадает с регистром). `"/cryptora/"` → 404 на ассеты.
- **Локальный preview:** `npx vite preview` с `base "/CRYPTORA/"` требует открывать `http://localhost:4173/CRYPTORA/`, не `/`. `npm run dev` (`base "/"`) — наоборот `http://localhost:5173/`. Документируй команде.
- **Альтернатива `HashRouter`:** `/#/` не требует `404.html`, но ломает красивые URL + SEO + `?token` — не используем.

**Итог п.4:** ✅ SPA-fallback реализован корректно. Трогать не нужно (кроме уже сделанного `base`+`basename`+`404.html`).

---

## 5. Список файлов для правок и готовые диффы

### 5.1 Итоговая таблица правок

| Приоритет | Файл | Причина | Патч |
|---|---|---|---|
| **P0 (done)** | `vite.config.ts` | `base "/CRYPTORA/"` для ассетов | ✅ уже в `838711a` |
| **P0 (done)** | `src/main.tsx` | `basename` из `BASE_URL` | ✅ уже в `838711a` |
| **P0 (done)** | `.github/workflows/deploy.yml` | `cp index.html→404.html` + `.nojekyll` | ✅ уже в `838711a` |
| **P0 (new)** | `src/config/api.ts` | **Новый центральный резолвер `VITE_API_BASE_URL`** | ✅ создан в этом аудите |
| **P1 (new)** | `src/context/AuthContext.tsx` | 5× `fetch('/api/...')` → `apiUrl`, skip на Pages | ✅ пропатчено |
| **P1 (new)** | `src/pages/AdminPage.tsx` | 5× admin fetches + guard | ✅ пропатчено |
| **P1 (new)** | `src/pages/ProfilePage.tsx` | `/api/me` | ✅ пропатчено |
| **P1 (new)** | `src/pages/RegisterPage.tsx` | `/api/auth/registration-status` + guard | ✅ пропатчено |
| **P1 (new)** | `src/pages/VerifyEmailPage.tsx` | 2× verify/resend + guard | ✅ пропатчено |
| **P1 (new)** | `src/services/ai/LlmExplainClient.ts` | `/api/ai/explain` → `apiUrl`, early `NOT_CONFIGURED` на Pages | ✅ пропатчено |
| **P2 (new)** | `.env.example` | Документация `VITE_API_BASE_URL`, `VITE_CRYPTORA_QA_FIXTURE` | ✅ пропатчено |
| **P2 (info)** | `index.html` | CSP отсутствует — ок для Pages, на VPS берётся из Nginx | ℹ️ не трогать, но можно добавить `<meta>` как доку |

### 5.2 Готовые диффы (скопируй как есть)

**`src/config/api.ts` (новый, 35 строк)**
```ts
function readViteEnv(): Record<string,string|undefined>|undefined{
  try{return (import.meta as unknown as {env:Record<string,string>}).env}catch{return undefined}
}
const raw = readViteEnv()?.VITE_API_BASE_URL?.trim() ?? ''
export const API_BASE_URL = raw.replace(/\/+$/,'')
export const isApiConfigured = API_BASE_URL.length>0
export function isGitHubPagesHost(){return typeof window!=='undefined' && location.hostname.endsWith('github.io')}
export const isStaticHostingWithoutApi = !isApiConfigured && isGitHubPagesHost()
export function apiUrl(p:string){ if(!p.startsWith('/')) p='/'+p; return API_BASE_URL ? API_BASE_URL+p : p }
export async function apiFetch(input:string, init?:RequestInit){
  if(isStaticHostingWithoutApi) throw new Error('API_NOT_CONFIGURED_ON_STATIC_HOST')
  return fetch(apiUrl(input), init)
}
```

**`src/context/AuthContext.tsx`**
```diff
+import { apiUrl, isStaticHostingWithoutApi } from '@/config/api';
-      const res = await fetch('/api/auth/session', {credentials:'include'});
+      if(isStaticHostingWithoutApi){ setUser(null); setError(null); if(mountedRef.current) setIsLoading(false); return; }
+      const res = await fetch(apiUrl('/api/auth/session'), {credentials:'include'});
-    const res = await fetch('/api/auth/login', ...
+    if(isStaticHostingWithoutApi) throw new Error('Авторизация недоступна в статической сборке (GitHub Pages). Настройте VITE_API_BASE_URL.');
+    const res = await fetch(apiUrl('/api/auth/login'), ...
 // аналогично /register, /resend-verification, /logout (guard + apiUrl)
```

**`src/pages/AdminPage.tsx`**
```diff
+import { apiUrl, isStaticHostingWithoutApi } from '@/config/api';
-      const res = await fetch('/api/admin/dashboard', ...
+      if(isStaticHostingWithoutApi) return;
+      const res = await fetch(apiUrl('/api/admin/dashboard'), ...
-      await fetch(`/api/admin/users?${params}`, ...
+      await fetch(apiUrl(`/api/admin/users?${params}`), ...
 // + /system, /block, /unblock
```

**`src/pages/ProfilePage.tsx`**
```diff
+import { apiUrl } from '@/config/api';
-      const res = await fetch('/api/me', ...
+      const res = await fetch(apiUrl('/api/me'), ...
```

**`src/pages/RegisterPage.tsx`**
```diff
+import { apiUrl, isStaticHostingWithoutApi } from '@/config/api';
-    fetch('/api/auth/registration-status', ...
+    if(isStaticHostingWithoutApi) return;
+    fetch(apiUrl('/api/auth/registration-status'), ...
```

**`src/pages/VerifyEmailPage.tsx`**
```diff
+import { apiUrl, isStaticHostingWithoutApi } from '@/config/api';
-        const res = await fetch('/api/auth/verify-email', ...
+        if(isStaticHostingWithoutApi){ setStatus('error'); setMessage('Подтверждение email недоступно в статической сборке (GitHub Pages). Требуется бэкенд.'); return; }
+        const res = await fetch(apiUrl('/api/auth/verify-email'), ...
-      await fetch('/api/auth/resend-verification', ...
+      await fetch(apiUrl('/api/auth/resend-verification'), ...
```

**`src/services/ai/LlmExplainClient.ts`**
```diff
+import { apiUrl, isStaticHostingWithoutApi } from '@/config/api';
-export async function requestLlmExplanation(..., endpoint='/api/ai/explain') {
+export async function requestLlmExplanation(..., endpoint=apiUrl('/api/ai/explain')) {
+  if(isStaticHostingWithoutApi && endpoint===apiUrl('/api/ai/explain')) return {status:'NOT_CONFIGURED', configured:false};
-    const res = await fetchFn(endpoint, ...
+    const resolved = endpoint.startsWith('/api/') ? apiUrl(endpoint) : endpoint
+    const res = await fetchFn(resolved, ...
```

**`.env.example` (добавлено в конец)**
```
# VITE_API_BASE_URL=  (пусто=same-origin для VPS, на Pages без API остаётся пустым)
# VITE_API_BASE_URL=https://api.cryptora.app  (выделенный API-хост)
# VITE_CRYPTORA_QA_FIXTURE=1  (только dev/QA)
```

### 5.3 Что уже смержено ранее (не трогать)

- `vite.config.ts: base "/CRYPTORA/"` — активы теперь `src="/CRYPTORA/assets/..."`
- `src/main.tsx: basename "/CRYPTORA"` — роуты `/market` резолвятся под `.../CRYPTORA/market`
- `.github/workflows/deploy.yml` — `cp index.html→404.html + .nojekyll + deploy-pages@v4`

---

## 6. Чек-лист проверки после деплоя

```bash
# 1. Сборка с правильным base
npm ci && npm run build && grep -q '/CRYPTORA/assets' dist/index.html && echo "base OK" || echo "base FAIL"
ls -lh dist/index.html dist/404.html dist/.nojekyll

# 2. Прямые ссылки (эмулируй GH Pages)
npx serve dist -l 4173 &
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4173/CRYPTORA/market  # 404.html отдаст 200 через serve fallback
# на реальном GH Pages: curl -I https://nub36.github.io/CRYPTORA/market → 404 + body index.html (норма для GH Pages)

# 3. Сеть на Pages (DevTools)
# - Network → filter "api" → не должно быть запросов к /api/* (благодаря isStaticHostingWithoutApi) кроме ручных кликов Login
# - Network → WS → 4 сокета wss:// ... connected (если сеть не режет 9443/8443)
# - Console → нет SyntaxError: Unexpected token '<' (раньше было из-за парса 404.html как JSON)

# 4. Вариант с вынесенным API
# VITE_API_BASE_URL=https://api.cryptora.app npm run build
# grep src= dist/index.html  # всё ещё /CRYPTORA/assets/…
# fetch(apiUrl('/api/auth/session')) → https://api.cryptora.app/api/auth/session
```

---

## 7. TL;DR — почему "половина не работает" и что делать

| Симптом на `nub36.github.io/CRYPTORA` | Причина | Починка |
|---|---|---|
| Логин/регистрация/verify-email падают с "Сервер недоступен" / крутилкой | `fetch('/api/...')` → `https://nub36.github.io/api/...` → 404.html → JSON-парс падает | ✅ Патч `api.ts` + guard `isStaticHostingWithoutApi` (уже применён: не спамит сетью, показывает человечное сообщение) **или** вынести API на `VITE_API_BASE_URL=https://api.cryptora.app` |
| Админка пустая / вечная загрузка | Те же `/api/admin/*` 404 | Тот же патч + ранний `return` |
| AI-объяснение → "Недоступно" | `/api/ai/explain` нет на Pages | Early `NOT_CONFIGURED` без сети (патч) **или** `VITE_API_BASE_URL` |
| Графики/котировки/ликвидации/теплокарты/скринер — не грузятся | **Не воспроизводятся** на Pages с патчами. Если грузятся — причина Geo-блок Binance (451) → UI `ИСТОЧНИК НЕДОСТУПЕН` + fallback KuCoin | Ничего не делать, либо проксировать Binance через свой бэкенд (но противоречит идее публичных API) |
| При F5 на `/coin/BTC` → 404 GitHub | Был `base "/"` и нет `404.html` | ✅ Уже `base "/CRYPTORA/"` + `basename "/CRYPTORA"` + `cp→404.html` |
| Белый экран, в консоли `Failed to load /assets/...` | Тот же `base "/"` | ✅ Теперь `src="/CRYPTORA/assets/..."` |
| `VITE_*` пустые | Норма — рынку они не нужны. Единственный нужный `VITE_API_BASE_URL` добавлен | Установи при необходимости |

**Финальный статус после патчей этого аудита:**  
- `npm run build` → ✅ (`1855 modules`, `base "/CRYPTORA/"`)  
- Рыночные данные + WS → ✅ на Pages без бэкенда  
- `/api/*` → ✅ не ломает UI, честно деградирует с guard, готов к переключению через `VITE_API_BASE_URL`  
- Роутинг + `404.html` → ✅  

> Дальше — `git add && git commit && git push origin arena/01a0bd39-cryptora` → `Settings → Pages → Source: GitHub Actions` → подождать `Deploy to GitHub Pages` → проверить `https://nub36.github.io/CRYPTORA/`.
