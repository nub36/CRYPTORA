/**
 * Корневой компонент приложения V3.4.
 *
 * Задачи:
 *   • собрать API-клиент из конфигурации сборки и честно показать ошибку,
 *     если адрес сервера не задан;
 *   • переключать «Сигналы» / «О приложении» без навигационной библиотеки
 *     (меньше зависимостей — меньше поверхность отказа);
 *   • открывать детальный экран и закрывать его аппаратной кнопкой «назад»;
 *   • один раз при старте попытаться настроить push и показать фактический
 *     результат, а не «всё хорошо».
 *
 * Никакой логики стратегии здесь нет и быть не может.
 */
import React from 'react';
import {
  BackHandler, Platform, Pressable, StatusBar, StyleSheet, Text, View,
} from 'react-native';
import Constants from 'expo-constants';
import { ApiError, createApiClient, type ApiClient } from './src/api/client';
import { ScreenState } from './src/components/ScreenState';
import { AboutScreen } from './src/screens/AboutScreen';
import { SignalDetailScreen } from './src/screens/SignalDetailScreen';
import { SignalsListScreen } from './src/screens/SignalsListScreen';
import { resolveApiBaseUrl, resolveAppVersion } from './src/config';
import { setupPushNotifications, type PushStatus } from './src/notifications';
import { colors, spacing } from './src/theme';

type Tab = 'signals' | 'about';

const APP_VERSION = resolveAppVersion(Constants.expoConfig);

export default function App() {
  const apiBaseUrl = resolveApiBaseUrl(Constants.expoConfig);

  const client = React.useMemo<{ api: ApiClient } | { error: string }>(() => {
    try {
      return { api: createApiClient({ baseUrl: apiBaseUrl }) };
    } catch (e) {
      return { error: e instanceof ApiError || e instanceof Error ? e.message : String(e) };
    }
  }, [apiBaseUrl]);

  const [tab, setTab] = React.useState<Tab>('signals');
  const [openSignalId, setOpenSignalId] = React.useState<string | null>(null);
  const [pushStatus, setPushStatus] = React.useState<PushStatus | null>(null);

  const api = 'api' in client ? client.api : null;

  React.useEffect(() => {
    if (!api) return;
    let alive = true;
    void (async () => {
      const status = await setupPushNotifications({ client: api, enabled: Platform.OS === 'android' });
      if (alive) setPushStatus(status);
    })();
    return () => { alive = false; };
  }, [api]);

  React.useEffect(() => {
    if (!openSignalId) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpenSignalId(null);
      return true;
    });
    return () => sub.remove();
  }, [openSignalId]);

  if ('error' in client) {
    return (
      <View style={[styles.safe, styles.topInset]}>
        <StatusBar barStyle="light-content" />
        <ScreenState
          mode="error"
          title="Сервер не настроен"
          message={`${client.error}. Укажите адрес backend при сборке: EXPO_PUBLIC_API_BASE_URL или extra.apiBaseUrl в app.config.js. Без него приложение не показывает сигналы.`}
          testID="app-config-error"
        />
      </View>
    );
  }

  return (
    <View style={[styles.safe, styles.topInset]}>
      <StatusBar barStyle="light-content" />
      {openSignalId ? (
        <SignalDetailScreen
          api={api as ApiClient}
          signalId={openSignalId}
          onBack={() => setOpenSignalId(null)}
        />
      ) : tab === 'signals' ? (
        <SignalsListScreen api={api as ApiClient} onOpenSignal={(id) => setOpenSignalId(id)} />
      ) : (
        <AboutScreen
          api={api as ApiClient}
          apiBaseUrl={apiBaseUrl}
          appVersion={APP_VERSION}
          pushStatus={pushStatus}
        />
      )}

      {openSignalId ? null : (
        <View style={styles.tabBar}>
          <TabButton label="Сигналы" active={tab === 'signals'} onPress={() => setTab('signals')} testID="tab-signals" />
          <TabButton label="О приложении" active={tab === 'about'} onPress={() => setTab('about')} testID="tab-about" />
        </View>
      )}
    </View>
  );
}

function TabButton({ label, active, onPress, testID }: {
  label: string; active: boolean; onPress: () => void; testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      testID={testID}
      style={[styles.tabButton, active && styles.tabButtonActive]}
    >
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  // Отступ под строку состояния: SafeAreaView в RN 0.88 объявлен устаревшим.
  topInset: { paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingBottom: Platform.OS === 'android' ? spacing.sm : 0,
  },
  tabButton: { flex: 1, paddingVertical: spacing.md, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  tabButtonActive: { backgroundColor: colors.surfaceAlt },
  tabLabel: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  tabLabelActive: { color: colors.accent },
});
