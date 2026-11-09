/** Общие помощники тестов backend'а. */
import type { CandleProvider, MarketInterval } from '../src/market';
import type { OHLCV } from '@v34/core';
import { openDatabase, type Database } from '../src/db';
import { SignalRepository } from '../src/repository';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Провайдер, отдающий заранее подготовленные строки Binance. */
export class StaticProvider implements CandleProvider {
  readonly id = 'static-test';
  calls: { symbol: string; interval: MarketInterval; limit: number }[] = [];
  constructor(
    private readonly data: { '1h': unknown[][]; '4h': unknown[][]; symbol: string; now: () => number },
    private readonly failWith: Error | null = null,
  ) {}

  async getKlines(symbol: string, interval: MarketInterval, limit: number): Promise<OHLCV[]> {
    this.calls.push({ symbol, interval, limit });
    if (this.failWith) throw this.failWith;
    if (symbol !== this.data.symbol) throw new Error(`неожиданный символ ${symbol}`);
    const rows = this.data[interval];
    return rows.map((r) => {
      const a = r as [number, string, string, string, string, string];
      return {
        time: Math.floor(Number(a[0]) / 1000),
        open: Number(a[1]), high: Number(a[2]), low: Number(a[3]), close: Number(a[4]), volume: Number(a[5]),
        provenance: { exchange: 'Binance', isFallback: false },
      };
    });
  }
}

export interface TempDb {
  db: Database;
  repo: SignalRepository;
  file: string;
  cleanup(): void;
}

export function tempDb(file?: string): TempDb {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v34-db-'));
  const dbFile = file ?? path.join(dir, 'test.sqlite');
  const db = openDatabase(dbFile);
  return {
    db,
    file: dbFile,
    repo: new SignalRepository(db),
    cleanup: () => {
      try { db.close(); } catch { /* уже закрыта */ }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
