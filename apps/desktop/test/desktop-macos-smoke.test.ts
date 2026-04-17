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
    async waitForSelector() {},
    async clickByTestId(id) {
      clicked.push(id);
    },
    async setLive2dInteractionOverride() {},
    async resizeLive2dViewport() {},
    async pulseLive2dViewportTinyHost() {},
    async pulseLive2dDevicePixelRatio() {},
    async triggerLive2dContextLossAndRestore() {},
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
    async readLive2dCanvasStats() {
      return {
        status: null,
        fallbackText: null,
        width: 0,
        height: 0,
        canvasPresent: false,
        contextKind: null,
        sampleCount: 0,
        nonTransparentSampleCount: 0,
        sampleError: null,
        runtimeDebug: null,
      };
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

test('desktop macos smoke tester speech bundle scenario follows the expected step order', async () => {
  const clicked: string[] = [];
  const waited: string[] = [];
  const writtenReports: Array<Record<string, unknown>> = [];

  await runDesktopMacosSmokeScenario('tester.speech-bundle-panels', {
    async waitForTestId(id) {
      waited.push(id);
    },
    async waitForSelector() {},
    async clickByTestId(id) {
      clicked.push(id);
    },
    async setLive2dInteractionOverride() {},
    async resizeLive2dViewport() {},
    async pulseLive2dViewportTinyHost() {},
    async pulseLive2dDevicePixelRatio() {},
    async triggerLive2dContextLossAndRestore() {},
    async readAttributeByTestId() {
      return null;
    },
    async readTextByTestId() {
      return '';
    },
    async readLive2dCanvasStats() {
      return {
        status: null,
        fallbackText: null,
        width: 0,
        height: 0,
        canvasPresent: false,
        contextKind: null,
        sampleCount: 0,
        nonTransparentSampleCount: 0,
        sampleError: null,
        runtimeDebug: null,
      };
    },
    async writeReport(payload) {
      writtenReports.push(payload as unknown as Record<string, unknown>);
    },
    currentRoute() {
      return '/tester';
    },
    currentHtml() {
      return '<html>tester</html>';
    },
  });

  assert.deepEqual(clicked, [
    E2E_IDS.navTab('tester'),
    E2E_IDS.testerCapabilityTab('audio.synthesize'),
    E2E_IDS.testerCapabilityTab('audio.transcribe'),
    E2E_IDS.testerCapabilityTab('voice.clone'),
    E2E_IDS.testerCapabilityTab('voice.design'),
  ]);
  assert.deepEqual(waited, [
    E2E_IDS.panel('tester'),
    E2E_IDS.testerPanel('audio.synthesize'),
    E2E_IDS.testerInput('audio-synthesize-text'),
    E2E_IDS.testerPanel('audio.transcribe'),
    E2E_IDS.testerInput('audio-transcribe-file'),
    E2E_IDS.testerPanel('voice.clone'),
    E2E_IDS.testerInput('voice-clone-file'),
    E2E_IDS.testerPanel('voice.design'),
    E2E_IDS.testerInput('voice-design-instruction'),
  ]);
  assert.equal(writtenReports.length, 1);
  assert.deepEqual(writtenReports[0], {
    ok: true,
    steps: [
      'open-tester-tab',
      'wait-tester-panel',
      'open-tts-panel',
      'wait-tts-input',
      'open-stt-panel',
      'wait-stt-input',
      'open-voice-clone-panel',
      'wait-voice-clone-input',
      'open-voice-design-panel',
      'wait-voice-design-input',
      'write-pass-report',
    ],
    route: '/tester',
    htmlSnapshot: '<html>tester</html>',
  });
});

test('desktop macos smoke live2d render scenario waits for visible pixels before passing', async () => {
  for (const scenarioId of ['chat.live2d-render-smoke', 'chat.live2d-render-smoke-mark', 'chat.live2d-render-smoke-wanko'] as const) {
    const clicked: string[] = [];
    const selectorsWaited: string[] = [];
    const writtenReports: Array<Record<string, unknown>> = [];
    const resizeRequests: Array<{ width: number; height: number }> = [];
    let tinyHostPulseRequests = 0;
    const dprPulseRequests: number[] = [];
    let contextRecoveryRequests = 0;
    let statsReads = 0;

    await runDesktopMacosSmokeScenario(scenarioId, {
      async waitForTestId() {},
      async waitForSelector(selector) {
        selectorsWaited.push(selector);
      },
      async clickByTestId(id) {
        clicked.push(id);
      },
      async setLive2dInteractionOverride() {},
      async resizeLive2dViewport(size) {
        resizeRequests.push(size);
      },
      async pulseLive2dViewportTinyHost() {
        tinyHostPulseRequests += 1;
      },
      async pulseLive2dDevicePixelRatio(value) {
        dprPulseRequests.push(value);
      },
      async triggerLive2dContextLossAndRestore() {
        contextRecoveryRequests += 1;
      },
      async readAttributeByTestId() {
        return null;
      },
      async readTextByTestId() {
        return '';
      },
      async readLive2dCanvasStats(selector) {
        assert.equal(selector, '[data-avatar-live2d-status]');
        statsReads += 1;
        return {
          status: 'ready',
          fallbackText: null,
          width: 320,
          height: 640,
          canvasPresent: true,
          contextKind: 'webgl2',
          sampleCount: 48,
          nonTransparentSampleCount: statsReads >= 2 ? 7 : 0,
          sampleError: null,
          runtimeDebug: null,
        };
      },
      async writeReport(payload) {
        writtenReports.push(payload as unknown as Record<string, unknown>);
      },
      currentRoute() {
        return '/chat';
      },
      currentHtml() {
        return '<html>live2d</html>';
      },
    });

    assert.deepEqual(clicked, [E2E_IDS.chatTarget('agent-e2e-alpha')]);
    assert.deepEqual(selectorsWaited, ['[data-avatar-live2d-status]']);
    assert.equal(tinyHostPulseRequests, 1);
    assert.deepEqual(dprPulseRequests, [1.75]);
    assert.equal(contextRecoveryRequests, 1);
    assert.deepEqual(resizeRequests, [
      { width: 292, height: 520 },
      { width: 360, height: 820 },
    ]);
    assert.equal(writtenReports.length, 1);
    assert.deepEqual(writtenReports[0], {
      ok: true,
      steps: [
        'wait-chat-panel',
        'select-agent-target',
        'wait-live2d-viewport',
        'wait-live2d-visible-pixels',
        'trigger-live2d-context-loss-restore',
        'wait-live2d-visible-pixels-after-context-restore',
        'pulse-live2d-viewport-tiny-host',
        'wait-live2d-visible-pixels-after-tiny-host',
        'pulse-live2d-device-pixel-ratio',
        'wait-live2d-visible-pixels-after-dpr-pulse',
        'resize-live2d-viewport-small',
        'wait-live2d-visible-pixels-after-small-resize',
        'resize-live2d-viewport-restored',
        'wait-live2d-visible-pixels-after-restored-resize',
        'write-pass-report',
      ],
      route: '/chat',
      htmlSnapshot: '<html>live2d</html>',
      details: {
        live2d: {
          initialVisible: {
            status: 'ready',
            fallbackText: null,
            width: 320,
            height: 640,
            canvasPresent: true,
            contextKind: 'webgl2',
            sampleCount: 48,
            nonTransparentSampleCount: 7,
            sampleError: null,
            runtimeDebug: undefined,
          },
          afterContextRestore: {
            status: 'ready',
            fallbackText: null,
            width: 320,
            height: 640,
            canvasPresent: true,
            contextKind: 'webgl2',
            sampleCount: 48,
            nonTransparentSampleCount: 7,
            sampleError: null,
            runtimeDebug: undefined,
          },
          afterTinyHost: {
            status: 'ready',
            fallbackText: null,
            width: 320,
            height: 640,
            canvasPresent: true,
            contextKind: 'webgl2',
            sampleCount: 48,
            nonTransparentSampleCount: 7,
            sampleError: null,
            runtimeDebug: undefined,
          },
          afterDprPulse: {
            status: 'ready',
            fallbackText: null,
            width: 320,
            height: 640,
            canvasPresent: true,
            contextKind: 'webgl2',
            sampleCount: 48,
            nonTransparentSampleCount: 7,
            sampleError: null,
            runtimeDebug: undefined,
          },
          afterSmallResize: {
            status: 'ready',
            fallbackText: null,
            width: 320,
            height: 640,
            canvasPresent: true,
            contextKind: 'webgl2',
            sampleCount: 48,
            nonTransparentSampleCount: 7,
            sampleError: null,
            runtimeDebug: undefined,
          },
          afterRestoredResize: {
            status: 'ready',
            fallbackText: null,
            width: 320,
            height: 640,
            canvasPresent: true,
            contextKind: 'webgl2',
            sampleCount: 48,
            nonTransparentSampleCount: 7,
            sampleError: null,
            runtimeDebug: undefined,
          },
        },
      },
    });
  }
});

test('desktop macos smoke live2d speaking scenario waits for speaking telemetry before passing', async () => {
  const overrides: Array<Record<string, unknown> | null> = [];
  const writtenReports: Array<Record<string, unknown>> = [];
  let statsReads = 0;

  await runDesktopMacosSmokeScenario('chat.live2d-render-smoke-mark-speaking', {
    async waitForTestId() {},
    async waitForSelector() {},
    async clickByTestId() {},
    async setLive2dInteractionOverride(override) {
      overrides.push(override);
    },
    async resizeLive2dViewport() {},
    async pulseLive2dViewportTinyHost() {},
    async pulseLive2dDevicePixelRatio() {},
    async triggerLive2dContextLossAndRestore() {},
    async readAttributeByTestId() {
      return null;
    },
    async readTextByTestId() {
      return '';
    },
    async readLive2dCanvasStats() {
      statsReads += 1;
      const speakingReady = statsReads >= 4;
      return {
        status: 'ready',
        fallbackText: null,
        width: 320,
        height: 640,
        canvasPresent: true,
        contextKind: 'webgl2',
        sampleCount: 48,
        nonTransparentSampleCount: 8,
        sampleError: null,
        runtimeDebug: speakingReady
          ? {
            phase: 'speaking',
            smoothedAmplitude: 0.34,
            speakingEnergy: 0.41,
          }
          : {
            phase: 'idle',
            smoothedAmplitude: 0,
            speakingEnergy: 0,
          },
      };
    },
    async writeReport(payload) {
      writtenReports.push(payload as unknown as Record<string, unknown>);
    },
    currentRoute() {
      return '/chat';
    },
    currentHtml() {
      return '<html>live2d-speaking</html>';
    },
  });

  assert.deepEqual(overrides, [{
    phase: 'speaking',
    label: 'Speaking…',
    emotion: 'focus',
    amplitude: 0.82,
    visemeId: 'aa',
  }]);
  assert.equal(writtenReports.length, 1);
  assert.deepEqual(writtenReports[0], {
    ok: true,
    steps: [
      'wait-chat-panel',
      'select-agent-target',
      'wait-live2d-viewport',
      'wait-live2d-visible-pixels',
      'set-live2d-speaking-override',
      'wait-live2d-speaking-pose',
      'trigger-live2d-context-loss-restore',
      'wait-live2d-visible-pixels-after-context-restore',
      'pulse-live2d-viewport-tiny-host',
      'wait-live2d-visible-pixels-after-tiny-host',
      'pulse-live2d-device-pixel-ratio',
      'wait-live2d-visible-pixels-after-dpr-pulse',
      'resize-live2d-viewport-small',
      'wait-live2d-visible-pixels-after-small-resize',
      'resize-live2d-viewport-restored',
      'wait-live2d-visible-pixels-after-restored-resize',
      'write-pass-report',
    ],
    route: '/chat',
    htmlSnapshot: '<html>live2d-speaking</html>',
    details: {
      live2d: {
        initialVisible: {
          status: 'ready',
          fallbackText: null,
          width: 320,
          height: 640,
          canvasPresent: true,
          contextKind: 'webgl2',
          sampleCount: 48,
          nonTransparentSampleCount: 8,
          sampleError: null,
          runtimeDebug: {
            phase: 'idle',
            smoothedAmplitude: 0,
            speakingEnergy: 0,
          },
        },
        speakingVisible: {
          status: 'ready',
          fallbackText: null,
          width: 320,
          height: 640,
          canvasPresent: true,
          contextKind: 'webgl2',
          sampleCount: 48,
          nonTransparentSampleCount: 8,
          sampleError: null,
          runtimeDebug: {
            phase: 'speaking',
            smoothedAmplitude: 0.34,
            speakingEnergy: 0.41,
          },
        },
        afterContextRestore: {
          status: 'ready',
          fallbackText: null,
          width: 320,
          height: 640,
          canvasPresent: true,
          contextKind: 'webgl2',
          sampleCount: 48,
          nonTransparentSampleCount: 8,
          sampleError: null,
          runtimeDebug: {
            phase: 'speaking',
            smoothedAmplitude: 0.34,
            speakingEnergy: 0.41,
          },
        },
        afterTinyHost: {
          status: 'ready',
          fallbackText: null,
          width: 320,
          height: 640,
          canvasPresent: true,
          contextKind: 'webgl2',
          sampleCount: 48,
          nonTransparentSampleCount: 8,
          sampleError: null,
          runtimeDebug: {
            phase: 'speaking',
            smoothedAmplitude: 0.34,
            speakingEnergy: 0.41,
          },
        },
        afterDprPulse: {
          status: 'ready',
          fallbackText: null,
          width: 320,
          height: 640,
          canvasPresent: true,
          contextKind: 'webgl2',
          sampleCount: 48,
          nonTransparentSampleCount: 8,
          sampleError: null,
          runtimeDebug: {
            phase: 'speaking',
            smoothedAmplitude: 0.34,
            speakingEnergy: 0.41,
          },
        },
        afterSmallResize: {
          status: 'ready',
          fallbackText: null,
          width: 320,
          height: 640,
          canvasPresent: true,
          contextKind: 'webgl2',
          sampleCount: 48,
          nonTransparentSampleCount: 8,
          sampleError: null,
          runtimeDebug: {
            phase: 'speaking',
            smoothedAmplitude: 0.34,
            speakingEnergy: 0.41,
          },
        },
        afterRestoredResize: {
          status: 'ready',
          fallbackText: null,
          width: 320,
          height: 640,
          canvasPresent: true,
          contextKind: 'webgl2',
          sampleCount: 48,
          nonTransparentSampleCount: 8,
          sampleError: null,
          runtimeDebug: {
            phase: 'speaking',
            smoothedAmplitude: 0.34,
            speakingEnergy: 0.41,
          },
        },
      },
    },
  });
});

test('desktop macos smoke fails closed for unknown scenarios and emits a fail report', async () => {
  const reports: Array<Record<string, unknown>> = [];

  await assert.rejects(
    () => runDesktopMacosSmokeScenario('unknown-scenario', {
      async waitForTestId() {},
      async waitForSelector() {},
      async clickByTestId() {},
      async setLive2dInteractionOverride() {},
      async resizeLive2dViewport() {},
      async pulseLive2dViewportTinyHost() {},
      async pulseLive2dDevicePixelRatio() {},
      async triggerLive2dContextLossAndRestore() {},
      async readAttributeByTestId() {
        return null;
      },
      async readTextByTestId() {
        return '';
      },
      async readLive2dCanvasStats() {
        return {
          status: null,
          fallbackText: null,
          width: 0,
          height: 0,
          canvasPresent: false,
          contextKind: null,
          sampleCount: 0,
          nonTransparentSampleCount: 0,
          sampleError: null,
          runtimeDebug: null,
        };
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
    details: undefined,
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
