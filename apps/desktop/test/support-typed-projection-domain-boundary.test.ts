import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.join(import.meta.dirname, '../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Support typed projection lifecycle migrated to Kit UI', () => {
  const kitHook = read('kit/ui/src/hooks/typed-projection.ts');
  const kitIndex = read('kit/ui/src/index.ts');

  assert.match(kitIndex, /hooks\/typed-projection/);
  assert.match(kitHook, /export function useTypedProjection/);
  assert.match(kitHook, /status: 'failed'/);
  assert.match(kitHook, /data: null/);
  assert.match(kitHook, /useRef\(load\)/);
  assert.doesNotMatch(kitHook, /from ['"].*apps\//);
  assert.doesNotMatch(kitHook, /@renderer|@runtime|@nimiplatform\/sdk/);

  assert.equal(
    fs.existsSync(path.join(repoRoot, 'apps/desktop/src/shell/renderer/features/support/support-projection.ts')),
    false,
  );
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
  const settings = read('apps/tester/src/shell/routes/settings.tsx');
  const testerContract = read('apps/tester/test/tester-contract.test.mjs');

  assert.match(settings, /useTypedProjection/);
  assert.match(settings, /from '@nimiplatform\/kit\/ui'/);
  assert.match(settings, /useTypedProjection\(resolveTesterLocalRuntimeFacadeProjection/);
  assert.match(settings, /useTypedProjection\(resolveTesterRealmDataSyncProjection/);
  assert.match(settings, /localRuntimeFacadeProjection\.data/);
  assert.match(settings, /realmDataSyncProjection\.data/);
  assert.doesNotMatch(settings, /setLocalRuntimeFacadeProjection|setRealmDataSyncProjection/);
  assert.doesNotMatch(settings, /type LocalRuntimeFacadeProjectionState|type RealmDataSyncProjectionState/);
  assert.match(testerContract, /useTypedProjection/);
});
