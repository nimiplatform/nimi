import test from 'node:test';

import { assert, createBaseDriver, runDesktopMacosSmokeScenario } from './desktop-macos-smoke-test-helpers';

test('desktop macos smoke vrm speaking scenario waits for speaking posture evidence before passing', async () => {
  const overrides: Array<Record<string, unknown> | null> = [];
  const writtenReports: Array<Record<string, unknown>> = [];
  let vrmStatsReads = 0;

  await runDesktopMacosSmokeScenario('chat.vrm-speaking-smoke', createBaseDriver({
    async setChatAvatarInteractionOverride(override) {
      overrides.push(override);
    },
    async readVrmCanvasStats() {
      vrmStatsReads += 1;
      const speakingReady = vrmStatsReads >= 4;
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
            phase: speakingReady ? 'speaking' : 'idle',
            posture: speakingReady ? 'speaking-energized' : 'idle-settled',
            speakingEnergy: speakingReady ? 0.88 : 0,
            mouthOpen: speakingReady ? 0.28 : 0.11,
            eyeOpen: speakingReady ? 0.082 : 0.08,
            blinkSpeed: speakingReady ? 6 : 3.2,
          },
          expression: speakingReady
            ? {
              activeViseme: 'aa',
              weights: {
                aa: 0.89,
              },
            }
            : {
              activeViseme: null,
              weights: {},
            },
          diagnostic: {
            stage: 'ready',
            recoveryAttemptCount: 0,
            resizePosture: 'tracked-host-size',
            hostRenderable: true,
            canvasEpoch: 2,
          },
          framing: {
            mode: 'broad-portrait',
            selectionReason: 'width-ratio-threshold',
            scale: 1.31,
            positionX: 0,
            positionY: 0.14,
            positionZ: -0.18,
            railWidth: 360,
            railHeight: 820,
            railAspect: 820 / 360,
            railIsPortrait: true,
            fitHeight: 2.9,
            fitWidth: 2.18,
            fitDepth: 1.62,
            targetTop: 1.48,
            minBottom: -1.72,
            zOffset: -0.18,
            width: 1.22,
            height: 1.95,
            depth: 0.81,
            silhouetteAspect: 1.6,
            widthRatio: 0.6256,
          },
          renderLoop: {
            frameCount: vrmStatsReads * 3,
            readyFrameCount: vrmStatsReads * 2,
            lastFrameAt: vrmStatsReads * 100,
            lastReadyFrameAt: vrmStatsReads * 100,
            canvasEpoch: 2,
          },
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
      return '<html>vrm-speaking</html>';
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
      'wait-vrm-viewport',
      'wait-vrm-ready-lifecycle',
      'set-vrm-speaking-override',
      'wait-vrm-speaking-pose',
      'write-pass-report',
    ],
    route: '/chat',
    htmlSnapshot: '<html>vrm-speaking</html>',
    details: {
      vrm: {
        expectedFraming: {
          mode: 'broad-portrait',
          selectionReason: 'width-ratio-threshold',
          scale: 1.31,
          fitHeight: 2.9,
          fitWidth: 2.18,
          fitDepth: 1.62,
          targetTop: 1.48,
          minBottom: -1.72,
          zOffset: -0.18,
          width: 1.22,
          height: 1.95,
          depth: 0.81,
          silhouetteAspect: 1.6,
          widthRatio: 0.6256,
        },
        expectedActiveViseme: 'aa',
        expectedPhase: 'speaking',
        expectedPosture: 'speaking-energized',
        initialVisible: {
          status: 'ready',
          stage: 'ready',
          fallbackText: null,
          width: 320,
          height: 640,
          canvasPresent: true,
          contextKind: 'webgl2',
          sampleCount: 48,
          nonTransparentSampleCount: 0,
          sampleError: null,
          runtimeDebug: {
            viewportState: {
              phase: 'idle',
              posture: 'idle-settled',
              speakingEnergy: 0,
              mouthOpen: 0.11,
              eyeOpen: 0.08,
              blinkSpeed: 3.2,
            },
            expression: {
              activeViseme: null,
              weights: {},
            },
            diagnostic: {
              stage: 'ready',
              recoveryAttemptCount: 0,
              resizePosture: 'tracked-host-size',
              hostRenderable: true,
              canvasEpoch: 2,
            },
            framing: {
              mode: 'broad-portrait',
              selectionReason: 'width-ratio-threshold',
              scale: 1.31,
              positionX: 0,
              positionY: 0.14,
              positionZ: -0.18,
              railWidth: 360,
              railHeight: 820,
              railAspect: 820 / 360,
              railIsPortrait: true,
              fitHeight: 2.9,
              fitWidth: 2.18,
              fitDepth: 1.62,
              targetTop: 1.48,
              minBottom: -1.72,
              zOffset: -0.18,
              width: 1.22,
              height: 1.95,
              depth: 0.81,
              silhouetteAspect: 1.6,
              widthRatio: 0.6256,
            },
            renderLoop: {
              frameCount: 6,
              readyFrameCount: 4,
              lastFrameAt: 200,
              lastReadyFrameAt: 200,
              canvasEpoch: 2,
            },
          },
        },
        speakingVisible: {
          status: 'ready',
          stage: 'ready',
          fallbackText: null,
          width: 320,
          height: 640,
          canvasPresent: true,
          contextKind: 'webgl2',
          sampleCount: 48,
          nonTransparentSampleCount: 0,
          sampleError: null,
          runtimeDebug: {
            viewportState: {
              phase: 'speaking',
              posture: 'speaking-energized',
              speakingEnergy: 0.88,
              mouthOpen: 0.28,
              eyeOpen: 0.082,
              blinkSpeed: 6,
            },
            expression: {
              activeViseme: 'aa',
              weights: {
                aa: 0.89,
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
              mode: 'broad-portrait',
              selectionReason: 'width-ratio-threshold',
              scale: 1.31,
              positionX: 0,
              positionY: 0.14,
              positionZ: -0.18,
              railWidth: 360,
              railHeight: 820,
              railAspect: 820 / 360,
              railIsPortrait: true,
              fitHeight: 2.9,
              fitWidth: 2.18,
              fitDepth: 1.62,
              targetTop: 1.48,
              minBottom: -1.72,
              zOffset: -0.18,
              width: 1.22,
              height: 1.95,
              depth: 0.81,
              silhouetteAspect: 1.6,
              widthRatio: 0.6256,
            },
            renderLoop: {
              frameCount: 12,
              readyFrameCount: 8,
              lastFrameAt: 400,
              lastReadyFrameAt: 400,
              canvasEpoch: 2,
            },
          },
        },
      },
    },
  });
});

test('desktop macos smoke vrm speaking fallback scenario waits for no-viseme fallback evidence before passing', async () => {
  const overrides: Array<Record<string, unknown> | null> = [];
  const writtenReports: Array<Record<string, unknown>> = [];
  let vrmStatsReads = 0;

  await runDesktopMacosSmokeScenario('chat.vrm-speaking-smoke-no-viseme', createBaseDriver({
    async setChatAvatarInteractionOverride(override) {
      overrides.push(override);
    },
    async readVrmCanvasStats() {
      vrmStatsReads += 1;
      const speakingReady = vrmStatsReads >= 4;
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
            phase: speakingReady ? 'speaking' : 'idle',
            posture: speakingReady ? 'speaking-energized' : 'idle-settled',
            speakingEnergy: speakingReady ? 0.88 : 0,
            mouthOpen: speakingReady ? 0.28 : 0.11,
            eyeOpen: speakingReady ? 0.082 : 0.08,
            blinkSpeed: speakingReady ? 6 : 3.2,
          },
          expression: speakingReady
            ? {
              activeViseme: null,
              weights: {
                aa: 0.7,
              },
            }
            : {
              activeViseme: null,
              weights: {},
            },
          diagnostic: {
            stage: 'ready',
            recoveryAttemptCount: 0,
            resizePosture: 'tracked-host-size',
            hostRenderable: true,
            canvasEpoch: 2,
          },
          framing: {
            mode: 'broad-portrait',
            selectionReason: 'width-ratio-threshold',
            scale: 1.31,
            positionX: 0,
            positionY: 0.14,
            positionZ: -0.18,
            railWidth: 360,
            railHeight: 820,
            railAspect: 820 / 360,
            railIsPortrait: true,
            fitHeight: 2.9,
            fitWidth: 2.18,
            fitDepth: 1.62,
            targetTop: 1.48,
            minBottom: -1.72,
            zOffset: -0.18,
            width: 1.22,
            height: 1.95,
            depth: 0.81,
            silhouetteAspect: 1.6,
            widthRatio: 0.6256,
          },
          renderLoop: {
            frameCount: vrmStatsReads * 3,
            readyFrameCount: vrmStatsReads * 2,
            lastFrameAt: vrmStatsReads * 100,
            lastReadyFrameAt: vrmStatsReads * 100,
            canvasEpoch: 2,
          },
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
      return '<html>vrm-speaking-fallback</html>';
    },
  }));

  assert.deepEqual(overrides, [{
    phase: 'speaking',
    label: 'Speaking…',
    emotion: 'focus',
    amplitude: 0.82,
  }]);
  assert.equal(writtenReports.length, 1);
  assert.deepEqual(writtenReports[0], {
    ok: true,
    steps: [
      'wait-chat-panel',
      'select-agent-target',
      'wait-vrm-viewport',
      'wait-vrm-ready-lifecycle',
      'set-vrm-speaking-fallback-override',
      'wait-vrm-speaking-fallback-pose',
      'write-pass-report',
    ],
    route: '/chat',
    htmlSnapshot: '<html>vrm-speaking-fallback</html>',
    details: {
      vrm: {
        expectedFraming: {
          mode: 'broad-portrait',
          selectionReason: 'width-ratio-threshold',
          scale: 1.31,
          fitHeight: 2.9,
          fitWidth: 2.18,
          fitDepth: 1.62,
          targetTop: 1.48,
          minBottom: -1.72,
          zOffset: -0.18,
          width: 1.22,
          height: 1.95,
          depth: 0.81,
          silhouetteAspect: 1.6,
          widthRatio: 0.6256,
        },
        expectedActiveViseme: null,
        expectedPhase: 'speaking',
        expectedPosture: 'speaking-energized',
        initialVisible: {
          status: 'ready',
          stage: 'ready',
          fallbackText: null,
          width: 320,
          height: 640,
          canvasPresent: true,
          contextKind: 'webgl2',
          sampleCount: 48,
          nonTransparentSampleCount: 0,
          sampleError: null,
          runtimeDebug: {
            viewportState: {
              phase: 'idle',
              posture: 'idle-settled',
              speakingEnergy: 0,
              mouthOpen: 0.11,
              eyeOpen: 0.08,
              blinkSpeed: 3.2,
            },
            expression: {
              activeViseme: null,
              weights: {},
            },
            diagnostic: {
              stage: 'ready',
              recoveryAttemptCount: 0,
              resizePosture: 'tracked-host-size',
              hostRenderable: true,
              canvasEpoch: 2,
            },
            framing: {
              mode: 'broad-portrait',
              selectionReason: 'width-ratio-threshold',
              scale: 1.31,
              positionX: 0,
              positionY: 0.14,
              positionZ: -0.18,
              railWidth: 360,
              railHeight: 820,
              railAspect: 820 / 360,
              railIsPortrait: true,
              fitHeight: 2.9,
              fitWidth: 2.18,
              fitDepth: 1.62,
              targetTop: 1.48,
              minBottom: -1.72,
              zOffset: -0.18,
              width: 1.22,
              height: 1.95,
              depth: 0.81,
              silhouetteAspect: 1.6,
              widthRatio: 0.6256,
            },
            renderLoop: {
              frameCount: 6,
              readyFrameCount: 4,
              lastFrameAt: 200,
              lastReadyFrameAt: 200,
              canvasEpoch: 2,
            },
          },
        },
        speakingVisible: {
          status: 'ready',
          stage: 'ready',
          fallbackText: null,
          width: 320,
          height: 640,
          canvasPresent: true,
          contextKind: 'webgl2',
          sampleCount: 48,
          nonTransparentSampleCount: 0,
          sampleError: null,
          runtimeDebug: {
            viewportState: {
              phase: 'speaking',
              posture: 'speaking-energized',
              speakingEnergy: 0.88,
              mouthOpen: 0.28,
              eyeOpen: 0.082,
              blinkSpeed: 6,
            },
            expression: {
              activeViseme: null,
              weights: {
                aa: 0.7,
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
              mode: 'broad-portrait',
              selectionReason: 'width-ratio-threshold',
              scale: 1.31,
              positionX: 0,
              positionY: 0.14,
              positionZ: -0.18,
              railWidth: 360,
              railHeight: 820,
              railAspect: 820 / 360,
              railIsPortrait: true,
              fitHeight: 2.9,
              fitWidth: 2.18,
              fitDepth: 1.62,
              targetTop: 1.48,
              minBottom: -1.72,
              zOffset: -0.18,
              width: 1.22,
              height: 1.95,
              depth: 0.81,
              silhouetteAspect: 1.6,
              widthRatio: 0.6256,
            },
            renderLoop: {
              frameCount: 12,
              readyFrameCount: 8,
              lastFrameAt: 400,
              lastReadyFrameAt: 400,
              canvasEpoch: 2,
            },
          },
        },
      },
    },
  });
});

