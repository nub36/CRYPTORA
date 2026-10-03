import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('production Radar deployment contract', () => {
  it('uses one systemd server/index.js process rather than the legacy static server', () => {
    const unit = read('systemd/cryptora.service');
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const restart = read('scripts/restart.sh');

    expect(unit).toMatch(/^Type=simple$/m);
    expect(unit).toMatch(/^ExecStart=\/usr\/local\/bin\/node \/home\/user\/CRYPTORA\/server\/index\.js$/m);
    expect(unit).not.toMatch(/^ExecStart=.*productionServer\.js$/m);
    expect(pkg.scripts.start).toBe('node server/index.js');
    expect(restart).toContain('npm run migrate');
    expect(restart.indexOf('npm run migrate')).toBeLessThan(restart.indexOf('systemctl restart cryptora'));
    expect(restart).toContain('systemctl restart cryptora');
    expect(restart).toContain('refusing legacy fallback');
    expect(restart).not.toContain('nohup node');
    expect(restart).not.toMatch(/node\s+.*productionServer\.js/);
  });

  it('loads notification encryption from the actual production EnvironmentFile', () => {
    const unit = read('systemd/cryptora.service');
    expect(unit).toMatch(/^EnvironmentFile=-\/home\/user\/CRYPTORA\/\.env$/m);
    expect(unit).toContain('NOTIFICATION_ENCRYPTION_KEY');
    expect(unit).not.toMatch(/^EnvironmentFile=.*\.env\.production$/m);
  });

  it('makes migration completion a prerequisite of the supported restart path', () => {
    const deploy = read('scripts/deploy.sh');
    const update = read('scripts/update.sh');
    const docs = read('docs/DEPLOYMENT.md');

    expect(deploy).toContain('CRYPTORA_DB_BACKUP_CONFIRMED');
    expect(deploy.indexOf('npm ci')).toBeLessThan(deploy.indexOf('npm run migrate'));
    expect(deploy.indexOf('npm run migrate')).toBeLessThan(deploy.indexOf('npm run build'));
    expect(update.indexOf('./scripts/deploy.sh')).toBeLessThan(update.indexOf('./scripts/restart.sh'));
    expect(docs).toContain('backup → fetch approved SHA → locked dependencies → migrations → build →');
    expect(docs).toContain('Never start the new server before migration 012.');
    expect(docs).toContain('schema_migrations');
  });
});
