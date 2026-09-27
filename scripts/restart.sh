#!/usr/bin/env bash
# ==============================================================================
# CRYPTORA Operations: restart.sh
# Supported production backend path: exactly one systemd `cryptora.service`
# running server/index.js. No legacy productionServer.js fallback exists.
#
# A restart re-runs the idempotent migration runner before handing control to
# systemd. This prevents a supported release path from starting Radar code
# against a database that is missing migration 012.
# ==============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ "${CRYPTORA_DB_BACKUP_CONFIRMED:-}" != "YES" ]]; then
  echo "ERROR: take and verify a PostgreSQL backup before a production restart; then set CRYPTORA_DB_BACKUP_CONFIRMED=YES." >&2
  exit 2
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "ERROR: production restart requires systemd cryptora.service; refusing legacy fallback." >&2
  exit 2
fi

if ! systemctl cat cryptora >/dev/null 2>&1; then
  echo "ERROR: cryptora.service is not installed; refusing to start a standalone legacy server." >&2
  exit 2
fi

echo "Verifying/applying pending migrations before supported restart..."
npm run migrate

echo "Restarting supported CRYPTORA backend service..."
sudo systemctl restart cryptora
sudo systemctl is-active --quiet cryptora
echo "Systemd service 'cryptora' is active (server/index.js)."
