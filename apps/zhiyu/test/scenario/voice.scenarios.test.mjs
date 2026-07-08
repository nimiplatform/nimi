import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureScenarioEvidence,
  runtimeAgentLiveE2EChatScenarioPrompt,
  sendScenarioPrompt,
  waitForEvidence,
  withZhiyuScenarioApp,
} from './run-context-helpers.mjs';
import { runRepeatedScenario, scenarioTestTimeoutMs } from './repeat-runner-helpers.mjs';
import {
  assertRuntimeNativeVoiceInterruptFlow,
  renderLiveRuntimeCommittedVoice,
  runtimeProjectionEventTurnId,
} from '../electron-live-runtime-native-voice-helpers.mjs';

test('E-01 native_stream emits ordered chunks and completed terminal truth', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'E',
    id: 'E-01',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({
      scenarioId,
      seedAvatarPresentation: true,
      voiceSpeechStreamDelayMs: 250,
    }, async (context) => {
      const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt('e-native-stream')} E-01 native stream.`;
      await submitPrompt(context.page, prompt);
      await waitForEvidence(context.page, () => {
        const evidence = globalThis.window.__nimiZhiyuEvidence;
        const events = evidence?.chat?.diagnostics?.runtimeProjectionEvents ?? [];
        return evidence?.chat?.state === 'completed'
          && evidence?.companion?.voiceOutputMode === 'native_stream'
          && evidence?.companion?.voicePlaybackState === 'completed'
          && events.some((event) => event?.eventName === 'runtime.agent.presentation.voice_stream_chunk_available'
            && event?.detail?.voiceOutputMode === 'native_stream'
            && event?.detail?.voicePlaybackState === 'active'
            && event?.detail?.finalChunk === false)
          && events.some((event) => event?.eventName === 'runtime.agent.presentation.voice_playback_requested'
            && event?.detail?.voiceOutputMode === 'native_stream'
            && event?.detail?.finalArtifact === true
            && typeof event?.detail?.audioArtifactId === 'string'
            && event?.detail?.audioMimeType === 'audio/wav')
          && events.some((event) => event?.eventName === 'runtime.agent.presentation.voice_playback_terminal'
            && event?.detail?.voiceOutputMode === 'native_stream'
            && event?.detail?.voicePlaybackState === 'completed'
            && event?.detail?.terminalReason === 'native_stream_completed');
      }, 'E-01 completed native stream voice truth');
      const evidence = await context.page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      const events = evidence.chat.diagnostics.runtimeProjectionEvents;
      const chunks = events.filter((event) => event.eventName === 'runtime.agent.presentation.voice_stream_chunk_available');
      assert.ok(chunks.length >= 1);
      assert.deepEqual(chunks.map((event) => Number(event.detail.chunkSequence)).filter(Boolean), chunks.map((_, index) => index + 1));
      const playback = events.find((event) => event.eventName === 'runtime.agent.presentation.voice_playback_requested');
      assert.ok(playback?.detail?.audioArtifactId);
      assert.equal(playback.detail.audioMimeType, 'audio/wav');
      const voiceTool = context.page.locator('[data-zhiyu-composer-tool="hands-free"]').first();
      assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-output-mode'), 'native_stream');
      assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-playback-state'), 'completed');
      assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-violation'), 'false');
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { evidence, chunks, playback } });
    }),
  });
});

test('E-02 batch_final_artifact voice render projects replayable artifact truth', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'E',
    id: 'E-02',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({
      scenarioId,
      seedAvatarPresentation: true,
    }, async (context) => {
      const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt('e-batch-final')} E-02 batch final.`;
      const completed = await sendScenarioPrompt(context, prompt, 'E-02 completed text before manual voice render');
      const messageId = completed.turn.messageId || 'message-e-batch-final';
      const turnId = runtimeTurnIdForCompletedTurn(completed, messageId);
      assert.ok(turnId, `E-02 could not resolve Runtime turn id from evidence: ${JSON.stringify(completed.turn)}`);
      const renderResult = await renderLiveRuntimeCommittedVoice({
        page: context.page,
        fixture: context.fixture,
        readyEvidence: context.readyEvidence,
        conversationAnchorId: context.readyEvidence.conversation.conversationAnchorId,
        turnId,
        messageId,
        text: completed.chat.latestAssistantText || 'E-02 batch final voice artifact should be renderable.',
        playbackTarget: 'desktop_manual',
        timeoutMs: 45_000,
      });
      assert.equal(renderResult.status, 'ready');
      await waitForEvidence(context.page, ({ audioArtifactId }) =>
        globalThis.window.__nimiZhiyuEvidence?.companion?.voiceOutputMode === 'batch_final_artifact'
        && globalThis.window.__nimiZhiyuEvidence?.companion?.voiceAudioArtifactId === audioArtifactId
        && globalThis.window.__nimiZhiyuEvidence?.companion?.projectedFields?.includes('audioArtifactId'),
        'E-02 Zhiyu observed batch final artifact voice projection',
        { audioArtifactId: renderResult.audioArtifactId },
      );
      const evidence = await context.page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      const voiceTool = context.page.locator('[data-zhiyu-composer-tool="hands-free"]').first();
      assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-output-mode'), 'batch_final_artifact');
      assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-audio-artifact-id'), renderResult.audioArtifactId);
      assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-audio-mime-type'), renderResult.audioMimeType);
      assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-playback-action'), 'replay_artifact');
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { completed, renderResult, evidence } });
    }),
  });
});

test('E-03 text_only path leaves voice playback idle without warning or error', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'E',
    id: 'E-03',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({ scenarioId }, async (context) => {
      const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt('e-text-only')} E-03 text only.`;
      const evidence = await sendScenarioPrompt(context, prompt, 'E-03 text-only Runtime turn');
      assert.equal(evidence.chat.state, 'completed');
      assert.equal(evidence.companion.voiceOutputMode, null);
      assert.equal(evidence.companion.voicePlaybackState, null);
      const voiceTool = context.page.locator('[data-zhiyu-composer-tool="hands-free"]').first();
      assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-state'), 'idle');
      assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-reason'), 'runtime-voice-no-current-output');
      assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-violation'), 'false');
      assert.equal((evidence.chat.diagnostics?.runtimeProjectionEvents ?? []).some((event) =>
        String(event?.eventName || '').includes('voice_')
      ), false);
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { evidence } });
    }),
  });
});

test('E-04 user interrupt moves native_stream playback to interrupted', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'E',
    id: 'E-04',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({
      scenarioId,
      seedAvatarPresentation: true,
      voiceSpeechStreamDelayMs: 8_000,
    }, async (context) => {
      const result = await assertRuntimeNativeVoiceInterruptFlow(
        context.page,
        context.pageProblems,
        context.fixture,
        context.readyEvidence,
        { prompt: `${runtimeAgentLiveE2EChatScenarioPrompt('e-native-interrupt')} E-04 interrupt.` },
      );
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { result } });
    }),
  });
});

test('E-05 provider playback failure emits failed terminal without pseudo replay', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'E',
    id: 'E-05',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({
      scenarioId,
      seedAvatarPresentation: true,
      voiceSpeechStreamDelayMs: 250,
    }, async (context) => {
      const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt('e-native-failed')} E-05 failed native stream.`;
      await submitPrompt(context.page, prompt);
      await waitForEvidence(context.page, () => {
        const evidence = globalThis.window.__nimiZhiyuEvidence;
        const events = evidence?.chat?.diagnostics?.runtimeProjectionEvents ?? [];
        return evidence?.chat?.state === 'completed'
          && evidence?.companion?.voiceOutputMode === 'native_stream'
          && evidence?.companion?.voicePlaybackState === 'failed'
          && events.some((event) => event?.eventName === 'runtime.agent.presentation.voice_playback_terminal'
            && event?.detail?.voicePlaybackState === 'failed'
            && event?.detail?.terminalReason === 'native_stream_failed'
            && !Boolean(event?.detail?.finalArtifactId || event?.detail?.final_artifact_id));
      }, 'E-05 failed native stream terminal truth');
      const evidence = await context.page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      const failedStreamId = evidence.companion.voiceStreamId;
      assert.ok(failedStreamId);
      assert.equal(evidence.chat.diagnostics.runtimeProjectionEvents.some((event) =>
        event?.eventName === 'runtime.agent.presentation.voice_playback_requested'
        && (event?.detail?.voiceStreamId || event?.detail?.voice_stream_id) === failedStreamId
        && event?.detail?.finalArtifact === true
      ), false);
      const voiceTool = context.page.locator('[data-zhiyu-composer-tool="hands-free"]').first();
      assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-playback-state'), 'failed');
      assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-reason'), 'runtime-voice-native-stream-failed');
      assert.equal(await voiceTool.getAttribute('data-zhiyu-chat-voice-violation'), 'false');
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { evidence } });
    }),
  });
});

test('E-06 voice capture transcribes through fixture and sends transcript as a turn', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'E',
    id: 'E-06',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({
      scenarioId,
      initScript: installVoiceCaptureSuccessMock,
    }, async (context) => {
      const captureTool = context.page.locator('[data-zhiyu-composer-tool="voice-capture"]').first();
      await captureTool.waitFor({ state: 'visible', timeout: 15_000 });
      assert.equal(await captureTool.getAttribute('data-zhiyu-chat-voice-capture-ready'), 'true');
      await captureTool.click();
      await waitForEvidence(context.page, () =>
        globalThis.window.__nimiZhiyuEvidence?.voiceCapture?.state === 'recording',
        'E-06 voice capture recording',
      );
      await captureTool.click();
      await waitForEvidence(context.page, () =>
        globalThis.window.__nimiZhiyuEvidence?.voiceCapture?.state === 'idle'
        && globalThis.window.__nimiZhiyuEvidence?.voiceCapture?.reasonCode === 'runtime-voice-capture-transcribed'
        && globalThis.window.__nimiZhiyuEvidence?.voiceCapture?.transcriptText === 'Runtime live fixture transcript.'
        && document.querySelector('[data-chat-composer-textarea="true"]')?.value === 'Runtime live fixture transcript.',
        'E-06 Runtime STT transcript moved into composer',
      );
      assert.equal(context.fixture.realmRequests.some((request) => request.path === '/v1/audio/transcriptions'), true);
      await context.page.locator('[data-chat-composer-send="true"]').click();
      await waitForEvidence(context.page, () =>
        globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'completed'
        && globalThis.window.__nimiZhiyuEvidence?.chat?.messages?.some((message) => message?.text === 'Runtime live fixture transcript.'),
        'E-06 transcribed text sent as Runtime turn',
      );
      const evidence = await context.page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { evidence } });
    }),
  });
});

test('E-07 voice capture permission failure is typed and does not fabricate transcription', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'E',
    id: 'E-07',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({
      scenarioId,
      initScript: installVoiceCaptureFailureMock,
    }, async (context) => {
      const captureTool = context.page.locator('[data-zhiyu-composer-tool="voice-capture"]').first();
      await captureTool.waitFor({ state: 'visible', timeout: 15_000 });
      await captureTool.click();
      await waitForEvidence(context.page, () =>
        globalThis.window.__nimiZhiyuEvidence?.voiceCapture?.state === 'failed'
        && globalThis.window.__nimiZhiyuEvidence?.voiceCapture?.reasonCode === 'runtime-voice-capture-permission-denied'
        && globalThis.window.__nimiZhiyuEvidence?.voiceCapture?.transcriptLength === 0
        && document.querySelector('[data-chat-composer-textarea="true"]')?.value === '',
        'E-07 typed voice capture failure',
      );
      assert.equal(context.fixture.realmRequests.some((request) => request.path === '/v1/audio/transcriptions'), false);
      const evidence = await context.page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      assert.equal(await captureTool.getAttribute('data-zhiyu-chat-voice-capture-state'), 'failed');
      assert.equal(await captureTool.getAttribute('data-zhiyu-chat-voice-capture-reason'), 'runtime-voice-capture-permission-denied');
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { evidence } });
    }),
  });
});

async function submitPrompt(page, prompt) {
  await page.locator('[data-chat-composer-textarea="true"]').fill(prompt);
  await page.waitForFunction(() =>
    document.querySelector('[data-zhiyu-submit-enabled]')?.getAttribute('data-zhiyu-submit-enabled') === 'true'
    && document.querySelector('[data-chat-composer-send="true"]')?.disabled === false
    && document.querySelector('[data-chat-composer-textarea="true"]')?.value.length > 0,
  );
  await page.locator('[data-chat-composer-send="true"]').click();
}

function runtimeTurnIdForMessage(evidence, messageId) {
  const events = runtimeProjectionEvents(evidence);
  const requestId = String(evidence.chat?.requestId || evidence.turn?.requestId || '').trim();
  const matched = events.find((event) =>
    event?.eventName === 'runtime.agent.turn.message_committed'
    && (event?.detail?.messageId || event?.detail?.message_id || event?.messageId || event?.message_id) === messageId
  ) || events.find((event) =>
    (event?.detail?.messageId || event?.detail?.message_id || event?.messageId || event?.message_id) === messageId
  ) || events.find((event) =>
    requestId
    && (event?.detail?.requestId || event?.detail?.request_id || event?.requestId || event?.request_id) === requestId
  ) || events.find((event) => event?.eventName === 'runtime.agent.turn.message_committed')
    || events.find((event) => runtimeProjectionEventTurnId(event));
  return runtimeProjectionEventTurnId(matched);
}

function runtimeTurnIdForCompletedTurn(evidence, messageId) {
  return String(
    evidence.turn?.runtimeTurnId
      || evidence.chat?.runtimeTurnId
      || runtimeTurnIdForMessage(evidence, messageId)
      || '',
  ).trim();
}

function runtimeProjectionEvents(evidence) {
  return [
    ...(evidence.chat?.diagnostics?.runtimeProjectionEvents ?? []),
    ...(evidence.chat?.messages ?? []).flatMap((message) => message?.metadata?.runtimeProjectionEvents ?? []),
    ...(evidence.companion?.diagnostics?.runtimeProjectionEvents ?? []),
  ];
}

function installVoiceCaptureSuccessMock() {
  const stream = {
    getTracks() {
      return [{ stop() {} }];
    },
  };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      async getUserMedia() {
        return stream;
      },
    },
  });
  class MockMediaRecorder extends EventTarget {
    static isTypeSupported() {
      return true;
    }
    constructor(_stream, options = {}) {
      super();
      this.mimeType = options.mimeType || 'audio/webm';
      this.state = 'inactive';
    }
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      const blob = new Blob([new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4])], { type: this.mimeType || 'audio/webm' });
      const dataEvent = new Event('dataavailable');
      Object.defineProperty(dataEvent, 'data', { value: blob });
      this.dispatchEvent(dataEvent);
      this.dispatchEvent(new Event('stop'));
    }
  }
  Object.defineProperty(globalThis, 'MediaRecorder', {
    configurable: true,
    value: MockMediaRecorder,
  });
}

function installVoiceCaptureFailureMock() {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      async getUserMedia() {
        throw Object.assign(new Error('Microphone permission denied by scenario fixture.'), {
          reasonCode: 'runtime-voice-capture-permission-denied',
          actionHint: 'grant_microphone_permission',
          source: 'renderer',
        });
      },
    },
  });
  class MockMediaRecorder extends EventTarget {
    static isTypeSupported() {
      return true;
    }
  }
  Object.defineProperty(globalThis, 'MediaRecorder', {
    configurable: true,
    value: MockMediaRecorder,
  });
}
