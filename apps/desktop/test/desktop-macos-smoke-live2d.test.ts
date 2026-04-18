import test from 'node:test';

import { assert, E2E_IDS, createBaseDriver, runDesktopMacosSmokeScenario } from './desktop-macos-smoke-test-helpers';

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

    await runDesktopMacosSmokeScenario(scenarioId, createBaseDriver({
      async waitForSelector(selector) {
        selectorsWaited.push(selector);
      },
      async clickByTestId(id) {
        clicked.push(id);
      },
    async setChatAvatarInteractionOverride() {},
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
    }));

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

  await runDesktopMacosSmokeScenario('chat.live2d-render-smoke-mark-speaking', createBaseDriver({
    async setChatAvatarInteractionOverride(override) {
      overrides.push(override);
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
  }));

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
