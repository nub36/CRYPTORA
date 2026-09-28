# CRYPTORA — Deploy attempt report, 2026-09-28

**Target SHA:** `a24e3bd28a544f461dbbff1a65fede69f59c1da4` (PR #30, merged 2026-09-28T09:12:30Z)

## VERDICT

**DEPLOYED: NO.** No production change was made. Nothing was written to
`/root/CRYPTORA`, `/var/www/cryptora`, the database, or `cryptora.service`.

The target SHA is **not** live. It was validated end-to-end and is ready to ship,
but this sandbox has no route to the VPS and no credentials, so publication must
be run by the owner (runbook in §5).

---

## 1. Why the deploy could not be performed (verified, not assumed)

Three independent blockers. Each was tested, not inferred.

### 1.1 No SSH credentials exist in this environment
```
~/.ssh                     -> does not exist
ssh-add -l                 -> no agent
find / -name 'id_*|*.pem'  -> only /etc/ssh host keys (this sandbox's own sshd) + CA bundles
env | grep -i ssh|deploy   -> nothing
```
There is no private key, agent, or SSH config to authenticate with.

### 1.2 Sandbox egress blocks the VPS on every port
`cryptora.duckdns.org` resolves to `89.125.24.50`. A raw TCP connect to port 22
*appears* to succeed — but that is an artifact of an allowlist proxy, proven by a
control test:

| Test | Result |
| --- | --- |
| TCP `89.125.24.50:22` | "open" |
| TCP `89.125.24.50:47119` (bogus port) | **also "open"** → proxy fakes the connect |
| `ssh -vvv root@…` | `kex_exchange_identification: Connection closed by remote host` |
| `ssh -p 443` | same failure |
| `https://cryptora.duckdns.org/` from sandbox | `SSL_ERROR_SYSCALL` |
| `http://…:80`, `http://…:3000` | empty reply / reset |
| `https://github.com`, `https://registry.npmjs.org` | **200** |

GitHub and npm are reachable; the VPS is not, on any port or protocol. The
previous agent's failure is reproducible and environmental — not a mistake.

### 1.3 No CI path to the VPS
- Repo token is read-only: `admin:false`, **`push:false`**.
- `actions/secrets` and `actions/runners` → HTTP 403 (cannot read or add a deploy key).
- The only deploy workflow, `.github/workflows/deploy.yml`, publishes to
  **GitHub Pages**, not the VPS. Its own header states production is the VPS and
  that Pages degrades auth/AI to guest mode. Running it would **not** deploy
  production, and would publish an unrelated artifact.

---

## 2. Actual current production state (read-only, verified live)

Reached via an out-of-sandbox HTTP fetch; no changes made.

```json
// GET /api/health
{"status":"ok","version":"0.9.3","node":"v22.23.2","environment":"production",
 "uptimeSeconds":8238,"database":"connected","timestamp":"2026-09-28T09:19:08Z"}
```
```
// GET /api/radar/status
source=server  running=true  lifecycle=live  universe=26/26 active
detector: 26/26 symbols warmed (20/20 observations each), warm=true
marketFeed: connected, 26 subscribed, stale=false, reconnectAttempt=0,
            source=binance-spot-ticker, lastMessage 2026-09-28T09:19:18Z
startedAt=2026-09-28T07:01:51Z   retentionDays=30   errorCode=null
```
`/api/radar/events?limit=1` returns a real persisted event (TIA VOLUME_SPIKE,
`isDemo:false`). Nginx is `nginx/1.24.0 (Ubuntu)`.

**Production is healthy.** Backend up, DB connected, Radar live and fully warmed.

### Reported production SHA
The backend exposes no commit/build endpoint, so the exact SHA **cannot be read
remotely**. It is bounded by hard evidence as **a pre-PR#30 build**, almost
certainly the previous `main` tip `cb0f16e0821b257ebb5bb898f11f13577f90dd1d`.
Run `cd /root/CRYPTORA && git rev-parse HEAD` on the VPS for the literal value.

---

## 3. Proof the target SHA is NOT live

1. **Timing.** The service started `07:01:51Z`; the target commit did not exist
   until `09:12:30Z`. The running process predates the release by ~2h11m.
2. **Missing asset.** The target SHA builds `assets/CoinDetailPage-B-cifCmo.js`
   (contains PR #30's new strings). Production returns **`404 Not Found`** for
   that exact path — and nginx serves genuine 404s for missing assets, so the
   probe is valid.
3. **Rendered UI is the old layout.** Live `/coin/XRP` still shows the inline
   control row PR #30 *deleted* (`5m 15m 30m 1h 4h 1D 1W`, `RSI MACD`,
   `Свечи Линия`, `MA вкл`, `SMA 20 / SMA 50 / SMA 200 / BB 20`) and does **not**
   contain the string PR #30 *added*: `Аналитический terminal · без исполнения сделок`.

---

## 4. Release validation performed here (target SHA, clean checkout)

| Gate | Result |
| --- | --- |
| `git rev-parse HEAD` | `a24e3bd…` — matches target, tree clean |
| `origin/main` tip | `a24e3bd…` — identical to target |
| `npm ci` | ✅ 384 packages |
| `npm run typecheck` | ✅ 0 errors |
| `npm test` | ✅ **1674/1674 passed**, 152 files |
| `npm run build` | ✅ built in 8.83s, 95 files, 2.87 MB |
| PR#30 marker in bundle | ✅ present in `CoinDetailPage-B-cifCmo.js` |

`sha256(dist/index.html) = 08c6f381b17950085f5c44abaa0c7cff6171082b0f8e11bc0329286227140333`

**Scope of PR #30 — frontend only.** Changed files: `docs/DECISIONS.md`,
`e2e/coinTerminal.spec.ts`, `e2e/timeframeHang.spec.ts`,
`src/components/common/CandleChart.tsx`, `src/components/common/ChartTerminal.tsx`,
`src/pages/CoinDetailPage.tsx`, `tests/unit/chartTerminal.test.tsx`,
`tests/unit/timeframeSwitchStability.test.tsx`.

**Zero `server/` changes and zero migrations** — independently confirms "no DB
migrations in PR #30". A DB backup/migration is therefore not required, and a
backend restart is **not** needed for correctness.

---

## 5. Runbook for the owner (frontend-only, no DB mutation)

> ⚠️ **Do not use `scripts/update.sh`, `scripts/deploy.sh`, or `scripts/restart.sh`
> for this release.** All three run `npm run migrate` against production
> PostgreSQL, which is **not authorized** here. They also assume the repo lives at
> `/home/user/CRYPTORA`, while real production is `/root/CRYPTORA` +
> `/var/www/cryptora`. The checked-in `nginx/cryptora.conf` has the same stale
> root — a pre-existing drift worth fixing separately.

```bash
set -euo pipefail
RELEASE_SHA=a24e3bd28a544f461dbbff1a65fede69f59c1da4

# ---- 0. Pre-flight (read-only) -------------------------------------------
cd /root/CRYPTORA
git status --short            # MUST be empty. If dirty: STOP, do not overwrite.
git rev-parse HEAD            # record the outgoing SHA for rollback
systemctl is-active cryptora.service
curl -fsS http://127.0.0.1:3000/api/health; echo
curl -fsS http://127.0.0.1:3000/api/radar/status | head -c 200; echo

# ---- 1. Rollback point for the live frontend -----------------------------
cp -a /var/www/cryptora "/var/www/cryptora.bak.$(date -u +%Y%m%dT%H%M%SZ)"

# ---- 2. Fetch and verify the exact approved object -----------------------
git fetch origin --tags
git rev-parse --verify "${RELEASE_SHA}^{commit}"
git checkout --detach "$RELEASE_SHA"
[ "$(git rev-parse HEAD)" = "$RELEASE_SHA" ] || { echo "SHA MISMATCH"; exit 1; }

# ---- 3. Build (NO npm run migrate — PR #30 has no migrations) ------------
npm ci
npm run typecheck
npm test
npm run build

# ---- 4. Confirm the artifact really contains PR #30 ----------------------
grep -l "Аналитический terminal" dist/assets/*.js   # must match a chunk

# ---- 5. Publish static frontend to the real nginx root -------------------
rsync -a --delete --delay-updates dist/ /var/www/cryptora/

# ---- 6. Verify in production --------------------------------------------
curl -fsS http://127.0.0.1:3000/api/health; echo
curl -fsS http://127.0.0.1:3000/api/radar/status | head -c 200; echo
grep -l "Аналитический terminal" /var/www/cryptora/assets/*.js
curl -fsS https://cryptora.duckdns.org/coin/XRP -o /dev/null -w 'XRP page: %{http_code}\n'
journalctl -u cryptora.service -n 50 --no-pager
```

Then hard-reload `https://cryptora.duckdns.org/coin/XRP` and confirm the header
reads **`Аналитический terminal · без исполнения сделок`** and the chart controls
are inside the new terminal toolbar.

### Do you need to restart `cryptora.service`?
**No.** PR #30 changes no backend file, and nginx serves the static frontend
directly. Restarting would reset the process-local RadarMonitor: `lifecycle`
drops from `live` to `warming` and all 26 symbols must re-warm (20 observations
each) — a real, avoidable availability cost for zero benefit. Restart only if
policy demands it, and expect `warming` for several minutes.

### Rollback
```bash
rsync -a --delete "/var/www/cryptora.bak.<TIMESTAMP>/" /var/www/cryptora/
# and, if the checkout was moved:
cd /root/CRYPTORA && git checkout --detach <PREVIOUS_SHA>
```

---

## 6. Checklist status

| Item | Status |
| --- | --- |
| SSH to VPS established | ❌ impossible from this sandbox (§1) |
| Pre-deploy read-only checks on VPS | ❌ not runnable (no SSH); done remotely over HTTPS instead (§2) |
| Actual production SHA reported | ⚠️ pre-PR#30 build; exact SHA needs one command on the VPS (§2) |
| Target SHA verified vs `origin/main` | ✅ identical |
| No DB migrations in PR #30 | ✅ independently confirmed |
| Production DB mutated | ✅ no — nothing was touched |
| Target SHA published | ❌ **NO** |
| Production verification after deploy | ⛔ N/A — no deploy occurred |
