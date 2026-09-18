#!/usr/bin/env bash
# ==============================================================================
# CRYPTORA Operations: logs.sh
# Streams or displays production logs
# ==============================================================================
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINES="${1:-50}"

if command -v journalctl >/dev/null 2>&1 && systemctl is-active --quiet cryptora 2>/dev/null; then
    journalctl -u cryptora -n "$LINES" --no-pager
elif [ -f "$REPO_ROOT/server.log" ]; then
    tail -n "$LINES" "$REPO_ROOT/server.log"
else
    echo "No log file found at $REPO_ROOT/server.log and systemd unit not active."
fi
