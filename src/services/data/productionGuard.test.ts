import { afterEach, describe, expect, it } from 'vitest';
import { assertDemoNotInProduction } from './productionGuard';

describe('assertDemoNotInProduction', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('throws in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertDemoNotInProduction()).toThrow('[CRITICAL]');
  });

  it('includes provider context', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertDemoNotInProduction('TestDemoProvider')).toThrow('TestDemoProvider');
  });

  it('does not throw in development', () => {
    process.env.NODE_ENV = 'development';
    expect(() => assertDemoNotInProduction()).not.toThrow();
  });

  it('does not throw in test', () => {
    process.env.NODE_ENV = 'test';
    expect(() => assertDemoNotInProduction()).not.toThrow();
  });
});
