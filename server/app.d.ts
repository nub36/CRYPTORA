/**
 * Type declarations for server/app.js (plain-JS module).
 */
import type { Express } from 'express';

export interface CreateAppOptions {
  /** Session store backend. 'memory' is refused when NODE_ENV=production. */
  sessionStore?: 'postgres' | 'memory';
}

export declare function createApp(options?: CreateAppOptions): Express;
