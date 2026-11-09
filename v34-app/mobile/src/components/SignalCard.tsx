import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SignalView } from '../api/types';
import { Badge, type BadgeTone } from './Badge';
import { colors, radius, spacing } from '../theme';
import { formatPrice, formatUtc, signalState, statusLabel } from '../format';

/** Цвет статуса — по подтверждённому серверному статусу, не по цене. */
function statusTone(status: SignalView['status']): BadgeTone {
  switch (status) {
    case 'ACTIVE': return 'neutral';
    case 'FILLED': return 'warn';
    case 'TARGET_REACHED': return 'ok';
    case 'INVALIDATED': return 'danger';
    case 'CLOSED': return 'neutral';
    default: return 'neutral';
  }
}

export interface SignalCardProps {
  signal: SignalView;
  onPress: (id: string) => void;
}

export function SignalCard({ signal, onPress }: SignalCardProps) {
  const state = signalState(signal);
  const dirTone: BadgeTone = signal.direction === 'LONG' ? 'long' : 'short';

  return (
    <Pressable
      onPress={() => onPress(signal.id)}
      accessibilityRole="button"
      accessibilityLabel={`${signal.symbol}, ${signal.direction}, ${statusLabel(signal.status)}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      testID={`signal-card-${signal.id}`}
    >
      <View style={styles.header}>
        <Text style={styles.symbol}>{signal.symbol}</Text>
        <View style={styles.badges}>
          <Badge label={signal.direction} tone={dirTone} />
          <Badge label={statusLabel(signal.status)} tone={statusTone(signal.status)} />
        </View>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Вход</Text>
        <Text style={styles.value}>
          {signal.entryZone ? `${formatPrice(signal.entryZone.low)} – ${formatPrice(signal.entryZone.high)}` : '—'}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Стоп</Text>
        <Text style={styles.value}>{signal.initialStopLoss === null ? 'нет данных' : formatPrice(signal.initialStopLoss)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>TP1 / TP2</Text>
        <Text style={styles.value}>
          {signal.targets.length === 0
            ? '—'
            : signal.targets.map((t) => formatPrice(t.price)).join(' / ')}
        </Text>
      </View>

      <View style={styles.footer}>
        <Text style={styles.meta}>{formatUtc(state === 'waitingEntry' ? signal.setupAt : signal.statusAt)}</Text>
        {signal.stale ? <Text style={styles.stale}>устарело</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  pressed: { backgroundColor: colors.surfaceAlt },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  symbol: { color: colors.text, fontSize: 17, fontWeight: '700' },
  badges: { flexDirection: 'row', gap: spacing.xs, flexShrink: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  label: { color: colors.muted, fontSize: 13 },
  value: { color: colors.text, fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  meta: { color: colors.muted, fontSize: 11 },
  stale: { color: colors.warn, fontSize: 11, fontWeight: '700' },
});
