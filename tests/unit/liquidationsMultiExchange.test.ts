import { beforeEach, describe, expect, it } from 'vitest';
import { LiquidationPipeline } from '@/services/liquidations/LiquidationPipeline';
import { BybitLiquidationStream } from '@/services/realtime/liquidations/BybitLiquidationStream';
import { OkxLiquidationStream } from '@/services/realtime/liquidations/OkxLiquidationStream';

class MockSocket {
  public static instances: MockSocket[] = [];
  public sent: string[] = [];
  public onopen: (() => void) | null = null;
  public onmessage: ((ev: { data: string }) => void) | null = null;
  public onerror: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  constructor(public url: string) {
    MockSocket.instances.push(this);
  }
  send(f: string) {
    this.sent.push(f);
  }
  close() {
    this.onclose?.();
  }
  open() {
    this.onopen?.();
  }
  push(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
}

const T = Date.now() - 60_000;

describe('Bybit V5 allLiquidation → конвейер', () => {
  beforeEach(() => {
    MockSocket.instances = [];
    LiquidationPipeline.resetInstance();
  });

  it('разбирает пачку событий; S=Buy ⇒ ликвидирован ЛОНГ, S=Sell ⇒ ШОРТ; USD = p × v', () => {
    const p = new LiquidationPipeline();
    const events = p.ingestBybitAllLiquidation({
      topic: 'allLiquidation.BTCUSDT',
      type: 'snapshot',
      ts: T + 100,
      data: [
        { T, s: 'BTCUSDT', S: 'Buy', v: '0.5', p: '64000' },
        { T: T + 1, s: 'SOLUSDT', S: 'Sell', v: '100', p: '150' },
      ],
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ symbol: 'BTC', side: 'LONG', amountUsd: 32000, exchange: 'Bybit', isDemo: false });
    expect(events[1]).toMatchObject({ symbol: 'SOL', side: 'SHORT', amountUsd: 15000 });
    expect(events[0].timestamp).toBe(new Date(T).toISOString());
    const snap = p.getLiquidationSnapshot(T + 1000);
    expect(snap.exchangeBreakdown).toEqual([{ exchange: 'Bybit', totalUsd: 47000, percentage: 100 }]);
  });

  it('игнорирует чужие топики, неизвестную сторону и нулевые объёмы', () => {
    const p = new LiquidationPipeline();
    expect(p.ingestBybitAllLiquidation({ topic: 'publicTrade.BTCUSDT', data: [{ T, s: 'BTCUSDT', S: 'Buy', v: '1', p: '1' }] })).toEqual([]);
    expect(p.ingestBybitAllLiquidation({ topic: 'allLiquidation.BTCUSDT', data: [{ T, s: 'BTCUSDT', S: 'Hold', v: '1', p: '1' }] })).toEqual([]);
    expect(p.ingestBybitAllLiquidation({ topic: 'allLiquidation.BTCUSDT', data: [{ T, s: 'BTCUSDT', S: 'Buy', v: '0', p: '1' }] })).toEqual([]);
    expect(p.getLiquidationSnapshot().total24h).toBe(0);
  });

  it('повторный кадр (snapshot после переподключения) не удваивает агрегаты', () => {
    const p = new LiquidationPipeline();
    const frame = { topic: 'allLiquidation.BTCUSDT', data: [{ T, s: 'BTCUSDT', S: 'Buy', v: '1', p: '60000' }] };
    p.ingestBybitAllLiquidation(frame);
    p.ingestBybitAllLiquidation(frame);
    expect(p.getLiquidationSnapshot(T + 1000).total24h).toBe(60000);
  });

  it('транспорт: подписка пачками ≤10 топиков, ping keep-alive, служебные кадры не считаются данными', () => {
    const p = new LiquidationPipeline();
    const s = new BybitLiquidationStream(p, { webSocketClass: MockSocket, symbols: Array.from({ length: 12 }, (_, i) => `S${i}USDT`) });
    s.connect();
    const sock = MockSocket.instances[0];
    expect(sock.url).toBe('wss://stream.bybit.com/v5/public/linear');
    sock.open();
    const subs = sock.sent.map((f) => JSON.parse(f)).filter((m) => m.op === 'subscribe');
    expect(subs).toHaveLength(2);
    expect(subs[0].args).toHaveLength(10);
    expect(subs[0].args[0]).toBe('allLiquidation.S0USDT');
    expect(s.getState()).toBe('connected');
    expect(p.getStreamStates().bybit).toBe('connected');
    sock.push({ op: 'pong', success: true });
    sock.push({ success: true, op: 'subscribe', conn_id: 'x' });
    expect(s.getReceivedMessages()).toBe(0);
    sock.push({ topic: 'allLiquidation.BTCUSDT', data: [{ T: Date.now(), s: 'BTCUSDT', S: 'Sell', v: '1', p: '50000' }] });
    expect(s.getReceivedMessages()).toBe(1);
    expect(p.getLiquidationSnapshot().dataStatus).toBe('LIVE_STREAM');
    s.disconnect();
    expect(p.getStreamStates().bybit).toBe('idle');
  });
});

describe('OKX liquidation-orders → конвейер', () => {
  beforeEach(() => {
    MockSocket.instances = [];
    LiquidationPipeline.resetInstance();
  });

  const ct = { 'BTC-USDT-SWAP': 0.01, 'ETH-USDT-SWAP': 0.1 };
  const frame = {
    arg: { channel: 'liquidation-orders', instType: 'SWAP' },
    data: [
      { instId: 'BTC-USDT-SWAP', instFamily: 'BTC-USDT', details: [{ bkPx: '60000', sz: '5', side: 'sell', posSide: 'long', ts: String(T) }] },
      { instId: 'ETH-USDT-SWAP', details: [{ bkPx: '3000', sz: '20', side: 'buy', posSide: 'short', ts: String(T + 5) }] },
      { instId: 'BTC-USD-SWAP', details: [{ bkPx: '60000', sz: '5', side: 'sell', posSide: 'long', ts: String(T) }] },
      { instId: 'DOGE-USDT-SWAP', details: [{ bkPx: '0.1', sz: '5', side: 'sell', posSide: 'long', ts: String(T) }] },
    ],
  };

  it('USD = bkPx × sz × ctVal; posSide задаёт сторону; инверсные и без ctVal — отбрасываются', () => {
    const p = new LiquidationPipeline();
    const ev = p.ingestOkxLiquidationOrders(frame, ct);
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ symbol: 'BTC', side: 'LONG', amountUsd: 3000, price: 60000, exchange: 'OKX', isDemo: false });
    expect(ev[1]).toMatchObject({ symbol: 'ETH', side: 'SHORT', amountUsd: 6000 });
  });

  it('без posSide сторона выводится из side ордера закрытия (sell ⇒ лонг)', () => {
    const p = new LiquidationPipeline();
    const ev = p.ingestOkxLiquidationOrders(
      { arg: { channel: 'liquidation-orders' }, data: [{ instId: 'BTC-USDT-SWAP', details: [{ bkPx: '1', sz: '1', side: 'sell', ts: String(T) }] }] },
      ct,
    );
    expect(ev[0].side).toBe('LONG');
  });

  it('транспорт: без каталога ctVal (REST недоступен) поток честно unavailable, события не оцениваются', async () => {
    const p = new LiquidationPipeline();
    const s = new OkxLiquidationStream(p, { webSocketClass: MockSocket, fetchFn: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
    s.connect();
    await new Promise((r) => setTimeout(r, 0));
    expect(MockSocket.instances).toHaveLength(0);
    expect(['unavailable', 'reconnecting']).toContain(s.getState());
    expect(p.getLiquidationSnapshot().total24h).toBe(0);
    s.disconnect();
  });

  it('транспорт: каталог из публичного REST, подписка на канал, текстовый ping/pong, ingest', async () => {
    const p = new LiquidationPipeline();
    const fetchFn = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: '0', data: [{ instId: 'BTC-USDT-SWAP', ctVal: '0.01' }, { instId: 'BTC-USD-SWAP', ctVal: '100' }] }),
    })) as unknown as typeof fetch;
    const s = new OkxLiquidationStream(p, { webSocketClass: MockSocket, fetchFn });
    s.connect();
    await new Promise((r) => setTimeout(r, 0));
    expect(s.getContractValues()).toEqual({ 'BTC-USDT-SWAP': 0.01 });
    const sock = MockSocket.instances[0];
    expect(sock.url).toBe('wss://ws.okx.com:8443/ws/v5/public');
    sock.open();
    expect(JSON.parse(sock.sent[0])).toEqual({ op: 'subscribe', args: [{ channel: 'liquidation-orders', instType: 'SWAP' }] });
    sock.push('pong');
    sock.push({ event: 'subscribe', arg: { channel: 'liquidation-orders', instType: 'SWAP' } });
    expect(s.getReceivedMessages()).toBe(0);
    sock.push({ arg: { channel: 'liquidation-orders', instType: 'SWAP' }, data: [{ instId: 'BTC-USDT-SWAP', details: [{ bkPx: '60000', sz: '5', posSide: 'long', side: 'sell', ts: String(Date.now()) }] }] });
    expect(p.getLiquidationSnapshot().total24h).toBe(3000);
    expect(p.getStreamStates().okx).toBe('connected');
    s.disconnect();
  });
});

describe('Агрегированный статус потоков по биржам', () => {
  it('connected, если жив хотя бы один; unavailable — только если недоступны все', () => {
    const p = new LiquidationPipeline();
    p.setStreamState('unavailable', 'binance');
    p.setStreamState('unavailable', 'bybit');
    p.setStreamState('unavailable', 'okx');
    expect(p.getStreamState()).toBe('unavailable');
    expect(p.getLiquidationSnapshot().dataStatus).toBe('UNAVAILABLE');
    p.setStreamState('connected', 'okx');
    expect(p.getStreamState()).toBe('connected');
    expect(p.getLiquidationSnapshot().dataStatus).toBe('AWAITING_STREAM');
  });
});
