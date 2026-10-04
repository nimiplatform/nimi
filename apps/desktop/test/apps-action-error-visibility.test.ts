import assert from 'node:assert/strict';
import test from 'node:test';

import { visibleAppsActionError } from '../src/shell/renderer/features/apps/apps-panel-controller.js';
import type { DesktopAppsEntry } from '../src/shell/renderer/features/apps/apps-panel-projection.js';

const failure = { entryKey: 'app-a', error: { message: 'This action did not complete.', detail: 'install failed' } };

test('an App action failure stays with the App it happened on', () => {
  assert.equal(visibleAppsActionError(failure, 'app-a'), failure.error, 'shown in its own detail, polls included');
  assert.equal(visibleAppsActionError(failure, 'app-b'), null, 'never shown on another App');
  assert.equal(visibleAppsActionError(failure, null), failure.error, 'shown in the App list');
  assert.equal(visibleAppsActionError({ entryKey: null, error: failure.error }, 'app-b'), failure.error);
  assert.equal(visibleAppsActionError(null, 'app-a'), null);
});

test('removing a sibling source keeps its failure visible on the current App detail', () => {
  const entries = [
    { identity: { entryKey: 'app-a', appId: 'example.app' } },
    { identity: { entryKey: 'app-b', appId: 'example.app' } },
    { identity: { entryKey: 'app-c', appId: 'another.app' } },
  ] as DesktopAppsEntry[];
  assert.equal(visibleAppsActionError(failure, 'app-b', entries), failure.error);
  assert.equal(visibleAppsActionError(failure, 'app-c', entries), null);
});
