#!/usr/bin/env bash
# ==============================================================================
# CRYPTORA Operations: update.sh
# Supported production release path: exact approved commit -> migration -> build
# -> systemd restart. This script intentionally has no legacy standalone-server
# fallback.
# ==============================================================================
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: CRYPTORA_DB_BACKUP_CONFIRMED=YES $0 <approved-commit-sha>" >&2
  exit 2
fi

APPROVED_SHA="$1"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ "${CRYPTORA_DB_BACKUP_CONFIRMED:-}" != "YES" ]]; then
  echo "ERROR: take and verify the production PostgreSQL backup before updating." >&2
  exit 2
fi

if ! git diff --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  echo "ERROR: deployment checkout is not clean; refusing to replace it." >&2
  exit 2
fi

echo "Fetching approved release object..."
git fetch origin --tags
if ! git rev-parse --verify --quiet "${APPROVED_SHA}^{commit}" >/dev/null; then
  echo "ERROR: approved commit is not available after git fetch: $APPROVED_SHA" >&2
  exit 2
fi

# A detached, immutable release SHA prevents a branch-tip race between approval
# and deployment. The exact SHA is recorded in the release log below.
git checkout --detach "$APPROVED_SHA"
ACTUAL_SHA="$(git rev-parse HEAD)"
echo "Preparing approved commit: $ACTUAL_SHA"

./scripts/deploy.sh

# deploy.sh has completed npm run migrate before this restart can occur.
./scripts/restart.sh

echo "Update complete for approved commit $ACTUAL_SHA. Run the health/Radar verification steps in docs/DEPLOYMENT.md."
