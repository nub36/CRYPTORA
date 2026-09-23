# Production error `relation "strategy_settings" does not exist` — analysis & migration plan

**Status: ANALYSIS ONLY. No production database change is performed by this branch.**

Scope note: this document does **not** alter any strategy algorithm. V3.0 / V3.3 / V2.8
math (thresholds, ATR periods, wick/body ratios, corridor fractions, targets) lives in
code under `src/services/strategyArchive/definitions/**` and is untouched.

---

## 1. Diagnosis

The error is **not** a schema-drift or a broken migration. It is a *pending* migration.

- `server/db/migrations/006_strategy_settings.sql` exists in the repository and creates
  the table.
- `server/services/strategySettings.js` is the only layer that reads/writes it, and
  `server/services/strategyEngine/strategyScheduler.js` re-reads it on every scheduler
  cycle.
- Therefore, on a database where migrations `001`–`005` were applied but `006` was not,
  the scheduler's first query raises
  `relation "strategy_settings" does not exist` on every cycle.

**Conclusion:** production is running application code that is newer than its applied
migration set. The fix is to *apply the already-reviewed migration*, not to write a new one.

## 2. Why applying `006` is low risk

`006_strategy_settings.sql` was written to be safe to (re-)run:

| Property | Evidence in the file |
| --- | --- |
| Idempotent table creation | `CREATE TABLE IF NOT EXISTS strategy_settings` |
| Idempotent index creation | `CREATE INDEX IF NOT EXISTS idx_strategy_settings_enabled` |
| Never re-disables a live strategy | Seed uses `ON CONFLICT (strategy_id) DO NOTHING` |
| Safe default posture | All three strategies seeded `enabled = FALSE` — nothing starts scanning by itself |
| No destructive statement | No `DROP`, no `ALTER ... TYPE`, no `DELETE`, no `UPDATE` |
| Cannot register a rogue strategy | `CHECK (strategy_id IN (...))` + `strategy_id` as `PRIMARY KEY` |
| Contains no strategy math | Only `enabled`, `scan_interval_seconds`, `symbols`, bookkeeping columns |

The runner (`scripts/migrate.mjs`) wraps each migration in `BEGIN/COMMIT` with a
`ROLLBACK` on failure and records the version in `schema_migrations`, so a failure
leaves the database exactly as it was.

Migration `007_signals.sql` sorts after `006` and may also be pending; check status
before deciding scope.

## 3. Recommended procedure (for the operator, on the production host)

> Run during a low-traffic window. Requires `DATABASE_URL` for the production database.

1. **Inspect, don't change.** Confirm what is actually pending:
   ```bash
   npm run migrate:status
   ```
   Expect `001`–`005` applied and `006` (possibly `007`) pending.

2. **Back up first.** This is the real safety net, independent of migration content:
   ```bash
   pg_dump "$DATABASE_URL" --format=custom --file=cryptora-pre-006-$(date +%F-%H%M).dump
   ```

3. **Verify the backup is restorable** (list its contents; a dump that cannot be read is not a backup):
   ```bash
   pg_restore --list cryptora-pre-006-*.dump | head
   ```

4. **Apply pending migrations:**
   ```bash
   npm run migrate
   ```

5. **Verify the table and the safe default posture:**
   ```sql
   SELECT strategy_id, enabled, scan_interval_seconds FROM strategy_settings ORDER BY strategy_id;
   ```
   Expect exactly the three known ids, all `enabled = false`.

6. **Confirm the error stops.** Watch the service logs for one scheduler cycle; the
   `relation ... does not exist` message must disappear. No strategy begins scanning
   until an administrator enables one explicitly.

## 4. Rollback

Because the migration is purely additive, rollback is only needed if step 4 fails
mid-way — and the runner already rolls that transaction back automatically.

If a rollback is nevertheless required after a successful apply (e.g. to return to the
previous release), the table can be left in place: older code simply ignores it. Dropping
it is **not** recommended while any newer code is deployed, since the scheduler depends on it.

## 5. What this branch deliberately does **not** do

- Does not connect to, read, or modify the production database.
- Does not add, edit, or reorder any migration file (`001`–`005` guard in
  `tests/integration/migrationsPostgres.test.ts` remains satisfied).
- Does not change any strategy algorithm or any strategy parameter.
