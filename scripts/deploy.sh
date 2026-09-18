#!/usr/bin/env bash
# ==============================================================================
# CRYPTORA Operations: deploy.sh
# Production build and deployment validation script
# ==============================================================================
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "======================================================="
echo "  CRYPTORA Deployment Pipeline Starting"
echo "  Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "  Directory: $REPO_ROOT"
echo "======================================================="

# 1. Dependency check
echo "[1/4] Checking and installing dependencies..."
npm ci

# 2. Quality Gates: Typecheck & Tests
echo "[2/4] Running Quality Gates (TypeScript + Unit Tests)..."
npm run typecheck
npm test

# 3. Production Build
echo "[3/4] Compiling production build (dist/)..."
npm run build

# 4. Verification
if [ ! -f "$REPO_ROOT/dist/index.html" ]; then
    echo "ERROR: dist/index.html was not generated!" >&2
    exit 1
fi

echo "[4/4] Production assets verified successfully."
echo "Deployment build complete. Run ./scripts/restart.sh to apply."
