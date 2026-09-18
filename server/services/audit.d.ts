/**
 * Type declarations for server/services/audit.js (plain-JS module).
 */

export interface RecordAuditParams {
  actorUserId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

export declare function recordAudit(params: RecordAuditParams): Promise<void>;

/** Strips sensitive keys (password, token, secret, …) from metadata. */
export declare function sanitizeMetadata(
  meta: Record<string, unknown>
): Record<string, unknown>;

export interface AuditLogQuery {
  limit?: number;
  offset?: number;
  actorUserId?: string | null;
  action?: string | null;
}

export declare function getAuditLog(query?: AuditLogQuery): Promise<Array<Record<string, unknown>>>;
