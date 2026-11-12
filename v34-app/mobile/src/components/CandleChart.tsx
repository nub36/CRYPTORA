/**
 * График свечей без нативных зависимостей (обычные View).
 *
 * Почему не библиотека графиков: лишний нативный модуль — лишняя причина, по
 * которой standalone APK может не запуститься. Здесь достаточно прямоугольников,
 * и это полностью проверяется тестами.
 *
 * Данные — только с сервера: `candles` пришли из `/api/v1/candles`, `overlay`
 * собран из серверного сигнала (см. chartLevels.ts). Компонент не сглаживает,
 * не интерполирует и не досчитывает бары.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Candle } from '../api/types';
import { formatPrice } from '../format';
import type { ChartOverlay } from '../chartLevels';
import { colors, radius, spacing } from '../theme';

export interface CandleChartProps {
  candles: readonly Candle[];
  overlay?: ChartOverlay | null;
  height?: number;
  testID?: string;
}

const LEVEL_COLORS: Record<string, string> = {
  entry: colors.accent,
  stop: colors.danger,
  target: colors.long,
  be: colors.warn,
};

export function CandleChart({ candles, overlay = null, height = 200, testID = 'candle-chart' }: CandleChartProps) {
  const [width, setWidth] = React.useState(0);
  const levels = overlay?.levels ?? [];
  const zone = overlay?.zone ?? null;

  const { min, max } = React.useMemo(() => {
    if (candles.length === 0) return { min: 0, max: 1 };
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const c of candles) {
      lo = Math.min(lo, c.low);
      hi = Math.max(hi, c.high);
    }
    if (zone) {
      lo = Math.min(lo, zone.low);
      hi = Math.max(hi, zone.high);
    }
    for (const level of levels) {
      lo = Math.min(lo, level.price);
      hi = Math.max(hi, level.price);
    }
    // Нулевой диапазон (плоский ряд) — не повод делить на ноль.
    if (!(hi > lo)) {
      const pad = Math.abs(hi) * 0.001 || 1;
      return { min: lo - pad, max: hi + pad };
    }
    const pad = (hi - lo) * 0.04;
    return { min: lo - pad, max: hi + pad };
  }, [candles, levels, zone]);

  const y = React.useCallback(
    (price: number) => ((max - price) / (max - min)) * height,
    [max, min, height],
  );

  if (candles.length === 0) {
    return (
      <View style={styles.empty} testID={`${testID}-empty`}>
        <Text style={styles.emptyText}>Свечи с сервера не получены</Text>
      </View>
    );
  }

  const plotWidth = width > 0 ? width : 320;
  const step = plotWidth / candles.length;
  const bodyWidth = Math.max(1, Math.min(14, step * 0.62));

  return (
    <View
      style={[styles.wrap, { height }]}
      testID={testID}
      accessible
      accessibilityLabel={`График: ${candles.length} свечей, уровней ${levels.length}`}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {zone ? (
        <View
          testID={`${testID}-zone`}
          style={[
            styles.zone,
            {
              top: y(zone.high),
              height: Math.max(1, y(zone.low) - y(zone.high)),
            },
          ]}
        />
      ) : null}

      {candles.map((candle, index) => {
        const up = candle.close >= candle.open;
        const color = up ? colors.long : colors.short;
        const bodyTop = y(Math.max(candle.open, candle.close));
        const bodyHeight = Math.max(1, Math.abs(y(candle.open) - y(candle.close)));
        return (
          <React.Fragment key={`${candle.time}-${index}`}>
            <View
              style={[
                styles.wick,
                { left: index * step + (step - 1) / 2, top: y(candle.high), height: Math.max(1, y(candle.low) - y(candle.high)), backgroundColor: color },
              ]}
            />
            <View
              testID={`${testID}-candle-${index}`}
              style={[
                styles.body,
                { left: index * step + (step - bodyWidth) / 2, top: bodyTop, height: bodyHeight, width: bodyWidth, backgroundColor: color },
              ]}
            />
          </React.Fragment>
        );
      })}

      {levels.map((level) => (
        <View
          key={level.key}
          testID={`${testID}-level-${level.key}`}
          style={[styles.levelLine, { top: Math.max(0, Math.min(height - 1, y(level.price))), backgroundColor: LEVEL_COLORS[level.tone] ?? colors.muted }]}
        >
          <Text
            testID={`${testID}-level-label-${level.key}`}
            numberOfLines={1}
            style={[styles.levelLabel, { color: LEVEL_COLORS[level.tone] ?? colors.muted }]}
          >
            {`${level.label} ${formatPrice(level.price)}`}
          </Text>
        </View>
      ))}

      <Text style={styles.axisTop} testID={`${testID}-axis-max`}>{formatPrice(max)}</Text>
      <Text style={styles.axisBottom} testID={`${testID}-axis-min`}>{formatPrice(min)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  empty: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyText: { color: colors.muted, fontSize: 13 },
  zone: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: 'rgba(74,222,128,0.10)',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(74,222,128,0.30)',
  },
  wick: { position: 'absolute', width: 1 },
  body: { position: 'absolute', borderRadius: 1 },
  levelLine: { position: 'absolute', left: 0, right: 0, height: 1 },
  levelLabel: {
    position: 'absolute',
    right: spacing.xs,
    top: -13,
    fontSize: 10,
    fontWeight: '700',
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 3,
  },
  axisTop: { position: 'absolute', left: spacing.xs, top: spacing.xs, color: colors.muted, fontSize: 10 },
  axisBottom: { position: 'absolute', left: spacing.xs, bottom: spacing.xs, color: colors.muted, fontSize: 10 },
});
