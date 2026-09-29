/**
 * Type declarations for server/services/sessionAuth.js.
 */

import type { Request } from 'express';

export declare function establishSession(
  req: Request,
  user: { id: string; role: string }
): Promise<void>;
