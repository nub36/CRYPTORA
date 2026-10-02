import { query } from '../../db/pool.js';
import { strategyDraftSchema } from '../../validators/strategyLab.js';
import { loadLabCore } from './labCoreBundle.js';

export class SavedStrategyValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SavedStrategyValidationError';
  }
}

function publicRow(row) {
  return {
    id: row.id,
    name: row.name,
    indicators: row.payload.indicators,
    sourceCode: row.payload.sourceCode,
    execution: row.payload.execution,
    apiVersion: row.api_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function validateSavedDraft(body) {
  let draft;
  try {
    draft = strategyDraftSchema.parse(body);
  } catch (error) {
    const issue = error?.issues?.[0];
    throw new SavedStrategyValidationError(issue?.message || 'Стратегия имеет некорректный формат');
  }
  const core = await loadLabCore();
  const compiled = core.compileResearchDraft(draft);
  if (!compiled.ok || !compiled.definition) {
    throw new SavedStrategyValidationError(`Код стратегии некорректен: ${core.formatCodeErrors(compiled.errors)}`);
  }
  return draft;
}

export async function listSavedStrategies(ownerId) {
  const result = await query(
    `SELECT id, name, payload, api_version, created_at, updated_at
       FROM strategy_lab_saved_strategies
      WHERE owner_id = $1
      ORDER BY updated_at DESC, id DESC`,
    [ownerId]
  );
  return result.rows.map(publicRow);
}

export async function createSavedStrategy(ownerId, draft) {
  const result = await query(
    `INSERT INTO strategy_lab_saved_strategies
       (owner_id, name, payload, api_version)
     VALUES ($1, $2, $3::jsonb, $4)
     RETURNING id, name, payload, api_version, created_at, updated_at`,
    [ownerId, draft.name.trim(), JSON.stringify(draft), draft.apiVersion]
  );
  return publicRow(result.rows[0]);
}

export async function updateSavedStrategy(ownerId, id, draft) {
  const result = await query(
    `UPDATE strategy_lab_saved_strategies
        SET name = $1, payload = $2::jsonb, api_version = $3, updated_at = now()
      WHERE id = $4 AND owner_id = $5
      RETURNING id, name, payload, api_version, created_at, updated_at`,
    [draft.name.trim(), JSON.stringify(draft), draft.apiVersion, id, ownerId]
  );
  return result.rows[0] ? publicRow(result.rows[0]) : null;
}
