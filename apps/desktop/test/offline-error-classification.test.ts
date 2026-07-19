import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('D-OFFLINE-001: SDK-owned offline error classification boundary', () => {
  test('Desktop no longer owns offline error classifiers or typed error aliases', () => {
    const offlineErrorsPath = resolve(import.meta.dirname, '../src/shell/renderer/infra/offline/errors.ts');
    const offlineIndexPath = resolve(import.meta.dirname, '../src/shell/renderer/infra/offline/index.ts');

    assert.equal(existsSync(offlineErrorsPath), false);
    assert.equal(existsSync(offlineIndexPath), false);
  });

  test('Realm data API consumes SDK classifier and only coordinates Desktop cache state', () => {
    const realmApiSource = readFileSync(
      resolve(import.meta.dirname, '../src/shell/renderer/infra/realm/realm-api.ts'),
      'utf8',
    );
    assert.match(realmApiSource, /isRealmOfflineErrorLike as isRealmOfflineError/);
    assert.match(realmApiSource, /import \{ getOfflineCoordinator \} from '@renderer\/infra\/offline\/coordinator'/);
    assert.match(realmApiSource, /getOfflineCoordinator\(\)\.markRealmRestReachability\('unreachable'\)/);
    assert.doesNotMatch(
      realmApiSource,
      /import\s*\{[^}]*isRealmOfflineError[^}]*\}\s*from '@renderer\/infra\/offline'/s,
    );
  });
});
