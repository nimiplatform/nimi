import { E2E_IDS } from '@renderer/testability/e2e-ids';
import {
  isChatLive2dRenderSmokeScenario,
  isChatVrmLifecycleSmokeScenario,
  type DesktopMacosSmokeDriverDeps,
  type Live2dVisiblePixelsTimeoutError,
  type VrmVisiblePixelsTimeoutError,
  SMOKE_STEP_TIMEOUT_MS,
} from './desktop-macos-smoke-shared';
import {
  toLive2dCanvasStatsReport,
  waitForSpeakingLive2dPose,
  waitForVisibleLive2dPixels,
} from './desktop-macos-smoke-live2d';
import {
  assertStableVrmFramingSignature,
  assertStableVrmRendererMemory,
  assertStableVrmResourceCounts,
  readVrmPerformanceEvidence,
  resolveVrmFramingSignature,
  toVrmCanvasStatsReport,
  waitForVisibleVrmPixels,
  waitForVrmPostureEvidence,
} from './desktop-macos-smoke-vrm';

async function waitForMemoryMode(
  deps: Pick<DesktopMacosSmokeDriverDeps, 'readAttributeByTestId' | 'readTextByTestId'>,
  expected: 'baseline' | 'standard',
  timeoutMs = SMOKE_STEP_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const mode = (await deps.readAttributeByTestId(E2E_IDS.chatMemoryModeStatus, 'data-memory-mode'))?.trim().toLowerCase();
    if (mode === expected) {
      return;
    }
    if (!mode) {
      const label = (await deps.readTextByTestId(E2E_IDS.chatMemoryModeStatus)).trim().toLowerCase();
      if (label === expected) {
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`expected memory mode ${expected}`);
}

export async function runDesktopMacosSmokeScenario(
  scenarioId: string,
  deps: DesktopMacosSmokeDriverDeps,
): Promise<void> {
  const steps: string[] = [];
  const record = (step: string) => {
    steps.push(step);
  };

  try {
    switch (scenarioId) {
      case 'chat.memory-standard-bind':
        record('wait-chat-panel');
        await deps.waitForTestId(E2E_IDS.panel('chat'));
        record('select-agent-target');
        await deps.clickByTestId(E2E_IDS.chatTarget('agent-e2e-alpha'));
        record('open-settings');
        await deps.clickByTestId(E2E_IDS.chatSettingsToggle);
        record('wait-baseline');
        await deps.waitForTestId(E2E_IDS.chatMemoryModeStatus);
        await waitForMemoryMode(deps, 'baseline');
        record('cancel-upgrade');
        await deps.clickByTestId(E2E_IDS.chatMemoryModeUpgradeButton);
        record('confirm-cancel-still-baseline');
        await waitForMemoryMode(deps, 'baseline');
        record('confirm-upgrade');
        await deps.clickByTestId(E2E_IDS.chatMemoryModeUpgradeButton);
        record('wait-standard');
        await waitForMemoryMode(deps, 'standard');
        record('write-pass-report');
        await deps.writeReport({
          ok: true,
          steps,
          route: deps.currentRoute(),
          htmlSnapshot: deps.currentHtml(),
        });
        return;

      case 'tester.speech-bundle-panels':
        record('open-tester-tab');
        await deps.clickByTestId(E2E_IDS.navTab('tester'));
        record('wait-tester-panel');
        await deps.waitForTestId(E2E_IDS.panel('tester'));
        record('open-tts-panel');
        await deps.clickByTestId(E2E_IDS.testerCapabilityTab('audio.synthesize'));
        record('wait-tts-input');
        await deps.waitForTestId(E2E_IDS.testerPanel('audio.synthesize'));
        await deps.waitForTestId(E2E_IDS.testerInput('audio-synthesize-text'));
        record('open-stt-panel');
        await deps.clickByTestId(E2E_IDS.testerCapabilityTab('audio.transcribe'));
        record('wait-stt-input');
        await deps.waitForTestId(E2E_IDS.testerPanel('audio.transcribe'));
        await deps.waitForTestId(E2E_IDS.testerInput('audio-transcribe-file'));
        record('open-voice-clone-panel');
        await deps.clickByTestId(E2E_IDS.testerCapabilityTab('voice_workflow.tts_v2v'));
        record('wait-voice-clone-input');
        await deps.waitForTestId(E2E_IDS.testerPanel('voice_workflow.tts_v2v'));
        await deps.waitForTestId(E2E_IDS.testerInput('voice-clone-file'));
        record('open-voice-design-panel');
        await deps.clickByTestId(E2E_IDS.testerCapabilityTab('voice_workflow.tts_t2v'));
        record('wait-voice-design-input');
        await deps.waitForTestId(E2E_IDS.testerPanel('voice_workflow.tts_t2v'));
        await deps.waitForTestId(E2E_IDS.testerInput('voice-design-instruction'));
        record('write-pass-report');
        await deps.writeReport({
          ok: true,
          steps,
          route: deps.currentRoute(),
          htmlSnapshot: deps.currentHtml(),
        });
        return;

      case 'chat.live2d-render-smoke':
      case 'chat.live2d-render-smoke-mark':
      case 'chat.live2d-render-smoke-mark-speaking':
      default: {
        if (
          scenarioId === 'chat.vrm-speaking-smoke'
          || scenarioId === 'chat.vrm-speaking-smoke-no-viseme'
          || scenarioId === 'chat.vrm-listening-smoke'
          || scenarioId === 'chat.vrm-thinking-smoke'
        ) {
          const scenarioConfig = scenarioId === 'chat.vrm-speaking-smoke'
            ? {
              setStep: 'set-vrm-speaking-override',
              waitStep: 'wait-vrm-speaking-pose',
              override: { phase: 'speaking', label: 'Speaking…', emotion: 'focus', amplitude: 0.82, visemeId: 'aa' },
              wait: {
                expectedPhase: 'speaking',
                expectedPosture: 'speaking-energized',
                expectedActiveViseme: 'aa',
                minSpeakingEnergy: 0.02,
                minSpeakingWeight: 0.1,
                mouthOpenMin: 0.12,
                eyeOpenMin: 0.01,
                blinkSpeedMin: 1,
                errorLabel: 'speaking posture evidence',
              },
              reportKey: 'speakingVisible',
            }
            : scenarioId === 'chat.vrm-speaking-smoke-no-viseme'
              ? {
                setStep: 'set-vrm-speaking-fallback-override',
                waitStep: 'wait-vrm-speaking-fallback-pose',
                override: { phase: 'speaking', label: 'Speaking…', emotion: 'focus', amplitude: 0.82 },
                wait: {
                  expectedPhase: 'speaking',
                  expectedPosture: 'speaking-energized',
                  expectedActiveViseme: null,
                  minSpeakingEnergy: 0.02,
                  minSpeakingWeight: 0.1,
                  mouthOpenMin: 0.12,
                  eyeOpenMin: 0.01,
                  blinkSpeedMin: 1,
                  errorLabel: 'speaking fallback posture evidence',
                },
                reportKey: 'speakingVisible',
              }
              : scenarioId === 'chat.vrm-listening-smoke'
                ? {
                  setStep: 'set-vrm-listening-override',
                  waitStep: 'wait-vrm-listening-pose',
                  override: { phase: 'listening', label: 'Listening…', emotion: 'focus', amplitude: 0.24 },
                  wait: {
                    expectedPhase: 'listening',
                    expectedPosture: 'listening-attentive',
                    expectedActiveViseme: null,
                    maxSpeakingEnergy: 0.001,
                    maxSpeakingWeight: 0.05,
                    minRelaxedWeight: 0.16,
                    mouthOpenMin: 0.1,
                    mouthOpenMax: 0.13,
                    eyeOpenMin: 0.08,
                    eyeOpenMax: 0.11,
                    blinkSpeedMin: 3,
                    blinkSpeedMax: 4,
                    errorLabel: 'listening posture evidence',
                  },
                  reportKey: 'listeningVisible',
                }
                : {
                  setStep: 'set-vrm-thinking-override',
                  waitStep: 'wait-vrm-thinking-pose',
                  override: { phase: 'thinking', label: 'Thinking…', emotion: 'calm', amplitude: 0.34 },
                  wait: {
                    expectedPhase: 'thinking',
                    expectedPosture: 'thinking-reflective',
                    expectedActiveViseme: null,
                    maxSpeakingEnergy: 0.001,
                    maxSpeakingWeight: 0.05,
                    minRelaxedWeight: 0.3,
                    mouthOpenMin: 0.09,
                    mouthOpenMax: 0.12,
                    eyeOpenMin: 0.03,
                    eyeOpenMax: 0.07,
                    blinkSpeedMin: 2,
                    blinkSpeedMax: 2.8,
                    errorLabel: 'thinking posture evidence',
                  },
                  reportKey: 'thinkingVisible',
                };

          record('wait-chat-panel');
          await deps.waitForTestId(E2E_IDS.panel('chat'));
          record('select-agent-target');
          await deps.clickByTestId(E2E_IDS.chatTarget('agent-e2e-alpha'));
          record('wait-vrm-viewport');
          await deps.waitForSelector('[data-avatar-vrm-status]');
          record('wait-vrm-ready-lifecycle');
          const initialVisibleStats = await waitForVisibleVrmPixels(deps, 20_000);
          const expectedFraming = resolveVrmFramingSignature(initialVisibleStats.runtimeDebug);
          if (!expectedFraming) {
            throw new Error('vrm framing evidence missing at initial ready checkpoint');
          }
          record(scenarioConfig.setStep);
          await deps.setChatAvatarInteractionOverride(scenarioConfig.override);
          record(scenarioConfig.waitStep);
          const phaseVisibleStats = await waitForVrmPostureEvidence(deps, scenarioConfig.wait, 12_000);
          assertStableVrmFramingSignature({
            label: scenarioConfig.reportKey,
            expected: expectedFraming,
            runtimeDebug: phaseVisibleStats.runtimeDebug,
          });
          record('write-pass-report');
          await deps.writeReport({
            ok: true,
            steps,
            route: deps.currentRoute(),
            htmlSnapshot: deps.currentHtml(),
            details: {
              vrm: {
                expectedFraming,
                expectedPhase: scenarioConfig.wait.expectedPhase,
                expectedPosture: scenarioConfig.wait.expectedPosture,
                expectedActiveViseme: scenarioConfig.wait.expectedActiveViseme,
                initialVisible: toVrmCanvasStatsReport(initialVisibleStats),
                [scenarioConfig.reportKey]: toVrmCanvasStatsReport(phaseVisibleStats),
              },
            },
          });
          return;
        }

        if (isChatVrmLifecycleSmokeScenario(scenarioId)) {
          record('wait-chat-panel');
          await deps.waitForTestId(E2E_IDS.panel('chat'));
          record('select-agent-target');
          await deps.clickByTestId(E2E_IDS.chatTarget('agent-e2e-alpha'));
          record('wait-vrm-viewport');
          await deps.waitForSelector('[data-avatar-vrm-status]');
          record('wait-vrm-ready-lifecycle');
          const initialVisibleStats = await waitForVisibleVrmPixels(deps, 20_000);
          const expectedFraming = resolveVrmFramingSignature(initialVisibleStats.runtimeDebug);
          const initialPerformance = readVrmPerformanceEvidence(initialVisibleStats.runtimeDebug);
          const expectedSceneResources = initialPerformance.sceneResources;
          const expectedRendererMemory = initialPerformance.rendererMemory;
          if (!expectedFraming || !expectedSceneResources || !expectedRendererMemory) {
            throw new Error('vrm lifecycle evidence missing at initial ready checkpoint');
          }

          record('trigger-vrm-context-loss-restore');
          await deps.triggerVrmContextLossAndRestore();
          record('wait-vrm-ready-lifecycle-after-context-restore');
          const afterContextRestoreStats = await waitForVisibleVrmPixels(deps, 20_000);
          record('pulse-vrm-viewport-tiny-host');
          await deps.pulseVrmViewportTinyHost();
          record('wait-vrm-ready-lifecycle-after-tiny-host');
          const afterTinyHostStats = await waitForVisibleVrmPixels(deps, 20_000);
          record('resize-vrm-viewport-small');
          await deps.resizeVrmViewport({ width: 292, height: 520 });
          record('wait-vrm-ready-lifecycle-after-small-resize');
          const afterSmallResizeStats = await waitForVisibleVrmPixels(deps, 20_000);
          record('resize-vrm-viewport-restored');
          await deps.resizeVrmViewport({ width: 360, height: 820 });
          record('wait-vrm-ready-lifecycle-after-restored-resize');
          const afterRestoredResizeStats = await waitForVisibleVrmPixels(deps, 20_000);

          for (const [label, stats] of [
            ['after-context-restore', afterContextRestoreStats],
            ['after-tiny-host', afterTinyHostStats],
            ['after-small-resize', afterSmallResizeStats],
            ['after-restored-resize', afterRestoredResizeStats],
          ] as const) {
            assertStableVrmFramingSignature({ label, expected: expectedFraming, runtimeDebug: stats.runtimeDebug });
            assertStableVrmResourceCounts({ label, expected: expectedSceneResources, runtimeDebug: stats.runtimeDebug });
            assertStableVrmRendererMemory({ label, expected: expectedRendererMemory, runtimeDebug: stats.runtimeDebug });
          }

          record('switch-away-to-non-vrm-target');
          await deps.clickByTestId(E2E_IDS.chatRow('chat-e2e-primary'));
          record('wait-vrm-viewport-teardown');
          await deps.waitForSelectorGone('[data-avatar-vrm-status]', 12_000);
          record('switch-back-to-vrm-target');
          await deps.clickByTestId(E2E_IDS.chatTarget('agent-e2e-alpha'));
          record('wait-vrm-viewport-rebound');
          await deps.waitForSelector('[data-avatar-vrm-status]');
          record('wait-vrm-ready-lifecycle-after-rebind');
          const afterRebindStats = await waitForVisibleVrmPixels(deps, 20_000);
          record('repeat-vrm-churn-away');
          await deps.clickByTestId(E2E_IDS.chatRow('chat-e2e-primary'));
          record('wait-vrm-viewport-second-teardown');
          await deps.waitForSelectorGone('[data-avatar-vrm-status]', 12_000);
          record('repeat-vrm-churn-back');
          await deps.clickByTestId(E2E_IDS.chatTarget('agent-e2e-alpha'));
          record('wait-vrm-ready-lifecycle-after-second-rebind');
          const afterSecondRebindStats = await waitForVisibleVrmPixels(deps, 20_000);

          for (const [label, stats] of [
            ['after-rebind', afterRebindStats],
            ['after-second-rebind', afterSecondRebindStats],
          ] as const) {
            assertStableVrmFramingSignature({ label, expected: expectedFraming, runtimeDebug: stats.runtimeDebug });
            assertStableVrmResourceCounts({ label, expected: expectedSceneResources, runtimeDebug: stats.runtimeDebug });
            assertStableVrmRendererMemory({ label, expected: expectedRendererMemory, runtimeDebug: stats.runtimeDebug });
          }

          const afterRebindPerformance = readVrmPerformanceEvidence(afterRebindStats.runtimeDebug);
          const afterSecondRebindPerformance = readVrmPerformanceEvidence(afterSecondRebindStats.runtimeDebug);
          if (initialPerformance.loadSuccessCount !== 1 || initialPerformance.disposeCount !== 0) {
            throw new Error('vrm initial performance evidence did not start at loadSuccessCount=1 and disposeCount=0');
          }
          if (afterRebindPerformance.loadSuccessCount !== 2 || afterRebindPerformance.disposeCount !== 1) {
            throw new Error('vrm rebind performance evidence did not advance to loadSuccessCount=2 and disposeCount=1');
          }
          if (afterSecondRebindPerformance.loadSuccessCount !== 3 || afterSecondRebindPerformance.disposeCount !== 2) {
            throw new Error('vrm second rebind performance evidence did not advance to loadSuccessCount=3 and disposeCount=2');
          }

          record('write-pass-report');
          await deps.writeReport({
            ok: true,
            steps,
            route: deps.currentRoute(),
            htmlSnapshot: deps.currentHtml(),
            details: {
              vrm: {
                expectedFraming,
                expectedSceneResources,
                expectedRendererMemory,
                initialVisible: toVrmCanvasStatsReport(initialVisibleStats),
                afterContextRestore: toVrmCanvasStatsReport(afterContextRestoreStats),
                afterTinyHost: toVrmCanvasStatsReport(afterTinyHostStats),
                afterSmallResize: toVrmCanvasStatsReport(afterSmallResizeStats),
                afterRestoredResize: toVrmCanvasStatsReport(afterRestoredResizeStats),
                afterRebind: toVrmCanvasStatsReport(afterRebindStats),
                afterSecondRebind: toVrmCanvasStatsReport(afterSecondRebindStats),
              },
            },
          });
          return;
        }

        if (!isChatLive2dRenderSmokeScenario(scenarioId)) {
          throw new Error(`unknown macOS smoke scenario: ${scenarioId}`);
        }

        record('wait-chat-panel');
        await deps.waitForTestId(E2E_IDS.panel('chat'));
        record('select-agent-target');
        await deps.clickByTestId(E2E_IDS.chatTarget('agent-e2e-alpha'));
        record('wait-live2d-viewport');
        await deps.waitForSelector('[data-avatar-live2d-status]');
        record('wait-live2d-visible-pixels');
        const initialVisibleStats = await waitForVisibleLive2dPixels(deps, 12_000);
        const speakingVisibleStats = scenarioId === 'chat.live2d-render-smoke-mark-speaking'
          ? await (async () => {
            record('set-live2d-speaking-override');
            await deps.setChatAvatarInteractionOverride({
              phase: 'speaking',
              label: 'Speaking…',
              emotion: 'focus',
              amplitude: 0.82,
              visemeId: 'aa',
            });
            record('wait-live2d-speaking-pose');
            return waitForSpeakingLive2dPose(deps, 12_000);
          })()
          : null;
        record('trigger-live2d-context-loss-restore');
        await deps.triggerLive2dContextLossAndRestore();
        record('wait-live2d-visible-pixels-after-context-restore');
        const afterContextRestoreStats = await waitForVisibleLive2dPixels(deps, 12_000);
        record('pulse-live2d-viewport-tiny-host');
        await deps.pulseLive2dViewportTinyHost();
        record('wait-live2d-visible-pixels-after-tiny-host');
        const afterTinyHostStats = await waitForVisibleLive2dPixels(deps, 12_000);
        record('pulse-live2d-device-pixel-ratio');
        await deps.pulseLive2dDevicePixelRatio(1.75);
        record('wait-live2d-visible-pixels-after-dpr-pulse');
        const afterDprPulseStats = await waitForVisibleLive2dPixels(deps, 12_000);
        record('resize-live2d-viewport-small');
        await deps.resizeLive2dViewport({ width: 292, height: 520 });
        record('wait-live2d-visible-pixels-after-small-resize');
        const afterSmallResizeStats = await waitForVisibleLive2dPixels(deps, 12_000);
        record('resize-live2d-viewport-restored');
        await deps.resizeLive2dViewport({ width: 360, height: 820 });
        record('wait-live2d-visible-pixels-after-restored-resize');
        const afterRestoredResizeStats = await waitForVisibleLive2dPixels(deps, 12_000);
        record('write-pass-report');
        await deps.writeReport({
          ok: true,
          steps,
          route: deps.currentRoute(),
          htmlSnapshot: deps.currentHtml(),
          details: {
            live2d: {
              initialVisible: toLive2dCanvasStatsReport(initialVisibleStats),
              ...(speakingVisibleStats ? { speakingVisible: toLive2dCanvasStatsReport(speakingVisibleStats) } : {}),
              afterContextRestore: toLive2dCanvasStatsReport(afterContextRestoreStats),
              afterTinyHost: toLive2dCanvasStatsReport(afterTinyHostStats),
              afterDprPulse: toLive2dCanvasStatsReport(afterDprPulseStats),
              afterSmallResize: toLive2dCanvasStatsReport(afterSmallResizeStats),
              afterRestoredResize: toLive2dCanvasStatsReport(afterRestoredResizeStats),
            },
          },
        });
        return;
      }
    }
  } catch (error) {
    const live2dStats = (error as Live2dVisiblePixelsTimeoutError | null | undefined)?.live2dStats;
    const vrmStats = (error as VrmVisiblePixelsTimeoutError | null | undefined)?.vrmStats;
    await deps.writeReport({
      ok: false,
      failedStep: steps[steps.length - 1] || 'bootstrap',
      steps,
      errorMessage: error instanceof Error ? error.message : String(error || 'unknown error'),
      errorName: error instanceof Error ? error.name : undefined,
      errorStack: error instanceof Error ? error.stack : undefined,
      errorCause: error instanceof Error ? String(error.cause || '') || undefined : undefined,
      route: deps.currentRoute(),
      htmlSnapshot: deps.currentHtml(),
      details: live2dStats
        ? { live2d: { failureSnapshot: toLive2dCanvasStatsReport(live2dStats) } }
        : vrmStats
          ? { vrm: { failureSnapshot: toVrmCanvasStatsReport(vrmStats) } }
          : undefined,
    });
    throw error;
  }
}
