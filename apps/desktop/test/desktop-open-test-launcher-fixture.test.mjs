import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DESKTOP_OPEN_TEST_HOSTS,
  DESKTOP_OPEN_TEST_TARGETS,
  collectDesktopOpenFixtureEvidence,
  createDesktopOpenTestLauncher,
} from '../e2e/fixtures/desktop-open-test-launcher.mjs';

test('Desktop Open generic fixture covers accepted target row ids', () => {
  assert.deepEqual(DESKTOP_OPEN_TEST_TARGETS.map((target) => target.rowId), [
    'target.explore-worlds-section',
    'target.explore-worlds',
    'target.explore-personas-section',
    'target.explore-personas',
    'target.explore-personas-discover',
    'target.explore-activity-section',
    'target.explore-activity',
    'target.explore-search',
    'target.runtime-connector',
    'target.runtime-model',
    'target.agents-inventory',
    'target.apps-surface',
    'target.app-selection',
    'target.settings-profile',
  ]);
});

test('Desktop Open generic fixture keeps installed-app sourceHost evidence distinct', () => {
  assert.equal(
    DESKTOP_OPEN_TEST_HOSTS.some((host) =>
      host.rowId === 'owner.installed-app-source-host'
        && host.hostClass === 'installed-nimi-app-standard-shell-v1'
        && host.sourceHost === 'desktop-electron-installed-app-host',
    ),
    true,
  );
  assert.equal(
    DESKTOP_OPEN_TEST_HOSTS.some((host) =>
      host.hostClass === 'installed-nimi-app-standard-shell-v1'
        && host.sourceHost === 'desktop-electron-installed-app-host',
    ),
    true,
  );
});

test('Desktop Open generic fixture invokes only renderer-owned request payload', async () => {
  const calls = [];
  const launcher = createDesktopOpenTestLauncher({
    openDesktopIntent: async (request) => {
      calls.push(request);
      return {
        status: 'accepted',
        confirmation: 'desktop-accepted',
        bridgeId: 'desktop-open-20260708-fixture',
        requestId: 'desktop-open-20260708-fixture-request',
        appliedTarget: request.intent.kind,
      };
    },
  });

  const evidence = await launcher.openTarget('target.runtime-connector');

  assert.deepEqual(calls, [{
    intent: {
      kind: 'open-runtime-config',
      page: 'cloud',
      action: 'add-connector',
    },
  }]);
  assert.equal(evidence.result.status, 'accepted');
  assert.equal(evidence.expected.activeTab, 'runtime');
});

test('Desktop Open generic fixture can collect a full target evidence manifest', async () => {
  const evidence = await collectDesktopOpenFixtureEvidence({
    openDesktopIntent: async (request) => ({
      status: 'accepted',
      confirmation: 'desktop-accepted',
      bridgeId: 'desktop-open-20260708-fixture',
      requestId: 'desktop-open-20260708-fixture-request',
      appliedTarget: request.intent.kind,
    }),
  });

  assert.equal(evidence.fixtureId, 'desktop-open-test-launcher');
  assert.equal(evidence.rows.length, DESKTOP_OPEN_TEST_TARGETS.length);
  assert.equal(evidence.rows.every((row) => row.result.status === 'accepted'), true);
});
