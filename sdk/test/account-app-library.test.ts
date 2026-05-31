import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseAccountAppLibraryRecord,
  parseOptionalAccountAppLibraryRecord,
} from '../src/app/index.js';

test('parseAccountAppLibraryRecord decodes account app-library projection', () => {
  const parsed = parseAccountAppLibraryRecord({
    schemaVersion: 1,
    accountId: 'account-1',
    updatedAt: '2026-05-31T00:00:00Z',
    apps: [{
      appId: 'tester.app',
      libraryState: 'enabled',
      installed: true,
      lastOpenedAt: '2026-05-31T00:00:00Z',
      dataPolicy: 'keep_on_uninstall',
    }],
  });

  assert.equal(parsed.accountId, 'account-1');
  assert.equal(parsed.apps[0]?.libraryState, 'enabled');
  assert.equal(parsed.apps[0]?.dataPolicy, 'keep_on_uninstall');
});

test('parseAccountAppLibraryRecord fails closed for invalid row state', () => {
  assert.throws(
    () => parseAccountAppLibraryRecord({
      schemaVersion: 1,
      accountId: 'account-1',
      updatedAt: '2026-05-31T00:00:00Z',
      apps: [{
        appId: 'tester.app',
        libraryState: 'local-enabled',
        installed: true,
        dataPolicy: 'keep_on_uninstall',
      }],
    }),
    /invalid libraryState: local-enabled/,
  );
});

test('parseOptionalAccountAppLibraryRecord keeps missing record explicit', () => {
  assert.equal(parseOptionalAccountAppLibraryRecord(null), null);
  assert.equal(parseOptionalAccountAppLibraryRecord(undefined), null);
});
