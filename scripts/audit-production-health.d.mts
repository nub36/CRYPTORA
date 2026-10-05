/** Декларации для scripts/audit-production-health.mjs (строго read-only аудит). */

export interface AuditCheck {
  name: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  detail?: string;
  data?: unknown;
}

/** Маскирует пароль в DSN: в вывод аудита секрет не попадает. */
export function maskDsn(dsn: string | null | undefined): string;

/** Бросает, если SQL не начинается с select/with/show/table. */
export function assertReadOnlySql(sql: string): string;

export const checks: AuditCheck[];
export function addCheck(check: AuditCheck): void;
export function overall(): 'PASS' | 'WARN' | 'FAIL';
export function main(argv?: string[]): Promise<number>;
