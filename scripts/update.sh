#!/usr/bin/env bash
# ==============================================================================
# CRYPTORA Operations: update.sh
# Pulls git updates and runs deployment pipeline
# ==============================================================================
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "Fetching latest changes from Git..."
git fetch origin
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Current branch: $CURRENT_BRANCH"

git pull origin "$CURRENT_BRANCH"

echo "Executing deployment build..."
./scripts/deploy.sh

echo "Restarting service..."
./scripts/restart.sh

echo "Update and deployment complete!"
