#!/usr/bin/env bash
# ==============================================================================
# CRYPTORA Operations: deploy.sh
# Build and migration phase for an already-approved production release.
#
# This script deliberately does NOT restart the service. `scripts/update.sh`
# invokes it before the systemd-only restart, so migration 012 can never be
# skipped on the supported deployment path.
# ==============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ "${CRYPTORA_DB_BACKUP_CONFIRMED:-}" != "YES" ]]; then
  echo "ERROR: take and verify a PostgreSQL backup first, then rerun with CRYPTORA_DB_BACKUP_CONFIRMED=YES." >&2
  echo "See docs/DEPLOYMENT.md: approved SHA -> npm ci -> npm run migrate -> build -> systemd restart." >&2
  exit 2
fi

echo "======================================================="
echo "  CRYPTORA Approved Release Preparation"
echo "  Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "  Directory: $REPO_ROOT"
echo "  Commit:    $(git rev-parse HEAD)"
echo "======================================================="

# 1. Dependency check (includes the production `ws` dependency used by Radar).
echo "[1/5] Installing locked dependencies..."
npm ci

# 2. Migrations MUST happen before the new server can write/read radar_events.
# The runner is idempotent: schema_migrations skips already-applied files.
echo "[2/5] Applying pending PostgreSQL migrations before any restart..."
npm run migrate

# 3. Quality gates.
echo "[3/5] Running quality gates (TypeScript + tests)..."
npm run typecheck
npm test

# 4. Production build. Nginx serves $REPO_ROOT/dist in the supported topology.
echo "[4/5] Compiling production assets (dist/)..."
npm run build

# 5. Verification. Publication/restart are explicit follow-up operations.
if [[ ! -f "$REPO_ROOT/dist/index.html" ]]; then
  echo "ERROR: dist/index.html was not generated!" >&2
  exit 1
fi

echo "[5/5] Release prepared. Publish frontend assets, verify, then run systemd restart only."
