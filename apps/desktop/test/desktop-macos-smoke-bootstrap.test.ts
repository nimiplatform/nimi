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
        steps: ['wait-chat-panel', 'configure-runtime-text-route'],
      }),
      {
        ok: false,
        failedStep: 'bootstrap-timeout-before-ready',
        steps: ['wait-chat-panel', 'configure-runtime-text-route'],
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
  const bootstrapSource = fs.readFileSync(
    path.join(root, 'src/shell/renderer/infra/bootstrap/desktop-macos-smoke.ts'),
    'utf8',
  );
  const retiredLive2dRuntimeHookPath = path.join(
    root,
    'src/shell/renderer/features/chat/chat-agent-avatar-live2d-runtime-hook.ts',
  );

  assert.match(mainSource, /renderer-main-entry/);
  assert.match(mainSource, /renderer-root-mounted/);
  assert.match(mainSource, /window-page-error/);
  assert.match(mainSource, /desktop_macos_smoke_ping/);
  assert.doesNotMatch(mainSource, /import\('@renderer\/bridge\/runtime-bridge\/macos-smoke'\)/);
  assert.match(bootstrapRsSource, /build_renderer_entry_probe_script/);
  assert.match(bootstrapSource, /app-mounted/);
  assert.match(bootstrapSource, /connectDesktopMacosSmoke/);
  assert.match(bootstrapSource, /macos-smoke-context-ready/);
  assert.match(bootstrapSource, /macos-smoke-scenario-start/);
  assert.match(bootstrapSource, /macos-smoke-step-start/);
  assert.match(bootstrapSource, /macos-smoke-scenario-finished/);
  assert.match(bootstrapSource, /desktop macOS smoke scenario/);
  assert.match(bootstrapSource, /smoke-context-load-failed/);
  assert.match(bootstrapSource, /bootstrap-timeout-before-ready/);
  assert.match(bootstrapSource, /bootstrap-error-screen/);
  assert.equal(fs.existsSync(retiredLive2dRuntimeHookPath), false);
});

test('desktop macos smoke commands are fixture-gated instrumentation only', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const macosSmokeSource = fs.readFileSync(
    path.join(root, 'src-tauri/src/main_parts/defaults_and_commands/macos_smoke.rs'),
    'utf8',
  );
  const bootstrapRsSource = fs.readFileSync(
    path.join(root, 'src-tauri/src/main_parts/app_bootstrap.rs'),
    'utf8',
  );
  const ipcSpecSource = fs.readFileSync(
    path.join(root, '../../.nimi/spec/desktop/kernel/tables/ipc-commands.yaml'),
    'utf8',
  );
  const classificationSource = fs.readFileSync(
    path.join(root, '../../.nimi/spec/desktop/kernel/tables/command-execution-classification.yaml'),
    'utf8',
  );

  assert.match(macosSmokeSource, /^\/\/! Desktop macOS smoke instrumentation\./);
  for (const commandName of [
    'desktop_macos_smoke_report_write',
  ]) {
    assert.match(
      macosSmokeSource,
      new RegExp(`pub\\(crate\\) fn ${commandName}[\\s\\S]*?require_enabled_macos_smoke_override\\(\\)\\?;`),
    );
  }
  assert.doesNotMatch(macosSmokeSource, /desktop_macos_smoke_avatar_evidence_read/);
  assert.doesNotMatch(macosSmokeSource, /desktop_macos_smoke_avatar_product_local_asset_fault_apply/);
  assert.match(
    macosSmokeSource,
    /desktop_macos_smoke_context_get[\s\S]*?macos_smoke_override\(\)\?[\s\S]*?enabled: false/,
  );
  assert.match(
    macosSmokeSource,
    /desktop_macos_smoke_ping[\s\S]*?append_macos_smoke_backend_stage\(payload\.stage\.as_str\(\), payload\.details\.as_ref\(\)\)/,
  );
  assert.match(
    bootstrapRsSource,
    /Production builds register the renderer-entry probe[\s\S]*?desktop_macos_smoke_context_get/,
  );
  assert.doesNotMatch(
    ipcSpecSource,
    /description: (?!Fixture-gated macOS smoke instrumentation;)[^\n]*macOS smoke/,
  );
  assert.match(classificationSource, /family: macos_smoke_acceptance_instrumentation/);
  assert.match(classificationSource, /owner_domain: desktop-smoke-instrumentation/);
});

test('desktop macos smoke builds fixture-enabled app bundles explicitly', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const processSource = fs.readFileSync(
    path.join(root, 'scripts/run-macos-smoke-process.mjs'),
    'utf8',
  );

  assert.match(processSource, /'--features',\s*'desktop-e2e-fixture'/);
});

test('desktop macos smoke DOM driver forwards step callbacks to the scenario runner', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const driverSource = fs.readFileSync(
    path.join(root, 'src/shell/renderer/infra/bootstrap/desktop-macos-smoke-driver-deps.ts'),
    'utf8',
  );

  assert.match(driverSource, /onStepStart:\s*options\.onStepStart/);
  assert.match(driverSource, /isReportOpen:\s*options\.isReportOpen/);
});

test('desktop macos smoke driver consumes SDK Runtime smoke verification surface', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const driverSource = fs.readFileSync(
    path.join(root, 'src/shell/renderer/infra/bootstrap/desktop-macos-smoke-driver-deps.ts'),
    'utf8',
  );

  assert.match(driverSource, /createNimiRuntimeAgentSmokeVerificationSurface/);
  assert.match(driverSource, /options\.lifecycle\.auth\(\)/);
  assert.doesNotMatch(driverSource, /productionAppStore/);
  assert.doesNotMatch(driverSource, /createRuntimeAgentSmokeVerificationSurface/);
  assert.doesNotMatch(driverSource, /createRuntimeProtectedScopeHelper/);
  assert.doesNotMatch(driverSource, /withScopes\(\['runtime\.agent\.read'\]/);
});
