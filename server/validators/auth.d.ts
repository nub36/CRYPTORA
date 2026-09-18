/**
 * CRYPTORA — Auth Validators Type Declarations
 */

import { z } from 'zod';

export declare const registerSchema: z.ZodObject<{
  email: z.ZodEffects<z.ZodString, string, string>;
  displayName: z.ZodEffects<z.ZodString, string, string>;
  password: z.ZodString;
}>;

export declare const loginSchema: z.ZodObject<{
  email: z.ZodEffects<z.ZodString, string, string>;
  password: z.ZodString;
}>;

export declare const updateProfileSchema: z.ZodObject<{
  displayName: z.ZodEffects<z.ZodString, string, string>;
}>;

export declare const blockUserSchema: z.ZodObject<{
  userId: z.ZodString;
}>;