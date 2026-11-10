# Развёртывание продукта V3.4 на новом VPS

## Статус на текущий момент (честно)

| Что | Состояние |
|---|---|
| Код backend'а, тесты, сборка | готово и проверено локально (см. корневой `README.md`) |
| Скрипты/конфиги развёртывания | готовы, лежат в этом каталоге |
| Сборка и проверка релизного архива | выполняется `deploy/make-release.sh` на машине разработчика, включая распаковку и запуск |
| Подключение к VPS | **не выполнялось**: SSH-доступа в рабочем окружении нет |
| Что работает на VPS | **ничего** — сервер не разворачивался |
| Домен и HTTPS | **не настроены**: домена нет, DNS не менялся |
| APK на VPS | нет: ни APK, ни `manifest.json` не публиковались |
| Firebase / push | **не настроен**: нет `google-services.json` и ключа сервисного аккаунта |

Ни одна строка ниже не выдаётся за выполненную. Всё, что помечено «нужно от владельца»,
без владельца сделать нельзя.

## Что нужно от владельца

1. **Доступ к VPS**: SSH-ключ + alias в `~/.ssh/config`:
   ```
   Host v34-app-vps
     HostName <IP или домен VPS>
     User <непривилегированный пользователь>
     IdentityFile ~/.ssh/<ключ>
     IdentitiesOnly yes
   ```
   Подключение — только по ключу, отдельным непривилегированным пользователем. Пароль
   root из переписки/скриншотов не используется никогда; в репозиторий ничего из этого
   не попадает.
2. **Домен** (например `signals.<ваш-домен>.fi`) и разрешение на изменение DNS. Без
   домена публичного HTTPS не будет, а API (в том числе регистрация устройств) нельзя
   выставлять в интернет без TLS. Скрипт установки откажется работать с доменами-заглушками
   (`example.com` и подобными).
3. **Релизный keystore** для APK: файл `.jks` + alias + пароли — в защищённом хранилище
   владельца. Владелец либо собирает APK сам, либо передаёт keystore в CI-секреты
   (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
   `ANDROID_KEY_PASSWORD`), но не в чат и не в Git.
4. **Firebase-проект** (если нужны реальные push): `google-services.json` для сборки
   Android и JSON сервисного аккаунта для сервера — оба файла вне Git.

## Состав каталога

| Файл | Назначение | Куда ставится на VPS |
|---|---|---|
| `make-release.sh` | сборка релизного архива + самопроверка (распаковка, старт, health, SIGTERM) | запускается на машине разработчика |
| `install.sh` | установка: проверки → пользователь/каталоги → systemd → health → HTTPS(ACME) | запускается вручную под sudo |
| `v34-app.service` | systemd-unit с минимальными привилегиями, `ExecStart=/usr/bin/node /opt/v34app/current/dist/server.mjs` | `/etc/systemd/system/v34-app.service` |
| `v34.env.example` | шаблон окружения без секретов (`V34_HOST=127.0.0.1`) | `/etc/v34-app/v34.env` (chmod 640) |
| `nginx-v34-app.conf` | шаблон reverse-proxy: HTTPS, редирект с 80, rate-limit на `/api/v1/devices`; `__DOMAIN__` подставляет `install.sh` | `/etc/nginx/sites-available/v34-app.conf` |
| `limits.conf` | зона `limit_req_zone devices` | `/etc/nginx/conf.d/v34-limits.conf` |
| `publish-apk.sh` | публикация APK + `manifest.json` со SHA-256 | запускается вручную |

## Раскладка релиза (одна и та же везде)

```
v34-app-release/
  dist/server.mjs                 ← ExecStart=/usr/bin/node /opt/v34app/current/dist/server.mjs
  dist/scan-once.mjs
  landing/                        ← V34_STATIC_DIR
  node_modules/express, jose      ← prod-зависимости в КОРНЕ релиза
  package.json                    ← самостоятельный манифест (без workspaces)
  RELEASE.json                    ← версия, дата, требование Node, без секретов
```

`node_modules` лежит рядом с `dist/`, поэтому Node разрешает `express`/`jose`
подъёмом по дереву каталогов. Оба факта проверяются автоматически:
`make-release.sh` — при упаковке и после распаковки, `install.sh` — ещё раз на
месте установки. Архив, где зависимости лежат в `server/node_modules` или
отсутствуют, отклоняется.

## Порядок действий

### 1. Собрать и проверить архив (машина разработчика)

```bash
cd v34-app
npm ci
./deploy/make-release.sh            # → release/v34-app-<version>.tar.gz
```

Скрипт не только пакует: он распаковывает архив во временный каталог, поднимает
сервер на временной БД и `127.0.0.1`, ждёт `GET /api/v1/health`, затем
останавливает процесс по `SIGTERM`. Если что-то из этого не работает — архив не
создаётся. Внешние обращения (Binance/Firebase) при проверке не выполняются:
первый скан откладывается.

### 2. Скопировать архив и каталог `deploy/` на VPS

```bash
scp v34-app/release/v34-app-*.tar.gz v34-app-vps:/tmp/
rsync -a v34-app/deploy/ v34-app-vps:/tmp/v34-deploy/
```

### 3. Установка (на VPS)

```bash
ssh v34-app-vps
sudo /tmp/v34-deploy/install.sh /tmp/v34-app-0.1.0.tar.gz \
     --domain signals.<ваш-домен>.fi --email <почта-владельца>
```

Что делает `install.sh` и в каком порядке:

1. **Проверки до любых изменений**: root, архив и его раскладка, `/usr/bin/node`
   версии ≥ 22.5 (именно этот бинарник запускает systemd — `node` из nvm не
   подойдёт), наличие `nginx`, `certbot`, `curl`, валидность домена и почты,
   резолв домена в IPv4.
2. Пользователь `v34app`, каталоги `/opt/v34app/{current,data,apk}`, `/etc/v34-app`.
3. Распаковка, повторная проверка `express`/`jose` из `dist/`, атомарная замена
   `current` (предыдущая версия → `current.previous`).
4. `v34.env` (если ещё нет), systemd-юнит, `restart`, затем **ожидание health**.
   Если сервис не ответил за 40 с — печатается журнал и скрипт завершается с
   ошибкой. Подавления ошибок запуска нет.
5. **HTTPS в безопасной последовательности**: webroot `/var/www/certbot` →
   временный HTTP-конфиг только для ACME (порт 80 отдаёт челлендж, всё прочее —
   503; API по HTTP не публикуется) → `nginx -t` → reload → локальная проверка
   челленджа → `certbot certonly --webroot` → проверка файлов сертификата →
   включение TLS-конфига → `nginx -t` → reload → локальная проверка
   `https://<домен>/api/v1/health`.
   Если `nginx -t` не принял конфиг — симлинк снимается, reload не выполняется,
   скрипт завершается с ошибкой.
6. Firewall **не включается автоматически**. `install.sh` печатает готовые
   команды; правила добавляются только с `--firewall`, а `ufw` включается только
   с `--firewall-enable`, причём порт SSH берётся из реально слушающих сокетов.

Если установка прервалась на шаге HTTPS, база и сервис уже работают локально;
повторный запуск идемпотентен.

### 4. Домен и DNS

DNS-записи не меняет ни скрипт, ни агент: `A`-запись `signals.<домен>` →
IP сервера настраивает владелец. После распространения DNS — шаг 3 (или
повторный запуск `install.sh`).

### 5. Публикация APK (после сборки и подписи)

```bash
sudo /tmp/v34-deploy/publish-apk.sh ~/cryptora-v34-0.1.0-release.apk 0.1.0 --release-key
curl -fsS https://signals.<ваш-домен>.fi/api/v1/apk
```

`--release-key` указывается только для APK, подписанного релизным ключом
владельца. Для проверочной сборки флаг не ставится: лендинг покажет её как
неподписанную. Debug-APK из CI релизом не является.

### 6. Firebase (если нужны push)

```bash
sudo install -o root -g v34app -m 0640 fcm-service-account.json /etc/v34-app/
# в v34.env:
# V34_PUSH_ENABLED=true
# V34_FCM_PROJECT_ID=<project-id>
# V34_FCM_SERVICE_ACCOUNT_FILE=/etc/v34-app/fcm-service-account.json
sudo systemctl restart v34-app
curl -fsS https://signals.<ваш-домен>.fi/api/v1/meta | jq .push
```

`configured:true` означает только «сервер готов отправлять». Фактическая доставка
проверяется отдельно на реальном устройстве, и без Firebase её проверить нельзя.

## Проверка после развёртывания

```bash
curl -fsS https://signals.<ваш-домен>.fi/api/v1/health
curl -fsS https://signals.<ваш-домен>.fi/api/v1/meta   | jq '{engine: .engine.dataStatus, push: .push.configured}'
curl -fsS https://signals.<ваш-домен>.fi/api/v1/signals | jq '{count, stale, staleReason}'
curl -fsS https://signals.<ваш-домен>.fi/api/v1/apk     | jq .
journalctl -u v34-app -n 100 --no-pager
```

Ожидаемое поведение первых минут: `stale: true` и причина «сканов ещё не было» до
первого успешного скана (первый скан запускается через `V34_SCAN_INITIAL_DELAY_MS`).

Backend слушает `127.0.0.1:8080` (`V34_HOST` в `v34.env`). Наружу порт не
открывается и в `ufw` не добавляется: доступ только через nginx по HTTPS. Явный
внешний bind возможен лишь с `V34_HOST=<адрес>` **и** `V34_ALLOW_PUBLIC_BIND=true`
— делать это не нужно.

## Резервная копия и восстановление БД

База — SQLite в режиме WAL (`/opt/v34app/data/v34.sqlite`). Копировать файл
`v34.sqlite` «на горячую» нельзя: без `-wal`/`-shm` копия будет неполной или
битой. Используйте штатный механизм SQLite.

**Резервная копия (онлайн, без остановки сервиса):**

```bash
sudo install -d -m 0750 -o v34app -g v34app /var/backups/v34app
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
sudo -u v34app sqlite3 /opt/v34app/data/v34.sqlite \
  ".backup '/var/backups/v34app/v34-$STAMP.sqlite'"
sudo -u v34app sqlite3 /var/backups/v34app/v34-$STAMP.sqlite 'PRAGMA integrity_check;'
```

`.backup` берёт консистентный снимок с учётом WAL. Альтернатива с тем же
результатом — `VACUUM INTO`:

```bash
sudo -u v34app sqlite3 /opt/v34app/data/v34.sqlite \
  "VACUUM INTO '/var/backups/v34app/v34-$STAMP.sqlite';"
```

**Ежедневно (cron, 03:15 UTC, хранить 14 дней):**

```cron
15 3 * * * v34app sqlite3 /opt/v34app/data/v34.sqlite ".backup '/var/backups/v34app/v34-$(date -u +\%Y\%m\%d).sqlite'" && find /var/backups/v34app -name 'v34-*.sqlite' -mtime +14 -delete
```

**Восстановление:**

```bash
sudo systemctl stop v34-app
sudo install -o v34app -g v34app -m 0640 /var/backups/v34app/v34-<STAMP>.sqlite \
     /opt/v34app/data/v34.sqlite
# WAL/SHM от старой БД удалить, иначе SQLite попытается применить чужой журнал
sudo rm -f /opt/v34app/data/v34.sqlite-wal /opt/v34app/data/v34.sqlite-shm
sudo systemctl start v34-app
curl -fsS http://127.0.0.1:8080/api/v1/health
```

Перед восстановлением полезно сохранить текущий файл: `mv v34.sqlite
v34.sqlite.before-restore`. Восстановление делается только при остановленном
сервисе — иначе два процесса пишут в один файл.

## Обновление и откат

`install.sh` можно запускать повторно: он сохраняет предыдущий релиз в
`/opt/v34app/current.previous`, не трогает `v34.env` и БД в `/opt/v34app/data`.
Перед обновлением снимите резервную копию (раздел выше).

Откат:

```bash
sudo systemctl stop v34-app
sudo mv /opt/v34app/current /opt/v34app/current.failed
sudo mv /opt/v34app/current.previous /opt/v34app/current
sudo systemctl start v34-app
curl -fsS http://127.0.0.1:8080/api/v1/health
```

## Чего здесь нет

- Автоматического деплоя из CI. Владелец запускает скрипты вручную — так проще
  контролировать доступ.
- Торговых ключей, ордеров, подключения к торговым счетам. Только публичные свечи Binance.
- Секретов. Ни `v34.env`, ни keystore, ни сервисного аккаунта в репозитории нет.
- Автоматического включения firewall: неверный порт SSH отрезает доступ к серверу.
