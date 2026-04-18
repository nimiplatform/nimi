import test from 'node:test';

import { assert, createBaseDriver, runDesktopMacosSmokeScenario } from './desktop-macos-smoke-test-helpers';

test('desktop macos smoke vrm listening scenario waits for listening posture evidence before passing', async () => {
  const overrides: Array<Record<string, unknown> | null> = [];
  const writtenReports: Array<Record<string, unknown>> = [];
  let vrmStatsReads = 0;

  await runDesktopMacosSmokeScenario('chat.vrm-listening-smoke', createBaseDriver({
    async setChatAvatarInteractionOverride(override) {
      overrides.push(override);
    },
    async readVrmCanvasStats() {
      vrmStatsReads += 1;
      const listeningReady = vrmStatsReads >= 4;
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
            phase: listeningReady ? 'listening' : 'idle',
            posture: listeningReady ? 'listening-attentive' : 'idle-settled',
            speakingEnergy: 0,
            mouthOpen: listeningReady ? 0.11 : 0.11,
            eyeOpen: listeningReady ? 0.09 : 0.08,
            blinkSpeed: listeningReady ? 3.6 : 3.2,
          },
          expression: listeningReady
            ? {
              activeViseme: null,
              weights: {
                relaxed: 0.34,
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
      return '<html>vrm-listening</html>';
    },
  }));

  assert.deepEqual(overrides, [{
    phase: 'listening',
    label: 'Listening…',
    emotion: 'focus',
    amplitude: 0.24,
  }]);
  assert.equal(writtenReports.length, 1);
  assert.deepEqual(writtenReports[0], {
    ok: true,
    steps: [
      'wait-chat-panel',
      'select-agent-target',
      'wait-vrm-viewport',
      'wait-vrm-ready-lifecycle',
      'set-vrm-listening-override',
      'wait-vrm-listening-pose',
      'write-pass-report',
    ],
    route: '/chat',
    htmlSnapshot: '<html>vrm-listening</html>',
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
        expectedPhase: 'listening',
        expectedPosture: 'listening-attentive',
        expectedActiveViseme: null,
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
        listeningVisible: {
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
              phase: 'listening',
              posture: 'listening-attentive',
              speakingEnergy: 0,
              mouthOpen: 0.11,
              eyeOpen: 0.09,
              blinkSpeed: 3.6,
            },
            expression: {
              activeViseme: null,
              weights: {
                relaxed: 0.34,
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

test('desktop macos smoke vrm thinking scenario waits for thinking posture evidence before passing', async () => {
  const overrides: Array<Record<string, unknown> | null> = [];
  const writtenReports: Array<Record<string, unknown>> = [];
  let vrmStatsReads = 0;

  await runDesktopMacosSmokeScenario('chat.vrm-thinking-smoke', createBaseDriver({
    async setChatAvatarInteractionOverride(override) {
      overrides.push(override);
    },
    async readVrmCanvasStats() {
      vrmStatsReads += 1;
      const thinkingReady = vrmStatsReads >= 4;
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
            phase: thinkingReady ? 'thinking' : 'idle',
            posture: thinkingReady ? 'thinking-reflective' : 'idle-settled',
            speakingEnergy: 0,
            mouthOpen: thinkingReady ? 0.1 : 0.11,
            eyeOpen: thinkingReady ? 0.05 : 0.08,
            blinkSpeed: thinkingReady ? 2.2 : 3.2,
          },
          expression: thinkingReady
            ? {
              activeViseme: null,
              weights: {
                relaxed: 0.34,
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
      return '<html>vrm-thinking</html>';
    },
  }));

  assert.deepEqual(overrides, [{
    phase: 'thinking',
    label: 'Thinking…',
    emotion: 'calm',
    amplitude: 0.34,
  }]);
  assert.equal(writtenReports.length, 1);
  assert.deepEqual(writtenReports[0], {
    ok: true,
    steps: [
      'wait-chat-panel',
      'select-agent-target',
      'wait-vrm-viewport',
      'wait-vrm-ready-lifecycle',
      'set-vrm-thinking-override',
      'wait-vrm-thinking-pose',
      'write-pass-report',
    ],
    route: '/chat',
    htmlSnapshot: '<html>vrm-thinking</html>',
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
        expectedPhase: 'thinking',
        expectedPosture: 'thinking-reflective',
        expectedActiveViseme: null,
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
        thinkingVisible: {
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
              phase: 'thinking',
              posture: 'thinking-reflective',
              speakingEnergy: 0,
              mouthOpen: 0.1,
              eyeOpen: 0.05,
              blinkSpeed: 2.2,
            },
            expression: {
              activeViseme: null,
              weights: {
                relaxed: 0.34,
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
