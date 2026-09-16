# CRYPTORA — Production Deployment Guide & Operations Manual

> **Проект:** CRYPTORA — Crypto Market Intelligence Terminal  
> **Версия релиза:** 0.7.0  
> **Инвариант продукта:** CRYPTORA IS STRICTLY A MARKET INTELLIGENCE TERMINAL. NO TRADE EXECUTION, NO TRADING BOTS, NO CUSTODY, NO PRIVATE KEYS, NO TRADING API KEYS.

---

## 1. Архитектура Production

```text
                             [ User Browser ]
                                     │
                                     ▼
                ┌─────────────────────────────────────────┐
                │          Internet / Public DNS          │
                └────────────────────┬────────────────────┘
                                     │ (Port 80 / 443 HTTPS)
                                     ▼
                ┌─────────────────────────────────────────┐
                │              Nginx Proxy                │
                │   - SSL/TLS Termination (Certbot)       │
                │   - Static Asset Caching (1y immutable) │
                │   - Security Headers & Strict CSP       │
                │   - SPA Routing Fallback (/index.html)  │
                │   - Rate Limiting (30r/s)               │
                └──────────────┬──────────────────────────┘
                               │
                               │ (Reverse Proxy: 127.0.0.1:3000)
                               ▼
                ┌─────────────────────────────────────────┐
                │       Node.js Production Server         │
                │       (server/productionServer.js)      │
                │   - SPA File Serving (/dist)            │
                │   - Health Check (/api/health)          │
                │   - Market Data Gateway (/api/proxy/*)  │
                │   - 10s In-Memory Response Caching      │
                │   - Managed via Systemd / PM2           │
                └─────────────────────────────────────────┘
```

### Разделение сред: DEMO vs LIVE

- **DEMO Mode:** Детерминированные эталонные снимки рынка для демонстрации и аудита без сетевых задержек.
- **LIVE Mode:** Прямое получение публичных котировок с Binance и KuCoin через доменные адаптеры с Zod-валидацией DTO. Если API бирж недоступны с IP сервера/клиента, выводится честный статус ошибки — платформе строго запрещено маскировать сбои живых провайдеров демо-данными.

---

## 2. Требования к серверу (VPS Prerequisites)

- **ОС:** Ubuntu 22.04 LTS / Debian 12 / Rocky Linux 9 (x86_64).
- **CPU / RAM:** 1 vCPU, 1 GB RAM (минимум); 2 vCPU, 2 GB RAM (рекомендуется).
- **Диск:** 10 GB SSD.
- **Сетевые порты:**
  - `80/tcp` (HTTP — Nginx / Let's Encrypt validation)
  - `443/tcp` (HTTPS — TLS encrypted web traffic)
  - `22/tcp` (SSH — управление сервером)
  - Внутренний порт `3000/tcp` привязан к `127.0.0.1` или `0.0.0.0` (закрыт внешним фаерволом UFW).
- **Установленное ПО:**
  - Node.js >= 18.x (рекомендуется Node.js 20.x LTS)
  - npm >= 9.x
  - Nginx >= 1.18
  - Git
  - Certbot (для SSL-сертификатов)

---

## 3. Путь Deployment (Пошаговая установка)

### Шаг 1. Клонирование репозитория

```bash
cd /home/user # или /var/www
git clone https://github.com/nub36/CRYPTORA.git
cd CRYPTORA
git checkout arena/01a0a67d-cryptora # или рабочая ветка
```

### Шаг 2. Конфигурация переменных окружения

```bash
cp .env.example .env
# Отредактируйте .env при необходимости:
# HOST=0.0.0.0
# PORT=3000
# NODE_ENV=production
```

> **Безопасность:** В файле `.env` категорически запрещено хранить приватные ключи, сид-фразы или учетные данные бирж. Никаких secrets не требуется для работы с публичными данными.

### Шаг 3. Сборка и валидация Quality Gates

```bash
# Установка зависимостей с автоматическим патчем Playwright JSX
npm ci

# Прохождение всех тестов и линтеров
npm run typecheck
npm test

# Сборка production-бандла
npm run build

# Сквозное тестирование браузерных маршрутов
npm run test:e2e
```

### Шаг 4. Настройка сервиса Systemd

Скопируйте конфигурацию юнита в системную директорию:

```bash
sudo cp systemd/cryptora.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable cryptora
sudo systemctl start cryptora
sudo systemctl status cryptora
```

### Шаг 5. Настройка веб-сервера Nginx

1. Скопируйте конфигурационный файл:
   ```bash
   sudo cp nginx/cryptora.conf /etc/nginx/sites-available/cryptora.conf
   sudo ln -sf /etc/nginx/sites-available/cryptora.conf /etc/nginx/sites-enabled/
   ```
2. Проверьте синтаксис:
   ```bash
   sudo nginx -t
   ```
3. Перезапустите Nginx:
   ```bash
   sudo systemctl reload nginx
   ```

---

## 4. Настройка Домена и HTTPS (Let's Encrypt / Certbot)

Если для терминала выделен домен (например, `cryptora.app`):

1. **Настройка DNS:**  
   В панели DNS-провайдера создайте A-записи:
   - `@` -> `IP_ВАШЕГО_VPS`
   - `www` -> `IP_ВАШЕГО_VPS`

2. **Получение SSL-сертификата через Certbot:**
   ```bash
   sudo apt-get install certbot python3-certbot-nginx -y
   sudo certbot --nginx -d cryptora.app -d www.cryptora.app
   ```

3. **Автоматическое продление:**
   Certbot устанавливает cron/systemd-таймер автоматического обновления. Проверка:
   ```bash
   sudo certbot renew --dry-run
   ```

Если домен еще не делегирован, терминал доступен напрямую по IP-адресу сервера на порту 80/3000 (HTTP).

---

## 5. Операционные команды (CLI Operations)

В директории `scripts/` подготовлены исполняемые команды управления:

| Команда | Описание |
| :--- | :--- |
| `./scripts/deploy.sh` | Полный цикл: `npm ci` -> `typecheck` -> `test` -> `build` -> валидация `dist/` |
| `./scripts/restart.sh` | Бесшовный перезапуск службы Systemd или фонового процесса |
| `./scripts/status.sh` | Проверка статуса сервиса, процесса Node и эндпоинта `/api/health` |
| `./scripts/logs.sh 100` | Вывод последних 100 строк логов (`journalctl` или `server.log`) |
| `./scripts/update.sh` | Автоматический `git pull` с последующим вызовом `deploy.sh` и `restart.sh` |

---

## 6. Процедура отката (Rollback Procedure)

В случае обнаружения деградации или ошибок после обновления:

```bash
# 1. Откат на предыдущий стабильный коммит
git log -5 --oneline
git checkout <PREVIOUS_COMMIT_HASH>

# 2. Повторная сборка стабильного бандла
npm ci
npm run build

# 3. Перезапуск сервиса
./scripts/restart.sh
```

---

## 7. Безопасность и защита инфраструктуры

1. **Non-Custodial Invariant:** Терминал физически не содержит программного кода для отправки транзакций в блокчейн или создания торговых ордеров.
2. **Zero Secrets:** Исходный код и бандл фронтенда не содержат приватных ключей или API-токенов.
3. **CSP (Content Security Policy):**
   ```http
   Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://api.binance.com https://fapi.binance.com https://api.kucoin.com wss://stream.binance.com:9443; frame-ancestors 'self';
   ```
4. **Запрет Directory Listing:** Опция `autoindex off` отключена на уровне Nginx и серверного обработчика.
5. **Отсутствие Source Maps в Production:** В `vite.config.ts` жестко зафиксировано `build: { sourcemap: false }`.

---

## 8. Известные ограничения сетевой среды

- **Песочницы и внешние фаерволы:** В изолированных контейнерных средах без прямого исходящего доступа в Интернет сетевые запросы к публичным API (`api.binance.com`, `api.kucoin.com`) могут блокироваться локальным сетевым фильтром хоста. При работе на боевом VPS с открытым внешним сетевым шлюзом данные ограничения отсутствуют.
- **Ограничения частоты запросов (Rate Limits):** Для защиты от лимитов бирж (Binance 1200 weight/min) в терминале реализован клиентский и серверный TTL-кэш (10 секунд).
