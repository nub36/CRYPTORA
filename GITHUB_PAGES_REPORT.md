# CRYPTORA — Технический отчёт для деплоя на GitHub Pages

> Дата: 2026-09-20 | Ветка: `arena/01a0bd39-cryptora` | Репозиторий: `nub36/CRYPTORA` | Версия: `0.8.44`

Этот документ — полная выжимка для правильной настройки GitHub Pages. По итогам анализа уже внесены исправления и создан готовый workflow (ниже).

---

## 1. Стек и технологии

| Параметр | Значение |
|---|---|
| **Тип проекта** | SPA (Single Page Application), **не статический HTML**, не Next.js/Astro |
| **Сборщик** | **Vite 6.4.3** |
| **Фреймворк UI** | **React 18.3.1** + TypeScript 5.7 + React Router 6.28 |
| **Стили** | Tailwind CSS 3.4 + PostCSS + Autoprefixer, кастомная дизайн-система |
| **Графики** | `lightweight-charts` 4.2.1 (TradingView) + кастомные SVG-sparklines |
| **Шрифты** | Самохостед: `@fontsource/inter`, `@fontsource-variable/jetbrains-mono` (CSP-safe, без Google Fonts) |
| **Валидация** | Zod + доменные адаптеры |
| **Тесты** | Vitest 2.1 + Playwright 1.49 + Testing Library |
| **Бэкенд (отдельно)** | Node.js 20 + Express 5.2 + PostgreSQL + connect-pg-simple (сессии) — см. п.5 |
| **Менеджер пакетов** | npm (есть `package-lock.json`) |

**Вывод:** проект собирается Vite → чистый статический бандл, пригоден для GitHub Pages. SSR/SSG нет.

---

## 2. Структура файлов

```
CRYPTORA/
├── index.html              ← ГЛАВНЫЙ HTML (в корне проекта, не в public/src)
│     └── <script src="/src/main.tsx">
├── src/
│   ├── main.tsx            ← вход Vite (BrowserRouter + Providers)
│   ├── App.tsx             ← 25+ маршрутов
│   ├── pages/              ← 25 страниц (Overview, Market, CoinDetail…)
│   ├── components/         ← layout, market, charts, workspace
│   └── services/           ← прямые коннекты к Binance/KuCoin/CoinGecko…
├── vite.config.ts          ← конфиг сборки (path alias @ → src)
├── package.json            ← scripts: dev / build / preview / start / server
├── public/                 ← ОТСУТСТВУЕТ (нет статики вне кода)
└── dist/                   ← папка сборки (генерируется `npm run build`)
      ├── index.html        ← 2.2 KB (с хешированными ссылками)
      └── assets/           ← JS/CSS/WOFF2 с хешами (immutable)
```

- **Главный `index.html`:** в корне (`/index.html`), Vite-шаблон. В `dist/index.html` инжектятся хешированные ассеты.
- **Папка сборки:** **`dist/`** (дефолт Vite). В `.gitignore` уже: `dist`, `node_modules`, `.env`.
  Проверка билда: `npm ci && npm run build` → `dist/assets/index-*.js (318 KB)`, `vendor-react-*.js`, `vendor-charts-*.js` и т.д.
- **Нет `public/`:** все ассеты идут через импорты JS/CSS, хешируются Vite.

---

## 3. Конфигурация и зависимости

**`package.json` — основные скрипты:**
```json
{
  "dev":        "vite --host 0.0.0.0 --port 5173",
  "build":     "tsc -b && vite build",
  "prebuild":  "node scripts/build-articles-index.mjs",
  "preview":   "vite preview --host 0.0.0.0 --port 5173",
  "start":     "node server/productionServer.js",
  "server":    "node server/index.js",
  "typecheck": "tsc --noEmit",
  "test":      "vitest run"
}
```
- `build` = `tsc -b` (проверка типов, `noEmit`) → `vite build` → `dist/`.
- `prebuild` генерирует `src/services/content/articlesIndex.generated.ts` из `content/articles/*.md`.

**`vite.config.ts` (было → стало):**
```ts
// Было: base отсутствовал (= "/") → ломалось на https://user.github.io/repo/
export default defineConfig({ plugins:[react()], ... })

// Стало (уже применено в репозитории):
export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : process.env.GITHUB_PAGES_BASE || '/CRYPTORA/',
  // dev = "/" (удобно локально), build = "/CRYPTORA/" (Project Pages)
}))
```
Для кастомного домена (корень) — `GITHUB_PAGES_BASE=/ npm run build` или поменяй на `base: "/"`.

**Переменные окружения:**
- **Фронтенд:** `VITE_*` **не используется** кроме опциональной `VITE_CRYPTORA_QA_FIXTURE=1` (включает QA-фикстуру только в dev/test; в прод-сборке без неё режим всегда `LIVE`). Для GH Pages `.env` **не нужен**.
- **Бэкенд (`server/`):** `.env.example` содержит `DATABASE_URL`, `SESSION_SECRET`, `SMTP_*`, `OPENAI_API_KEY`, `APP_ORIGIN` и т.д. — всё это **не попадает в бандл** и на GH Pages не используется (см. п.5). Фронтенд не читает `.env`.

---

## 4. Пути к ассетам (Assets)

| Что | Как подключено | Проблема на GH Pages | Решение |
|---|---|---|---|
| **JS/CSS** | Vite инжектит абсолютные пути `src="/assets/index-*.js"` | На `https://nub36.github.io/CRYPTORA/` путь `/assets/...` → `https://nub36.github.io/assets/...` → **404** | `base: "/CRYPTORA/"` (уже исправлено) → теперь `src="/CRYPTORA/assets/index-*.js"` |
| **Шрифты/иконки** | Через `import '@fontsource/inter/400.css'` → Vite копирует `*.woff2` в `assets/` | Тоже требовали base | Исправлено тем же `base` |
| **Картинки** | Статических `<img src="/…">` нет; `data: https:` рендерит с CDN | Нет проблем | — |
| **`.env` / CSP** | `server/productionServer.js` выставляет CSP с `connect-src` на биржи | На GH Pages Nginx нет, но CSP не нужен — данные грузятся напрямую из браузера | — |

**Проверка:**
```bash
npm run build
grep -o 'src="[^"]*"' dist/index.html
# → src="/CRYPTORA/assets/index-C28QTR2B.js"  ✓
```
Для **User/Org Pages** (`nub36.github.io` без суффикса) или кастомного домена — пересобери с `base: "/"`:
```bash
GITHUB_PAGES_BASE=/ npm run build
# → src="/assets/index-*.js"
```

---

## 5. Роутинг и бэкенд

**Роутинг — SPA:**
- `src/main.tsx`: `<BrowserRouter>` + `App.tsx` с `Routes`.
- 25+ маршрутов: `/`, `/market`, `/coin/:symbol`, `/futures`, `/liquidations`, `/screener`, `/radar`, `/heatmaps`, `/tools`, `/strategies`, `/signals`, `/correlations`, `/onchain`, `/journal`, `/calendar`, `/ecosystem`, `/portfolio`, `/articles`, `/articles/:slug`, `/login`, `/register`, `/verify-email`, `/profile`, `/admin`, `* → NotFoundPage`.
- **Требует SPA-fallback:** прямой заход на `https://nub36.github.io/CRYPTORA/coin/BTC` без fallback даст 404 от GitHub Pages. **Решение:** скопировать `dist/index.html → dist/404.html` (де-факто `history fallback` на GH Pages) + `touch dist/.nojekyll`. Уже в workflow.
- **Также важен `basename`:** `<BrowserRouter basename="/CRYPTORA">` синхронизирован с `base` Vite. Для кастомного домена автоматически `/`.

**Бэкенд — есть, но не нужен для GH Pages:**
- `server/` — Express 5: `/api/health`, `/api/auth/*`, `/api/me`, `/api/admin`, `/api/ai/explain` + сессии в PostgreSQL, CSRF, rate-limit, Argon2, Nodemailer.
- `server/productionServer.js` — отдельный лёгкий http-сервер, раздающий `dist/` + SPA-fallback (альтернатива Nginx).
- **Фронтенд НЕ зависит от бэкенда для главного функционала:** котировки, свечи, стакан, OI/фандинг, Fear&Greed, DeFiLlama TVL, mempool — всё тянется **напрямую из браузера** по `fetch`/`WebSocket` к `api.binance.com`, `api.kucoin.com`, `api.coingecko.com`, `api.alternative.me`, `wss://stream.binance.com:9443` и т.д. (см. `src/services/data/adapters/*`).
- На GH Pages эндпоинты `/api/auth/*` будут 404 — страницы `/login`, `/register`, `/profile`, `/admin` отобразят состояние ошибки, но **терминал продолжит работать** (рынок, графики, скринер и т.д.).
- Для.fullstack деплоя нужен VPS с Node+Postgres+Nginx (см. `docs/DEPLOYMENT.md`, `nginx/cryptora.conf`, `systemd/cryptora.service`).

**Итог:** сайт **чисто статический с точки зрения GH Pages** — можно деплоить только `dist/` без сервера. SPA-роутинг требует `404.html` клона.

---

## ✅ Что уже сделано в этой ветке

### 1) `vite.config.ts` — исправлен base
```ts
export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : process.env.GITHUB_PAGES_BASE || '/CRYPTORA/',
  // ...
}))
```

### 2) `src/main.tsx` — добавлен basename
```ts
const _baseUrl = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL || '/';
const routerBasename = _baseUrl === '/' ? '/' : _baseUrl.replace(/\/$/, '');
<BrowserRouter basename={routerBasename}>
```

### 3) `.github/workflows/deploy.yml` — готовый деплой (уже в репо)
```yaml
name: Deploy to GitHub Pages
on:
  push: { branches: ["main"] }
  workflow_dispatch:
permissions: { contents: read, pages: write, id-token: write }
# ...
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run build
      - run: cp dist/index.html dist/404.html && touch dist/.nojekyll
      - uses: actions/upload-pages-artifact@v3
        with: { path: ./dist }
  deploy:
    needs: build
    environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }
    runs-on: ubuntu-latest
    steps:
      - uses: actions/deploy-pages@v4
```

---

## 🚀 Как включить публикацию (3 шага)

**1. Push ветки в `main`:**
```bash
git push origin arena/01a0bd39-cryptora:main
# или merge PR → main (workflow слушает только main)
```

**2. В GitHub → Settings → Pages:**
- **Build and deployment → Source:** `GitHub Actions` (не `Deploy from a branch`!)

**3. Запустится workflow `Deploy to GitHub Pages` → сайт появится на:**
```
https://nub36.github.io/CRYPTORA/
```

**Проверка локально:**
```bash
npm ci
npm run build         # соберёт с base /CRYPTORA/
npx vite preview --host 0.0.0.0 --port 4173
# открой http://localhost:4173/CRYPTORA/  (или npm run dev → http://localhost:5173/)
```

**Для кастомного домена:**
```ts
// vite.config.ts → base: "/"
```
или
```bash
GITHUB_PAGES_BASE=/ npm run build
# + в deploy.yml: run: GITHUB_PAGES_BASE=/ npm run build
# + Settings → Pages → Custom domain
```

**Альтернативный workflow (ветка `gh-pages` через `peaceiris/actions-gh-pages`):**
если предпочитаешь классический `gh-pages` бранч — замени `upload-pages-artifact/deploy-pages` на `peaceiris/actions-gh-pages@v4` с `publish_dir: ./dist`. Текущий `deploy-pages` — современный рекомендованный GitHub способ (OIDC, без PAT).

---

## ⚠️ Ограничения GH Pages для этого проекта

- Нет серверного API → авторизация/верификация почты/админка не будут работать (ожидаемо; UI покажет «недоступно»). Весь маркет-дата функционал работает.
- `OPENAI_API_KEY` / `DATABASE_URL` / `SMTP` остаются на VPS — на Pages их нет и не нужно.
- Если включишь CSP через `<meta>` — не забудь `connect-src` из `server/productionServer.js` (иначе браузер заблокирует `wss://fstream.binance.com` и т.д.).

---

## 📎 Полезные команды

```bash
# Локальная разработка (без base)
npm run dev

# Проверка типов + тесты
npm run typecheck
npm test

# Production-сборка с правильным base
npm run build
ls -lh dist/ && cat dist/index.html | grep -o 'src="[^"]*"'

# Эмуляция GH Pages fallback
cp dist/index.html dist/404.html && touch dist/.nojekyll && npx serve dist
```
