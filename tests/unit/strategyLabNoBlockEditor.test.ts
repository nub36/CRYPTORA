// @vitest-environment node
/**
 * CRYPTORA — Strategy Lab · блок-редактор удалён (CODE-FIRST)
 * ---------------------------------------------------------------------------
 * C. Зависимость @xyflow/react отсутствует в package.json и в lockfile.
 * A. UI-инфраструктура блок-редактора удалена из исходников.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

describe('C. @xyflow/react полностью удалён', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  it('нет в dependencies/devDependencies', () => {
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain('@xyflow/react');
    expect(Object.keys(pkg.devDependencies ?? {})).not.toContain('@xyflow/react');
  });

  it('нет в package-lock.json', () => {
    const lock = fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8');
    expect(lock).not.toContain('@xyflow');
  });

  it('нет в node_modules', () => {
    expect(fs.existsSync(path.join(ROOT, 'node_modules/@xyflow'))).toBe(false);
  });
});

describe('A/B. UI блок-редактора и переключателя режимов удалены', () => {
  it('файлы блок-редактора и режимов авторинга отсутствуют', () => {
    for (const rel of [
      'src/components/strategyLab/blocks',
      'src/components/strategyLab/LabAuthoringModeSwitch.tsx',
      'src/components/strategyLab/LabConstructor.tsx',
    ]) {
      expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(false);
    }
  });

  it('в исходниках нет импортов React Flow и ссылок на блок-редактор', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
      }
    };
    walk(path.join(ROOT, 'src'));
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      expect(text.includes('@xyflow/react'), file).toBe(false);
      expect(text.includes('LabBlockEditor'), file).toBe(false);
      expect(text.includes('LabAuthoringModeSwitch'), file).toBe(false);
    }
  });
});
