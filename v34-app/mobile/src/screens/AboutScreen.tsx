import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError, type ApiClient } from '../api/client';
import type { MetaResponse } from '../api/types';
import { Badge } from '../components/Badge';
import { ScreenState } from '../components/ScreenState';
import { formatUtc } from '../format';
import type { PushStatus } from '../notifications';
import { colors, radius, spacing } from '../theme';

export interface AboutScreenProps {
  api: ApiClient;
  apiBaseUrl: string;
  appVersion: string;
  pushStatus: PushStatus | null;
}

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; meta: MetaResponse }
  | { phase: 'error'; message: string };

const PUSH_STATUS_LABELS: Record<PushStatus['status'], string> = {
  registered: 'зарегистрировано',
  denied: 'запрещено пользователем',
  unavailable: 'недоступно',
  error: 'ошибка',
  disabled: 'отключено',
};

const DATA_STATUS_LABELS: Record<MetaResponse['engine']['dataStatus'], string> = {
  fresh: 'свежие',
  stale: 'устаревшие',
  error: 'ошибка данных',
  unknown: 'сканов ещё не было',
};

export function AboutScreen({ api, apiBaseUrl, appVersion, pushStatus }: AboutScreenProps) {
  const [state, setState] = React.useState<State>({ phase: 'loading' });

  const load = React.useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      setState({ phase: 'ready', meta: await api.getMeta() });
    } catch (e) {
      const message = e instanceof ApiError || e instanceof Error ? e.message : String(e);
      setState({ phase: 'error', message });
    }
  }, [api]);

  React.useEffect(() => { void load(); }, [load]);

  if (state.phase === 'loading') return <ScreenState mode="loading" title="Загружаем сведения о стратегии" />;
  if (state.phase === 'error') {
    return (
      <ScreenState
        mode="error"
        title="Сведения недоступны"
        message={`${state.message}. Приложение показывает только то, что сообщил сервер, и ничего не придумывает.`}
        actionLabel="Повторить"
        onAction={() => { void load(); }}
        testID="about-error"
      />
    );
  }

  const m = state.meta;
  const st = m.strategy;
  const lastScan = m.engine.lastScan;
  const devices = m.push.devices;

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content} testID="about-ready">
      <View style={styles.hero}>
        <Text style={styles.title}>CRYPTORA · {st.version}</Text>
        <Text style={styles.subtitle}>{st.nameRu}</Text>
        <Text style={styles.mono}>{st.id}</Text>
        <View style={styles.badgeRow}>
          <Badge label={st.badgeLabel || st.badge} tone="warn" />
          <Badge label={`API ${m.apiVersion}`} tone="neutral" />
          <Badge label={`сборка ${m.serverVersion}`} tone="neutral" />
        </View>
      </View>

      <Text style={styles.warning}>{st.researchNote}</Text>

      <Card title="Логика стратегии">
        <Paragraph text={st.description.short} />
        <Row label="Исполнение / контекст" value={`${st.timeframes.exec} / ${st.timeframes.context}`} />
        <Row label="Прогрев" value={`${st.warmupBars} баров`} />
        <Row label="Свечей за запрос" value={`${st.candleLimits['4h']} · 4h, ${st.candleLimits['1h']} · 1h`} />
        <Row label="Скан" value={`каждые ${m.engine.scanIntervalMs / 1000} с`} />
        <Row label="Коридор входа" value={st.description.entry} />
        <Row label="Стоп" value={st.description.stop} />
        <Row label="Цели" value={st.description.targets} />
        <Row label="Выход" value={st.exitRule} />
      </Card>

      <Card title="Гейты качества V3.4">
        <Row label="Коридор входа" value={`±${st.entryZoneHalfWidthAtr.toFixed(2)} ATR (0.10 V3.3 + ${st.qualityGates.entryZoneAtrPad} V3.4)`} />
        <Row label="TP1 минимум" value={`${st.qualityGates.tp1MinR} R`} />
        <Row label="TP2 минимум" value={`${st.qualityGates.tp2MinR} R`} />
      </Card>

      <Card title="Инструменты">
        <Row label="Вселенная" value={m.universe.symbols.join(', ')} />
        <Row label="Котировка" value={m.universe.quote} />
      </Card>

      <Card title="Данные рынка">
        <Row label="Источник" value={`${m.marketData.exchange} · ${m.marketData.venue}`} />
        <Row label="Адрес" value={m.marketData.baseUrl} />
        <Row label="Идентификатор" value={m.marketData.id} />
        <Row label="Только чтение" value={m.marketData.readOnly ? 'да' : 'нет'} />
        <Row label="Ключи API" value={m.marketData.apiKeysRequired ? 'требуются' : 'не требуются'} />
        <Row label="Выставление ордеров" value={m.marketData.orderPlacement ? 'ДА' : 'нет'} />
        <Row label="Модель комиссий" value={`${m.marketData.feeVenueAssumed} (2/5 bps)`} />
      </Card>

      <Card title="Состояние сканирования">
        <Row label="Статус данных" value={DATA_STATUS_LABELS[m.engine.dataStatus]} />
        {m.engine.staleReason ? <Row label="Причина" value={m.engine.staleReason} /> : null}
        <Row label="Последний скан" value={formatUtc(m.engine.lastScanAt)} />
        <Row label="Последний успешный" value={formatUtc(m.engine.lastSuccessfulScanAt)} />
        {lastScan ? (
          <>
            <Row label="Результат скана" value={`${lastScan.status} · ${lastScan.symbolsOk}/${lastScan.symbolsTotal} символов`} />
            <Row label="Новых сигналов" value={String(lastScan.signalsNew)} />
            {lastScan.error ? <Row label="Ошибка скана" value={lastScan.error} /> : null}
          </>
        ) : null}
        {m.engine.perSymbol.map((s) => (
          <View key={s.symbol} style={styles.symbolRow}>
            <Text style={styles.symbolName}>{s.symbol}</Text>
            <Text style={[styles.symbolValue, s.dataError ? styles.symbolError : null]} numberOfLines={2}>
              {s.dataError
                ? `ошибка: ${s.dataError}`
                : `1h: ${s.closedBars['1h']} · 4h: ${s.closedBars['4h']} · пробелов: ${s.gaps1h}`}
            </Text>
          </View>
        ))}
      </Card>

      <Card title="Уведомления">
        <Row label="Состояние на устройстве" value={pushStatus ? PUSH_STATUS_LABELS[pushStatus.status] : 'не проверялось'} />
        <Row label="Детали" value={pushStatus ? pushStatus.message : 'проверка не выполнялась'} />
        <Row label="Push на сервере" value={m.push.configured ? 'настроен' : `не настроен${m.push.missing.length ? ` (нет: ${m.push.missing.join(', ')})` : ''}`} />
        {m.push.reason ? <Row label="Причина" value={m.push.reason} /> : null}
        {devices ? <Row label="Устройств" value={`${devices.enabled} активных из ${devices.total}`} /> : null}
        {!m.push.configured ? (
          <Text style={styles.hint}>
            Чтобы уведомления действительно приходили, нужны: Firebase-проект, файл
            google-services.json в сборке Android и ключ сервисного аккаунта FCM в окружении
            сервера (вне Git). Без них приложение честно показывает, что push не настроен.
          </Text>
        ) : null}
      </Card>

      <Card title="Ограничения">
        {st.description.limitations.map((line) => (
          <Text key={line} style={styles.hint}>• {line}</Text>
        ))}
        <Text style={styles.hint}>{st.description.riskNote}</Text>
      </Card>

      <Card title="Сервер и приложение">
        <Row label="API" value={apiBaseUrl} />
        <Row label="Версия сервера" value={m.serverVersion} />
        <Row label="Минимальная версия приложения" value={m.minAppVersion} />
        <Row label="Версия приложения" value={appVersion} />
        <Row label="Время сервера" value={formatUtc(m.serverTime)} />
      </Card>

      <Text style={styles.footer}>{m.disclaimer}</Text>
      <Text style={styles.footer}>
        Приложение отображает только подтверждённые сервером значения: уровни, статус, события
        TP1/TP2, безубыток и действующий стоп. Оно не считает стратегию на телефоне, не выставляет
        ордера и не подключается к торговому счёту.
      </Text>
    </ScrollView>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <View style={styles.cardBody}>{children}</View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={4}>{value}</Text>
    </View>
  );
}

function Paragraph({ text }: { text: string }) {
  return <Text style={styles.paragraph}>{text}</Text>;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  hero: { gap: spacing.xs },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  subtitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  mono: { color: colors.muted, fontSize: 11 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  warning: {
    color: colors.warnText,
    backgroundColor: colors.warnBg,
    borderColor: colors.warnBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 12,
    lineHeight: 18,
  },
  card: { gap: spacing.sm },
  cardTitle: { color: colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  cardBody: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, alignItems: 'flex-start' },
  rowLabel: { color: colors.muted, fontSize: 13, flexShrink: 1, maxWidth: '42%' },
  rowValue: { color: colors.text, fontSize: 13, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  paragraph: { color: colors.text, fontSize: 13, lineHeight: 19 },
  symbolRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  symbolName: { color: colors.text, fontSize: 12, fontWeight: '600' },
  symbolValue: { color: colors.muted, fontSize: 12, textAlign: 'right', flexShrink: 1 },
  symbolError: { color: colors.danger },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  footer: { color: colors.muted, fontSize: 11, lineHeight: 16 },
});
