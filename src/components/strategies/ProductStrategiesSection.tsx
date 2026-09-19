import React, { useMemo, useState } from 'react';
import { AlertTriangle, Cpu, FileCode2, Info, Layers } from 'lucide-react';
import { Badge } from '@/components/common/Badge';
import { Collapsible } from '@/components/common/Collapsible';
import { buildArchiveCards, type ArchiveCardModel } from '@/services/strategyArchive';

/**
 * Три продуктовые стратегии, подключённые к LiveSignalEngine.
 *
 * Единственный источник истины — реестр `strategyArchive`. Математика стратегий
 * здесь только читается для отображения и не переопределяется.
 */
export const PRODUCT_STRATEGY_IDS = [
  'V3_0_HTF_LIQUIDATION_TRAP',
  'V3_3_HTF_ZONE_MITIGATION',
  'V2_8_ZERO_FEE_SNIPER_TRAILING',
] as const;

/**
 * Честные подписи статуса исследования.
 *
 * Правило: UI не имеет права обещать больше, чем доказано. «Рабочая»,
 * «прибыльная» и «проверенная в live» запрещены — этих доказательств нет.
 * Ключ — фактический `verdict` из реестра.
 */
const STATUS_UI: Record<
  string,
  { label: string; tone: 'green' | 'amber' | 'red' | 'cyan' | 'neutral'; hint: string }
> = {
  VALIDATED_FOR_RESEARCH: {
    label: 'Research validated',
    tone: 'green',
    hint: 'Источник прогнал стратегию на TRAIN и VALIDATION. Это подтверждение исследуемости, а не доходности: часть пар на VALIDATION отрицательна.',
  },
  TRAIN_ONLY_NOT_VALIDATED: {
    label: 'Train only',
    tone: 'amber',
    hint: 'Окно VALIDATION уже израсходовано другой версией — независимой проверки на валидации нет. К цифрам следует относиться как к гипотезе.',
  },
  VALIDATED_GROSS_ONLY: {
    label: 'Gross-only validated',
    tone: 'amber',
    hint: 'Все цифры получены при нулевых комиссиях. С реальной комиссией популяция становится отрицательной, поэтому статус — только gross.',
  },
};

/** Короткие описания: 1–2 строки, строго по фактическим правилам реестра. */
const SHORT_DESCRIPTION: Record<string, string> = {
  V3_0_HTF_LIQUIDATION_TRAP:
    '1H-свеча выносит подтверждённый 4H swing и закрывается обратно; вход лимитом в коридоре ±0.10 ATR. Две цели: середина 4H-диапазона и противоположный swing.',
  V3_3_HTF_ZONE_MITIGATION:
    'Зоны 4H (Order Block / FVG) после displacement. Вход на 1H при митигации зоны и поглощении; TP1 — середина ноги, TP2 — противоположный swing.',
  V2_8_ZERO_FEE_SNIPER_TRAILING:
    'Снайпер-реверсал на замороженном движке V2 с 8-условным фильтром и трейлингом от MFE. Все результаты — gross при нулевых комиссиях.',
};

/** Категория сетапа — для быстрой ориентации, без оценки качества. */
const CATEGORY: Record<string, string> = {
  V3_0_HTF_LIQUIDATION_TRAP: 'HTF Liquidity Trap',
  V3_3_HTF_ZONE_MITIGATION: 'SMC · Order Block / FVG',
  V2_8_ZERO_FEE_SNIPER_TRAILING: 'Reversal Sniper + Trailing',
};

/** Подписи блоков правил в карточке. */
const RULE_LABELS: Record<string, string> = {
  zones: 'Зоны',
  mitigation: 'Митигация',
  entry: 'Entry logic',
  confirm: 'Подтверждение',
  fill: 'Исполнение лимита',
  stop: 'Stop Loss',
  targets: 'Take Profit',
  exit: 'Exit logic',
  exitTrail: 'Trailing',
  exitOthers: 'Прочие ветки выхода',
  timeout: 'Таймаут',
  intrabar: 'Внутрибарные правила',
  fees: 'Комиссии',
  scope: 'Охват',
};

/** Порядок, в котором правила читаются как «как входит / как выходит». */
const RULE_ORDER = [
  'zones', 'mitigation', 'entry', 'confirm', 'fill', 'stop',
  'targets', 'exit', 'exitTrail', 'exitOthers', 'timeout', 'intrabar', 'fees', 'scope',
];

export const ProductStrategiesSection: React.FC = () => {
  const cards = useMemo(
    () =>
      buildArchiveCards()
        .filter((c) => (PRODUCT_STRATEGY_IDS as readonly string[]).includes(c.id))
        // Фиксированный продуктовый порядок: V3.0 → V3.3 → V2.8.
        .sort(
          (a, b) =>
            PRODUCT_STRATEGY_IDS.indexOf(a.id as (typeof PRODUCT_STRATEGY_IDS)[number]) -
            PRODUCT_STRATEGY_IDS.indexOf(b.id as (typeof PRODUCT_STRATEGY_IDS)[number]),
        ),
    [],
  );

  return (
    <section
      data-testid="product-strategies"
      aria-label="Стратегии CRYPTORA"
      className="grid grid-cols-1 gap-3 lg:grid-cols-3"
    >
      {cards.map((card) => (
        <ProductStrategyCard key={card.id} card={card} />
      ))}
    </section>
  );
};

const ProductStrategyCard: React.FC<{ card: ArchiveCardModel }> = ({ card: c }) => {
  const status = STATUS_UI[c.verdict] ?? {
    label: c.verdictLabelRu,
    tone: 'neutral' as const,
    hint: '',
  };
  const description = SHORT_DESCRIPTION[c.id] ?? c.nameRu;
  const [open, setOpen] = useState(false);

  const rules = RULE_ORDER.filter((k) => c.rulesRu[k]).map((k) => [
    RULE_LABELS[k] ?? k,
    c.rulesRu[k] as string,
  ]);

  return (
    <article
      data-testid={`product-strategy-${c.id}`}
      className="flex flex-col rounded-lg border border-surface-border bg-surface p-3.5 shadow-panel transition-colors hover:border-brand-cyan/25"
    >
      {/* ── Primary UI: версия, имя, статус ─────────────────────────── */}
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="ui-label font-mono text-brand-cyan">V{c.version}</div>
            <h3 className="ui-card-title mt-0.5 break-words">{c.name}</h3>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Badge variant={status.tone} size="xs">{status.label}</Badge>
            {status.hint && (
              <span className="group relative">
                <Info
                  aria-label={status.hint}
                  className="h-3.5 w-3.5 cursor-help text-slate-500"
                />
                <span
                  role="tooltip"
                  className="pointer-events-none absolute right-0 top-5 z-20 hidden w-60 rounded-md border border-surface-border bg-surface-elevated p-2 text-[11px] font-normal leading-relaxed text-slate-300 shadow-xl group-hover:block"
                >
                  {status.hint}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* Timeframe + категория */}
        <dl className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <div className="flex items-center gap-1">
            <dt className="ui-label">Timeframe</dt>
            <dd className="ui-num text-slate-200">{c.assumptions.execTimeframe}</dd>
          </div>
          <div className="flex items-center gap-1">
            <dt className="ui-label">Структура</dt>
            <dd className="ui-num text-slate-200">{c.assumptions.structuralTimeframe}</dd>
          </div>
          <div className="flex items-center gap-1">
            <dt className="sr-only">Тип</dt>
            <dd>
              <Badge variant="cyan" size="xs">{CATEGORY[c.id] ?? 'Strategy'}</Badge>
            </dd>
          </div>
        </dl>

        <p className="ui-secondary text-slate-400">{description}</p>
      </header>

      {/* ── Действие ─────────────────────────────────────────────────
          Переключателя ВКЛ/ВЫКЛ намеренно нет: это следующий backend-этап.
          Декоративный switch без сохранения состояния здесь был бы обманом. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`details-${c.id}`}
        className="mt-3 inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-md border border-surface-border px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-brand-cyan/40 hover:text-white"
      >
        {open ? 'Свернуть' : 'Подробнее'}
      </button>

      <div id={`details-${c.id}`} hidden={!open} className="mt-3 space-y-2.5">
        {/* Логика — обычный sans-serif: это описания, а не технические ID. */}
        <div className="space-y-2">
          {rules.map(([label, text]) => (
            <div key={label} className="rounded-md border border-surface-border/60 bg-surface-2/40 p-2.5">
              <div className="ui-label mb-0.5">{label}</div>
              <p className="ui-secondary text-[11px] text-slate-300">{text}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded-md border border-surface-border/60 bg-surface-2/40 p-2.5">
            <div className="ui-label mb-1">Backtest status</div>
            <div className="ui-secondary text-[11px]">Проверка: {c.assumptions.validationType}</div>
            <div className="ui-secondary text-[11px]">Комиссии: {c.assumptions.feeModel}</div>
            <div className="ui-secondary text-[11px]">
              Воспроизведение: {c.reproLabelRu}
            </div>
          </div>
          <div className="rounded-md border border-surface-border/60 bg-surface-2/40 p-2.5">
            <div className="ui-label mb-1">Охват</div>
            <div className="ui-secondary text-[11px]">{c.assumptions.symbols}</div>
            <div className="ui-secondary text-[11px]">{c.assumptions.period}</div>
          </div>
        </div>

        {/* Замечание по результатам — фактический текст реестра, без смягчений. */}
        <div className="rounded-md border border-surface-border/60 bg-surface-2/40 p-2.5">
          <div className="ui-label mb-1">Research notes</div>
          <p className="ui-secondary text-[11px] text-slate-300">{c.headlineNoteRu}</p>
        </div>

        {/* Риски и ограничения — всегда свёрнуты по умолчанию. */}
        <Collapsible
          testId={`risks-${c.id}`}
          tone="warning"
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          label="Риски и ограничения"
          count={c.caveatsRu.length}
        >
          <ul className="list-disc space-y-1 pl-4">
            {c.caveatsRu.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Collapsible>

        {c.discrepancies.length > 0 && (
          <Collapsible
            testId={`discrepancies-${c.id}`}
            icon={<FileCode2 className="h-3.5 w-3.5" />}
            label="Расхождения спецификация ↔ код"
            count={c.discrepancies.length}
          >
            <div className="space-y-1.5">
              {c.discrepancies.map((d) => (
                <div key={d.id} className="border-l-2 border-surface-border pl-2">
                  <span className="ui-hash">{d.id}</span> · спецификация: {d.specStatement}{' '}
                  <span className="text-slate-500">→</span> исследование: {d.researchBehaviour}{' '}
                  <span className="text-slate-500">Политика: сохранить поведение исследования.</span>
                </div>
              ))}
            </div>
          </Collapsible>
        )}

        {/* Происхождение и хеши — только внутри технических сведений. */}
        <Collapsible
          testId={`technical-${c.id}`}
          tone="muted"
          icon={<Layers className="h-3.5 w-3.5" />}
          label="Технические сведения"
        >
          <dl className="space-y-1">
            <div>
              <dt className="ui-label inline">Source pin: </dt>
              <dd className="ui-hash inline">{c.provenance.sourcePin}</dd>
            </div>
            <div>
              <dt className="ui-label inline">Dataset: </dt>
              <dd className="ui-hash inline">{c.provenance.dataset}</dd>
            </div>
            <div className="ui-helper">
              {c.provenance.artifactCount} артефакт(ов) sha256 · {c.provenance.discrepancyCount} расхожд. ·{' '}
              {c.variantCount} вариант(ов)
            </div>
            {c.provenance.frozenEngine && (
              <div className="ui-helper">
                Входы: frozen V2 engine <span className="ui-hash">{c.provenance.frozenEngine}</span> (только архив)
              </div>
            )}
            {c.reproducedTradeCounts.length > 0 && (
              <div className="ui-hash">
                Перезапуск: {c.reproducedTradeCounts.map((e) => `${e.slice} n=${e.n}`).join('; ')}
              </div>
            )}
          </dl>
        </Collapsible>
      </div>
    </article>
  );
};

/** Иконка раздела — вынесена, чтобы страница не импортировала её повторно. */
export const StrategiesSectionIcon = Cpu;
