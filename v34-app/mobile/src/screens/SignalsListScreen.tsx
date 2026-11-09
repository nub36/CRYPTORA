import React from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { ApiClient } from '../api/client';
import type { SignalView } from '../api/types';
import { useSignals } from '../hooks/useSignals';
import { SignalCard } from '../components/SignalCard';
import { ScreenState } from '../components/ScreenState';
import { StaleBanner } from '../components/StaleBanner';
import { colors, radius, spacing } from '../theme';
import { formatUtc } from '../format';

export interface SignalsListScreenProps {
  api: ApiClient;
  onOpenSignal: (id: string) => void;
  /** 0 — без автообновления (используется в тестах). */
  pollMs?: number;
}

/** Фильтр по открытым/всем сигналам. Значения — из домена сервера. */
type StatusFilter = 'OPEN' | 'ALL';

export function SignalsListScreen({ api, onOpenSignal, pollMs = 60_000 }: SignalsListScreenProps) {
  const [filter, setFilter] = React.useState<StatusFilter>('OPEN');
  const params = React.useMemo(
    () => (filter === 'OPEN' ? { limit: 50, status: ['ACTIVE', 'FILLED'] } : { limit: 50 }),
    [filter],
  );
  const { phase, data, error, refreshing, refresh } = useSignals(api, { params, pollMs });

  if (phase === 'loading') {
    return <ScreenState mode="loading" title="Загружаем сигналы" message="Запрос к серверу V3.4…" testID="list-loading" />;
  }

  if (phase === 'error') {
    return (
      <ScreenState
        mode="error"
        title="Не удалось загрузить сигналы"
        message={`${error?.message ?? 'неизвестная ошибка'}. Проверьте соединение и повторите попытку.`}
        actionLabel="Повторить"
        onAction={() => { void refresh(); }}
        testID="list-error"
      />
    );
  }

  const items: SignalView[] = data?.items ?? [];

  return (
    <View style={styles.wrap} testID="list-ready">
      <View style={styles.toolbar}>
        <Text style={styles.title}>Сигналы V3.4</Text>
        <View style={styles.filters}>
          <FilterButton label="Открытые" active={filter === 'OPEN'} onPress={() => setFilter('OPEN')} />
          <FilterButton label="Все" active={filter === 'ALL'} onPress={() => setFilter('ALL')} />
        </View>
      </View>

      {data?.stale ? <StaleBanner reason={data.staleReason} asOf={data.asOf} /> : null}
      {error && !data?.stale ? (
        <View style={styles.refreshError}>
          <Text style={styles.refreshErrorText}>Не удалось обновить: {error.message}</Text>
        </View>
      ) : null}

      {items.length === 0 ? (
        <ScreenState
          mode="empty"
          title="Сигналов пока нет"
          message={
            data
              ? `Сервер проверил рынок и не нашёл сетапов под фильтром. Данные на ${formatUtc(data.asOf)}.`
              : 'Сервер вернул пустой список.'
          }
          actionLabel="Обновить"
          onAction={() => { void refresh(); }}
          testID="list-empty"
        />
      ) : (
        <FlatList
          testID="signals-flatlist"
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <SignalCard signal={item} onPress={onOpenSignal} />}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { void refresh(); }}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
          ListFooterComponent={
            <Text style={styles.footer}>
              {`Всего под фильтром: ${data?.total ?? items.length} · обновлено ${formatUtc(data?.asOf ?? null)}`}
            </Text>
          }
        />
      )}
    </View>
  );
}

function FilterButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.filter, active && styles.filterActive]}
    >
      <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  toolbar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  filters: { flexDirection: 'row', gap: spacing.sm },
  filter: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  filterText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  filterTextActive: { color: colors.text },
  refreshError: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
  refreshErrorText: { color: colors.danger, fontSize: 12 },
  listContent: { paddingTop: spacing.xs, paddingBottom: spacing.xxl },
  footer: { color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: spacing.sm },
});
