import test from 'node:test';

import { assert, E2E_IDS, createBaseDriver, runDesktopMacosSmokeScenario, shouldStartDesktopMacosSmoke } from './desktop-macos-smoke-test-helpers';

test('desktop macos smoke only starts when bootstrap is ready and a scenario is enabled', () => {
  assert.equal(shouldStartDesktopMacosSmoke({
    bootstrapReady: true,
    context: { enabled: true, scenarioId: 'boot.anonymous.login-screen' },
    alreadyStarted: false,
  }), true);

  assert.equal(shouldStartDesktopMacosSmoke({
    bootstrapReady: false,
    context: { enabled: true, scenarioId: 'boot.anonymous.login-screen' },
    alreadyStarted: false,
  }), false);

  assert.equal(shouldStartDesktopMacosSmoke({
    bootstrapReady: true,
    context: { enabled: false, scenarioId: 'boot.anonymous.login-screen' },
    alreadyStarted: false,
  }), false);

  assert.equal(shouldStartDesktopMacosSmoke({
    bootstrapReady: true,
    context: { enabled: true },
    alreadyStarted: false,
  }), false);

  assert.equal(shouldStartDesktopMacosSmoke({
    bootstrapReady: true,
    context: { enabled: true, scenarioId: 'boot.anonymous.login-screen' },
    alreadyStarted: true,
  }), false);
});

test('desktop macos smoke anonymous boot scenario asserts login gate and no ordinary shell', async () => {
  const clicked: string[] = [];
  const waited: string[] = [];
  const goneSelectors: string[] = [];
  const writtenReports: Array<Record<string, unknown>> = [];

  await runDesktopMacosSmokeScenario('boot.anonymous.login-screen', createBaseDriver({
    async waitForTestId(id) {
      waited.push(id);
    },
    async waitForSelectorGone(selector) {
      goneSelectors.push(selector);
    },
    async clickByTestId(id) {
      clicked.push(id);
    },
    async writeReport(payload) {
      writtenReports.push(payload as unknown as Record<string, unknown>);
    },
    currentRoute() {
      return '/';
    },
    currentHtml() {
      return '<html>chat</html>';
    },
  }));

  assert.deepEqual(clicked, []);
  assert.deepEqual(goneSelectors, [
    `[data-testid="${E2E_IDS.shellSidebarRail}"]`,
    `[data-testid="${E2E_IDS.mainShell}"]`,
    `[data-testid="${E2E_IDS.panel('chat')}"]`,
  ]);
  assert.deepEqual(waited, [
    E2E_IDS.loginScreen,
  ]);
  assert.equal(writtenReports.length, 1);
  assert.deepEqual(writtenReports[0], {
    ok: true,
    steps: [
      'wait-login-screen',
      'verify-anonymous-sidebar-absent',
      'verify-anonymous-main-shell-absent',
      'verify-anonymous-chat-panel-absent',
      'write-pass-report',
    ],
    route: '/',
    htmlSnapshot: '<html>chat</html>',
  });
});
