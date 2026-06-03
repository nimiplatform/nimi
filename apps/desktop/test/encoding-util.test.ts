import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { readTesterSettingsSurface } from './helpers/read-tester-settings-surface';

const desktopDir = resolve(import.meta.dirname, '..');
const repoDir = resolve(desktopDir, '../..');
const desktopRuntimeDir = resolve(desktopDir, 'src/runtime');

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const abs = join(dir, entry);
    return statSync(abs).isDirectory() ? walkFiles(abs) : [abs];
  });
}

function readRepo(relativePath: string): string {
  return readFileSync(resolve(repoDir, relativePath), 'utf8');
}

test('Desktop src/runtime residual namespace is fully retired', () => {
  assert.deepEqual(walkFiles(desktopRuntimeDir), []);

  const bootstrap = readRepo('apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts');
  const testerSettings = readTesterSettingsSurface(repoDir);

  assert.match(bootstrap, /createMissingWorldEvolutionSelectorReadProvider/);
  assert.match(bootstrap, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(testerSettings, /loadTesterWorldEvolutionSelectorReadProjection/);
  assert.doesNotMatch(bootstrap, /@runtime\/world-evolution/);
});
