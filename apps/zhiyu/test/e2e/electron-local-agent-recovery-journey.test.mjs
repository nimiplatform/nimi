import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  runtimeAgentLiveE2EChatScenarioPrompt,
  sendScenarioPrompt,
  waitForEvidence,
  withZhiyuScenarioApp,
} from '../scenario/run-context-helpers.mjs';
import { resetAcceptanceInputs } from '../electron-live-runtime-acceptance-helpers.mjs';
import {
  assertMidStreamFailureFlow,
  assertRuntimeNativeVoiceInterruptFlow,
} from '../electron-live-runtime-native-voice-helpers.mjs';

const artifactsRoot = requiredPath('NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_ARTIFACTS_ROOT');
const summaryPath = requiredPath('NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_SUMMARY_PATH');

test('turn-media-recovery uses one product environment for all recovery checkpoints', { timeout: 600_000 }, async () => {
  await mkdir(artifactsRoot, { recursive: true });
  const checkpoints = {};
  await withZhiyuScenarioApp({
    scenarioId: 'turn-media-recovery',
    seedAvatarPresentation: true,
    localChatCompletionStreamDelayMs: 4_000,
    voiceSpeechStreamDelayMs: 8_000,
    initScript: installConfigurableVoiceCaptureMock,
  }, async (context) => {
    await assertMidStreamFailureFlow(context.page, context.pageProblems, context.readyEvidence);
    const midstream = await context.page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
    assert.equal(midstream.chat.state, 'completed');
    assert.equal(midstream.companion.diagnostics.runtimeProjectionEvents.some((event) =>
      event?.eventName === 'runtime.agent.turn.action_failed'
      && event?.detail?.reasonCode === ReasonCode.AI_OUTPUT_INVALID
    ), true);
    checkpoints['midstream-failure-evidence'] = await captureCheckpoint(context, 'midstream-failure-evidence', { midstream });

    const interrupted = await assertRuntimeNativeVoiceInterruptFlow(
      context.page,
      context.pageProblems,
      context.fixture,
      context.readyEvidence,
      { prompt: `${runtimeAgentLiveE2EChatScenarioPrompt('e-native-interrupt')} recovery Journey interrupt.` },
    );
    assert.equal(interrupted.interruptedEvidence.companion.voicePlaybackState, 'interrupted');
    checkpoints['voice-interrupt'] = await captureCheckpoint(context, 'voice-interrupt', { interrupted });

    await resetAcceptanceInputs(context.page);
    const failedVoicePrompt = `${runtimeAgentLiveE2EChatScenarioPrompt('e-native-failed')} recovery Journey voice failure.`;
    await context.page.locator('[data-chat-composer-textarea="true"]').fill(failedVoicePrompt);
    await context.page.locator('[data-chat-composer-send="true"]').click();
    await waitForEvidence(context.page, () => {
      const evidence = globalThis.window.__nimiZhiyuEvidence;
      return evidence?.chat?.state === 'completed'
        && evidence?.companion?.voiceOutputMode === 'native_stream'
        && evidence?.companion?.voicePlaybackState === 'failed';
    }, 'turn-media-recovery typed voice failure');
    const failedVoice = await context.page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
    const failedVoiceEvents = [
      ...(failedVoice.chat?.diagnostics?.runtimeProjectionEvents || []),
      ...(failedVoice.companion?.diagnostics?.runtimeProjectionEvents || []),
      ...(failedVoice.chat?.messages || []).flatMap((message) => message?.metadata?.runtimeProjectionEvents || []),
    ];
    assert.equal(failedVoiceEvents.some((event) =>
      event?.eventName === 'runtime.agent.presentation.voice_playback_terminal'
      && event?.detail?.terminalReason === 'native_stream_failed'
      && !Boolean(event?.detail?.finalArtifactId || event?.detail?.final_artifact_id)
    ), true);
    checkpoints['voice-failure'] = await captureCheckpoint(context, 'voice-failure', { failedVoice });

    await context.page.evaluate(() => { globalThis.__nimiRecoveryCaptureMode = 'permission-denied'; });
    const captureTool = context.page.locator('[data-zhiyu-composer-tool="voice-capture"]').first();
    await captureTool.click();
    await waitForEvidence(context.page, () =>
      globalThis.window.__nimiZhiyuEvidence?.voiceCapture?.state === 'failed'
      && globalThis.window.__nimiZhiyuEvidence?.voiceCapture?.reasonCode === 'runtime-voice-capture-permission-denied'
      && globalThis.window.__nimiZhiyuEvidence?.voiceCapture?.transcriptLength === 0,
    'turn-media-recovery microphone denied');
    const microphoneDenied = await context.page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
    checkpoints['microphone-denied'] = await captureCheckpoint(context, 'microphone-denied', { microphoneDenied });

    context.fixture.setTranscriptionFailure(true);
    await context.page.reload({ waitUntil: 'domcontentloaded' });
    await context.page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
    await context.page.waitForSelector('[data-zhiyu-screen="home"]');
    await waitForEvidence(context.page, () =>
      globalThis.window.__nimiZhiyuEvidence?.voiceCapture?.ready === true
      && globalThis.window.__nimiZhiyuEvidence?.voiceCapture?.state === 'idle',
    'turn-media-recovery capture readiness after renderer reload');
    await context.page.evaluate(() => { globalThis.__nimiRecoveryCaptureMode = 'record'; });
    await captureTool.click();
    await waitForEvidence(context.page, () => globalThis.window.__nimiZhiyuEvidence?.voiceCapture?.state === 'recording', 'turn-media-recovery recording before transcription failure');
    await captureTool.click();
    await waitForEvidence(context.page, () => {
      const capture = globalThis.window.__nimiZhiyuEvidence?.voiceCapture;
      return capture?.state === 'failed'
        && capture?.reasonCode !== 'runtime-voice-capture-permission-denied'
        && capture?.transcriptLength === 0
        && capture?.transcriptText === '';
    }, 'turn-media-recovery transcription failure');
    context.fixture.setTranscriptionFailure(false);
    const transcriptionFailure = await context.page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
    assert.equal(context.fixture.realmRequests.some((request) => request.path === '/v1/audio/transcriptions'), true);
    checkpoints['transcription-failure'] = await captureCheckpoint(context, 'transcription-failure', { transcriptionFailure });

    await resetAcceptanceInputs(context.page);
    const cancelPrompt = `${runtimeAgentLiveE2EChatScenarioPrompt('b-stream-delta')} recovery Journey cancel.`;
    await context.page.locator('[data-chat-composer-textarea="true"]').fill(cancelPrompt);
    await context.page.locator('[data-chat-composer-send="true"]').click();
    const stopButton = context.page.locator('[data-zhiyu-chat-stop-action="true"]');
    await stopButton.waitFor({ state: 'visible', timeout: 30_000 });
    await stopButton.click();
    await waitForEvidence(context.page, () =>
      globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'canceled'
      && globalThis.window.__nimiZhiyuEvidence?.chat?.reasonCode === 'runtime-agent-chat-user-canceled',
    'turn-media-recovery stop cancels turn');
    const canceled = await context.page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
    assert.equal(canceled.chat.messages.some((message) => message?.status === 'streaming'), false);
    checkpoints['stop-cancels-all'] = await captureCheckpoint(context, 'stop-cancels-all', { canceled });

    const retryPrompt = `${runtimeAgentLiveE2EChatScenarioPrompt('b-single-turn')} recovery Journey retry.`;
    let retried;
    try {
      retried = await sendScenarioPrompt(context, retryPrompt, 'turn-media-recovery retry new turn');
    } catch (error) {
      await captureCheckpoint(context, 'retry-new-turn-failure', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    assert.equal(retried.chat.state, 'completed');
    assert.equal(retried.chat.messages.some((message) => message?.text === retryPrompt), true);
    checkpoints['retry-new-turn'] = await captureCheckpoint(context, 'retry-new-turn', { retried });
  });

  await writeFile(summaryPath, `${JSON.stringify({
    schemaVersion: 'nimi.local-agent-product-zhiyu-recovery-summary/v2',
    journeyId: 'turn-media-recovery',
    processStarts: { provider: 1, realm: 1, runtime: 1, desktop: 0, zhiyu: 1 },
    checkpoints,
    pageProblems: [],
    outcome: 'passed',
  }, null, 2)}\n`);
});

async function captureCheckpoint(context, checkpointId, details) {
  const screenshot = path.join(artifactsRoot, `${checkpointId}.png`);
  const evidencePath = path.join(artifactsRoot, `${checkpointId}.json`);
  await context.page.screenshot({ path: screenshot, fullPage: true });
  const dom = await context.page.evaluate(() => ({
    url: globalThis.location.href,
    title: globalThis.document.title,
    bodyText: globalThis.document.body?.innerText?.slice(0, 4_000) || '',
    evidence: globalThis.window.__nimiZhiyuEvidence,
  }));
  await writeFile(evidencePath, `${JSON.stringify({
    schemaVersion: 'nimi.local-agent-product-checkpoint-evidence/v2',
    checkpointId,
    screenshot: path.basename(screenshot),
    pageProblems: [...context.pageProblems],
    dom,
    details,
  }, null, 2)}\n`);
  assert.equal(context.pageProblems.length, 0, `${checkpointId} page problems: ${JSON.stringify(context.pageProblems)}`);
  return { passed: true, evidencePath: path.basename(evidencePath), screenshot: path.basename(screenshot) };
}

function installConfigurableVoiceCaptureMock() {
  globalThis.__nimiRecoveryCaptureMode = 'record';
  const stream = { getTracks: () => [{ stop() {} }] };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      async getUserMedia() {
        if (globalThis.__nimiRecoveryCaptureMode === 'permission-denied') {
          throw Object.assign(new Error('Microphone permission denied by recovery Journey.'), {
            reasonCode: 'runtime-voice-capture-permission-denied',
            actionHint: 'grant_microphone_permission',
            source: 'renderer',
          });
        }
        return stream;
      },
    },
  });
  class RecoveryMediaRecorder extends EventTarget {
    static isTypeSupported() { return true; }
    constructor(_stream, options = {}) {
      super();
      this.mimeType = options.mimeType || 'audio/webm';
      this.state = 'inactive';
    }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      const blob = new Blob([new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4])], { type: this.mimeType });
      const event = new Event('dataavailable');
      Object.defineProperty(event, 'data', { value: blob });
      this.dispatchEvent(event);
      this.dispatchEvent(new Event('stop'));
    }
  }
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: RecoveryMediaRecorder });
}

function requiredPath(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return path.resolve(value);
}
