#!/usr/bin/env bash
# Публикация собранного APK: копирует файл в каталог раздачи и пишет манифест,
# из которого лендинг и /api/v1/apk берут версию, размер и SHA-256.
#
# Использование:
#   sudo ./publish-apk.sh /path/to/app-release.apk 0.1.0 --release-key
#   sudo ./publish-apk.sh /path/to/app-debug.apk   0.1.0            # проверочная сборка
#
# --release-key ставится ТОЛЬКО если APK подписан релизным ключом владельца.
# Скрипт не хранит ключей и паролей и не подписывает APK: подпись выполняется
# владельцем/EAS заранее.
set -euo pipefail

APK_DIR="${V34_APK_DIR:-/opt/v34app/apk}"
APK_SRC="${1:-}"
VERSION="${2:-}"
SIGNED="false"
for arg in "${@:3}"; do
  [[ "$arg" == "--release-key" ]] && SIGNED="true"
done

if [[ -z "$APK_SRC" || ! -f "$APK_SRC" ]]; then
  echo "usage: publish-apk.sh <file.apk> <version> [--release-key]" >&2
  exit 1
fi
if [[ -z "$VERSION" ]]; then
  echo "нужна версия (например 0.1.0)" >&2
  exit 1
fi

mkdir -p "$APK_DIR"
FILE_NAME="cryptora-v34-${VERSION}$([[ "$SIGNED" == "true" ]] || echo '-debug').apk"
install -m 0644 "$APK_SRC" "$APK_DIR/$FILE_NAME"
SHA256="$(sha256sum "$APK_DIR/$FILE_NAME" | awk '{print $1}')"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > "$APK_DIR/manifest.json" <<JSON
{
  "fileName": "$FILE_NAME",
  "version": "$VERSION",
  "sha256": "$SHA256",
  "builtAt": "$BUILT_AT",
  "signedWithReleaseKey": $SIGNED
}
JSON
chmod 0644 "$APK_DIR/manifest.json"

echo "опубликовано: $APK_DIR/$FILE_NAME"
echo "sha256: $SHA256"
echo "signedWithReleaseKey: $SIGNED"
echo "проверьте: curl -fsS http://127.0.0.1:8080/api/v1/apk"
