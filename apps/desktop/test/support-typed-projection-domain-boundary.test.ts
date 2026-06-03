import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { readTesterSettingsSurface } from './helpers/read-tester-settings-surface';

const repoRoot = path.join(import.meta.dirname, '../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Support typed projection lifecycle migrated to Kit UI', () => {
  if (fs.existsSync(path.join(repoRoot, 'apps/desktop/src/shell/renderer/features/support/support-projection.ts'))) {
    throw new Error('Desktop must not keep an app-local Support typed projection hook');
  }
});

test('Desktop Support consumes the shared projection hook directly from Kit UI', () => {
  for (const file of [
    'apps/desktop/src/shell/renderer/features/support/support-diagnostics-section.tsx',
    'apps/desktop/src/shell/renderer/features/support/support-logs-section.tsx',
    'apps/desktop/src/shell/renderer/features/support/support-repair-section.tsx',
    'apps/desktop/src/shell/renderer/features/support/support-recovery-section.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /useTypedProjection as useSupportProjection/);
    assert.match(source, /from '@nimiplatform\/kit\/ui'/);
    assert.doesNotMatch(source, /support-projection/);
    assert.match(source, /SupportFailClosed/);
  }
});

test('Tester consumes Kit typed projection hook as second app proof', () => {
  const settings = readTesterSettingsSurface(repoRoot);
  const testerSettingsContract = read('apps/tester/test/tester-settings-surface.test.mjs');

  assert.match(settings, /useTypedProjection/);
  assert.match(settings, /from '@nimiplatform\/kit\/ui'/);
  assert.match(settings, /useTypedProjection\(resolveTesterLocalRuntimeFacadeProjection/);
  assert.match(settings, /useTypedProjection\(resolveTesterRealmDataSyncProjection/);
  assert.match(settings, /localRuntimeFacadeProjection\.data/);
  assert.match(settings, /realmDataSyncProjection\.data/);
  assert.doesNotMatch(settings, /setLocalRuntimeFacadeProjection|setRealmDataSyncProjection/);
  assert.doesNotMatch(settings, /type LocalRuntimeFacadeProjectionState|type RealmDataSyncProjectionState/);
  assert.match(testerSettingsContract, /useTypedProjection/);
});
