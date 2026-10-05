/** Декларации для server/routes/health.js. */
import type { Router } from 'express';

declare const router: Router;
export default router;

export const HEALTH_VERSION: string;
export const HEALTH_ENVIRONMENT: string;
