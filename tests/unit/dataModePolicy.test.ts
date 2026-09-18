import { describe, it, expect } from 'vitest';
import { resolveInitialDataMode, QA_FIXTURE_STORAGE_KEY } from '@/config/dataModePolicy';

const storageWith = (entries: Record<string, string>): Pick<Storage, 'getItem'> => ({
  getItem: (k: string) => entries[k] ?? null,
});

describe('dataModePolicy — production = только LIVE', () => {
  it('production (фикстура запрещена): всегда live, что бы ни лежало в localStorage', () => {
    expect(resolveInitialDataMode(storageWith({}), false)).toBe('live');
    expect(resolveInitialDataMode(storageWith({ [QA_FIXTURE_STORAGE_KEY]: '1' }), false)).toBe('live');
    expect(resolveInitialDataMode(storageWith({ cryptora_data_mode: 'demo' }), false)).toBe('live');
    expect(resolveInitialDataMode(null, false)).toBe('live');
  });

  it('dev/test: demo только по явному ключу cryptora_qa_fixture=1', () => {
    expect(resolveInitialDataMode(storageWith({}), true)).toBe('live');
    expect(resolveInitialDataMode(storageWith({ cryptora_data_mode: 'demo' }), true)).toBe('live');
    expect(resolveInitialDataMode(storageWith({ [QA_FIXTURE_STORAGE_KEY]: '1' }), true)).toBe('demo');
    expect(resolveInitialDataMode(storageWith({ [QA_FIXTURE_STORAGE_KEY]: 'true' }), true)).toBe('live');
  });

  it('устаревший ключ cryptora_data_mode никогда не восстанавливает demo', () => {
    expect(resolveInitialDataMode(storageWith({ cryptora_data_mode: 'demo' }), true)).toBe('live');
    expect(resolveInitialDataMode(storageWith({ cryptora_data_mode: 'demo' }), false)).toBe('live');
  });

  it('сбой хранилища → live', () => {
    const broken = { getItem: () => { throw new Error('denied'); } };
    expect(resolveInitialDataMode(broken, true)).toBe('live');
  });
});
