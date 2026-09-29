/**
 * CRYPTORA — Auth middleware type declarations.
 */

import type { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void>;

/**
 * Requires an authenticated session established recently (sensitive actions
 * such as linking/unlinking providers). Responds 401 REAUTH_REQUIRED when the
 * session's authAt stamp is missing or too old.
 */
export function requireFreshAuth(req: Request, res: Response, next: NextFunction): void;

export function requireAdmin(req: Request, res: Response, next: NextFunction): void;
