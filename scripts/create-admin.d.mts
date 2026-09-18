/**
 * Type declarations for scripts/create-admin.mjs (plain-JS module).
 */

export interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

export interface BootstrapAdminRow {
  id: string;
  email: string;
  display_name: string;
  role: string;
  is_active: boolean;
  email_verified: boolean;
  email_verified_at: Date | string | null;
  created_at: Date | string;
}

export interface CreateBootstrapAdminResult {
  alreadyExists: boolean;
  existing?: { id: string; email: string };
  admin?: BootstrapAdminRow;
}

export declare function createBootstrapAdmin(
  db: Queryable,
  input: { email: string; displayName: string; password: string }
): Promise<CreateBootstrapAdminResult>;
