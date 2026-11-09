/**
 * ДОКАЗАТЕЛЬСТВО ПЕРЕНОСА: копии frozen-кода V3.4 идентичны исходникам
 * CRYPTORA побайтово, кроме строк импорта.
 *
 * Тест ловит два разных класса ошибок:
 *   1. кто-то «улучшил» математику в копии — текст перестал совпадать с
 *      источником (это ровно та ошибка, из-за которой в CRYPTORA появился баг
 *      V3.3: ручной пересказ формул);
 *   2. источник V3.4 изменился в CRYPTORA — закреплённые sha256 не совпали,
 *      и продукт нужно переносить заново, а не тихо расходиться с ним.
 *
 * Правило: в путях импорта допустимы только замены, перечисленные в
 * REWRITES (они не меняют ни одного арифметического выражения).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PACKAGE_SRC = path.resolve(HERE, '../src');
/** Корень CRYPTORA (репозиторий, из которого перенесена стратегия). */
const CRYPTORA_ROOT = path.resolve(HERE, '../../../..');

const ALIAS_ARCHIVE_TYPES = '@/services/strategyArchive/types';

interface Pin {
  /** Путь в исходном CRYPTORA. */
  source: string;
  /** Путь копии внутри пакета. */
  copy: string;
  /** sha256 исходника, зафиксированный при переносе. */
  sourceSha256: string;
  /** Разрешённые замены путей импорта (порядок важен). */
  rewrites: readonly (readonly [string, string])[];
}

const REWRITES = {
  strategyCore: [
    ["from '../../types'", "from './types'"],
    ["from '../../shared/primitives'", "from './primitives'"],
  ],
  primitives: [["from '../types'", "from './types'"]],
  frozenSettings: [
    ["from '../results/v2-real-20260915-080338/settings.json'", "from './results/v2-real-20260915-080338/settings.json'"],
  ],
  archiveTypes: [[ALIAS_ARCHIVE_TYPES, '../strategy/types']],
  replayCommon: [
    [ALIAS_ARCHIVE_TYPES, '../strategy/types'],
    ["from './types'", "from './replayTypes'"],
    ["from './shared'", "from './replayShared'"],
  ],
  v33Replay: [
    [ALIAS_ARCHIVE_TYPES, '../strategy/types'],
    ['@/services/strategyArchive/shared/frozenSettings', '../strategy/frozenSettings'],
    ['@/services/strategyArchive/shared/primitives', '../strategy/primitives'],
    ['@/services/strategyArchive/definitions/v3_3-htf-zone-mitigation/v33Core', '../strategy/v33Core'],
    ["from './types'", "from './replayTypes'"],
    ["from './shared'", "from './replayShared'"],
  ],
  v34Replay: [
    ['@/services/strategyArchive/definitions/v3_3-htf-zone-mitigation/v33Core', '../strategy/v33Core'],
    ["from '../targetQuality'", "from './targetQuality'"],
    ["from './types'", "from './replayTypes'"],
    ["from './shared'", "from './replayShared'"],
  ],
} as const;

const PINS: readonly Pin[] = [
  {
    source: 'src/services/strategyArchive/types.ts',
    copy: 'strategy/types.ts',
    sourceSha256: '7e80fb3e0dd7930754d37c1b6148a7d0b0fcf1f706c89758de52682dfaff2901',
    rewrites: [],
  },
  {
    source: 'src/services/strategyArchive/shared/primitives.ts',
    copy: 'strategy/primitives.ts',
    sourceSha256: '1721d02acd65feddc1148eaa74c67e3f3354cfbc2705d5d8ea1f66baff836b37',
    rewrites: REWRITES.primitives,
  },
  {
    source: 'src/services/strategyArchive/shared/frozenSettings.ts',
    copy: 'strategy/frozenSettings.ts',
    sourceSha256: '1895988b24a832dc9ed06e46f3791bd0ec97ce0727ed9795a375ab599bd3bf04',
    rewrites: REWRITES.frozenSettings,
  },
  {
    // Замороженный settings.json — байт-в-байт, без правок вообще.
    source: 'src/services/strategyArchive/results/v2-real-20260915-080338/settings.json',
    copy: 'strategy/results/v2-real-20260915-080338/settings.json',
    sourceSha256: '92311c4f9a96bc2e6922fc952aacc53ae473ffb22bcb6749b11c2a0cfa0cd3f9',
    rewrites: [],
  },
  {
    source: 'src/services/strategyArchive/definitions/v3_0-htf-liquidation-trap/v30Core.ts',
    copy: 'strategy/v30Core.ts',
    sourceSha256: 'd8521bea91997464d0031a32b16539d9cca7d60952643407992d46c376258c0c',
    rewrites: REWRITES.strategyCore,
  },
  {
    source: 'src/services/strategyArchive/definitions/v3_3-htf-zone-mitigation/v33Core.ts',
    copy: 'strategy/v33Core.ts',
    sourceSha256: '14c191c76a52319c39b57d84a27108c6b30e78b641521468456e0ba694090bcf',
    rewrites: REWRITES.strategyCore,
  },
  {
    source: 'src/services/signals/live/targetQuality.ts',
    copy: 'signals/targetQuality.ts',
    sourceSha256: 'e3a83d9a2dc8043fd1ffd4de0327ebf2e5addbb8f375b7550ec58dc71a969b44',
    rewrites: REWRITES.archiveTypes,
  },
  {
    source: 'src/services/signals/live/replays/types.ts',
    copy: 'signals/replayTypes.ts',
    sourceSha256: 'a605c17e5141c5d078727150ed76b62f0567cd5ca98886783a764da034fd5521',
    rewrites: REWRITES.archiveTypes,
  },
  {
    source: 'src/services/signals/live/replays/shared.ts',
    copy: 'signals/replayShared.ts',
    sourceSha256: 'f3dd0e99d6396831899fb24875d1763aa71183f8b9670397093283e186d460dd',
    rewrites: REWRITES.replayCommon,
  },
  {
    source: 'src/services/signals/live/replays/v33LiveReplay.ts',
    copy: 'signals/v33LiveReplay.ts',
    sourceSha256: '9aa0a0b80b123ef23d799edcc351beb0fe2933322683ec38f01482e87f36fcbd',
    rewrites: REWRITES.v33Replay,
  },
  {
    source: 'src/services/signals/live/replays/v34LiveReplay.ts',
    copy: 'signals/v34LiveReplay.ts',
    sourceSha256: '6848e0c5cf8845dc3447b34942c7609ed5e2fa3873861581ae51c5f33a90d54e',
    rewrites: REWRITES.v34Replay,
  },
];

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function rewriteImports(text: string, rules: readonly (readonly [string, string])[]): string {
  let out = text;
  for (const [from, to] of rules) out = out.split(from).join(to);
  return out;
}

describe('перенос исходного кода V3.4 (sha256)', () => {
  for (const pin of PINS) {
    it(`${pin.copy} совпадает с источником (кроме путей импорта)`, () => {
      const sourcePath = path.join(CRYPTORA_ROOT, pin.source);
      expect(fs.existsSync(sourcePath), `источник не найден: ${pin.source}`).toBe(true);
      const source = fs.readFileSync(sourcePath, 'utf8');
      const copy = fs.readFileSync(path.join(PACKAGE_SRC, pin.copy), 'utf8');

      // 1. Источник не изменился с момента переноса.
      expect(sha256(source), `источник ${pin.source} изменился — перенос нужно повторить`).toBe(pin.sourceSha256);

      // 2. Копия = источник с переписанными путями импорта, байт в байт.
      expect(copy).toBe(rewriteImports(source, pin.rewrites));
    });
  }

  it('ни в одной копии не осталось алиасов CRYPTORA (@/)', () => {
    for (const pin of PINS) {
      const copy = fs.readFileSync(path.join(PACKAGE_SRC, pin.copy), 'utf8');
      expect(copy.includes("'@/"), `${pin.copy} всё ещё импортирует через @/`).toBe(false);
    }
  });
});
