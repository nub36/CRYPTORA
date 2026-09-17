/**
 * Страж заземления LLM-ответа (docs/AI.md §2): любая цифра в тексте обязана присутствовать среди переданных фактов;
 * запрещены обещания доходности и торговые инструкции. Чистая функция — используется и сервером, и тестами.
 */

const FORBIDDEN = [
  /гарантир/i, /обязательно (вырастет|упадёт|упадет)/i, /ожидаемая доходность/i, /прибыльн(ая|ый) стратег/i, /лучший сигнал/i,
  /\b(покупай|продавай|купите|продайте|открой(те)? (лонг|шорт)|закрой(те)? позици)/i,
  /\b(buy|sell|long it|short it|take profit|stop loss)\b/i,
  /рекоменд(ую|уем) (купить|продать|войти|выйти)/i,
  /цель по цене|таргет \$?\d/i,
];

/** Нормализованные числовые токены из текста: «64 850,25», «64,850.25», «-0.0182», «68.2%» → строки чисел. */
export function extractNumbers(text) {
  const out = [];
  // Формы: 64,850.25 | 64 850,25 | 64850.25 | 0,25 | -0.0182
  const re = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d{1,3}(?:[\s\u00a0]\d{3})+(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?/g;
  for (const m of text.matchAll(re)) {
    let norm = m[0].replace(/[\s\u00a0]/g, '');
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(norm)) norm = norm.replace(/,/g, '');
    else norm = norm.replace(',', '.');
    const n = Number(norm);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Все числа, которые LLM имеет право упоминать: значения фактов в исходном виде и округлённые до 0–4 знаков. */
export function allowedNumbers(facts) {
  const set = new Set();
  const add = (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    for (let d = 0; d <= 4; d++) set.add(Number(v.toFixed(d)));
    set.add(Math.abs(v));
    for (let d = 0; d <= 4; d++) set.add(Number(Math.abs(v).toFixed(d)));
  };
  const walk = (o) => {
    if (o === null || o === undefined) return;
    if (typeof o === 'number') return add(o);
    if (typeof o === 'string') {
      for (const n of extractNumbers(o)) add(n);
      return;
    }
    if (Array.isArray(o)) return o.forEach(walk);
    if (typeof o === 'object') return Object.values(o).forEach(walk);
  };
  walk(facts);
  // Общеупотребимые константы контекста (периоды/пороги RSI), не являющиеся рыночными данными.
  for (const c of [1, 2, 3, 4, 7, 8, 12, 14, 24, 30, 50, 70, 100, 2026]) set.add(c);
  return set;
}

/** @returns {{ok:true}|{ok:false, reason:string}} */
export function checkGrounding(text, facts) {
  if (typeof text !== 'string' || text.trim().length === 0) return { ok: false, reason: 'empty' };
  for (const re of FORBIDDEN) {
    if (re.test(text)) return { ok: false, reason: `forbidden phrase: ${re}` };
  }
  const allowed = allowedNumbers(facts);
  for (const n of extractNumbers(text)) {
    if (!allowed.has(n) && !allowed.has(Math.abs(n))) return { ok: false, reason: `ungrounded number: ${n}` };
  }
  return { ok: true };
}
