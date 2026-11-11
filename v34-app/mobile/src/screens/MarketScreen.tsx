/**
 * Экран «Пары»: пары канонической конфигурации V3.4, график выбранной пары и
 * её сигналы.
 *
 * Правила, закреплённые тестами:
 *   • список пар приходит из `/api/v1/meta` (сервер), а не из локального
 *     массива; нет ответа — экран говорит «сервер недоступен», а не рисует
 *     «примерные» пары;
 *   • свечи приходят из `/api/v1/candles` — биржа с телефона не запрашивается;
 *   • уровни на графике (коридор, SL, TP1/TP2, BE) берутся только из серверного
 *     сигнала; нет SL/BE на сервере — нет и линий;
 *   • сигналы пары — лента сервера с фильтром `symbol`; пустая лента и ошибка
 *     сети выглядят по-разному.
 */
import React from 'react';
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import type { ApiClient } from '../api/client';
import type { MetaResponse, PairInfo, SignalView } from '../api/types';
import { CandleChart } from '../components/CandleChart';
import { ScreenState } from '../components/ScreenState';
import { SignalCard } from '../components/SignalCard';
import { StaleBanner } from '../components/StaleBanner';
import { chartOverlayForLatestSignal, type ChartOverlay } from '../chartLevels';
import { useCandles } from '../hooks/useCandles';
import { useMeta } from '../hooks/useMeta';
import { useSignals } from '../hooks/useSignals';
import { formatUtc } from '../format';
import { colors, radius, spacing } from '../theme';

export interface MarketScreenProps {
  api: ApiClient;
  onOpenSignal: (id: string) => void;
  /** 0 — без автообновления (тесты и скриншоты). */
  pollMs?: number;
}

/**
 * Пары для витрины. Приоритет — `universe.pairs` от сервера; если сервер его не
 * прислал (старая версия), показываем биржевые символы как есть, без выдуманных
 * имён. Локального списка пар в приложении нет.
 */
export function resolvePairs(meta: MetaResponse | null): PairInfo[] {
  if (!meta) return [];
  const fromServer = meta.universe?.pairs;
  if (Array.isArray(fromServer) && fromServer.length > 0) {
    return fromServer
      .filter((p) => p && typeof p.symbol === 'string' && typeof p.exchangeSymbol === 'string')
      .map((p) => ({ symbol: p.symbol, exchangeSymbol: p.exchangeSymbol }));
  }
  const symbols = meta.universe?.symbols;
  return Array.isArray(symbols)
    ? symbols.filter((s) => typeof s === 'string' && s.length > 0).map((s) => ({ symbol: s, exchangeSymbol: s }))
    : [];
}

/** Подпись легенды: честно объясняет, почему линий нет. */
export function chartLegendText(phase: 'loading' | 'ready' | 'error', overlay: ChartOverlay): string {
  if (phase === 'loading') return 'Уровни: загружаем сигналы пары…';
  if (phase === 'error') return 'Уровни: сигналы пары недоступны — линии не рисуются';
  if (overlay.levels.length === 0 && !overlay.zone) return 'Уровни: серверных уровней по паре нет';
  const parts: string[] = [];
  if (overlay.zone) parts.push('коридор входа');
  for (const level of overlay.levels) parts.push(level.label);
  return `Уровни с сервера: ${parts.join(' · ')}`;
}

export function MarketScreen({ api, onOpenSignal, pollMs = 60_000 }: MarketScreenProps) {
  const meta = useMeta(api);
  const pairs = React.useMemo(() => resolvePairs(meta.data), [meta.data]);
  const [selected, setSelected] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (pairs.length === 0) {
      setSelected(null);
      return;
    }
    setSelected((current) => (
      current && pairs.some((p) => p.exchangeSymbol === current)
        ? current
        : pairs[0]!.exchangeSymbol
    ));
  }, [pairs]);

  if (meta.phase === 'loading') {
    return (
      <ScreenState
        mode="loading"
        title="Загружаем пары V3.4"
        message="Запрос конфигурации к серверу…"
        testID="market-loading"
      />
    );
  }

  if (meta.phase === 'error') {
    return (
      <ScreenState
        mode="error"
        title="Сервер недоступен"
        message={`${meta.error?.message ?? 'нет связи с сервером'}. Пары, график и сигналы появятся только после ответа backend CRYPTORA V3.4. Проверьте адрес сервера в сборке и соединение.`}
        actionLabel="Повторить"
        onAction={() => { void meta.refresh(); }}
        testID="market-error"
      />
    );
  }

  if (pairs.length === 0 || !selected) {
    return (
      <ScreenState
        mode="empty"
        title="Сервер не сообщил пары"
        message="В конфигурации V3.4 нет ни одной пары, поэтому график и сигналы показывать нечего."
        actionLabel="Обновить"
        onAction={() => { void meta.refresh(); }}
        testID="market-no-pairs"
      />
    );
  }

  const pair = pairs.find((p) => p.exchangeSymbol === selected) ?? pairs[0]!;

  return (
    <PairMarket
      // Смена пары пересоздаёт состояние свечей: старый график не остаётся.
      key={pair.exchangeSymbol}
      api={api}
      meta={meta.data}
      pairs={pairs}
      pair={pair}
      onSelect={setSelected}
      onOpenSignal={onOpenSignal}
      pollMs={pollMs}
    />
  );
}

interface PairMarketProps {
  api: ApiClient;
  meta: MetaResponse | null;
  pairs: PairInfo[];
  pair: PairInfo;
  onSelect: (exchangeSymbol: string) => void;
  onOpenSignal: (id: string) => void;
  pollMs: number;
}

function PairMarket({ api, meta, pairs, pair, onSelect, onOpenSignal, pollMs }: PairMarketProps) {
  const candles = useCandles(api, { symbol: pair.exchangeSymbol, interval: '1h', limit: 120, pollMs });
  const signals = useSignals(api, { params: { limit: 50, symbol: pair.exchangeSymbol }, pollMs });
  const items: SignalView[] = signals.data?.items ?? [];
  const overlay = React.useMemo(() => chartOverlayForLatestSignal(items), [items]);
  const exchange = meta?.marketData?.exchange ?? 'биржа';
  const intervalNote = meta?.strategy?.timeframes?.exec ?? '1h';

  const header = (
    <View>
      <View style={styles.toolbar}>
        <Text style={styles.title}>Пары V3.4</Text>
        <Text style={styles.subtitle}>
          {`Каноническая конфигурация · ${pairs.length} пар · ${exchange}, публичные данные`}
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pairRow}
        testID="pair-selector"
      >
        {pairs.map((p) => {
          const active = p.exchangeSymbol === pair.exchangeSymbol;
          return (
            <Pressable
              key={p.exchangeSymbol}
              testID={`pair-chip-${p.exchangeSymbol}`}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onSelect(p.exchangeSymbol)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.symbol}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {candles.data?.stale ? (
        <StaleBanner reason={candles.data.staleReason} asOf={candles.data.asOf} />
      ) : null}

      <View style={styles.chartCard} testID="market-chart">
        <View style={styles.chartHeader}>
          <Text style={styles.chartTitle} testID="chart-pair">{pair.symbol}</Text>
          <Text style={styles.chartSub}>{`1H · таймфрейм ${intervalNote}`}</Text>
        </View>

        {candles.phase === 'loading' ? (
          <View style={styles.chartPlaceholder} testID="chart-loading">
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.placeholderText}>Загружаем свечи с сервера…</Text>
          </View>
        ) : candles.phase === 'error' ? (
          <View style={styles.chartError} testID="chart-error">
            <Text style={styles.chartErrorTitle}>График недоступен</Text>
            <Text style={styles.chartErrorText}>
              {`${candles.error?.message ?? 'нет ответа сервера'}. Свечи не дорисовываются на телефоне.`}
            </Text>
            <Pressable onPress={() => { void candles.refresh(); }} testID="chart-retry" accessibilityRole="button" style={styles.retry}>
              <Text style={styles.retryText}>Повторить</Text>
            </Pressable>
          </View>
        ) : (
          <CandleChart candles={candles.data?.candles ?? []} overlay={overlay} testID="market-candles" />
        )}

        {candles.error && candles.data ? (
          <Text style={styles.refreshErrorText} testID="chart-refresh-error">
            {`Не удалось обновить график: ${candles.error.message}`}
          </Text>
        ) : null}

        <Text style={styles.legend} testID="chart-legend">
          {chartLegendText(signals.phase, overlay)}
        </Text>
        <Text style={styles.caption}>
          {candles.data?.source
            ? `Источник: ${candles.data.source.exchange} · получено сервером ${formatUtc(candles.data.asOf)}`
            : 'Данные графика отдаёт backend V3.4; телефон к бирже не обращается.'}
        </Text>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{`Сигналы · ${pair.symbol}`}</Text>
        {signals.data ? (
          <Text style={styles.sectionMeta}>{`всего ${signals.data.total}`}</Text>
        ) : null}
      </View>

      {signals.error && signals.data ? (
        <Text style={styles.refreshErrorText} testID="signals-refresh-error">
          {`Не удалось обновить сигналы: ${signals.error.message}`}
        </Text>
      ) : null}
    </View>
  );

  return (
    <FlatList
      testID="market-flatlist"
      data={signals.phase === 'ready' ? items : []}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <SignalCard signal={item} onPress={onOpenSignal} />}
      ListHeaderComponent={header}
      ListEmptyComponent={<SignalsPlaceholder phase={signals.phase} error={signals.error} pair={pair} asOf={signals.data?.asOf ?? null} onRetry={signals.refresh} />}
      contentContainerStyle={styles.listContent}
      refreshControl={
        <RefreshControl
          refreshing={signals.refreshing || candles.refreshing}
          onRefresh={() => {
            void signals.refresh();
            void candles.refresh();
          }}
          tintColor={colors.accent}
          colors={[colors.accent]}
        />
      }
    />
  );
}

function SignalsPlaceholder({
  phase, error, pair, asOf, onRetry,
}: {
  phase: 'loading' | 'ready' | 'error';
  error: { message: string } | null;
  pair: PairInfo;
  asOf: string | null;
  onRetry: () => Promise<void>;
}) {
  if (phase === 'loading') {
    return (
      <View style={styles.placeholder} testID="signals-loading">
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.placeholderText}>{`Загружаем сигналы ${pair.symbol}…`}</Text>
      </View>
    );
  }
  if (phase === 'error') {
    return (
      <View style={styles.placeholder} testID="signals-error">
        <Text style={styles.errorTitle}>Сигналы недоступны</Text>
        <Text style={styles.errorText}>{`${error?.message ?? 'нет ответа сервера'}. Пустой список вместо ошибки не показывается.`}</Text>
        <Pressable onPress={() => { void onRetry(); }} testID="signals-retry" accessibilityRole="button" style={styles.retry}>
          <Text style={styles.retryText}>Повторить</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.placeholder} testID="signals-empty">
      <Text style={styles.errorTitle}>Сигналов по паре нет</Text>
      <Text style={styles.errorText}>
        {`Сервер проверил рынок и не нашёл сетапов по ${pair.symbol}. Данные на ${formatUtc(asOf)}.`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm, gap: 2 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  subtitle: { color: colors.muted, fontSize: 12 },
  pairRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 40,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  chipTextActive: { color: colors.text },
  chartCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  chartHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  chartTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  chartSub: { color: colors.muted, fontSize: 11 },
  chartPlaceholder: { height: 140, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  placeholderText: { color: colors.muted, fontSize: 13, textAlign: 'center' },
  chartError: { gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
  chartErrorTitle: { color: colors.danger, fontSize: 14, fontWeight: '700' },
  chartErrorText: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  retry: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    minHeight: 40,
    justifyContent: 'center',
  },
  retryText: { color: colors.text, fontWeight: '600', fontSize: 12 },
  legend: { color: colors.text, fontSize: 12, fontWeight: '600' },
  caption: { color: colors.muted, fontSize: 11 },
  refreshErrorText: { color: colors.warn, fontSize: 12, marginHorizontal: spacing.lg, marginBottom: spacing.sm },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  sectionMeta: { color: colors.muted, fontSize: 12 },
  placeholder: { padding: spacing.lg, alignItems: 'center', gap: spacing.sm },
  errorTitle: { color: colors.text, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  errorText: { color: colors.muted, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  listContent: { paddingBottom: spacing.xxl },
});
