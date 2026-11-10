import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../theme';

export type ScreenStateMode = 'loading' | 'empty' | 'error';

export interface ScreenStateProps {
  mode: ScreenStateMode;
  title: string;
  message?: string | null;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}

/**
 * Единое состояние экрана: загрузка / пусто / ошибка.
 *
 * Пустой список и сетевая ошибка — РАЗНЫЕ экраны: пользователь должен
 * понимать, что сетапов нет, а не что приложение сломалось.
 */
export function ScreenState({ mode, title, message, actionLabel, onAction, testID }: ScreenStateProps) {
  return (
    <View style={styles.wrap} testID={testID ?? `state-${mode}`}>
      {mode === 'loading' ? <ActivityIndicator color={colors.accent} size="large" /> : null}
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: colors.bg,
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  message: { color: colors.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  action: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 44,
    justifyContent: 'center',
  },
  actionPressed: { backgroundColor: colors.surfaceAlt },
  actionText: { color: colors.text, fontWeight: '600' },
});
