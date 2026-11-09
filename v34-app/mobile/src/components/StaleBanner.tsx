import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../theme';
import { formatUtc } from '../format';

/**
 * Предупреждение об устаревших данных.
 *
 * Показывается, когда сервер не подтверждает свежесть. Молча показывать старые
 * сигналы как актуальные запрещено.
 */
export function StaleBanner({ reason, asOf }: { reason: string | null; asOf: string | null }) {
  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <Text style={styles.title}>Данные могут быть устаревшими</Text>
      <Text style={styles.text}>
        {reason ?? 'сервер не подтвердил актуальность данных'}
        {asOf ? ` · ответ сервера: ${formatUtc(asOf)}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.warnSoft,
    borderWidth: 1,
    borderColor: 'rgba(240,180,41,0.35)',
    borderRadius: radius.md,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    gap: 2,
  },
  title: { color: colors.warn, fontWeight: '700', fontSize: 13 },
  text: { color: colors.text, fontSize: 12, lineHeight: 18 },
});
