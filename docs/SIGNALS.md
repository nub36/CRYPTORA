# SIGNALS — Архитектура аналитических сетапов и неизменяемая история

> **КРИТИЧЕСКОЕ ПРАВИЛО:**  
> Сигналы в CRYPTORA — это **НЕ** кнопка «Купи/Продай» с фальшивым маркетингом «98% точности».  
> Любой аналитический сетап строится на формализованной проверяемой логике с неизменяемым журналом и фиксацией опровергающих факторов.

---

## 1. Модель данных сигнала (Signal Model)

```typescript
export interface SignalSetup {
  id: string;
  strategyId: string;
  strategyVersion: string;
  instrument: string; // e.g. BTC/USDT
  exchange: string; // e.g. Aggregated / Binance
  timeframe: string; // e.g. 4h, 1D
  createdAt: string; // ISO UTC
  direction: 'LONG' | 'SHORT' | 'NEUTRAL_ALERT';
  
  // Уровни входа и отмены идеи
  entryRange: [number, number];
  invalidationLevel: number; // Уровень отмены гипотезы (Stop Loss аналог)
  targets: number[];
  
  // Объективные факты подтверждения
  supportingEvidence: string[];
  
  // Факторы риска и опровергающие аргументы
  opposingEvidence: string[];
  
  // Ссылки на снимок состояния данных
  dataSnapshotRef: string;
  
  // Аудит исхода
  status: 'PENDING' | 'TRIGGERED' | 'INVALIDATED' | 'COMPLETED_TARGET';
  outcomeTimestamp?: string;
  realizedReturnPct?: number;
}
```

---

## 2. Принцип неизменяемости (Immutable History)

1. **Никакого переписывания задним числом:**  
   Сетап, однажды выпущенный алгоритмическим движком, фиксируется в неизменяемом логе.
2. **Неудачные сигналы сохраняются навсегда:**  
   Любые попытки удалить сработавшие по инвалидации сетапы или скрыть убыточные периоды строго запрещены системным дизайном.
3. **Честная статистика:**  
   Винрейт, фактор прибыли и математическое ожидание считаются только по полному историческому пулу.
