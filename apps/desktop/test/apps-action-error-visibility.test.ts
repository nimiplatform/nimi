import assert from 'node:assert/strict';
import test from 'node:test';

import { visibleAppsActionError } from '../src/shell/renderer/features/apps/apps-panel-controller.js';

const failure = { entryKey: 'app-a', error: { message: 'This action did not complete.', detail: 'install failed' } };

test('an App action failure stays with the App it happened on', () => {
  assert.equal(visibleAppsActionError(failure, 'app-a'), failure.error, 'shown in its own detail, polls included');
  assert.equal(visibleAppsActionError(failure, 'app-b'), null, 'never shown on another App');
  assert.equal(visibleAppsActionError(failure, null), failure.error, 'shown in the App list');
  assert.equal(visibleAppsActionError({ entryKey: null, error: failure.error }, 'app-b'), failure.error);
  assert.equal(visibleAppsActionError(null, 'app-a'), null);
});
