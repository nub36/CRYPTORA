/**
 * CRYPTORA — Strategy Lab · Числовое поле ввода (RESEARCH ONLY)
 * ---------------------------------------------------------------------------
 * Исправление бага ввода чисел (Phase 2A, §7).
 * Во время набора поле хранит строковое состояние и разрешает:
 *   "" (пустая строка), "2", "20", "1.", "1.5", "0.05".
 * Не форсирует немедленное превращение каждого символа в Number + default.
 * Парсинг и валидация выполняются на лету для валидных чисел и финально на blur.
 */

import React, { useEffect, useState } from 'react';

export interface LabNumericInputProps {
  value: number;
  onChange: (val: number) => void;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  'data-lab-tutorial'?: string;
  'aria-label'?: string;
}

export const LabNumericInput: React.FC<LabNumericInputProps> = ({
  value,
  onChange,
  min,
  max,
  step = 1,
  integer = false,
  disabled = false,
  className = '',
  placeholder,
  ...rest
}) => {
  const [text, setText] = useState<string>(() => (Number.isFinite(value) ? String(value) : ''));
  const [isFocused, setIsFocused] = useState(false);

  // Синхронизация внешнего значения, когда поле не находится в фокусе пользователя
  useEffect(() => {
    if (!isFocused) {
      setText(Number.isFinite(value) ? String(value) : '');
    }
  }, [value, isFocused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Разрешаем пустую строку, числа с точкой, знаки
    if (raw === '' || /^-?\d*\.?\d*$/.test(raw)) {
      setText(raw);
      if (raw !== '' && raw !== '-' && raw !== '.') {
        const parsed = integer ? parseInt(raw, 10) : parseFloat(raw);
        if (Number.isFinite(parsed)) {
          onChange(parsed);
        }
      }
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    if (text === '' || text === '-' || text === '.') {
      const fallback = min !== undefined ? min : Number.isFinite(value) ? value : integer ? 1 : 1.0;
      setText(String(fallback));
      onChange(fallback);
      return;
    }

    let parsed = integer ? parseInt(text, 10) : parseFloat(text);
    if (!Number.isFinite(parsed)) {
      parsed = min !== undefined ? min : Number.isFinite(value) ? value : 1;
    } else {
      if (min !== undefined && parsed < min) parsed = min;
      if (max !== undefined && parsed > max) parsed = max;
    }
    setText(String(parsed));
    onChange(parsed);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      onFocus={() => setIsFocused(true)}
      onChange={handleChange}
      onBlur={handleBlur}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      {...rest}
    />
  );
};
