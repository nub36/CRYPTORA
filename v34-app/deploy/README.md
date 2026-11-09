# Развёртывание продукта V3.4 на новом VPS

## Статус на текущий момент (честно)

| Что | Состояние |
|---|---|
| Код backend'а, тесты, сборка | готово и проверено локально (см. корневой `README.md`) |
| Скрипты/конфиги развёртывания | готовы, лежат в этом каталоге |
| Подключение к VPS | **не выполнялось**: SSH-alias `v34-app-vps` в рабочем окружении отсутствует, доступ не предоставлен |
| Что работает на VPS | **ничего** — сервер не разворачивался |
| Домен и HTTPS | **не настроены**: домена нет, DNS не менялся (менять без разрешения владельца нельзя) |
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
2. **Домен** (например `signals.example.com`) и разрешение на изменение DNS. Без домена
   публичного HTTPS не будет, а API регистрации устройств нельзя выставлять в интернет
   без TLS.
3. **Релизный keystore** для APK: файл `.jks` + alias + пароли — в защищённом хранилище
   владельца. Владелец либо собирает APK сам, либо передаёт keystore в CI-секреты
   (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
   `ANDROID_KEY_PASSWORD`), но не в чат и не в Git.
4. **Firebase-проект** (если нужны реальные push): `google-services.json` для сборки
   Android и JSON сервисного аккаунта для сервера — оба файла вне Git.

## Состав каталога

| Файл | Назначение | Куда ставится на VPS |
|---|---|---|
| `install.sh` | идемпотентная установка: пользователь, каталоги, systemd, nginx, ufw | запускается вручную под sudo |
| `v34-app.service` | systemd-unit с минимальными привилегиями | `/etc/systemd/system/v34-app.service` |
| `v34.env.example` | шаблон окружения без секретов | `/etc/v34-app/v34.env` (chmod 600) |
| `nginx-v34-app.conf` | reverse-proxy, редирект на HTTPS, rate-limit на `/api/v1/devices` | `/etc/nginx/sites-available/v34-app.conf` |
| `limits.conf` | зона `limit_req_zone devices` | `/etc/nginx/conf.d/v34-limits.conf` |
| `publish-apk.sh` | публикация APK + `manifest.json` со SHA-256 | запускается вручную |

## Порядок действий (когда доступ появится)

1. Собрать релизный архив **на машине разработчика** (не на VPS; тесты и сборки на VPS
   не запускаются):
   ```bash
   cd v34-app
   npm ci
   npm run build                      # esbuild → server/dist/server.mjs
   npm ci --omit=dev -w @v34/server   # prod-зависимости рядом с dist
   tar -czf /tmp/v34-app-release.tar.gz \
     server/dist server/package.json server/node_modules \
     landing package.json package-lock.json README.md
   ```
2. Скопировать архив и каталог `deploy/` на VPS:
   ```bash
   scp /tmp/v34-app-release.tar.gz v34-app-vps:/tmp/
   rsync -a deploy/ v34-app-vps:/tmp/v34-deploy/
   ```
3. На VPS:
   ```bash
   ssh v34-app-vps
   sudo /tmp/v34-deploy/install.sh /tmp/v34-app-release.tar.gz
   sudoedit /etc/v34-app/v34.env     # V34_PUBLIC_BASE_URL, каталоги, символы
   sudo systemctl restart v34-app
   curl -fsS http://127.0.0.1:8080/api/v1/health
   ```
4. Домен/HTTPS (после разрешения владельца на DNS):
   ```bash
   sudo certbot --nginx -d signals.example.com
   ```
   Затем `V34_PUBLIC_BASE_URL=https://signals.example.com` и рестарт.
5. Публикация APK (после сборки и подписи):
   ```bash
   sudo /tmp/v34-deploy/publish-apk.sh ~/cryptora-v34-0.1.0-release.apk 0.1.0 --release-key
   curl -fsS https://signals.example.com/api/v1/apk
   ```
   `--release-key` указывается только для APK, подписанного релизным ключом владельца.
   Для проверочной сборки флаг не ставится: лендинг покажет её как неподписанную.
6. Firebase (если нужны push):
   ```bash
   sudo install -o root -g v34app -m 0640 fcm-service-account.json /etc/v34-app/
   # в v34.env:
   # V34_PUSH_ENABLED=true
   # V34_FCM_PROJECT_ID=<project-id>
   # V34_FCM_SERVICE_ACCOUNT_FILE=/etc/v34-app/fcm-service-account.json
   sudo systemctl restart v34-app
   curl -fsS https://signals.example.com/api/v1/meta | jq .push
   ```
   `configured:true` означает только «сервер готов отправлять». Фактическая доставка
   проверяется отдельно на реальном устройстве, и без Firebase её проверить нельзя.

## Проверка после развёртывания

```bash
curl -fsS https://signals.example.com/api/v1/health
curl -fsS https://signals.example.com/api/v1/meta   | jq '{engine: .engine.dataStatus, push: .push.configured}'
curl -fsS https://signals.example.com/api/v1/signals | jq '{count, stale, staleReason}'
curl -fsS https://signals.example.com/api/v1/apk     | jq .
journalctl -u v34-app -n 100 --no-pager
```

Ожидаемое поведение первых минут: `stale: true` и причина «сканов ещё не было» до
первого успешного скана (первый скан запускается через `V34_SCAN_INITIAL_DELAY_MS`).

## Обновление

`install.sh` можно запускать повторно: он сохраняет предыдущий релиз в
`/opt/v34app/current.previous`, не трогает `v34.env` и БД в `/opt/v34app/data`.
Откат: остановить сервис, вернуть `current.previous` на место `current`, запустить.

## Чего здесь нет

- Автоматического деплоя из CI. Владелец запускает скрипты вручную — так проще
  контролировать доступ.
- Торговых ключей, ордеров, подключения к торговым счетам. Только публичные свечи Binance.
- Секретов. Ни `v34.env`, ни keystore, ни сервисного аккаунта в репозитории нет.
