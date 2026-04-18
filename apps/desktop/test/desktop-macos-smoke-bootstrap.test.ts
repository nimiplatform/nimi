import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { assert, buildDesktopMacosSmokeFailureReportPayload } from './desktop-macos-smoke-test-helpers';

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
  const live2dViewportSource = fs.readFileSync(
    path.join(root, 'src/shell/renderer/features/chat/chat-agent-avatar-live2d-viewport.tsx'),
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
  assert.match(live2dViewportSource, /webglcontextrestored/);
  assert.match(live2dViewportSource, /action:live2d-model-rebuilt/);
});
