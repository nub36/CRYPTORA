import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError, type ApiClient } from '../api/client';
import type { SignalView } from '../api/types';
import { Badge } from '../components/Badge';
import { ScreenState } from '../components/ScreenState';
import { StaleBanner } from '../components/StaleBanner';
import { colors, radius, spacing } from '../theme';
import {
  activeStopLabel, EVENT_LABELS, exitReasonLabel, formatPct, formatPrice,
  formatSignedR, formatUtc, signalState, statusLabel,
} from '../format';

export interface SignalDetailScreenProps {
  api: ApiClient;
  signalId: string;
  onBack: () => void;
  /** Данные из списка — чтобы экран не мигал до ответа сервера. */
  initialSignal?: SignalView | null;
}

type DetailState =
  | { phase: 'loading' }
  | { phase: 'ready'; signal: SignalView }
  | { phase: 'error'; message: string };

export function SignalDetailScreen({ api, signalId, onBack, initialSignal = null }: SignalDetailScreenProps) {
  const [state, setState] = React.useState<DetailState>(
    initialSignal ? { phase: 'ready', signal: initialSignal } : { phase: 'loading' },
  );
  const [refreshing, setRefreshing] = React.useState(false);

  const load = React.useCallback(async () => {
    setRefreshing(true);
    try {
      const signal = await api.getSignal(signalId);
      setState({ phase: 'ready', signal });
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'неизвестная ошибка';
      // Если данные из списка уже есть — оставляем их и показываем ошибку
      // обновления, а не пустой экран.
      setState((prev) => (prev.phase === 'ready'
        ? { phase: 'ready', signal: { ...prev.signal, stale: true, staleReason: `не удалось обновить: ${message}` } }
        : { phase: 'error', message }));
    } finally {
      setRefreshing(false);
    }
  }, [api, signalId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const back = (
    <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Назад к списку" style={styles.back}>
      <Text style={styles.backText}>‹ Назад</Text>
    </Pressable>
  );

  if (state.phase === 'loading') {
    return (
      <View style={styles.wrap}>
        {back}
        <ScreenState mode="loading" title="Загружаем сигнал" message="Запрос к серверу V3.4…" testID="detail-loading" />
      </View>
    );
  }

  if (state.phase === 'error') {
    return (
      <View style={styles.wrap}>
        {back}
        <ScreenState
          mode="error"
          title="Сигнал недоступен"
          message={`${state.message}. Попробуйте обновить экран.`}
          actionLabel="Повторить"
          onAction={() => { void load(); }}
          testID="detail-error"
        />
      </View>
    );
  }

  const s = state.signal;
  const dirTone = s.direction === 'LONG' ? 'long' : 'short';
  const tp1 = s.targets.find((t) => t.level === 1)?.price ?? null;
  const tp2 = s.targets.find((t) => t.level === 2)?.price ?? null;

  return (
    <View style={styles.wrap} testID="detail-ready">
      {back}
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.symbol}>{s.symbol}</Text>
            <Text style={styles.sub}>{s.timeframe} · {statusLabel(s.status)}</Text>
          </View>
          <View style={styles.badges}>
            <Badge label={s.direction} tone={dirTone} />
            <Badge label={statusLabel(s.status)} tone={s.status === 'TARGET_REACHED' ? 'ok' : s.status === 'INVALIDATED' ? 'danger' : 'neutral'} />
          </View>
        </View>

        {s.stale ? <StaleBanner reason={s.staleReason} asOf={s.asOf} /> : null}

        {s.outcome ? (
          <Section title="Исход сделки">
            <Row label="Статус" value={statusLabel(s.outcome.status)} />
            <Row label="Причина выхода" value={exitReasonLabel(s.outcome.exitReason) ?? '—'} />
            <Row label="Цена выхода" value={formatPrice(s.outcome.exitPrice)} />
            <Row label="Результат (gross)" value={formatSignedR(s.outcome.resultR)} />
            <Row label="Результат (net, 2/5 bps)" value={formatSignedR(s.outcome.netResultR)} />
            <Row label="Изменение цены" value={formatPct(s.outcome.pnlResultPct)} />
            <Row label="Баров в сделке" value={s.outcome.barsHeld === null ? '—' : String(s.outcome.barsHeld)} />
            <Row label="Закрыт" value={formatUtc(s.closedAt)} />
          </Section>
        ) : null}

        <Section title="Уровни (опубликованы сервером)">
          <Row label="Коридор входа" value={s.entryZone ? `${formatPrice(s.entryZone.low)} – ${formatPrice(s.entryZone.high)}` : 'нет данных'} />
          <Row
            label="Первоначальный стоп"
            value={s.initialStopLoss === null ? 'нет данных' : formatPrice(s.initialStopLoss)}
            emphasis={s.initialStopLoss === null}
          />
          <Row label="TP1" value={tp1 === null ? 'нет данных' : formatPrice(tp1)} />
          <Row label="TP2" value={tp2 === null ? 'нет данных' : formatPrice(tp2)} />
          <Row label="Факт входа" value={s.entry ? `${formatPrice(s.entry.price)} · ${formatUtc(s.entry.at)}` : 'входа ещё не было'} />
        </Section>

        <Section title="Подтверждённые события">
          <ProgressRow label="TP1" hit={s.progress.tp1Hit} at={s.progress.tp1HitAt} />
          <ProgressRow label="TP2" hit={s.progress.tp2Hit} at={s.progress.tp2HitAt} />
          <ProgressRow
            label="Безубыток"
            hit={s.progress.breakevenArmed || s.progress.breakevenOccurred}
            at={s.progress.breakevenArmed ? s.progress.breakevenArmedAt : s.progress.breakevenOccurredAt}
          />
          <ProgressRow label="Стоп" hit={s.progress.stopHit} at={s.progress.stopHitAt} danger />
          {signalState(s) === 'inPosition' ? (
            <Row label="Действующий стоп" value={activeStopLabel(s)} />
          ) : (
            <Row label="Действующий стоп" value="не действует — сделка закрыта" />
          )}
          {s.progress.currentStopBasis === 'BE_AT_ENTRY' ? (
            <Text style={styles.hint}>Стоп переведён на цену входа после TP1 — это правило стратегии, подтверждённое сервером.</Text>
          ) : null}
          {s.progress.breakevenOccurred && !s.progress.breakevenArmed ? (
            <Text style={styles.hint}>
              Безубыток был достигнут в ходе сделки — это история события, а не текущий уровень стопа.
            </Text>
          ) : null}
        </Section>

        <Section title="Журнал событий">
          {s.events.length === 0 ? (
            <Text style={styles.hint}>Событий нет.</Text>
          ) : (
            s.events.map((e) => (
              <View key={`${e.type}-${e.occurredAt ?? 'na'}`} style={styles.eventRow}>
                <Text style={styles.eventLabel}>{EVENT_LABELS[e.type] ?? e.type}</Text>
                <Text style={styles.eventTime}>{formatUtc(e.occurredAt)}</Text>
              </View>
            ))
          )}
        </Section>

        <Section title="Источник и время">
          <Row label="Сетап сформирован" value={formatUtc(s.setupAt)} />
          <Row label="Опубликован" value={formatUtc(s.publishedAt)} />
          <Row label="Последнее изменение" value={formatUtc(s.statusAt)} />
          <Row label="Данные" value={s.dataSource ? `${s.dataSource.exchange}${s.dataSource.isFallback ? ' (резерв)' : ''}` : '—'} />
          <Row label="Ответ сервера" value={formatUtc(s.asOf)} />
        </Section>

        <Pressable
          onPress={() => { void load(); }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.refresh, pressed && styles.refreshPressed]}
          disabled={refreshing}
        >
          <Text style={styles.refreshText}>{refreshing ? 'Обновляем…' : 'Обновить'}</Text>
        </Pressable>

        <Text style={styles.disclaimer}>
          Аналитический сигнал, не инвестиционная рекомендация. Приложение не выставляет ордера
          и не подключается к торговому счёту.
        </Text>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Row({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, emphasis && styles.rowValueMuted]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function ProgressRow({ label, hit, at, danger = false }: { label: string; hit: boolean; at: string | null; danger?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          hit ? (danger ? styles.hitDanger : styles.hit) : styles.rowValueMuted,
        ]}
      >
        {hit ? `✓ ${at ? formatUtc(at) : 'подтверждено'}` : 'не подтверждено'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  back: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs, minHeight: 44, justifyContent: 'center' },
  backText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md },
  symbol: { color: colors.text, fontSize: 24, fontWeight: '800' },
  sub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  badges: { flexDirection: 'row', gap: spacing.xs, flexShrink: 1 },
  section: { gap: spacing.sm },
  sectionTitle: { color: colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  sectionBody: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, alignItems: 'flex-start' },
  rowLabel: { color: colors.muted, fontSize: 13, flexShrink: 1 },
  rowValue: { color: colors.text, fontSize: 13, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  rowValueMuted: { color: colors.muted, fontWeight: '500' },
  hit: { color: colors.accent },
  hitDanger: { color: colors.danger },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  eventRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  eventLabel: { color: colors.text, fontSize: 13, flexShrink: 1 },
  eventTime: { color: colors.muted, fontSize: 12 },
  refresh: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.surface,
    minHeight: 44,
    justifyContent: 'center',
  },
  refreshPressed: { backgroundColor: colors.surfaceAlt },
  refreshText: { color: colors.text, fontWeight: '600' },
  disclaimer: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
