/**
 * SignalsLedgerAuditSection — второстепенная «Статистика и аудит» (§13).
 *
 * Прежний экран ставил крупные KPI-карты и SHA-плашку в главный фокус. Здесь
 * та же функциональность сохранена, но убрана в сворачиваемый блок: полезный
 * аудит не удалён, однако он больше не занимает первый мобильный экран.
 *
 * Разделение источников (§8, RULES §1): серверная лента (`/api/signals`) —
 * основной источник этого экрана, а браузерный журнал (`SignalsAuditLedger`) —
 * отдельный локальный журнал аудита. Их числа НЕ смешиваются: каждая метрика
 * подписана своим источником.
 */

import React from 'react';
import { Shield, Check } from 'lucide-react';
import type { SignalsPerformanceSummary } from '@/services/signals/SignalsAuditLedger';
import { Collapsible } from '@/components/common/Collapsible';

export interface ServerSignalsStats {
  /** Сколько сигналов выбранного инструмента загружено (страница + догрузки). */
  loaded: number;
  /** Всего сигналов инструмента под фильтром (из ответа сервера). */
  total: number;
  /** Открытых (ACTIVE + FILLED). */
  open: number;
  /** Со сделкой/исходом (есть R). */
  withOutcome: number;
}

interface SignalsLedgerAuditSectionProps {
  serverStats: ServerSignalsStats | null;
  ledgerSummary: SignalsPerformanceSummary | null;
  integrityVerified: boolean | null;
}

export const SignalsLedgerAuditSection: React.FC<SignalsLedgerAuditSectionProps> = ({
  serverStats,
  ledgerSummary,
  integrityVerified,
}) => {
  return (
    <section data-qa="signals-audit-section" aria-label="Статистика и аудит">
      <Collapsible
        testId="signals-stats"
        tone="muted"
        label="Статистика и аудит"
        hint="серверная лента и браузерный журнал — отдельно"
      >
        {/* Компактная серверная статистика по выбранному инструменту. */}
        <div className="rounded border border-surface-border/60 bg-surface-elevated/40 p-3">
          <div className="ui-card-title mb-1">Серверная лента — выбранный инструмент</div>
          {serverStats ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              <div><span className="ui-label">Загружено: </span><span className="ui-num text-slate-200">{serverStats.loaded}</span></div>
              <div><span className="ui-label">Всего: </span><span className="ui-num text-slate-200">{serverStats.total}</span></div>
              <div><span className="ui-label">Открытых: </span><span className="ui-num text-slate-200">{serverStats.open}</span></div>
              <div><span className="ui-label">С исходом: </span><span className="ui-num text-slate-200">{serverStats.withOutcome}</span></div>
            </div>
          ) : (
            <p className="ui-helper">Серверная лента не загружена.</p>
          )}
          <p className="ui-helper mt-2">
            Считается только по загруженной странице ленты выбранной монеты; глобальные доли и проценты по
            малой выборке не выводятся, чтобы не создавать «красивую» статистику на нескольких сделках.
          </p>
        </div>

        {/* Браузерный журнал аудита — отдельный источник, не смешивается с сервером. */}
        <div className="mt-3 rounded border border-surface-border/60 bg-surface-elevated/40 p-3" data-qa="signals-ledger-audit">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="ui-card-title">Браузерный журнал аудита</div>
            <span className="flex items-center gap-1 text-xs font-semibold">
              {integrityVerified === null ? (
                <span className="text-slate-500">недоступен</span>
              ) : integrityVerified ? (
                <span className="flex items-center gap-1 text-brand-green"><Check className="h-4 w-4" />SHA-256 OK</span>
              ) : (
                <span className="text-rose-400">Ошибка хэша</span>
              )}
            </span>
          </div>
          {ledgerSummary ? (
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              <div><span className="ui-label">Сетапов: </span><span className="ui-num text-slate-200">{ledgerSummary.totalSetups}</span></div>
              <div><span className="ui-label">Открытых: </span><span className="ui-num text-slate-200">{ledgerSummary.activeCount + ledgerSummary.filledCount}</span></div>
              <div><span className="ui-label">Сделок с исходом: </span><span className="ui-num text-slate-200">{ledgerSummary.tradesClosed}</span></div>
              <div><span className="ui-label">Доля R &gt; 0: </span><span className="ui-num text-slate-200">{ledgerSummary.tradesClosed === 0 ? '—' : `${ledgerSummary.accuracyRatePct}%`}</span></div>
            </div>
          ) : (
            <p className="ui-helper mt-1">Журнал пуст или недоступен в этом режиме.</p>
          )}
          <p className="ui-helper mt-2">
            Это локальный журнал этого браузера (публикация и исход хэшируются раздельно). Он независим от
            серверной ленты выше; расхождения по охвату окна и моменту публикации ожидаемы и объяснимы.
          </p>
        </div>
      </Collapsible>

      {/* Кодекс прозрачности — сохранён, но второстепенен. */}
      <Collapsible
        testId="signals-code-of-transparency"
        tone="muted"
        icon={<Shield className="h-4 w-4 text-brand-green" />}
        label="Кодекс прозрачности сигналов"
        hint="журнал, статистика, опровергающие факторы"
        className="mt-2"
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <div className="ui-card-title mb-0.5">Неизменяемый журнал</div>
            <p className="ui-helper">
              Публикация сетапа фиксируется цепочным SHA-256 в момент закрытия бара; исход дописывается один
              раз и хэшируется отдельно. Ни один сигнал нельзя удалить или отредактировать задним числом.
            </p>
          </div>
          <div>
            <div className="ui-card-title mb-0.5">Честная статистика</div>
            <p className="ui-helper">
              Исходы считаются по закрытым свечам по правилам самой стратегии и включают убыточные сделки и
              отмены. Заявлений вида «98 % точности» здесь нет.
            </p>
          </div>
          <div>
            <div className="ui-card-title mb-0.5">Опровергающие аргументы</div>
            <p className="ui-helper">
              Каждый сетап содержит не только подтверждающие факторы, но и условия отмены, риски и
              исследовательский вердикт стратегии.
            </p>
          </div>
        </div>
      </Collapsible>
    </section>
  );
};

export default SignalsLedgerAuditSection;
