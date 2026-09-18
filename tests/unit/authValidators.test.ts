/**
 * CRYPTORA — Auth Validators Tests
 *
 * Tests Zod validation schemas for auth endpoints.
 */

import { describe, it, expect } from 'vitest';
import { registerSchema, loginSchema, updateProfileSchema } from '../../server/validators/auth.js';

describe('registerSchema', () => {
  it('accepts valid registration data', () => {
    const result = registerSchema.safeParse({
      email: 'test@example.com',
      displayName: 'Test User',
      password: 'password123',
    });
    expect(result.success).toBe(true);
  });

  it('normalizes email to lowercase', () => {
    const result = registerSchema.safeParse({
      email: '  TEST@Example.COM  ',
      displayName: 'Test User',
      password: 'password123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('test@example.com');
    }
  });

  it('rejects invalid email', () => {
    const result = registerSchema.safeParse({
      email: 'not-an-email',
      displayName: 'Test User',
      password: 'password123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects short password', () => {
    const result = registerSchema.safeParse({
      email: 'test@example.com',
      displayName: 'Test User',
      password: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('rejects long password', () => {
    const result = registerSchema.safeParse({
      email: 'test@example.com',
      displayName: 'Test User',
      password: 'a'.repeat(129),
    });
    expect(result.success).toBe(false);
  });

  it('rejects short display name', () => {
    const result = registerSchema.safeParse({
      email: 'test@example.com',
      displayName: 'A',
      password: 'password123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects long display name', () => {
    const result = registerSchema.safeParse({
      email: 'test@example.com',
      displayName: 'A'.repeat(51),
      password: 'password123',
    });
    expect(result.success).toBe(false);
  });

  it('trims display name', () => {
    const result = registerSchema.safeParse({
      email: 'test@example.com',
      displayName: '  Test User  ',
      password: 'password123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayName).toBe('Test User');
    }
  });
});

describe('loginSchema', () => {
  it('accepts valid login data', () => {
    const result = loginSchema.safeParse({
      email: 'test@example.com',
      password: 'password123',
    });
    expect(result.success).toBe(true);
  });

  it('normalizes email to lowercase', () => {
    const result = loginSchema.safeParse({
      email: '  TEST@Example.COM  ',
      password: 'password123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('test@example.com');
    }
  });

  it('rejects empty email', () => {
    const result = loginSchema.safeParse({
      email: '',
      password: 'password123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty password', () => {
    const result = loginSchema.safeParse({
      email: 'test@example.com',
      password: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('updateProfileSchema', () => {
  it('accepts valid display name', () => {
    const result = updateProfileSchema.safeParse({
      displayName: 'New Name',
    });
    expect(result.success).toBe(true);
  });

  it('rejects short display name', () => {
    const result = updateProfileSchema.safeParse({
      displayName: 'A',
    });
    expect(result.success).toBe(false);
  });

  it('rejects long display name', () => {
    const result = updateProfileSchema.safeParse({
      displayName: 'A'.repeat(51),
    });
    expect(result.success).toBe(false);
  });

  it('trims display name', () => {
    const result = updateProfileSchema.safeParse({
      displayName: '  New Name  ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayName).toBe('New Name');
    }
  });
});