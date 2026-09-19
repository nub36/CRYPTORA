import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export type CollapsibleTone = 'neutral' | 'warning' | 'muted';

const TONE_TRIGGER: Record<CollapsibleTone, string> = {
  neutral: 'text-slate-300 hover:text-white',
  warning: 'text-amber-300 hover:text-amber-200',
  muted: 'text-slate-500 hover:text-slate-300',
};

const TONE_BODY: Record<CollapsibleTone, string> = {
  neutral: 'border-surface-border bg-surface-2/40 text-slate-300',
  warning: 'border-amber-500/30 bg-amber-500/[0.05] text-amber-100/90',
  muted: 'border-surface-border/60 bg-surface-2/30 text-slate-400',
};

export interface CollapsibleProps {
  /** Заголовок триггера. */
  label: React.ReactNode;
  children: React.ReactNode;
  /** Иконка слева от подписи (необязательно). */
  icon?: React.ReactNode;
  /** Счётчик в подписи, например количество оговорок. */
  count?: number;
  /** Подсказка справа от подписи, видна только в свёрнутом состоянии. */
  hint?: string;
  /** Развёрнуто по умолчанию. Для рисков/оговорок/техсведений — всегда false. */
  defaultOpen?: boolean;
  /**
   * Монтировать содержимое только при первом раскрытии.
   *
   * Нужно для тяжёлых блоков (исследовательский архив на 13 карточек, журнал
   * бэктеста): без этого они строились бы на первом рендере страницы, хотя
   * пользователь их почти никогда не открывает. Короткие юридические и
   * рисковые тексты, наоборот, должны оставаться в DOM — поэтому default false.
   */
  mountOnOpen?: boolean;
  tone?: CollapsibleTone;
  /** Идентификатор для тестов и QA. */
  testId?: string;
  className?: string;
  bodyClassName?: string;
}

/**
 * Единый collapsible-примитив терминала.
 *
 * Зачем он отдельным компонентом: второстепенная информация (методология,
 * оговорки, риски, происхождение данных, SHA, юридический текст) должна быть
 * доступна, но не обязана занимать экран. Один примитив гарантирует одинаковое
 * поведение на десктопе и на 390px: крупная область нажатия, поворот шеврона,
 * корректные aria-атрибуты и отсутствие горизонтального переполнения.
 *
 * Контент остаётся в DOM и просто скрыт, поэтому текст доступен для поиска,
 * скринридеров и автотестов независимо от состояния.
 */
export const Collapsible: React.FC<CollapsibleProps> = ({
  label,
  children,
  icon,
  count,
  hint,
  defaultOpen = false,
  mountOnOpen = false,
  tone = 'neutral',
  testId,
  className = '',
  bodyClassName = '',
}) => {
  const [open, setOpen] = useState(defaultOpen);
  // После первого раскрытия содержимое остаётся смонтированным, чтобы повторное
  // сворачивание не теряло состояние внутри (фильтры, сравнение, скролл).
  const [everOpened, setEverOpened] = useState(defaultOpen);
  const bodyId = useId();

  const toggle = () =>
    setOpen((v) => {
      const next = !v;
      if (next) setEverOpened(true);
      return next;
    });

  const mounted = !mountOnOpen || everOpened;

  return (
    <div
      className={`rounded-lg border border-surface-border/70 ${className}`}
      data-testid={testId}
      data-open={open}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-semibold transition-colors min-h-[44px] ${TONE_TRIGGER[tone]}`}
      >
        {icon && <span className="shrink-0">{icon}</span>}
        <span className="min-w-0 flex-1">
          {label}
          {typeof count === 'number' && (
            <span className="ml-1.5 font-mono font-normal text-slate-500">({count})</span>
          )}
          {!open && hint && (
            <span className="ml-2 hidden font-normal text-slate-500 sm:inline">{hint}</span>
          )}
        </span>
        <span className="shrink-0 text-[11px] font-normal text-slate-500">
          {open ? 'Свернуть' : 'Подробнее'}
        </span>
        <ChevronDown
          aria-hidden
          className={`h-4 w-4 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <div
        id={bodyId}
        role="region"
        hidden={!open}
        className={`rounded-b-lg border-t px-3 py-3 text-xs leading-relaxed ${TONE_BODY[tone]} ${bodyClassName}`}
      >
        {mounted ? children : null}
      </div>
    </div>
  );
};
