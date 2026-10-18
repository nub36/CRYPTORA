/**
 * SignalProgressBadges — бейджи подтверждённого lifecycle-прогресса (Signals UI V1).
 *
 * Показывает ТОЛЬКО факты из серверной проекции (`SignalProgressModel`):
 * взят ли TP1/TP2, взведён ли безубыток, сработал ли стоп. Решения
 * «достигнуто / нет» здесь нет — оно принято сервером по журналу и исходу;
 * компонент решает лишь «показывать / не показывать» по флагам.
 *
 * Пустое состояние (все флаги ложны — прогресс неизвестен либо его нет) —
 * это null, а не «нет событий»: отсутствие бейджа не утверждает отсутствия
 * факта, оно означает «подтверждённого факта для показа нет».
 */

import React from 'react';
import type { SignalProgressModel } from '@/services/signals/ui/signalUiModel';
import {
  breakevenBadgeText,
  stopHitBadgeText,
  tp1BadgeText,
  tp2BadgeText,
} from '@/utils/serverSignalText';
import { Badge } from '@/components/common/Badge';

interface SignalProgressBadgesProps {
  progress: SignalProgressModel | null | undefined;
  /** Размер бейджей (compact по умолчанию — строка заголовка деталей). */
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

export const SignalProgressBadges: React.FC<SignalProgressBadgesProps> = ({
  progress,
  size = 'xs',
  className = '',
}) => {
  if (!progress) return null;
  const badges: Array<{ key: string; qa: string; variant: 'green' | 'cyan' | 'amber' | 'red'; text: string }> = [];
  if (progress.tp1Hit) {
    badges.push({ key: 'tp1', qa: 'signals-progress-tp1', variant: 'green', text: tp1BadgeText() });
  }
  if (progress.breakevenArmed) {
    badges.push({
      key: 'be',
      qa: 'signals-progress-be',
      variant: 'cyan',
      text: breakevenBadgeText(progress.currentStop),
    });
  }
  if (progress.tp2Hit) {
    badges.push({ key: 'tp2', qa: 'signals-progress-tp2', variant: 'amber', text: tp2BadgeText() });
  }
  if (progress.stopHit) {
    badges.push({ key: 'stop', qa: 'signals-progress-stop', variant: 'red', text: stopHitBadgeText() });
  }
  if (badges.length === 0) return null;

  return (
    <span
      data-qa="signals-progress-badges"
      className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}
      aria-label="Подтверждённый прогресс сигнала"
    >
      {badges.map((b) => (
        <span key={b.key} data-qa={b.qa} className="inline-flex">
          <Badge variant={b.variant} size={size}>
            {b.text}
          </Badge>
        </span>
      ))}
    </span>
  );
};

export default SignalProgressBadges;
