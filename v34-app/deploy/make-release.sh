#!/usr/bin/env bash
# Сборка релизного архива backend'а V3.4 и его ПРОВЕРКА.
#
# Запускается на машине разработчика (не на VPS):
#   ./deploy/make-release.sh [выходной-каталог]
#
# Что делает:
#   1. собирает сервер (esbuild → dist/server.mjs);
#   2. складывает в ОДИН корень всё, что нужно на сервере:
#        dist/server.mjs, landing/, package.json, node_modules (ТОЛЬКО prod);
#   3. проверяет, что `express` и `jose` реально разрешаются из dist/server.mjs
#      (а не «где-то в рабочей копии»);
#   4. пакует tar.gz и СРАЗУ ЖЕ распаковывает его во временный каталог,
#      поднимает сервер на временной БД и локальном порту, проверяет
#      /api/v1/health и корректную остановку по SIGTERM.
#
# Раскладка архива (совпадает с deploy/v34-app.service):
#   v34-app-release/
#     dist/server.mjs          ← ExecStart=/usr/bin/node …/current/dist/server.mjs
#     dist/server.mjs.map
#     dist/scan-once.mjs
#     landing/…                ← V34_STATIC_DIR
#     node_modules/express, node_modules/jose   ← внешние зависимости
#     package.json             ← engines/deps, НЕ workspace-манифест
#     RELEASE.json             ← версия/дата/требования (без секретов)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$HERE/.." && pwd)"
OUT_DIR=""
SMOKE=1

for arg in "$@"; do
  case "$arg" in
    --no-smoke) SMOKE=0 ;;
    -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
    -*) echo "неизвестная опция: $arg" >&2; exit 1 ;;
    *) [[ -z "$OUT_DIR" ]] || { echo "лишний аргумент: $arg" >&2; exit 1; }; OUT_DIR="$arg" ;;
  esac
done
OUT_DIR="${OUT_DIR:-$APP_ROOT/release}"

die() { echo "ОШИБКА: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }

command -v node >/dev/null || die "нужен Node.js >= 22.5"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"
(( NODE_MAJOR > 22 || (NODE_MAJOR == 22 && NODE_MINOR >= 5) )) || die "нужен Node >= 22.5 (сейчас $(node -v))"
command -v npm >/dev/null || die "нужен npm"
command -v tar >/dev/null || die "нужен tar"

VERSION="$(node -p "require('$APP_ROOT/package.json').version")"
NAME="v34-app-release"
TARBALL="$OUT_DIR/v34-app-$VERSION.tar.gz"
WORK="$(mktemp -d)"
STAGE="$WORK/$NAME"
trap 'rm -rf "$WORK"' EXIT

step "сборка сервера"
cd "$APP_ROOT"
[[ -d node_modules ]] || die "нет node_modules: выполните npm ci в $APP_ROOT"
npm run build

step "раскладка релиза"
mkdir -p "$STAGE/dist"
install -m 0644 server/dist/server.mjs "$STAGE/dist/server.mjs"
[[ -f server/dist/server.mjs.map ]] && install -m 0644 server/dist/server.mjs.map "$STAGE/dist/server.mjs.map"
install -m 0644 server/dist/scan-once.mjs "$STAGE/dist/scan-once.mjs"
[[ -d landing ]] || die "нет каталога landing/"
cp -a landing "$STAGE/landing"

# Манифест релиза — самостоятельный, без workspace-ссылок: на VPS нет монорепо.
node - "$APP_ROOT" "$STAGE" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [appRoot, stage] = process.argv.slice(2);
const rootPkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const serverPkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'server/package.json'), 'utf8'));
const deps = { ...serverPkg.dependencies };
if (!deps.express || !deps.jose) {
  console.error('ОШИБКА: server/package.json должен объявлять express и jose');
  process.exit(1);
}
const manifest = {
  name: 'cryptora-v34-app',
  version: rootPkg.version,
  private: true,
  description: 'CRYPTORA V3.4 signals backend (release bundle)',
  engines: { node: '>=22.5.0' },
  dependencies: deps,
};
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
NODE

step "production-зависимости (express, jose) в корень архива"
(
  cd "$STAGE"
  npm install --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error
)

step "проверка разрешимости зависимостей из dist/server.mjs"
for mod in express jose; do
  [[ -f "$STAGE/node_modules/$mod/package.json" ]] || die "в архиве нет node_modules/$mod"
done
PROBE="$STAGE/dist/__probe.mjs"
cat > "$PROBE" <<'PROBE_JS'
import 'express';
import 'jose';
console.log('deps-ok');
PROBE_JS
PROBE_OUT="$(cd "$STAGE" && node dist/__probe.mjs)" || { rm -f "$PROBE"; die "express/jose не разрешаются из dist/"; }
rm -f "$PROBE"
[[ "$PROBE_OUT" == "deps-ok" ]] || die "проверка зависимостей вернула: $PROBE_OUT"

# Служебные файлы, без которых архив бессмысленен.
for f in dist/server.mjs landing/index.html package.json; do
  [[ -f "$STAGE/$f" ]] || die "в архиве нет $f"
done

BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
GIT_COMMIT="$(cd "$APP_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo unknown)"
node - "$STAGE" "$VERSION" "$BUILT_AT" "$GIT_COMMIT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [stage, version, builtAt, gitCommit] = process.argv.slice(2);
const deps = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8')).dependencies;
const info = {
  app: 'cryptora-v34-app',
  version,
  builtAt,
  gitCommit,
  entry: 'dist/server.mjs',
  node: '>=22.5.0',
  runtimeDeps: deps,
  layout: { entry: 'dist/server.mjs', static: 'landing/', modules: 'node_modules/' },
  note: 'debug-APK сюда не входит; секретов в архиве нет',
};
fs.writeFileSync(path.join(stage, 'RELEASE.json'), JSON.stringify(info, null, 2) + '\n');
NODE

step "упаковка"
mkdir -p "$OUT_DIR"
rm -f "$TARBALL"
tar -czf "$TARBALL" -C "$WORK" "$NAME"
SHA="$(sha256sum "$TARBALL" | cut -d' ' -f1)"
SIZE="$(stat -c %s "$TARBALL")"
echo "архив: $TARBALL"
echo "размер: $SIZE байт"
echo "sha256: $SHA"

if (( SMOKE == 0 )); then
  echo "проверка запуска пропущена (--no-smoke)"
  exit 0
fi

step "проверка: распаковка архива и запуск сервера"
SMOKE_DIR="$(mktemp -d)"
SMOKE_PORT="${V34_SMOKE_PORT:-18080}"
cleanup_smoke() {
  [[ -n "${SMOKE_PID:-}" ]] && kill "$SMOKE_PID" 2>/dev/null || true
  rm -rf "$SMOKE_DIR"
}
trap 'cleanup_smoke; rm -rf "$WORK"' EXIT

tar -xzf "$TARBALL" -C "$SMOKE_DIR"
UNPACKED="$SMOKE_DIR/$NAME"
[[ -d "$UNPACKED" ]] || die "в архиве нет корневого каталога $NAME"
for f in dist/server.mjs node_modules/express/package.json node_modules/jose/package.json landing/index.html; do
  [[ -e "$UNPACKED/$f" ]] || die "после распаковки нет $f"
done
mkdir -p "$UNPACKED/data" "$UNPACKED/apk"

# Локальное окружение: временная БД, только loopback, без обращений в интернет
# (первый скан откладывается далеко вперёд).
(
  cd "$UNPACKED"
  V34_HOST=127.0.0.1 \
  V34_PORT="$SMOKE_PORT" \
  V34_DB_PATH="$UNPACKED/data/smoke.sqlite" \
  V34_STATIC_DIR="$UNPACKED/landing" \
  V34_APK_DIR="$UNPACKED/apk" \
  V34_SCAN_INITIAL_DELAY_MS=86400000 \
  V34_LOG_LEVEL=warn \
  NODE_OPTIONS=--experimental-sqlite \
  node dist/server.mjs > "$SMOKE_DIR/server.log" 2>&1 &
  echo $! > "$SMOKE_DIR/pid"
)
SMOKE_PID="$(cat "$SMOKE_DIR/pid")"

HEALTH_OK=0
for _ in $(seq 1 40); do
  if ! kill -0 "$SMOKE_PID" 2>/dev/null; then
    echo "--- лог сервера ---" >&2
    cat "$SMOKE_DIR/server.log" >&2
    die "сервер завершился при старте из распакованного архива"
  fi
  if curl -fsS --max-time 2 "http://127.0.0.1:$SMOKE_PORT/api/v1/health" > "$SMOKE_DIR/health.json" 2>/dev/null; then
    HEALTH_OK=1
    break
  fi
  sleep 0.5
done
if (( HEALTH_OK == 0 )); then
  echo "--- лог сервера ---" >&2
  cat "$SMOKE_DIR/server.log" >&2
  die "health не ответил за 20 с"
fi

node - "$SMOKE_DIR/health.json" <<'NODE'
const fs = require('node:fs');
const body = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (body.ok !== true || body.db !== 'ok') {
  console.error('health вернул:', body);
  process.exit(1);
}
console.log('health:', JSON.stringify(body));
NODE

# Остановка: SIGTERM должен завершить процесс за отведённое время.
kill -TERM "$SMOKE_PID"
STOPPED=0
for _ in $(seq 1 40); do
  if ! kill -0 "$SMOKE_PID" 2>/dev/null; then STOPPED=1; break; fi
  sleep 0.25
done
if (( STOPPED == 0 )); then
  kill -KILL "$SMOKE_PID" 2>/dev/null || true
  die "сервер не остановился по SIGTERM за 10 с"
fi
wait "$SMOKE_PID" 2>/dev/null || true
SMOKE_PID=""

echo
echo "ГОТОВО. Архив проверен: распаковка → старт → health → SIGTERM."
echo "Установка на VPS: sudo ./deploy/install.sh $(basename "$TARBALL") --domain <домен> --email <почта>"
