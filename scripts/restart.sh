#!/usr/bin/env bash
# ==============================================================================
# CRYPTORA Operations: restart.sh
# Gracefully restarts the CRYPTORA production service or standalone process
# ==============================================================================
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "Restarting CRYPTORA service..."

if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet cryptora 2>/dev/null; then
    sudo systemctl restart cryptora
    echo "Systemd service 'cryptora' restarted successfully."
else
    # Fallback for non-systemd environments (kills existing process and relaunches)
    OLD_PIDS=$(pgrep -f "productionServer.js" || true)
    if [ -n "$OLD_PIDS" ]; then
        echo "Terminating existing Node server process (PID: $OLD_PIDS)..."
        kill -15 $OLD_PIDS 2>/dev/null || true
        sleep 1
    fi
    echo "Starting productionServer.js in background..."
    nohup node "$REPO_ROOT/server/productionServer.js" > "$REPO_ROOT/server.log" 2>&1 &
    sleep 1
    echo "CRYPTORA production server restarted (PID: $(pgrep -f 'productionServer.js' || echo 'unknown'))."
fi
