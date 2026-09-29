/**
 * CRYPTORA — 6-digit verification code input.
 *
 * UX: auto-focus, full-code paste, backspace navigation, arrow keys,
 * mobile numeric keyboard (inputMode="numeric"), accessible labels.
 * The component holds digits only in React state — nothing is persisted.
 */

import React, { useRef, useCallback, useEffect } from 'react';

export const CODE_LENGTH = 6;

interface CodeInputProps {
  value: string;
  onChange: (code: string) => void;
  /** Called once when all 6 digits are present. */
  onComplete?: (code: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Render inputs in an error state. */
  invalid?: boolean;
}

export const CodeInput: React.FC<CodeInputProps> = ({
  value,
  onChange,
  onComplete,
  disabled = false,
  autoFocus = true,
  invalid = false,
}) => {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: CODE_LENGTH }, (_, i) => value[i] ?? '');

  useEffect(() => {
    if (autoFocus && !disabled) {
      refs.current[Math.min(value.length, CODE_LENGTH - 1)]?.focus();
    }
    // Focus only on mount — not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  const commit = useCallback(
    (next: string) => {
      const clean = next.replace(/\D/g, '').slice(0, CODE_LENGTH);
      onChange(clean);
      if (clean.length === CODE_LENGTH) onComplete?.(clean);
    },
    [onChange, onComplete]
  );

  const handleChange = (index: number, raw: string) => {
    const incoming = raw.replace(/\D/g, '');
    if (!incoming) {
      // Deletion via the input itself.
      commit(value.slice(0, index) + value.slice(index + 1));
      return;
    }
    // Support typing over an existing digit and multi-char input (paste into a box).
    const next = (value.slice(0, index) + incoming + value.slice(index + incoming.length)).slice(0, CODE_LENGTH);
    commit(next);
    const focusTo = Math.min(index + incoming.length, CODE_LENGTH - 1);
    refs.current[focusTo]?.focus();
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (digits[index]) {
        commit(value.slice(0, index) + value.slice(index + 1));
      } else if (index > 0) {
        commit(value.slice(0, index - 1) + value.slice(index));
        refs.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      refs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < CODE_LENGTH - 1) {
      e.preventDefault();
      refs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH);
    if (!pasted) return;
    commit(pasted);
    refs.current[Math.min(pasted.length, CODE_LENGTH - 1)]?.focus();
  };

  return (
    <div
      role="group"
      aria-label="Код подтверждения из 6 цифр"
      className="flex items-center justify-center gap-1.5 sm:gap-2"
    >
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={CODE_LENGTH}
          value={digit}
          disabled={disabled}
          aria-label={`Цифра ${i + 1} из ${CODE_LENGTH}`}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          data-testid={`code-digit-${i}`}
          className={`h-12 w-10 rounded-md border bg-surface-2 text-center font-mono text-xl text-white focus:outline-none sm:h-14 sm:w-11 ${
            invalid
              ? 'border-rose-500/60 focus:border-rose-400'
              : 'border-white/[0.1] focus:border-cyan-400/60'
          } disabled:cursor-not-allowed disabled:opacity-50`}
        />
      ))}
    </div>
  );
};
