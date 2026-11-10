#!/usr/bin/env bash
# Установка backend'а V3.4 на НОВЫЙ VPS владельца.
#
# Запускается ТОЛЬКО вручную владельцем на сервере, под sudo. Из агентской
# сессии он не запускался: доступа к VPS в окружении разработки нет.
#
#   sudo ./install.sh v34-app-0.1.0.tar.gz --domain signals.mydomain.fi --email admin@mydomain.fi
#
# Порядок намеренно «сначала проверить, потом менять»: все проверки (бинарник
# Node из unit-файла, содержимое архива, разрешимость express/jose, домен,
# наличие nginx/certbot) выполняются ДО создания пользователей и правки
# systemd. Скрипт не считает установку успешной, пока сервис реально не ответил
# на /api/v1/health, и не включает nginx-конфиг со ссылкой на несуществующий
# сертификат.
#
# HTTPS — единственный способ публикации API. Порт 80 отдаёт только ACME и
# редирект; backend слушает 127.0.0.1 и наружу не выставляется.
#
# Firewall скрипт сам НЕ включает: `ufw --force enable` в незнакомой
# конфигурации обрывает доступ по SSH. Правила добавляются только с явным
# флагом --firewall, а включение — только с --firewall-enable.
set -euo pipefail

APP_USER="v34app"
APP_ROOT="/opt/v34app"
ENV_DIR="/etc/v34-app"
ACME_WEBROOT="/var/www/certbot"
NGINX_AVAILABLE="/etc/nginx/sites-available"
NGINX_ENABLED="/etc/nginx/sites-enabled"

ARCHIVE=""
DOMAIN=""
EMAIL=""
WANT_NGINX=1
WANT_FIREWALL=0
ENABLE_FIREWALL=0
SKIP_DNS_CHECK=0
die() { echo "ОШИБКА: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }
warn() { echo "ВНИМАНИЕ: $*" >&2; }

usage() {
  cat >&2 <<'EOF'
usage: sudo ./install.sh <архив.tar.gz> --domain <домен> --email <почта> [опции]

  --domain <домен>     публичный домен для HTTPS (обязателен без --no-nginx)
  --email <почта>      почта для Let's Encrypt (обязательна без --no-nginx)
  --no-nginx           не настраивать nginx/HTTPS: API останется только на
                       127.0.0.1 и НЕ будет опубликован
  --skip-dns-check     не проверять, что домен уже резолвится (certbot всё
                       равно потребует рабочий DNS)
  --firewall           только ДОБАВИТЬ правила ufw (80/443 + реально
                       слушающий порт SSH); ufw не включается
  --firewall-enable    включить ufw после --firewall (явное решение владельца)
  -h, --help           эта справка

Архив собирается на машине разработчика: ./deploy/make-release.sh
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) [[ $# -ge 2 ]] || die "--domain требует значение"; DOMAIN="$2"; shift 2 ;;
    --domain=*) DOMAIN="${1#*=}"; shift ;;
    --email) [[ $# -ge 2 ]] || die "--email требует значение"; EMAIL="$2"; shift 2 ;;
    --email=*) EMAIL="${1#*=}"; shift ;;
    --no-nginx) WANT_NGINX=0; shift ;;
    --skip-dns-check) SKIP_DNS_CHECK=1; shift ;;
    --firewall) WANT_FIREWALL=1; shift ;;
    --firewall-enable) WANT_FIREWALL=1; ENABLE_FIREWALL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) die "неизвестная опция: $1 (см. --help)" ;;
    *)
      [[ -z "$ARCHIVE" ]] || die "лишний аргумент: $1"
      ARCHIVE="$1"; shift ;;
  esac
done

# ── Проверки ДО любых изменений в системе ────────────────────────────────────
step "проверки окружения"
[[ $EUID -eq 0 ]] || die "запускать через sudo"
[[ -n "$ARCHIVE" ]] || { usage; exit 1; }
[[ -f "$ARCHIVE" && -r "$ARCHIVE" ]] || die "архив не найден: $ARCHIVE"
command -v tar >/dev/null || die "нужен tar"
command -v systemctl >/dev/null || die "нужен systemd (systemctl не найден)"

# systemd-юнит запускает ИМЕННО /usr/bin/node. Проверяем тот же бинарник, а не
# «какой-нибудь node из PATH» (nvm/volta у root не видны сервису).
NODE_BIN="/usr/bin/node"
[[ -x "$NODE_BIN" ]] || die "нет $NODE_BIN: юнит запускает именно его. Установите Node >= 22.5 системно (NodeSource/apt), а не через nvm"
NODE_VERSION="$("$NODE_BIN" -v 2>/dev/null || true)"
[[ -n "$NODE_VERSION" ]] || die "$NODE_BIN не запускается"
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[1]')"
(( NODE_MAJOR > 22 || (NODE_MAJOR == 22 && NODE_MINOR >= 5) )) || die "нужен Node >= 22.5 в $NODE_BIN (сейчас $NODE_VERSION): node:sqlite"
command -v curl >/dev/null || die "нужен curl (проверка здоровья сервиса и HTTPS)"

if (( WANT_NGINX == 1 )); then
  command -v nginx >/dev/null || die "nginx не установлен: apt install nginx (или запустите с --no-nginx, тогда API не будет опубликован)"
  command -v certbot >/dev/null || die "certbot не установлен: apt install certbot (или --no-nginx)"
  [[ -d "$NGINX_AVAILABLE" && -d "$NGINX_ENABLED" ]] || die "нет $NGINX_AVAILABLE: нестандартная установка nginx, настройте вручную"
  [[ -n "$DOMAIN" ]] || die "--domain обязателен: HTTPS — единственный способ публикации API"
  [[ -n "$EMAIL" ]] || die "--email обязателен для Let's Encrypt"
  [[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] \
    || die "домен должен быть строчным FQDN без схемы и пробелов: $DOMAIN"
  case "$DOMAIN" in
    example.com|*.example.com|example.org|*.example.org|example.net|*.example.net|*.*.example|localhost|*.local)
      die "домен-заглушка ($DOMAIN): укажите реальный домен — с ним выпускается сертификат" ;;
  esac
  [[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || die "некорректная почта: $EMAIL"

  # DNS проверяем ДО правки nginx: без резолва ACME не пройдёт.
  if (( SKIP_DNS_CHECK == 1 )); then
    warn "проверка DNS пропущена (--skip-dns-check)"
  elif command -v getent >/dev/null; then
    getent ahostsv4 "$DOMAIN" >/dev/null 2>&1 \
      || die "$DOMAIN не резолвится в IPv4 на этом сервере: сначала направьте A-запись на него (или --skip-dns-check)"
  fi
fi

# Содержимое архива проверяем ДО распаковки в /opt: раскладка ровно та, что
# ждёт unit-файл (current/dist/server.mjs) и внешние зависимости в корне.
step "проверка архива"
TAR_LIST="$(tar -tzf "$ARCHIVE")" || die "архив не читается: $ARCHIVE"
TOP=""
for entry in dist/server.mjs dist/scan-once.mjs landing/index.html package.json \
             node_modules/express/package.json node_modules/jose/package.json; do
  if grep -qx "\([^/]*/\)\?$entry" <<<"$TAR_LIST"; then
    continue
  fi
  die "в архиве нет $entry — пересоберите ./deploy/make-release.sh"
done
TOP="$(grep -o '^[^/]*/dist/server.mjs$' <<<"$TAR_LIST" | head -1 | cut -d/ -f1 || true)"
if [[ -n "$TOP" && "$TOP" != "dist" ]]; then
  warn "архив с корневым каталогом «$TOP/» — он будет снят при распаковке"
else
  TOP=""
fi

# ── Изменения в системе ─────────────────────────────────────────────────────
step "пользователь и каталоги"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_ROOT" --shell /usr/sbin/nologin "$APP_USER"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_ROOT"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_ROOT/data"
install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$APP_ROOT/apk"
install -d -o root -g "$APP_USER" -m 0750 "$ENV_DIR"

step "распаковка релиза"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
tar -xzf "$ARCHIVE" -C "$STAGE"
if [[ -n "$TOP" ]]; then
  SRC="$STAGE/$TOP"
else
  SRC="$STAGE"
fi
[[ -f "$SRC/dist/server.mjs" ]] || die "после распаковки нет dist/server.mjs"

# Обломки предыдущей неудачной попытки не должны попасть в новый релиз.
rm -rf "$APP_ROOT/current.new"
install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$APP_ROOT/current.new"
cp -a "$SRC"/. "$APP_ROOT/current.new"/
for f in dist/server.mjs package.json node_modules/express/package.json node_modules/jose/package.json landing/index.html; do
  [[ -e "$APP_ROOT/current.new/$f" ]] || die "в релизе отсутствует $f (ожидаемая раскладка: dist/, landing/, node_modules/)"
done

# Та же проверка, что и при упаковке, но уже на месте установки: express/jose
# должны разрешаться ИЗ dist/server.mjs, а не из рабочей копии разработчика.
PROBE="$APP_ROOT/current.new/dist/__probe.mjs"
printf "import 'express';\nimport 'jose';\n" > "$PROBE"
chown "$APP_USER:$APP_USER" "$PROBE"
( cd "$APP_ROOT/current.new" && "$NODE_BIN" dist/__probe.mjs ) \
  || die "express/jose не разрешаются из $APP_ROOT/current.new/dist — релиз собран неверно"
rm -f "$PROBE"

chown -R "$APP_USER:$APP_USER" "$APP_ROOT/current.new"
if [[ -d "$APP_ROOT/current" ]]; then
  rm -rf "$APP_ROOT/current.previous"
  mv "$APP_ROOT/current" "$APP_ROOT/current.previous"
fi
mv "$APP_ROOT/current.new" "$APP_ROOT/current"

step "конфигурация"
if [[ ! -f "$ENV_DIR/v34.env" ]]; then
  install -o root -g "$APP_USER" -m 0640 "$(dirname "$0")/v34.env.example" "$ENV_DIR/v34.env"
  echo "создан $ENV_DIR/v34.env — при необходимости отредактируйте (backend слушает 127.0.0.1)"
fi
if [[ ! -f "$ENV_DIR/fcm-service-account.json" ]]; then
  echo "FCM не настроен: push останется выключенным (configured:false) — это штатное состояние"
fi

step "systemd"
UNIT_SRC="$(dirname "$0")/v34-app.service"
[[ -f "$UNIT_SRC" ]] || die "рядом со скриптом нет v34-app.service"
grep -q "^ExecStart=$NODE_BIN $APP_ROOT/current/dist/server.mjs$" "$UNIT_SRC" \
  || die "unit-файл не совпадает с раскладкой: ожидается ExecStart=$NODE_BIN $APP_ROOT/current/dist/server.mjs"
install -m 0644 "$UNIT_SRC" /etc/systemd/system/v34-app.service
systemctl daemon-reload
systemctl enable v34-app.service >/dev/null
systemctl restart v34-app.service

APP_PORT="$(grep -E '^V34_PORT=' "$ENV_DIR/v34.env" | tail -1 | cut -d= -f2 || true)"
APP_PORT="${APP_PORT:-8080}"

# Сервис обязан РЕАЛЬНО подняться. Раньше здесь стояло `systemctl status || true`,
# и падение сервиса выглядело как успешная установка.
wait_health() {
  local deadline=$((SECONDS + 40))
  while (( SECONDS < deadline )); do
    if ! systemctl is-active --quiet v34-app.service; then
      return 1
    fi
    if curl -fsS --max-time 2 "http://127.0.0.1:$APP_PORT/api/v1/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}
if ! wait_health; then
  echo "--- журнал v34-app ---" >&2
  systemctl --no-pager --lines=50 status v34-app.service >&2 || true
  journalctl -u v34-app.service --no-pager -n 80 >&2 || true
  die "сервис не ответил на http://127.0.0.1:$APP_PORT/api/v1/health — установка НЕ завершена"
fi
echo "backend отвечает: http://127.0.0.1:$APP_PORT/api/v1/health"

if (( WANT_NGINX == 0 )); then
  warn "nginx не настраивался (--no-nginx): API доступен только локально и НЕ опубликован"
else
  step "HTTPS: ACME → сертификат → TLS-конфиг"
  install -m 0644 "$(dirname "$0")/limits.conf" /etc/nginx/conf.d/v34-limits.conf
  install -d -m 0755 "$ACME_WEBROOT/.well-known/acme-challenge"

  # 1) Временный конфиг ТОЛЬКО для ACME: без сертификата и без API.
  ACME_CONF="$NGINX_AVAILABLE/v34-app-acme.conf"
  FINAL_CONF="$NGINX_AVAILABLE/v34-app.conf"
  cat > "$ACME_CONF" <<EOF
# Временный конфиг выпуска сертификата (создан install.sh, удаляется после).
# Порт 80 отдаёт только ACME-челлендж; API по HTTP не публикуется.
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location /.well-known/acme-challenge/ {
        root $ACME_WEBROOT;
        default_type text/plain;
    }

    location / {
        default_type text/plain;
        return 503 "HTTPS ещё не настроен\n";
    }
}
EOF

  enable_conf() {
    local conf="$1" link="$2"
    ln -sfn "$conf" "$link"
    if ! nginx -t 2>/tmp/v34-nginx-test.err; then
      cat /tmp/v34-nginx-test.err >&2
      rm -f "$link"
      return 1
    fi
    if ! systemctl reload nginx; then
      rm -f "$link"
      return 1
    fi
  }

  ACME_ENABLED_PATH="$NGINX_ENABLED/v34-app-acme.conf"
  if ! enable_conf "$ACME_CONF" "$ACME_ENABLED_PATH"; then
    rm -f "$ACME_CONF" "$ACME_ENABLED_PATH"
    die "nginx -t не принял ACME-конфиг: ничего не включено, reload не выполнялся"
  fi
  # Локальная проверка, что челлендж реально отдаётся с этого хоста.
  PROBE_FILE="$ACME_WEBROOT/.well-known/acme-challenge/__v34_probe"
  echo ok > "$PROBE_FILE"
  chmod 0644 "$PROBE_FILE"
  if ! curl -fsS --max-time 5 -H "Host: $DOMAIN" "http://127.0.0.1/.well-known/acme-challenge/__v34_probe" >/dev/null; then
    rm -f "$PROBE_FILE"
    rm -f "$ACME_ENABLED_PATH"
    systemctl reload nginx || true
    die "ACME-челлендж не отдаётся локально: проверьте, что nginx слушает 80 и домен указывает на этот сервер"
  fi
  rm -f "$PROBE_FILE"

  CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
  if [[ -f "$CERT_DIR/fullchain.pem" && -f "$CERT_DIR/privkey.pem" ]]; then
    echo "сертификат для $DOMAIN уже существует — выпуск пропущен"
  else
    # 2) Выпуск сертификата по http-01 через webroot. Никакого --nginx.
    if ! certbot certonly --webroot --webroot-path "$ACME_WEBROOT" \
        -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --keep-until-expiring; then
      die "certbot не выпустил сертификат. Порт 80 остаётся в ACME-режиме (API не опубликован). Проверьте DNS/доступность 80 и повторите."
    fi
  fi
  [[ -f "$CERT_DIR/fullchain.pem" && -f "$CERT_DIR/privkey.pem" ]] \
    || die "certbot завершился без файлов сертификата в $CERT_DIR — TLS-конфиг не включаю"

  # 3) Постоянный TLS-конфиг: шаблон с подставленным доменом.
  sed "s|__DOMAIN__|$DOMAIN|g" "$(dirname "$0")/nginx-v34-app.conf" > "$FINAL_CONF"
  chmod 0644 "$FINAL_CONF"
  FINAL_ENABLED="$NGINX_ENABLED/v34-app.conf"
  # Два server{} с одним server_name на 80 одновременно не нужны: снимаем
  # ACME-симлинк перед включением TLS-конфига.
  rm -f "$ACME_ENABLED_PATH"
  if ! enable_conf "$FINAL_CONF" "$FINAL_ENABLED"; then
    rm -f "$FINAL_ENABLED"
    ln -sfn "$ACME_CONF" "$ACME_ENABLED_PATH"
    die "nginx -t не принял TLS-конфиг: он НЕ включён, reload не выполнялся; ACME-конфиг оставлен активным"
  fi

  # 4) Проверяем HTTPS локально (до открытия порта наружу).
  if ! curl -fsS --max-time 10 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/v1/health" >/dev/null; then
    die "HTTPS не отвечает локально. Конфиг включён, но публикацию считать успешной нельзя: проверьте nginx -t, журнал /var/log/nginx/v34-app.error.log"
  fi
  # ACME-конфиг больше не нужен: продление идёт через location в основном конфиге.
  rm -f "$ACME_ENABLED_PATH" "$ACME_CONF"
  nginx -t
  systemctl reload nginx
  echo "HTTPS работает: https://$DOMAIN/api/v1/health"
fi

step "firewall"
if (( WANT_FIREWALL == 0 )); then
  echo "ufw НЕ изменялся (это осознанно: включение ufw с неверным портом SSH отрезает доступ)."
  echo "Проверьте свой порт SSH и добавьте правила вручную, например:"
  SSHD_PORTS="$(grep -hiE '^[[:space:]]*Port[[:space:]]+[0-9]+' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null | awk '{print $2}' | sort -u | tr '\n' ' ' || true)"
  SSHD_PORTS="${SSHD_PORTS:-22}"
  for p in $SSHD_PORTS; do
    echo "  ufw allow $p/tcp    # SSH"
  done
  echo "  ufw allow 80/tcp"
  echo "  ufw allow 443/tcp"
  echo "  ufw enable          # только после проверки порта SSH"
  echo "Порт backend'а ($APP_PORT) наружу НЕ открывается: доступ только через HTTPS-proxy."
elif command -v ufw >/dev/null; then
  # Порт(ы) SSH берём из фактической конфигурации sshd, а если её прочитать
  # нельзя — из реально слушающих сокетов sshd. При сомнении отказываемся:
  # «наверное, 22» — это способ закрыть себе доступ.
  SSH_LISTEN=""
  if command -v sshd >/dev/null && sshd -T >/dev/null 2>&1; then
    SSH_LISTEN="$(sshd -T 2>/dev/null | awk '/^port /{print $2}' | sort -u | tr '\n' ' ')"
  fi
  if [[ -z "${SSH_LISTEN// /}" ]]; then
    SSH_LISTEN="$(ss -ltnpH 2>/dev/null | awk '$0 ~ /sshd/ {print $4}' \
      | sed -E 's/.*:([0-9]+)$/\1/' | sort -u | tr '\n' ' ')"
  fi
  [[ -n "${SSH_LISTEN// /}" ]] || die "не удалось определить слушающий порт SSH: включение ufw опасно. Добавьте правила вручную"
  for p in $SSH_LISTEN; do
    ufw allow "$p/tcp" comment 'ssh (detected)'
  done
  ufw allow 80/tcp comment 'http/acme'
  ufw allow 443/tcp comment 'https'
  ufw status verbose
  if (( ENABLE_FIREWALL == 1 )); then
    echo "включаю ufw (явный флаг --firewall-enable, SSH-порты выше уже разрешены)"
    ufw --force enable
    ufw status verbose
  else
    echo "правила добавлены, ufw НЕ включён (для включения: --firewall-enable)"
  fi
else
  die "ufw не установлен, но запрошен --firewall"
fi

step "готово"
echo "Сервис:  systemctl status v34-app"
echo "Логи:    journalctl -u v34-app -f"
echo "Backend: http://127.0.0.1:$APP_PORT (только loopback)"
if (( WANT_NGINX == 1 )); then
  echo "Публично: https://$DOMAIN"
  echo "Проверка: curl -fsS https://$DOMAIN/api/v1/health"
else
  echo "Публикации нет (--no-nginx): API доступен только локально."
fi
echo "Первый скан идёт через V34_SCAN_INITIAL_DELAY_MS; до него /api/v1/signals отдаёт stale:true — это ожидаемо."
echo "Резервная копия БД: sqlite3 $APP_ROOT/data/v34.sqlite \".backup '/var/backups/v34-\\$(date +%F).sqlite'\""
