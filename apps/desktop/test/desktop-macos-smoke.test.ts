import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { E2E_IDS } from '../src/shell/renderer/testability/e2e-ids';
import {
  buildDesktopMacosSmokeFailureReportPayload,
  runDesktopMacosSmokeScenario,
  shouldStartDesktopMacosSmoke,
} from '../src/shell/renderer/infra/bootstrap/desktop-macos-smoke';

test('desktop macos smoke only starts when bootstrap is ready and a scenario is enabled', () => {
  assert.equal(shouldStartDesktopMacosSmoke({
    bootstrapReady: true,
    context: { enabled: true, scenarioId: 'chat.memory-standard-bind' },
    alreadyStarted: false,
  }), true);

  assert.equal(shouldStartDesktopMacosSmoke({
    bootstrapReady: false,
    context: { enabled: true, scenarioId: 'chat.memory-standard-bind' },
    alreadyStarted: false,
  }), false);

  assert.equal(shouldStartDesktopMacosSmoke({
    bootstrapReady: true,
    context: { enabled: false, scenarioId: 'chat.memory-standard-bind' },
    alreadyStarted: false,
  }), false);

  assert.equal(shouldStartDesktopMacosSmoke({
    bootstrapReady: true,
    context: { enabled: true },
    alreadyStarted: false,
  }), false);

  assert.equal(shouldStartDesktopMacosSmoke({
    bootstrapReady: true,
    context: { enabled: true, scenarioId: 'chat.memory-standard-bind' },
    alreadyStarted: true,
  }), false);
});

test('desktop macos smoke chat memory bind scenario follows the expected step order', async () => {
  const clicked: string[] = [];
  const waited: string[] = [];
  const writtenReports: Array<Record<string, unknown>> = [];
  let modeReads = 0;

  await runDesktopMacosSmokeScenario('chat.memory-standard-bind', {
    async waitForTestId(id) {
      waited.push(id);
    },
    async clickByTestId(id) {
      clicked.push(id);
    },
    async readAttributeByTestId(id, name) {
      assert.equal(id, E2E_IDS.chatMemoryModeStatus);
      assert.equal(name, 'data-memory-mode');
      modeReads += 1;
      if (modeReads <= 2) {
        return 'baseline';
      }
      return 'standard';
    },
    async readTextByTestId(id) {
      assert.equal(id, E2E_IDS.chatMemoryModeStatus);
      return '';
    },
    async writeReport(payload) {
      writtenReports.push(payload as unknown as Record<string, unknown>);
    },
    currentRoute() {
      return '/chat';
    },
    currentHtml() {
      return '<html>chat</html>';
    },
  });

  assert.deepEqual(waited.slice(0, 2), [
    E2E_IDS.panel('chat'),
    E2E_IDS.chatMemoryModeStatus,
  ]);
  assert.deepEqual(clicked, [
    E2E_IDS.chatTarget('agent-e2e-alpha'),
    E2E_IDS.chatSettingsToggle,
    E2E_IDS.chatMemoryModeUpgradeButton,
    E2E_IDS.chatMemoryModeUpgradeButton,
  ]);
  assert.equal(writtenReports.length, 1);
  assert.deepEqual(writtenReports[0], {
    ok: true,
    steps: [
      'wait-chat-panel',
      'select-agent-target',
      'open-settings',
      'wait-baseline',
      'cancel-upgrade',
      'confirm-cancel-still-baseline',
      'confirm-upgrade',
      'wait-standard',
      'write-pass-report',
    ],
    route: '/chat',
    htmlSnapshot: '<html>chat</html>',
  });
});

test('desktop macos smoke fails closed for unknown scenarios and emits a fail report', async () => {
  const reports: Array<Record<string, unknown>> = [];

  await assert.rejects(
    () => runDesktopMacosSmokeScenario('unknown-scenario', {
      async waitForTestId() {},
      async clickByTestId() {},
      async readAttributeByTestId() {
        return null;
      },
      async readTextByTestId() {
        return '';
      },
      async writeReport(payload) {
        reports.push(payload as unknown as Record<string, unknown>);
      },
      currentRoute() {
        return '/';
      },
      currentHtml() {
        return '<html>fail</html>';
      },
    }),
    /unknown macOS smoke scenario/,
  );

  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0], {
    ok: false,
    failedStep: 'bootstrap',
    steps: [],
    errorMessage: 'unknown macOS smoke scenario: unknown-scenario',
    errorName: 'Error',
    errorStack: reports[0]?.errorStack,
    errorCause: undefined,
    route: '/',
    htmlSnapshot: '<html>fail</html>',
  });
  assert.match(String(reports[0]?.errorStack || ''), /unknown macOS smoke scenario/);
});

test('desktop macos smoke bootstrap failure payload uses explicit failed-step classification', () => {
  const originalWindow = (globalThis as typeof globalThis & {
    window?: unknown;
  }).window;
  const originalDocument = (globalThis as typeof globalThis & {
    document?: unknown;
  }).document;

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        pathname: '/chat',
        search: '?tab=memory',
        hash: '#smoke',
      },
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      documentElement: {
        outerHTML: '<html>snapshot</html>',
      },
    },
  });

  try {
    assert.deepEqual(
      buildDesktopMacosSmokeFailureReportPayload({
        failedStep: 'bootstrap-timeout-before-ready',
        message: 'timed out',
      }),
      {
        ok: false,
        failedStep: 'bootstrap-timeout-before-ready',
        steps: ['bootstrap-timeout-before-ready'],
        errorMessage: 'timed out',
        errorName: undefined,
        errorStack: undefined,
        errorCause: undefined,
        route: '/chat?tab=memory#smoke',
        htmlSnapshot: '<html>snapshot</html>',
      },
    );
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    });
  }
});

test('desktop macos smoke renderer sources include mounted ping markers', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const mainSource = fs.readFileSync(
    path.join(root, 'src/shell/renderer/main.tsx'),
    'utf8',
  );
  const bootstrapRsSource = fs.readFileSync(
    path.join(root, 'src-tauri/src/main_parts/app_bootstrap.rs'),
    'utf8',
  );
  const appSource = fs.readFileSync(
    path.join(root, 'src/shell/renderer/App.tsx'),
    'utf8',
  );
  const bootstrapSource = fs.readFileSync(
    path.join(root, 'src/shell/renderer/infra/bootstrap/desktop-macos-smoke.ts'),
    'utf8',
  );

  assert.match(mainSource, /renderer-main-entry/);
  assert.match(mainSource, /renderer-root-mounted/);
  assert.match(mainSource, /window-page-error/);
  assert.match(bootstrapRsSource, /window-eval-probe/);
  assert.match(bootstrapRsSource, /renderer-module-import-failed/);
  assert.match(bootstrapRsSource, /window-dynamic-import-ok/);
  assert.match(appSource, /app-mounted/);
  assert.match(bootstrapSource, /macos-smoke-context-ready/);
  assert.match(bootstrapSource, /macos-smoke-scenario-start/);
  assert.match(bootstrapSource, /macos-smoke-scenario-finished/);
  assert.match(bootstrapSource, /smoke-context-load-failed/);
  assert.match(bootstrapSource, /bootstrap-timeout-before-ready/);
  assert.match(bootstrapSource, /bootstrap-error-screen/);
});
