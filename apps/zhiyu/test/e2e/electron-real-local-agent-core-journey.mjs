import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  renderLiveRuntimeCommittedVoice,
  runtimeProjectionEventTurnId,
} from '../electron-live-runtime-native-voice-helpers.mjs';
import {
  assertNoPageProblems,
  captureRealLocalAgentEvidence,
} from './electron-real-local-agent-evidence.mjs';

export async function runFullChainCoreContinuation({
  page,
  pageProblems,
  handoff,
  targetAgent,
  readyEvidence,
  setPresentationProfile,
  assertProductDesignLayout,
  waitForEvidence,
}) {
  const checkpoints = {};
  const fixture = {
    endpoint: handoff.runtimeEndpoint,
    ownerUserId: handoff.ownerUserId,
    runtimeSourceRef: targetAgent.runtimeSourceRef,
    localAgentRef: targetAgent.localAgentRef,
  };

  assert.equal(readyEvidence.chat.state, 'completed');
  assert.ok(readyEvidence.chat.messageCount >= 4, 'cross-app checkpoint requires at least two completed Zhiyu turns');
  assert.ok(readyEvidence.chat.conversationAnchorId, 'cross-app checkpoint requires a Runtime conversation anchor');
  checkpoints.crossAppAnchor = {
    passed: true,
    localAgentRef: readyEvidence.chat.localAgentRef,
    conversationAnchorId: readyEvidence.chat.conversationAnchorId,
    messageCount: readyEvidence.chat.messageCount,
  };
  await assertProductDesignLayout(page, 'full-chain core layout checkpoint');
  await page.setViewportSize({ width: 390, height: 900 });
  const narrowLayout = await page.evaluate(() => ({
    viewportWidth: globalThis.document.documentElement.clientWidth,
    scrollWidth: globalThis.document.documentElement.scrollWidth,
    activeElementTag: globalThis.document.activeElement?.tagName || null,
  }));
  const accessibility = await inspectCoreAccessibility(page);
  assert.ok(narrowLayout.scrollWidth <= narrowLayout.viewportWidth + 2, `core narrow layout overflow: ${JSON.stringify(narrowLayout)}`);
  assert.equal(accessibility.unnamedInteractiveControls.length, 0, `core controls require accessible names: ${JSON.stringify(accessibility)}`);
  checkpoints.layoutAccessibility = { passed: true, narrowLayout, accessibility };
  await page.setViewportSize({ width: 1280, height: 900 });

  const emotion = await sendCorePlannedTurn(page, handoff, {
    checkpointId: 'core-emotion-apml',
    prompt: '请用一个明确情绪回应，然后保持该情绪继续对话。',
    apml: '<message id="core-emotion-apml"><emotion>happy</emotion><activity>thinking</activity>情绪与 APML 已由 Runtime 投影。</message>',
    chunks: ['<message id="core-emotion-apml"><emotion>happy</emotion>', '<activity>thinking</activity>情绪与 APML 已由 Runtime 投影。</message>'],
  }, waitForEvidence);
  assert.equal(emotion.chat.state, 'completed');
  await waitForEvidence(page, () => Boolean(
    globalThis.window.__nimiZhiyuEvidence?.companion?.currentEmotionCue
      || globalThis.window.__nimiZhiyuEvidence?.companion?.currentEmotionId,
  ), 'core companion emotion projection');
  const emotionProjected = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
  const emotionBefore = emotionProjected.companion.currentEmotionCue || emotionProjected.companion.currentEmotionId;
  const emotionFollowUp = await sendCorePlannedTurn(page, handoff, {
    checkpointId: 'core-emotion-continuity',
    prompt: '这一轮不指定新情绪，继续刚才的状态。',
    apml: '<message id="core-emotion-continuity">没有新情绪标签的后续轮次。</message>',
  }, waitForEvidence);
  await waitForEvidence(page, (expected) => (
    globalThis.window.__nimiZhiyuEvidence?.companion?.currentEmotionCue
      || globalThis.window.__nimiZhiyuEvidence?.companion?.currentEmotionId
  ) === expected, 'core companion emotion continuity', emotionBefore);
  checkpoints.emotionApml = { passed: true, requestId: emotionFollowUp.chat.requestId, emotion: emotionBefore };
  await captureRealLocalAgentEvidence(page, 'core-emotion-apml', pageProblems, { emotion, emotionProjected, emotionFollowUp });

  const streamed = await sendCorePlannedTurn(page, handoff, {
    checkpointId: 'core-stream-reasoning',
    prompt: '请分段输出，并把推理片段与最终文本分开。',
    apml: '<message id="core-stream-reasoning">分段最终文本已经完成。</message>',
    chunks: ['<message id="core-stream-reasoning">分段', '最终文本已经完成。</message>'],
    reasoningChunks: ['checking Runtime route ', 'before final answer'],
    streamDelayMs: 750,
    observeStreaming: true,
  }, waitForEvidence);
  assert.match(streamed.chat.reasoningText || '', /Runtime route|final answer/u);
  assert.match(streamed.chat.outputText || '', /分段最终文本/u);
  checkpoints.streamingReasoning = { passed: true, requestId: streamed.chat.requestId, turnId: streamed.turn.runtimeTurnId || null };
  await captureRealLocalAgentEvidence(page, 'core-stream-reasoning', pageProblems, { streamed });

  const image = await sendCorePlannedTurn(page, handoff, {
    checkpointId: 'core-image-action',
    prompt: '生成一张当前伙伴的验收图像。',
    apml: '<message id="core-image-action">图像动作开始。</message><action id="core-image" kind="image"><prompt-payload kind="image"><prompt-text>current local agent portrait</prompt-text></prompt-payload></action>',
  }, waitForEvidence);
  assert.equal(image.chat.eventTypes.includes('artifact-ready'), true);
  const artifactSummary = page.locator('[data-zhiyu-runtime-action-artifact-summary="true"]').last();
  await artifactSummary.waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await artifactSummary.getAttribute('data-zhiyu-runtime-action-artifact-preview'), 'rendered');
  checkpoints.imageAction = { passed: true, requestId: image.chat.requestId };
  await captureRealLocalAgentEvidence(page, 'core-image-action', pageProblems, { image });

  await setPresentationProfile(targetAgent, true);
  const voice = await sendCorePlannedTurn(page, handoff, {
    checkpointId: 'core-native-voice',
    prompt: '用当前伙伴的 Runtime Voice 回应。',
    apml: '<message id="core-native-voice"><emotion>shy</emotion>Runtime native voice checkpoint.</message>',
  }, waitForEvidence);
  await waitForEvidence(page, () => {
    const companion = globalThis.window.__nimiZhiyuEvidence?.companion;
    return companion?.voiceOutputMode === 'native_stream' && companion?.voicePlaybackState === 'completed';
  }, 'full-chain core native voice completion');
  const voiceCompleted = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
  const voiceEvents = runtimeProjectionEvents(voiceCompleted);
  assert.equal(voiceEvents.some((event) => event?.eventName === 'runtime.agent.presentation.voice_stream_chunk_available'), true);
  assert.equal(voiceEvents.some((event) => event?.eventName === 'runtime.agent.presentation.voice_playback_terminal' && event?.detail?.voicePlaybackState === 'completed'), true);
  checkpoints.nativeVoice = { passed: true, requestId: voice.chat.requestId, voiceStreamId: voiceCompleted.companion.voiceStreamId };

  const voiceMessageId = voiceCompleted.turn.messageId;
  const voiceTurnId = completedRuntimeTurnId(voiceCompleted, voiceMessageId);
  assert.ok(voiceMessageId && voiceTurnId, 'batch voice checkpoint requires committed Runtime turn/message ids');
  const batchVoice = await renderLiveRuntimeCommittedVoice({
    page,
    fixture,
    readyEvidence: voiceCompleted,
    conversationAnchorId: voiceCompleted.chat.conversationAnchorId,
    turnId: voiceTurnId,
    messageId: voiceMessageId,
    text: voiceCompleted.chat.latestAssistantText || voiceCompleted.chat.outputText,
    playbackTarget: 'desktop_manual',
    timeoutMs: 45_000,
  });
  assert.equal(batchVoice.status, 'ready');
  await waitForEvidence(page, ({ audioArtifactId }) =>
    globalThis.window.__nimiZhiyuEvidence?.companion?.voiceOutputMode === 'batch_final_artifact'
    && globalThis.window.__nimiZhiyuEvidence?.companion?.voiceAudioArtifactId === audioArtifactId,
  'full-chain core batch voice artifact', { audioArtifactId: batchVoice.audioArtifactId });
  checkpoints.batchVoice = { passed: true, audioArtifactId: batchVoice.audioArtifactId };
  await captureRealLocalAgentEvidence(page, 'core-voice', pageProblems, { voiceCompleted, batchVoice });

  const captureTool = page.locator('[data-zhiyu-composer-tool="voice-capture"]').first();
  await captureTool.waitFor({ state: 'visible', timeout: 30_000 });
  await captureTool.click();
  await waitForEvidence(page, () => globalThis.window.__nimiZhiyuEvidence?.voiceCapture?.state === 'recording', 'core voice capture recording');
  await captureTool.click();
  await waitForEvidence(page, () =>
    globalThis.window.__nimiZhiyuEvidence?.voiceCapture?.state === 'idle'
    && globalThis.window.__nimiZhiyuEvidence?.voiceCapture?.reasonCode === 'runtime-voice-capture-transcribed'
    && globalThis.window.__nimiZhiyuEvidence?.voiceCapture?.transcriptText === 'Runtime full-chain fixture transcript.',
  'core Runtime STT transcript');
  await queueCoreProviderPlan(handoff, {
    checkpointId: 'core-stt-turn',
    apml: '<message id="core-stt-turn">STT transcript reached the Runtime turn.</message>',
  });
  await page.locator('[data-chat-composer-send="true"]').click();
  await waitForEvidence(page, () => globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'completed'
    && globalThis.window.__nimiZhiyuEvidence?.chat?.messages?.some((message) => message?.text === 'Runtime full-chain fixture transcript.'),
  'core transcribed turn completion');
  checkpoints.stt = { passed: true, transcript: 'Runtime full-chain fixture transcript.' };
  await captureRealLocalAgentEvidence(page, 'core-stt', pageProblems, { evidence: await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence) });

  await writeControlRequest(handoff, 'persona-materialize-request.json', { checkpointId: 'persona-materialized' });
  const personaAck = await waitForControlJson(handoff, 'persona-materialize-complete.json');
  assert.equal(personaAck.ok, true);
  const updatedHandoff = JSON.parse(await readFile(process.env.NIMI_LOCAL_AGENT_PRODUCT_HANDOFF_PATH, 'utf8'));
  const persona = updatedHandoff.agents.find((agent) => agent.sourceKind === 'realmPersona');
  assert.ok(persona, 'Desktop must materialize a RealmPersona in the same Journey environment');
  await setPresentationProfile(persona, true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForEvidence(page, () => globalThis.window.__nimiZhiyuEvidence?.inventory?.ready === true
    && globalThis.window.__nimiZhiyuEvidence?.inventory?.count === 2, 'two-agent Runtime inventory');
  await selectLocalAgent(page, persona.localAgentRef, waitForEvidence);
  const personaFirst = await sendCorePlannedTurn(page, updatedHandoff, {
    checkpointId: 'core-persona-turn-1',
    prompt: 'PERSONA_CANARY_B：请作为 Persona 回应。',
    apml: '<message id="core-persona-turn-1">Persona turn one.</message>',
  }, waitForEvidence);
  const personaSecond = await sendCorePlannedTurn(page, updatedHandoff, {
    checkpointId: 'core-persona-turn-2',
    prompt: '继续 Persona 的第二轮，并记住 PERSONA_CANARY_B。',
    apml: '<message id="core-persona-turn-2">Persona turn two.</message>',
  }, waitForEvidence);
  assert.equal(personaSecond.chat.localAgentRef, persona.localAgentRef);
  await selectLocalAgent(page, targetAgent.localAgentRef, waitForEvidence);
  const characterBeforeIsolation = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
  assert.equal(JSON.stringify(characterBeforeIsolation.chat.messages || []).includes('PERSONA_CANARY_B'), false);
  const isolated = await sendCorePlannedTurn(page, updatedHandoff, {
    checkpointId: 'core-cross-agent-isolation',
    prompt: 'CHARACTER_CANARY_A：只使用 Character 自己的上下文。',
    apml: '<message id="core-cross-agent-isolation">Character isolation confirmed.</message>',
  }, waitForEvidence);
  const manifestAfterIsolation = await fetchProviderManifest(updatedHandoff);
  const isolationRequest = (manifestAfterIsolation.realmFixture?.providerRequests || []).find((request) => request.checkpointId === 'core-cross-agent-isolation');
  assert.ok(isolationRequest, 'cross-agent provider checkpoint is missing');
  assert.equal(JSON.stringify(isolationRequest.body).includes('PERSONA_CANARY_B'), false);
  checkpoints.personaAndIsolation = {
    passed: true,
    personaLocalAgentRef: persona.localAgentRef,
    characterLocalAgentRef: targetAgent.localAgentRef,
    personaRequestIds: [personaFirst.chat.requestId, personaSecond.chat.requestId],
    characterRequestId: isolated.chat.requestId,
  };
  await captureRealLocalAgentEvidence(page, 'core-cross-agent-isolation', pageProblems, { personaFirst, personaSecond, isolated });

  const beforeRestart = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
  await writeControlRequest(updatedHandoff, 'runtime-restart-request.json', { checkpointId: 'runtime-restart' });
  const restartAck = await waitForControlJson(updatedHandoff, 'runtime-restart-complete.json');
  assert.equal(restartAck.localAgentCount, 2);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForEvidence(page, () => globalThis.window.__nimiZhiyuEvidence?.runtime?.ready === true
    && globalThis.window.__nimiZhiyuEvidence?.inventory?.count === 2, 'Runtime restart recovery inventory');
  await selectLocalAgent(page, targetAgent.localAgentRef, waitForEvidence);
  const recovered = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
  assert.ok(recovered.chat.messageCount >= beforeRestart.chat.messageCount, 'Runtime restart must recover the Character transcript');
  const afterRestart = await sendCorePlannedTurn(page, updatedHandoff, {
    checkpointId: 'core-after-restart',
    prompt: '重启后继续 CHARACTER_CANARY_A。',
    apml: '<message id="core-after-restart">Restart continuity confirmed.</message>',
  }, waitForEvidence);
  checkpoints.restart = { passed: true, messageCountBefore: beforeRestart.chat.messageCount, messageCountAfter: afterRestart.chat.messageCount };
  await captureRealLocalAgentEvidence(page, 'core-after-restart', pageProblems, { beforeRestart, afterRestart });

  await writeControlRequest(updatedHandoff, 'realm-offline-request.json', { checkpointId: 'realm-offline' });
  const offlineAck = await waitForControlJson(updatedHandoff, 'realm-offline-complete.json');
  assert.equal(offlineAck.restOnline, false);
  const offlineTurn = await sendCorePlannedTurn(page, updatedHandoff, {
    checkpointId: 'core-realm-offline-turn',
    prompt: 'Realm 离线时继续本地对话。',
    apml: '<message id="core-realm-offline-turn">Realm offline local continuity confirmed.</message>',
  }, waitForEvidence);
  assert.equal(offlineTurn.chat.state, 'completed');
  await writeControlRequest(updatedHandoff, 'realm-online-request.json', { checkpointId: 'realm-recovery' });
  const onlineAck = await waitForControlJson(updatedHandoff, 'realm-online-complete.json');
  assert.equal(onlineAck.restOnline, true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForEvidence(page, () => globalThis.window.__nimiZhiyuEvidence?.inventory?.count === 2, 'Realm recovery without duplicate agents');
  checkpoints.offlineRecovery = { passed: true, offlineRequestId: offlineTurn.chat.requestId, recoveredAgentCount: 2 };
  await captureRealLocalAgentEvidence(page, 'core-realm-offline-recovery', pageProblems, {
    offlineTurn,
    recovered: await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence),
  });

  assertNoPageProblems(pageProblems);
  const summaryPath = process.env.NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_SUMMARY_PATH;
  if (!summaryPath) throw new Error('full-chain-core requires NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_SUMMARY_PATH');
  await writeFile(summaryPath, `${JSON.stringify({
    schemaVersion: 'nimi.local-agent-product-zhiyu-core-summary/v2',
    journeyId: 'full-chain-core',
    ownerUserId: handoff.ownerUserId,
    characterLocalAgentRef: targetAgent.localAgentRef,
    checkpoints,
    pageProblems,
    outcome: 'passed',
  }, null, 2)}\n`);
}

async function inspectCoreAccessibility(page) {
  const session = await page.context().newCDPSession(page);
  const tree = await session.send('Accessibility.getFullAXTree');
  const interactiveRoles = new Set([
    'button', 'checkbox', 'combobox', 'link', 'menuitem', 'radio', 'searchbox', 'slider', 'switch', 'tab', 'textbox',
  ]);
  const controls = tree.nodes
    .filter((node) => !node.ignored && interactiveRoles.has(String(node.role?.value || '')))
    .map((node) => ({ role: String(node.role?.value || ''), name: String(node.name?.value || '').trim() }));
  return {
    interactiveControlCount: controls.length,
    unnamedInteractiveControls: controls.filter((control) => !control.name).slice(0, 20),
  };
}

export async function queueCoreProviderPlan(handoff, plan) {
  const response = await fetch(`${handoff.providerFixtureBaseUrl}/__fixture/control/provider-plan`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(plan),
  });
  assert.equal(response.ok, true, `provider plan ${plan.checkpointId} must be accepted`);
}

async function sendCorePlannedTurn(page, handoff, plan, waitForEvidence) {
  await queueCoreProviderPlan(handoff, plan);
  const before = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence?.chat?.messageCount || 0);
  const composer = page.locator('[data-chat-composer-textarea="true"]').first();
  await composer.fill(plan.prompt);
  await page.waitForFunction(() => globalThis.document.querySelector('[data-zhiyu-submit-enabled]')?.getAttribute('data-zhiyu-submit-enabled') === 'true'
    && globalThis.document.querySelector('[data-chat-composer-send="true"]')?.disabled === false);
  await page.locator('[data-chat-composer-send="true"]').click();
  if (plan.observeStreaming) {
    await waitForEvidence(page, () => globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'streaming'
      && (globalThis.window.__nimiZhiyuEvidence?.chat?.reasoningText || '').length > 0,
    `${plan.checkpointId} streaming checkpoint`);
  }
  await waitForEvidence(page, ({ previousCount }) => globalThis.window.__nimiZhiyuEvidence?.chat?.state === 'completed'
    && Number(globalThis.window.__nimiZhiyuEvidence?.chat?.messageCount || 0) >= Number(previousCount) + 2,
  `${plan.checkpointId} completion`, { previousCount: before });
  return page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
}

async function selectLocalAgent(page, localAgentRef, waitForEvidence) {
  const inventory = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence?.inventory?.localAgents || []);
  const index = inventory.findIndex((agent) => agent.localAgentRef === localAgentRef);
  assert.notEqual(index, -1, `LocalAgent ${localAgentRef} must exist in Runtime inventory`);
  const button = page.locator('[data-zhiyu-local-agent-candidate="true"]').nth(index);
  await button.waitFor({ state: 'visible', timeout: 30_000 });
  await button.click();
  await waitForEvidence(page, (expected) => globalThis.window.__nimiZhiyuEvidence?.localAgent?.localAgentRef === expected
    && globalThis.window.__nimiZhiyuEvidence?.conversation?.ready === true,
  `select ${localAgentRef}`, localAgentRef);
}

async function writeControlRequest(handoff, fileName, payload) {
  await writeFile(path.join(handoff.controlRoot, fileName), `${JSON.stringify(payload, null, 2)}\n`);
}

async function waitForControlJson(handoff, fileName, timeoutMs = 180_000) {
  const file = path.join(handoff.controlRoot, fileName);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${fileName}`);
}

async function fetchProviderManifest(handoff) {
  const response = await fetch(`${handoff.providerFixtureBaseUrl}/__fixture/control/manifest`);
  assert.equal(response.ok, true);
  return response.json();
}

function runtimeProjectionEvents(evidence) {
  return [
    ...(evidence.chat?.diagnostics?.runtimeProjectionEvents ?? []),
    ...(evidence.chat?.messages ?? []).flatMap((message) => message?.metadata?.runtimeProjectionEvents ?? []),
    ...(evidence.companion?.diagnostics?.runtimeProjectionEvents ?? []),
  ];
}

function completedRuntimeTurnId(evidence, messageId) {
  return String(evidence.turn?.runtimeTurnId
    || evidence.chat?.runtimeTurnId
    || runtimeProjectionEventTurnId(runtimeProjectionEvents(evidence).find((event) =>
      (event?.detail?.messageId || event?.detail?.message_id || event?.messageId) === messageId
    ) || runtimeProjectionEvents(evidence).find((event) => runtimeProjectionEventTurnId(event)))
    || '').trim();
}

export function installVoiceCaptureSuccessMock() {
  const stream = { getTracks() { return [{ stop() {} }]; } };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { async getUserMedia() { return stream; } },
  });
  class MockMediaRecorder extends EventTarget {
    static isTypeSupported() { return true; }
    constructor(_stream, options = {}) { super(); this.mimeType = options.mimeType || 'audio/webm'; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      const event = new Event('dataavailable');
      Object.defineProperty(event, 'data', { value: new Blob([new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4])], { type: this.mimeType }) });
      this.dispatchEvent(event);
      this.dispatchEvent(new Event('stop'));
    }
  }
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: MockMediaRecorder });
}
