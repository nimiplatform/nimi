import test from 'node:test';

import { assert, E2E_IDS, createBaseDriver, runDesktopMacosSmokeScenario } from './desktop-macos-smoke-test-helpers';

test('desktop macos smoke fails closed for unknown scenarios and emits a fail report', async () => {
  const reports: Array<Record<string, unknown>> = [];

  await assert.rejects(
    () => runDesktopMacosSmokeScenario('unknown-scenario', createBaseDriver({
      async writeReport(payload) {
        reports.push(payload as unknown as Record<string, unknown>);
      },
      currentRoute() {
        return '/';
      },
      currentHtml() {
        return '<html>fail</html>';
      },
    })),
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

for (const scenarioId of [
  'chat.vrm-lifecycle-smoke',
  'chat.vrm-lifecycle-smoke-avatar-sample-a',
  'chat.vrm-lifecycle-smoke-avatar-sample-b',
] as const) {
  test(`desktop macos smoke ${scenarioId} records ready, teardown, and rebind churn`, async () => {
    const clicked: string[] = [];
    const selectorsWaited: string[] = [];
    const selectorsGone: string[] = [];
    const writtenReports: Array<Record<string, unknown>> = [];
    const resizeRequests: Array<{ width: number; height: number }> = [];
    let tinyHostPulseRequests = 0;
    let contextRecoveryRequests = 0;
    let vrmStatsReads = 0;

    function createReadyLifecycleStats(readNumber: number) {
      const loadSuccessCount = readNumber >= 14 ? 3 : readNumber >= 12 ? 2 : 1;
      const disposeCount = readNumber >= 14 ? 2 : readNumber >= 12 ? 1 : 0;
      return {
        status: 'ready',
        stage: 'ready',
        fallbackText: null,
        width: 320,
        height: 640,
        canvasPresent: true,
        contextKind: 'webgl2' as const,
        sampleCount: 48,
        nonTransparentSampleCount: 0,
        sampleError: null,
        runtimeDebug: {
          viewportState: {
            phase: 'idle',
            posture: 'idle-settled',
            speakingEnergy: 0,
          },
          performance: {
            loadSuccessCount,
            disposeCount,
            disposedGeometryCount: disposeCount * 4,
            disposedMaterialCount: disposeCount * 3,
            disposedTextureCount: disposeCount * 2,
            lastLoadedAssetRef: 'desktop-avatar://fixture-vrm/sample.vrm',
            lastLoadedAt: readNumber * 100,
            lastDisposedAssetRef: disposeCount > 0 ? 'desktop-avatar://fixture-vrm/sample.vrm' : null,
            lastDisposedAt: disposeCount > 0 ? readNumber * 100 - 25 : null,
            rendererMemory: {
              geometries: 7,
              textures: 3,
              programs: 4,
            },
            sceneResources: {
              objectCount: 24,
              meshCount: 11,
              skinnedMeshCount: 1,
              geometryCount: 4,
              materialCount: 3,
              textureCount: 2,
              morphTargetCount: 8,
            },
          },
          diagnostic: {
            stage: 'ready',
            recoveryAttemptCount: 0,
            resizePosture: 'tracked-host-size',
            hostRenderable: true,
            canvasEpoch: 2,
          },
          framing: {
            mode: 'upper-body-portrait',
            selectionReason: 'portrait-default',
            scale: 1.44,
            positionX: 0,
            positionY: 0.16,
            positionZ: -0.16,
            railWidth: 360,
            railHeight: 820,
            railAspect: 820 / 360,
            railIsPortrait: true,
            fitHeight: 2.72,
            fitWidth: 1.9,
            fitDepth: 1.5,
            targetTop: 1.46,
            minBottom: -1.78,
            zOffset: -0.16,
            width: 0.9,
            height: 1.8,
            depth: 0.75,
            silhouetteAspect: 2,
            widthRatio: 0.5,
          },
          renderLoop: {
            frameCount: readNumber * 3,
            readyFrameCount: readNumber * 2,
            lastFrameAt: readNumber * 100,
            lastReadyFrameAt: readNumber * 100,
            canvasEpoch: 2,
          },
        },
      };
    }

    await runDesktopMacosSmokeScenario(scenarioId, createBaseDriver({
      async waitForSelector(selector) {
        selectorsWaited.push(selector);
      },
      async waitForSelectorGone(selector) {
        selectorsGone.push(selector);
      },
      async clickByTestId(id) {
        clicked.push(id);
      },
      async resizeVrmViewport(size) {
        resizeRequests.push(size);
      },
      async pulseVrmViewportTinyHost() {
        tinyHostPulseRequests += 1;
      },
      async triggerVrmContextLossAndRestore() {
        contextRecoveryRequests += 1;
      },
      async readVrmCanvasStats(selector) {
        assert.equal(selector, '[data-avatar-vrm-status]');
        vrmStatsReads += 1;
        return createReadyLifecycleStats(vrmStatsReads);
      },
      async writeReport(payload) {
        writtenReports.push(payload as unknown as Record<string, unknown>);
      },
      currentRoute() {
        return '/chat';
      },
      currentHtml() {
        return '<html>vrm</html>';
      },
    }));

    assert.deepEqual(clicked, [
      E2E_IDS.chatTarget('agent-e2e-alpha'),
      E2E_IDS.chatRow('chat-e2e-primary'),
      E2E_IDS.chatTarget('agent-e2e-alpha'),
      E2E_IDS.chatRow('chat-e2e-primary'),
      E2E_IDS.chatTarget('agent-e2e-alpha'),
    ]);
    assert.deepEqual(selectorsWaited, [
      '[data-avatar-vrm-status]',
      '[data-avatar-vrm-status]',
    ]);
    assert.deepEqual(selectorsGone, [
      '[data-avatar-vrm-status]',
      '[data-avatar-vrm-status]',
    ]);
    assert.equal(tinyHostPulseRequests, 1);
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
        'wait-vrm-viewport',
        'wait-vrm-ready-lifecycle',
        'trigger-vrm-context-loss-restore',
        'wait-vrm-ready-lifecycle-after-context-restore',
        'pulse-vrm-viewport-tiny-host',
        'wait-vrm-ready-lifecycle-after-tiny-host',
        'resize-vrm-viewport-small',
        'wait-vrm-ready-lifecycle-after-small-resize',
        'resize-vrm-viewport-restored',
        'wait-vrm-ready-lifecycle-after-restored-resize',
        'switch-away-to-non-vrm-target',
        'wait-vrm-viewport-teardown',
        'switch-back-to-vrm-target',
        'wait-vrm-viewport-rebound',
        'wait-vrm-ready-lifecycle-after-rebind',
        'repeat-vrm-churn-away',
        'wait-vrm-viewport-second-teardown',
        'repeat-vrm-churn-back',
        'wait-vrm-ready-lifecycle-after-second-rebind',
        'write-pass-report',
      ],
      route: '/chat',
      htmlSnapshot: '<html>vrm</html>',
      details: {
        vrm: {
          expectedFraming: {
            mode: 'upper-body-portrait',
            selectionReason: 'portrait-default',
            scale: 1.44,
            fitHeight: 2.72,
            fitWidth: 1.9,
            fitDepth: 1.5,
            targetTop: 1.46,
            minBottom: -1.78,
            zOffset: -0.16,
            width: 0.9,
            height: 1.8,
            depth: 0.75,
            silhouetteAspect: 2,
            widthRatio: 0.5,
          },
          expectedSceneResources: {
            objectCount: 24,
            meshCount: 11,
            skinnedMeshCount: 1,
            geometryCount: 4,
            materialCount: 3,
            textureCount: 2,
            morphTargetCount: 8,
          },
          expectedRendererMemory: {
            geometries: 7,
            textures: 3,
            programs: 4,
          },
          initialVisible: createReadyLifecycleStats(2),
          afterContextRestore: createReadyLifecycleStats(4),
          afterTinyHost: createReadyLifecycleStats(6),
          afterSmallResize: createReadyLifecycleStats(8),
          afterRestoredResize: createReadyLifecycleStats(10),
          afterRebind: createReadyLifecycleStats(12),
          afterSecondRebind: createReadyLifecycleStats(14),
        },
      },
    });
  });
}

