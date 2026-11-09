#!/usr/bin/env bash
# Установка backend V3.4 на НОВЫЙ VPS владельца.
#
# ВАЖНО: скрипт запускается ТОЛЬКО на VPS, вручную владельцем, под sudo.
# Из агентской сессии он не запускался и не мог быть запущен: доступ к VPS
# (alias v34-app-vps) в окружении разработки не настроен.
#
# Требования: Ubuntu 22.04/24.04, Node.js >= 22.5 (ставится отдельно),
# релизный архив собран на машине разработчика (npm ci && npm run build).
set -euo pipefail

APP_USER="v34app"
APP_ROOT="/opt/v34app"
ENV_DIR="/etc/v34-app"
RELEASE_ARCHIVE="${1:-}"

if [[ $EUID -ne 0 ]]; then
  echo "запускать через sudo" >&2
  exit 1
fi
if [[ -z "$RELEASE_ARCHIVE" || ! -f "$RELEASE_ARCHIVE" ]]; then
  echo "usage: sudo ./install.sh /path/to/v34-app-release.tar.gz" >&2
  echo "архив собирается на машине разработчика: npm ci && npm run build && tar -czf ..." >&2
  exit 1
fi
if ! command -v node >/dev/null; then
  echo "Node.js не найден: установите Node >= 22.5 (NodeSource или nvm для системного пользователя)" >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"
if (( NODE_MAJOR < 22 || (NODE_MAJOR == 22 && NODE_MINOR < 5) )); then
  echo "нужен Node >= 22.5 (сейчас $(node -v)): node:sqlite" >&2
  exit 1
fi

echo "== пользователь и каталоги =="
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_ROOT" --shell /usr/sbin/nologin "$APP_USER"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_ROOT"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_ROOT/data"
install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$APP_ROOT/apk"
install -d -o root -g "$APP_USER" -m 0750 "$ENV_DIR"

echo "== распаковка релиза =="
STAGE="$(mktemp -d)"
tar -xzf "$RELEASE_ARCHIVE" -C "$STAGE"
# Архив содержит dist/, landing/, package.json, package-lock.json, node_modules (prod).
install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$APP_ROOT/current.new"
cp -a "$STAGE"/. "$APP_ROOT/current.new"/
chown -R "$APP_USER:$APP_USER" "$APP_ROOT/current.new"
if [[ -d "$APP_ROOT/current" ]]; then
  rm -rf "$APP_ROOT/current.previous"
  mv "$APP_ROOT/current" "$APP_ROOT/current.previous"
fi
mv "$APP_ROOT/current.new" "$APP_ROOT/current"
rm -rf "$STAGE"

echo "== конфигурация =="
if [[ ! -f "$ENV_DIR/v34.env" ]]; then
  install -o root -g "$APP_USER" -m 0640 "$(dirname "$0")/v34.env.example" "$ENV_DIR/v34.env"
  echo "создан $ENV_DIR/v34.env — ЗАПОЛНИТЕ его перед запуском (V34_PUBLIC_BASE_URL и т.д.)"
fi
if [[ ! -f "$ENV_DIR/fcm-service-account.json" ]]; then
  echo "FCM не настроен: push останется выключенным (configured:false), это штатное состояние"
fi

echo "== systemd =="
install -m 0644 "$(dirname "$0")/v34-app.service" /etc/systemd/system/v34-app.service
systemctl daemon-reload
systemctl enable --now v34-app.service
sleep 2
systemctl --no-pager --lines=20 status v34-app.service || true

echo "== nginx =="
if command -v nginx >/dev/null; then
  install -m 0644 "$(dirname "$0")/limits.conf" /etc/nginx/conf.d/v34-limits.conf
  install -m 0644 "$(dirname "$0")/nginx-v34-app.conf" /etc/nginx/sites-available/v34-app.conf
  ln -sfn /etc/nginx/sites-available/v34-app.conf /etc/nginx/sites-enabled/v34-app.conf
  echo "ОБЯЗАТЕЛЬНО: замените server_name на реальный домен и выпустите сертификат"
  echo "  certbot --nginx -d <домен>"
  nginx -t
  systemctl reload nginx
else
  echo "nginx не установлен: поставьте и примените nginx-v34-app.conf вручную"
fi

echo "== firewall =="
if command -v ufw >/dev/null; then
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
  ufw status verbose
fi

echo
echo "Готово. Проверка с сервера:"
echo "  curl -fsS http://127.0.0.1:8080/api/v1/health"
echo "  curl -fsS http://127.0.0.1:8080/api/v1/meta | head -c 400"
echo "Первый скан выполняется через V34_SCAN_INITIAL_DELAY_MS после старта;"
echo "до него /api/v1/signals отдаёт stale:true и причину «сканов ещё не было» — это ожидаемо."
