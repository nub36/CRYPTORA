# Деплой CRYPTORA на GitHub Pages

> Актуально на v0.8.49. Статический хостинг поднимает **только фронтенд** (`dist/`); Node-бэкенд
> `server/` (Express + PostgreSQL: auth, AI-прокси) на GitHub Pages работать не может.

## Как включить

1. GitHub → репозиторий → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Смержить PR #2 в `main` (или запустить workflow вручную: **Actions → Deploy to GitHub Pages → Run workflow**).
3. Сайт: `https://nub36.github.io/CRYPTORA/`.

Workflow `.github/workflows/deploy.yml` триггерится на push в `main` и `workflow_dispatch`; на ветки `arena/*`
не триггерится — публикация только по решению владельца.

## Что работает на Pages

- Весь терминал: обзор, рынок, графики, фьючерсы, ликвидации, скринер, радар, теплокарты, стратегии, **сигналы**,
  корреляции, on-chain, журнал, статьи. Данные браузер берёт напрямую у публичных API (Binance, KuCoin, CoinGecko,
  Alternative.me, mempool.space, DeFiLlama, Bybit/OKX WS) — то же клиентское поведение, что на VPS.
- SPA-роутинг `BrowserRouter`: workflow копирует `index.html` → `404.html` (стандартный фолбэк GitHub Pages),
  `vite base` и `BrowserRouter basename` задаются из `GITHUB_BASE_PATH=/CRYPTORA/`.

## Что НЕ работает на Pages (и как выглядит)

- Логин, регистрация, подтверждение e-mail, профиль, админка, AI-объяснения (`/api/*`): бэкенда нет. `AuthContext`
  обрабатывает недоступность честно — «Авторизация временно недоступна», пользователь остаётся гостем; приложение
  не падает. Сигналы и рыночные данные от этого не зависят.
- Серверный CSP (helmet) отсутствует — его нет и в `index.html`: внешние API не блокируются.

## Ограничения

- Кастомный домен или переименование репозитория → поменять `GITHUB_BASE_PATH` в workflow (для домена — `/`).
- Артефакт — `dist/` (~1 МБ JS+CSS, без sourcemap); Jekyll отключён `.nojekyll`.
