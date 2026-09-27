#!/usr/bin/env bash
# ==============================================================================
# CRYPTORA Operations: logs.sh
# Supported production logs: one systemd cryptora.service running server/index.
# ==============================================================================
set -euo pipefail

LINES="${1:-50}"
if ! command -v journalctl >/dev/null 2>&1 || ! systemctl cat cryptora >/dev/null 2>&1; then
  echo "ERROR: cryptora.service/journald is required for supported production logs." >&2
  exit 2
fi

journalctl -u cryptora -n "$LINES" --no-pager
