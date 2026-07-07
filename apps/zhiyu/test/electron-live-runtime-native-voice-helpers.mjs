import assert from 'node:assert/strict';
import { createNimiRuntimeAppSessionMetadataProvider } from '../../../sdks/typescript/runtime/app-session.ts';
import { createNimiRuntimeAgentClient } from '../../../sdks/typescript/runtime/runtime-agent-client.ts';
import { withNimiRuntimeAgentScopes } from '../../../sdks/typescript/runtime/runtime-agent-protected.ts';
import { createNimiRuntimeAgentVoiceModule } from '../../../sdks/typescript/runtime/runtime-agent-voice.ts';
import { createRuntimeForEndpoint } from '../../../sdks/typescript/runtime/runtime-agent-live-e2e-fixture-runtime.test-helper.ts';
import {
  captureLiveRuntimeEvidence,
  escapeRegExp,
  waitForEvidence,
} from './electron-live-runtime-acceptance-helpers.mjs';

const desktopAppId = 'nimi.desktop';
const zhiyuAppId = 'nimi.zhiyu';
const zhiyuRuntimeVoiceObserverAppId = desktopAppId;
const zhiyuRuntimeVoiceObserverAppInstanceId = `${zhiyuRuntimeVoiceObserverAppId}.live-runtime-voice-observer`;
const zhiyuRuntimeProtectedScopes = [
  'runtime.agent.read',
  'runtime.agent.write',
  'runtime.agent.turn.read',
  'runtime.agent.turn.write',
  'runtime.agent.delegation.read',
  'runtime.agent.delegation.write',
  'runtime.agent.execution_config.read',
  'runtime.agent.execution_config.write',
  'ai.spend.meter',
];
export async function assertMidStreamFailureFlow(page, pageProblems, readyEvidence) {
  const failurePrompt = 'Please trigger Zhiyu mid-stream failure after committed text.';
  const expectedPartialText = 'Committed before induced action failure.';
  await page.locator('[data-chat-composer-textarea="true"]').fill(failurePrompt);
  await page.waitForFunction(() =>
    document.querySelector('[data-zhiyu-submit-enabled]')?.getAttribute('data-zhiyu-submit-enabled') === 'true'
    && document.querySelector('[data-chat-composer-send="true"]')?.disabled === false
    && document.querySelector('[data-chat-composer-textarea="true"]')?.value.length > 0,
  );
  await page.locator('[data-chat-composer-send="true"]').click();
  await waitForEvidence(page, ({ expectedPartialText, failurePrompt }) =>
    globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'failed'
    && globalThis.window.__nimiZhiyuEvidence?.chat?.ready === false
    && globalThis.window.__nimiZhiyuEvidence?.chat?.reasonCode !== 'runtime-agent-turn-completed'
    && globalThis.window.__nimiZhiyuEvidence?.chat?.reasonCode !== 'runtime-turn-request-accepted'
    && globalThis.window.__nimiZhiyuEvidence?.chat?.eventTypes?.includes('text-delta')
    && globalThis.window.__nimiZhiyuEvidence?.chat?.eventTypes?.includes('turn-failed')
    && globalThis.window.__nimiZhiyuEvidence?.chat?.messages?.some((message) => message?.text === failurePrompt)
    && globalThis.window.__nimiZhiyuEvidence?.chat?.messages?.some((message) =>
      message?.text === expectedPartialText
      && message?.status === 'error'
      && typeof message?.error === 'string'
      && message.error.length > 0
    ),
    'mid-stream failed Runtime Agent chat evidence',
    {
      expectedPartialText,
      failurePrompt,
    },
  );
  const failedEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
  assert.equal(failedEvidence.chat.ready, false);
  assert.equal(failedEvidence.chat.state, 'failed');
  assert.notEqual(failedEvidence.chat.reasonCode, 'runtime-agent-turn-completed');
  assert.notEqual(failedEvidence.chat.reasonCode, 'runtime-turn-request-accepted');
  assert.equal(failedEvidence.chat.eventTypes.includes('text-delta'), true);
  assert.equal(failedEvidence.chat.eventTypes.includes('turn-failed'), true);
  assert.equal(
    failedEvidence.chat.messages.some((message) =>
      message?.text === expectedPartialText
      && message?.status === 'error'
      && typeof message?.error === 'string'
      && message.error.length > 0
    ),
    true,
  );
  assert.equal(await page.locator('[data-zhiyu-agent-chat-state]').getAttribute('data-zhiyu-agent-chat-state'), 'failed');
  assert.equal(await page.locator('[data-zhiyu-agent-chat-ready]').getAttribute('data-zhiyu-agent-chat-ready'), 'false');
  const failureNotice = page.locator('[data-zhiyu-agent-chat-failure="true"]').last();
  await failureNotice.waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await failureNotice.getAttribute('data-zhiyu-agent-chat-failure-reason'), failedEvidence.chat.reasonCode);
  assert.equal(await failureNotice.getAttribute('data-zhiyu-agent-chat-failure-action'), failedEvidence.chat.actionHint);
  assert.match(await failureNotice.innerText(), new RegExp(escapeRegExp(failedEvidence.chat.reasonCode)));
  assert.match(await failureNotice.innerText(), /failed|failure|失败|处理/i);
  const failedConversationText = await page.locator('[data-zhiyu-region="conversation"]').innerText();
  assert.match(failedConversationText, new RegExp(escapeRegExp(expectedPartialText)));
  assert.doesNotMatch(failedConversationText, /runtime-agent-turn-completed|runtime-turn-request-accepted/);
  await page.locator('[data-chat-composer-textarea="true"]').fill('follow up after failure');
  await page.waitForFunction(() =>
    document.querySelector('[data-zhiyu-submit-enabled]')?.getAttribute('data-zhiyu-submit-enabled') === 'true'
    && document.querySelector('[data-chat-composer-send="true"]')?.disabled === false,
  );
  await captureLiveRuntimeEvidence(page, 'chatFailed', pageProblems, {
    readyEvidence,
    failedEvidence,
  });
  await page.locator('[data-chat-composer-textarea="true"]').fill('');
}

async function runCapabilityStudio(page, pageProblems, input) {
  const prompt = page.locator('textarea[aria-label="文字能力输入"]');
  await prompt.fill(input.prompt);
  const action = page.locator(`[data-zhiyu-capability-studio-run="${input.capabilityId}"]`);
  assert.equal(await action.isDisabled(), false);
  await action.click();
  await waitForEvidence(page, input.predicate, input.label);
  const evidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
  await captureLiveRuntimeEvidence(page, input.stage, pageProblems, {
    capabilityStudioEvidence: evidence,
  });
  return evidence;
}

export async function readZhiyuRuntimeAgentAuthBinding(page, readyEvidence) {
  const binding = await page.evaluate(() => {
    const host = globalThis.window?.__nimiZhiyuRuntimeAgentBinding
      || globalThis.__nimiZhiyuRuntimeAgentBinding
      || null;
    const scopedBinding = typeof host?.getScopedBinding === 'function'
      ? host.getScopedBinding()
      : host?.scopedBinding;
    const hostEquivalence = host?.hostEquivalence || null;
    return JSON.parse(JSON.stringify({ scopedBinding: scopedBinding || null, hostEquivalence }));
  });
  const scopedBinding = binding?.scopedBinding;
  const scopes = Array.isArray(scopedBinding?.scopes) ? scopedBinding.scopes : [];
  if (
    scopedBinding?.bindingId
    && scopes.includes('runtime.agent.turn.read')
    && scopes.includes('runtime.agent.turn.write')
  ) {
    return { kind: 'scopedBinding', bindingId: scopedBinding.bindingId };
  }
  const issued = await page.evaluate(async ({ readyEvidence }) => {
    const invoke = globalThis.window?.__NIMI_ELECTRON_RUNTIME__?.invoke
      || globalThis.window?.__NIMI_ELECTRON_TEST__?.invoke
      || globalThis.__NIMI_ELECTRON_RUNTIME__?.invoke
      || globalThis.__NIMI_ELECTRON_TEST__?.invoke
      || null;
    if (typeof invoke !== 'function') {
      return { error: 'electron_runtime_invoke_unavailable' };
    }
    return invoke('zhiyu.runtimeAgent.issueScopedBinding', {
      ownerUserId: readyEvidence?.conversation?.ownerUserId,
      runtimeSourceRef: readyEvidence?.conversation?.runtimeSourceRef,
      localAgentRef: readyEvidence?.conversation?.localAgentRef,
      conversationAnchorId: readyEvidence?.conversation?.conversationAnchorId,
      scopes: ['runtime.agent.turn.read', 'runtime.agent.turn.write'],
      issueRequestId: `zhiyu-live-runtime-voice-interrupt:${Date.now()}`,
      forceRenewal: true,
    });
  }, { readyEvidence });
  const issuedScopedBinding = issued?.scopedBinding;
  const issuedScopes = Array.isArray(issuedScopedBinding?.scopes) ? issuedScopedBinding.scopes : [];
  if (
    issuedScopedBinding?.bindingId
    && issuedScopes.includes('runtime.agent.turn.read')
    && issuedScopes.includes('runtime.agent.turn.write')
  ) {
    return { kind: 'scopedBinding', bindingId: issuedScopedBinding.bindingId };
  }
  const evidenceRef = String(binding?.hostEquivalence?.evidenceRef || '').trim();
  if (evidenceRef) {
    return { kind: 'hostEquivalence', evidenceRef };
  }
  assert.fail('Zhiyu live voice interrupt requires renderer Runtime scoped binding or admitted host equivalence');
}

export async function observeLiveRuntimeNativeVoiceInterrupt(input) {
  const agentClient = createZhiyuLiveRuntimeAgentClient(input.fixture);
  const stream = await agentClient.subscribeEvents({
    ownerUserId: input.fixture.ownerUserId,
    runtimeSourceRef: input.fixture.runtimeSourceRef,
    localAgentRef: input.fixture.localAgentRef,
    conversationAnchorId: input.conversationAnchorId,
    includeAgentEvents: true,
  });
  const iterator = stream[Symbol.asyncIterator]();
  input.onReady?.();
  const deadlineMs = Date.now() + 75_000;
  const existingVoiceStreamIds = new Set(input.existingVoiceStreamIds || []);
  let targetTurnId = '';
  let targetStreamId = '';
  let observedEvents = 0;
  let observedNativeChunks = 0;
  let skippedExistingNativeChunks = 0;
  try {
    for (;;) {
      const next = await nextAsyncIteratorValue(iterator, deadlineMs, 'Runtime native voice interrupt observer');
      if (next.done) {
        break;
      }
      const event = next.value;
      if (!event || typeof event !== 'object') {
        continue;
      }
      observedEvents += 1;
      if (event.eventName === 'runtime.agent.turn.accepted' && !targetTurnId && runtimeEventObservedAtOrAfter(event, input.notBeforeIso)) {
        targetTurnId = String(event.turnId || '').trim();
        targetStreamId = String(event.streamId || '').trim();
        continue;
      }
      if (targetTurnId && event.turnId !== targetTurnId) {
        continue;
      }
      if (!isRuntimeNativeNonFinalVoiceChunkEvent(event)) {
        continue;
      }
      observedNativeChunks += 1;
      const voiceStreamId = String(event.detail?.voiceStreamId || event.detail?.voice_stream_id || '').trim();
      if (!voiceStreamId || existingVoiceStreamIds.has(voiceStreamId)) {
        skippedExistingNativeChunks += 1;
        continue;
      }
      targetTurnId = targetTurnId || String(event.turnId || '').trim();
      targetStreamId = targetStreamId || String(event.streamId || '').trim();
      if (!targetTurnId) {
        continue;
      }
      const typed = await captureAndInterruptLiveRuntimeVoiceStream({
        fixture: input.fixture,
        conversationAnchorId: input.conversationAnchorId,
        turnId: targetTurnId,
        voiceStreamId,
        runtimeAuthBinding: input.runtimeAuthBinding,
      });
      return {
        nativeChunkEvent: event,
        interruptRuntimeTurnId: targetTurnId,
        interruptRuntimeStreamId: targetStreamId,
        voiceStreamId,
        ...typed,
      };
    }
  } finally {
    await iterator.return?.();
  }
  throw new Error(
    `Runtime native voice interrupt observer ended before seeing a new native stream chunk for prompt ${JSON.stringify(input.prompt)}; `
    + `events=${observedEvents} nativeChunks=${observedNativeChunks} skippedExistingNativeChunks=${skippedExistingNativeChunks} `
    + `targetTurnId=${targetTurnId || '<none>'}`,
  );
}

export function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function runtimeEventObservedAtOrAfter(event, notBeforeIso) {
  if (!notBeforeIso) {
    return true;
  }
  const observed = String(
    event?.timeline?.observedAtWall
      || event?.timeline?.observed_at_wall
      || event?.observedAt
      || event?.observed_at
      || '',
  ).trim();
  if (!observed) {
    return false;
  }
  const observedMs = Date.parse(observed);
  const notBeforeMs = Date.parse(notBeforeIso);
  return Number.isFinite(observedMs) && Number.isFinite(notBeforeMs) && observedMs >= notBeforeMs;
}

async function captureAndInterruptLiveRuntimeVoiceStream(input) {
  const voice = createZhiyuLiveRuntimeAgentVoiceModule(input.fixture, input.runtimeAuthBinding);
  const stream = await voice.subscribeStream({
    ownerUserId: input.fixture.ownerUserId,
    runtimeSourceRef: input.fixture.runtimeSourceRef,
    localAgentRef: input.fixture.localAgentRef,
    conversationAnchorId: input.conversationAnchorId,
    turnId: input.turnId,
    voiceStreamId: input.voiceStreamId,
  });
  const iterator = stream[Symbol.asyncIterator]();
  const deadlineMs = Date.now() + 45_000;
  try {
    const first = await nextAsyncIteratorValue(iterator, deadlineMs, 'typed Runtime voice stream first chunk');
    assert.equal(first.done, false, 'typed Runtime voice stream ended before first chunk');
    const typedFirstChunk = first.value;
    assert.equal(typedFirstChunk?.voiceStreamId, input.voiceStreamId);
    assert.equal(typedFirstChunk?.terminal, false);
    assert.equal((typedFirstChunk?.chunk?.byteLength ?? 0) > 0, true, 'typed Runtime voice stream must carry bytes in the non-final chunk');

    const interruptResponse = await promiseWithTimeout(
      interruptLiveRuntimeFixtureVoicePlayback(input.fixture, {
        ownerUserId: input.fixture.ownerUserId,
        runtimeSourceRef: input.fixture.runtimeSourceRef,
        localAgentRef: input.fixture.localAgentRef,
        conversationAnchorId: input.conversationAnchorId,
        turnId: input.turnId,
        voiceStreamId: input.voiceStreamId,
        reason: 'zhiyu_electron_live_voice_interrupt',
        runtimeAuthBinding: input.runtimeAuthBinding,
      }),
      10_000,
      `Runtime voice interrupt RPC did not return for ${input.voiceStreamId}`,
    );

    for (;;) {
      const next = await nextAsyncIteratorValue(iterator, deadlineMs, `typed Runtime voice stream interrupted terminal for ${input.voiceStreamId}`);
      assert.equal(next.done, false, 'typed Runtime voice stream ended before interrupted terminal');
      const event = next.value;
      if (!event?.terminal) {
        continue;
      }
      return {
        typedFirstChunk,
        typedTerminalEvent: event,
        interruptResponse,
      };
    }
  } finally {
    await iterator.return?.();
  }
}

function createZhiyuLiveRuntimeAgentClient(fixture) {
  const runtime = createRuntimeForEndpoint(fixture.endpoint, zhiyuRuntimeVoiceObserverAppId);
  return createNimiRuntimeAgentClient({
    runtime: {
      appId: zhiyuRuntimeVoiceObserverAppId,
      auth: runtime.auth,
      appAuth: runtime.grants,
      agents: runtime.agents,
      appMessages: runtime.appMessages,
    },
    appId: zhiyuRuntimeVoiceObserverAppId,
    getSubjectUserId: () => fixture.ownerUserId,
    withScopes: createZhiyuLiveRuntimeScopeRunner(fixture, runtime),
  });
}

function createZhiyuLiveRuntimeAgentVoiceModule(fixture, runtimeAuthBinding) {
  const runtime = createRuntimeForEndpoint(fixture.endpoint, zhiyuAppId);
  return createNimiRuntimeAgentVoiceModule({
    runtime: {
      appId: zhiyuAppId,
      auth: runtime.auth,
      appAuth: runtime.grants,
      agents: runtime.agents,
      artifacts: runtime.artifacts,
    },
    getSubjectUserId: () => fixture.ownerUserId,
    withScopes: createZhiyuRuntimeAuthBindingScopeRunner(runtimeAuthBinding),
  });
}

function createZhiyuRuntimeAuthBindingScopeRunner(runtimeAuthBinding) {
  return async (_scopes, operation) => operation({
    metadata: zhiyuRuntimeAuthBindingMetadata(runtimeAuthBinding),
  });
}

function createZhiyuLiveRuntimeScopeRunner(fixture, runtime) {
  const sessionMetadata = createNimiRuntimeAppSessionMetadataProvider({
    appId: zhiyuRuntimeVoiceObserverAppId,
    appInstanceId: zhiyuRuntimeVoiceObserverAppInstanceId,
    deviceId: 'nimi-zhiyu-live-runtime-voice-observer-device',
    appVersion: 'zhiyu-electron-live-runtime-acceptance',
    developerRegistration: false,
    capabilities: zhiyuRuntimeProtectedScopes,
    auth: runtime.auth,
  });
  return (scopes, operation) =>
    withNimiRuntimeAgentScopes({
      runtime: {
        appId: zhiyuRuntimeVoiceObserverAppId,
        auth: runtime.auth,
        appAuth: runtime.grants,
      },
      subjectUserId: fixture.ownerUserId,
    }, scopes, async (callOptions) => {
      const metadata = await sessionMetadata();
      return operation({
        ...callOptions,
        metadata: {
          ...metadata,
          ...(callOptions.metadata ?? {}),
        },
      });
    });
}

function isRuntimeNativeNonFinalVoiceChunkEvent(event) {
  return event?.eventName === 'runtime.agent.presentation.voice_stream_chunk_available'
    && event?.detail?.voiceOutputMode === 'native_stream'
    && event?.detail?.voicePlaybackState === 'active'
    && event?.detail?.finalChunk === false
    && Boolean(event?.detail?.voiceStreamId || event?.detail?.voice_stream_id)
    && Boolean(event?.detail?.chunkTransportRef || event?.detail?.chunk_transport_ref)
    && !Boolean(event?.detail?.audioArtifactId || event?.detail?.audio_artifact_id);
}

async function nextAsyncIteratorValue(iterator, deadlineMs, label) {
  const remainingMs = Math.max(0, deadlineMs - Date.now());
  if (remainingMs <= 0) {
    throw new Error(`${label} timed out`);
  }
  let timeout = null;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out`)), remainingMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function promiseWithTimeout(promise, timeoutMs, label) {
  let timeout = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} within ${timeoutMs}ms`)), timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export function summarizeTypedVoiceStreamEvent(event) {
  return {
    voiceStreamId: event?.voiceStreamId || '',
    conversationAnchorId: event?.conversationAnchorId || '',
    turnId: event?.turnId || '',
    streamId: event?.streamId || '',
    messageId: event?.messageId || '',
    chunkSequence: Number(event?.chunkSequence ?? 0),
    byteLength: Number(event?.chunk?.byteLength ?? 0),
    mimeType: event?.mimeType || '',
    voiceOutputMode: event?.voiceOutputMode,
    voicePlaybackState: event?.voicePlaybackState,
    terminal: event?.terminal === true,
    terminalReason: event?.terminalReason || '',
    replayTruncated: event?.replayTruncated === true,
  };
}

export async function readLiveRuntimeFixtureArtifactBytes(fixture, artifactId) {
  const sessionMetadata = createNimiRuntimeAppSessionMetadataProvider({
    appId: desktopAppId,
    appInstanceId: `${desktopAppId}.live-runtime`,
    deviceId: 'nimi-desktop-live-runtime-device',
    appVersion: 'zhiyu-electron-live-runtime-acceptance',
    developerRegistration: false,
    auth: fixture.runtime.auth,
  });
  return fixture.runtime.artifacts.readArtifactBytes({ artifactId }, {
    metadata: await sessionMetadata(),
  });
}

async function interruptLiveRuntimeFixtureVoicePlayback(fixture, input) {
  const runtime = createRuntimeForEndpoint(fixture.endpoint, zhiyuAppId);
  const idempotencyKey = `zhiyu-live-runtime-voice-interrupt:${input.voiceStreamId}`;
  return runtime.agents.interruptAgentVoicePlayback({
    context: {
      appId: zhiyuAppId,
      subjectUserId: input.ownerUserId,
      ownerUserId: input.ownerUserId,
      runtimeSourceRef: input.runtimeSourceRef,
      localAgentRef: input.localAgentRef,
    },
    conversationAnchorId: input.conversationAnchorId,
    turnId: input.turnId,
    voiceStreamId: input.voiceStreamId,
    reason: input.reason,
  }, {
    metadata: {
      ...zhiyuRuntimeAuthBindingMetadata(input.runtimeAuthBinding),
      idempotencyKey,
      'x-nimi-idempotency-key': idempotencyKey,
    },
  });
}

function zhiyuRuntimeAuthBindingMetadata(runtimeAuthBinding) {
  if (runtimeAuthBinding?.kind === 'scopedBinding') {
    const bindingId = String(runtimeAuthBinding.bindingId || '').trim();
    assert.ok(bindingId, 'Zhiyu Runtime scoped binding id is required for owner-app voice operations');
    return { 'x-nimi-runtime-scoped-binding-id': bindingId };
  }
  if (runtimeAuthBinding?.kind === 'hostEquivalence') {
    const evidenceRef = String(runtimeAuthBinding.evidenceRef || '').trim();
    assert.ok(evidenceRef, 'Zhiyu Runtime host equivalence evidence is required for owner-app voice operations');
    return { 'x-nimi-runtime-host-equivalence': evidenceRef };
  }
  assert.fail('Zhiyu Runtime auth binding is required for owner-app voice operations');
}

export function runtimeProjectionEventTurnId(event) {
  return String(
    event?.runtimeTurnId
      || event?.turnId
      || event?.detail?.runtimeTurnId
      || event?.detail?.turnId
      || event?.detail?.turn_id
      || '',
  ).trim();
}
