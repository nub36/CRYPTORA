#!/usr/bin/env bash
# ==============================================================================
# CRYPTORA Operations: status.sh
# Check health, process state, and network listener
# ==============================================================================
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3000}"

echo "======================================================="
echo "  CRYPTORA Production Status"
echo "  Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "======================================================="

# Check systemd status if systemctl is available
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet cryptora 2>/dev/null; then
    echo "• Systemd Service: ACTIVE (running)"
    systemctl status cryptora --no-pager | head -n 10
else
    echo "• Systemd Service: Inactive or not installed"
fi

# Check Node process
NODE_PIDS=$(pgrep -f "productionServer.js" || true)
if [ -n "$NODE_PIDS" ]; then
    echo "• Production Node Process: RUNNING (PID: $NODE_PIDS)"
else
    echo "• Production Node Process: NOT FOUND"
fi

# Test Health Endpoint
echo "• Health Endpoint Check (http://127.0.0.1:$PORT/api/health):"
if command -v curl >/dev/null 2>&1; then
    HEALTH_RESP=$(curl -s --max-time 3 "http://127.0.0.1:$PORT/api/health" || true)
    if [ -n "$HEALTH_RESP" ]; then
        echo "  Response: $HEALTH_RESP"
    else
        echo "  Endpoint unreachable on port $PORT"
    fi
fi
