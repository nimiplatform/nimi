import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

import {
  readConversationScenarioRegistry,
  resolveConversationScenarioRegistry,
} from '../../../../tests/local-agent-product/conversation-report/registry.mjs';
import {
  conversationReportExecutionStatus,
  resolveConversationTurnOutcome,
} from '../../../../tests/local-agent-product/conversation-report/turn-result.mjs';
import {
  captureRealLocalAgentEvidence,
} from './electron-real-local-agent-evidence.mjs';
import {
  selectLocalAgent,
  sendCorePlannedTurn,
  waitForControlJson,
  writeControlRequest,
} from './electron-real-local-agent-core-journey.mjs';

function submittedRequestId(evidence, prompt) {
  const messages = Array.isArray(evidence?.chat?.messages) ? evidence.chat.messages : [];
  const submitted = [...messages].reverse().find((message) => message?.role === 'user'
    && String(message?.text || '') === prompt
    && String(message?.metadata?.turnId || '').trim());
  return String(submitted?.metadata?.turnId || evidence?.chat?.requestId || '').trim();
}

function observedConversationSnapshot(evidence) {
  const messages = Array.isArray(evidence?.chat?.messages) ? evidence.chat.messages : [];
  const state = String(evidence?.chat?.state || '').trim().toLowerCase();
  return {
    threadId: evidence?.conversation?.threadId || null,
    transcriptMessageCount: Number(evidence?.chat?.messageCount || messages.length),
    transcript: messages,
    lastTurn: {
      turnId: evidence?.turn?.runtimeTurnId || evidence?.chat?.runtimeTurnId || null,
      status: state,
      reasonCode: state === 'failed'
        ? (evidence?.chat?.reasonCode || evidence?.turn?.reasonCode || '')
        : '',
      message: state === 'failed'
        ? (evidence?.chat?.message || evidence?.turn?.message || '')
        : '',
      contextSummary: evidence?.source?.turnContextSummary || null,
      structured: evidence?.companion?.structured || null,
    },
  };
}

function presentationOutput(evidence, snapshot, inspectSnapshot, capturedAt) {
  const companion = evidence?.companion || {};
  const structured = snapshot?.lastTurn?.structured || null;
  return {
    capturedAt,
    voice: {
      observed: Boolean(companion.voice || evidence?.voice),
      events: companion.voice ? [companion.voice] : evidence?.voice ? [evidence.voice] : [],
    },
    emotion: {
      observed: Boolean(companion.emotion || structured?.emotion),
      events: companion.emotion ? [companion.emotion] : structured?.emotion ? [structured.emotion] : [],
    },
    activity: {
      observed: Boolean(companion.activity || evidence?.activity),
      events: companion.activity ? [companion.activity] : evidence?.activity ? [evidence.activity] : [],
    },
    apml: {
      observed: Boolean(structured),
      structured,
    },
    hooks: [
      ...(inspectSnapshot?.pendingHooks || []),
      ...(inspectSnapshot?.recentTerminalHooks || []),
    ],
  };
}

async function executeDeclaredTurn({
  page,
  pageProblems,
  handoff,
  declaredTurn,
  stream,
  agent,
  expectedAnchorId,
  waitForEvidence,
}) {
  const pageProblemStart = pageProblems.length;
  const beforeEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
  const previousRuntimeTurnId = String(
    beforeEvidence?.turn?.runtimeTurnId || beforeEvidence?.chat?.runtimeTurnId || '',
  ).trim();
  const submittedAt = new Date().toISOString();
  const startedAt = Date.now();
  const evidence = await sendCorePlannedTurn(page, handoff, {
    checkpointId: declaredTurn.turn_id,
    prompt: declaredTurn.user_message,
  }, waitForEvidence, { allowTransportFailure: true });
  const receivedAt = new Date().toISOString();
  const conversationAnchorId = String(evidence.chat?.conversationAnchorId || '').trim();
  assert.ok(conversationAnchorId, `${declaredTurn.turn_id} must expose its Runtime conversation anchor`);
  if (expectedAnchorId) {
    assert.equal(conversationAnchorId, expectedAnchorId, `${declaredTurn.turn_id} replaced the Runtime-owned conversation anchor`);
  }
  const snapshot = observedConversationSnapshot(evidence);
  const memory = evidence.memory ?? null;
  const inspectSnapshot = evidence.source?.sourceContextStatus ?? null;
  const snapshotRuntimeTurnId = String(snapshot.lastTurn?.turnId || '').trim();
  const evidenceRuntimeTurnId = String(evidence.turn?.runtimeTurnId || '').trim();
  const runtimeTurnId = [snapshotRuntimeTurnId, evidenceRuntimeTurnId]
    .find((candidate) => candidate && candidate !== previousRuntimeTurnId) || null;
  if (evidenceRuntimeTurnId && snapshotRuntimeTurnId
    && evidenceRuntimeTurnId !== previousRuntimeTurnId && snapshotRuntimeTurnId !== previousRuntimeTurnId) {
    assert.equal(snapshotRuntimeTurnId, evidenceRuntimeTurnId,
      `${declaredTurn.turn_id} UI/Runtime turn correlation drifted`);
  }
  const turnPageProblems = pageProblems.slice(pageProblemStart);
  const outcome = resolveConversationTurnOutcome({
    snapshot,
    outputText: evidence.chat?.outputText || '',
    uiState: evidence.chat?.state,
    uiReasonCode: evidence.chat?.reasonCode || evidence.turn?.reasonCode,
    uiMessage: evidence.chat?.errorMessage || evidence.chat?.message,
    runtimeTurnId,
    pageErrors: turnPageProblems.filter((problem) => problem.startsWith('pageerror:')),
    consoleErrors: turnPageProblems.filter((problem) => problem.startsWith('console error:')),
  });
  if (outcome.status === 'completed') assert.ok(runtimeTurnId, `${declaredTurn.turn_id} completed without a current Runtime turn id`);
  const requestId = submittedRequestId(evidence, declaredTurn.user_message);
  assert.ok(requestId, `${declaredTurn.turn_id} current Zhiyu request id is missing`);
  const screenshotFiles = [];
  if (declaredTurn.screenshot_checkpoint) {
    await captureRealLocalAgentEvidence(page, declaredTurn.turn_id, pageProblems, {
      declaredTurnId: declaredTurn.turn_id,
      localAgentRef: agent.localAgentRef,
      conversationAnchorId,
      evidence,
    });
    screenshotFiles.push(
      `real-local-agent-${declaredTurn.turn_id}-desktop.png`,
      `real-local-agent-${declaredTurn.turn_id}-narrow.png`,
    );
  }
  return {
    turnId: declaredTurn.turn_id,
    streamId: stream.stream_id,
    order: declaredTurn.order,
    sourceKind: stream.source_provenance.source_kind,
    prompt: declaredTurn.user_message,
    submittedAt,
    receivedAt,
    latencyMs: Date.now() - startedAt,
    outputText: outcome.outputText,
    transportFailure: outcome.transportFailure,
    turnPageProblems,
    requestId,
    runtimeTurnId,
    conversationAnchorId,
    threadId: snapshot.threadId || null,
    transcriptMessageCount: Number(snapshot.transcriptMessageCount || snapshot.transcript?.length || 0),
    transcript: snapshot.transcript || [],
    contextSummary: snapshot.lastTurn?.contextSummary || evidence.source?.turnContextSummary || null,
    memory,
    inspect: inspectSnapshot,
    presentationOutput: presentationOutput(evidence, snapshot, inspectSnapshot, receivedAt),
    screenshotFiles,
    observationPointIds: declaredTurn.observation_point_ids,
    humanReviewDimensions: declaredTurn.human_review_dimensions,
  };
}

function timelineEvent(eventId, kind, streamId, agent, anchorId, extra = {}) {
  return {
    eventId,
    kind,
    streamId,
    occurredAt: new Date().toISOString(),
    correlation: {
      localAgentRef: agent?.localAgentRef || null,
      conversationAnchorId: anchorId || null,
    },
    ...extra,
  };
}

export async function runConversationReportContinuation({
  page,
  pageProblems,
  handoff,
  targetAgent,
  readyEvidence,
  waitForEvidence,
}) {
  const scenario = (await resolveConversationScenarioRegistry(readConversationScenarioRegistry())).scenarios
    .find((candidate) => candidate.scenario_id === 'conversation-report-baseline');
  assert.ok(scenario, 'conversation report baseline scenario is missing');
  const streamA = scenario.streams.find((stream) => stream.source_provenance.source_kind === 'worldCharacter');
  const streamB = scenario.streams.find((stream) => stream.source_provenance.source_kind === 'realmPersona');
  const desktopTurns = handoff.desktopConversationReportTurns || [];
  assert.deepEqual(desktopTurns.map((turn) => turn.turnId), streamA.turns.slice(0, 4).map((turn) => turn.turn_id));
  const anchorA = String(desktopTurns[0]?.conversationAnchorId || '').trim();
  assert.ok(anchorA, 'Desktop LocalAgent A conversation anchor is missing');
  assert.equal(new Set(desktopTurns.map((turn) => turn.conversationAnchorId)).size, 1,
    'Desktop turns must stay on one Runtime-owned LocalAgent A anchor');
  assert.equal(readyEvidence.conversation?.conversationAnchorId, anchorA,
    'Zhiyu must continue the Desktop Runtime-owned LocalAgent A conversation anchor');

  const turns = [...desktopTurns];
  const lifecycleEvents = [
    timelineEvent('materialize-local-agent-a', 'materialization', streamA.stream_id, targetAgent, anchorA, {
      materializationCount: 1,
    }),
    timelineEvent('desktop-start-stream-a', 'desktop_conversation_started', streamA.stream_id, targetAgent, anchorA),
    timelineEvent('continue-stream-a-in-zhiyu', 'desktop_to_zhiyu_continuation', streamA.stream_id, targetAgent, anchorA),
  ];

  for (const declaredTurn of streamA.turns.slice(4, 7)) {
    turns.push(await executeDeclaredTurn({
      page, pageProblems, handoff, declaredTurn, stream: streamA, agent: targetAgent,
      expectedAnchorId: anchorA, waitForEvidence,
    }));
  }

  await writeControlRequest(handoff, 'persona-materialize-request.json', {
    scenarioId: scenario.scenario_id,
    streamId: streamB.stream_id,
  });
  const personaAck = await waitForControlJson(handoff, 'persona-materialize-complete.json');
  assert.equal(personaAck.ok, true);
  const updatedHandoff = JSON.parse(await readFile(process.env.NIMI_LOCAL_AGENT_PRODUCT_HANDOFF_PATH, 'utf8'));
  const agentB = updatedHandoff.agents.find((agent) => agent.sourceKind === 'realmPersona');
  assert.ok(agentB, 'conversation report requires the once-materialized RealmPersona-source LocalAgent B');
  assert.notEqual(agentB.localAgentRef, targetAgent.localAgentRef, 'LocalAgent A/B identities must be opaque and distinct');
  lifecycleEvents.push(timelineEvent('materialize-local-agent-b', 'materialization', streamB.stream_id, agentB, null, {
    materializationCount: 1,
  }));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForEvidence(page, () => globalThis.window.__nimiZhiyuEvidence?.runtime?.ready === true
    && globalThis.window.__nimiZhiyuEvidence?.inventory?.count === 2, 'conversation report two-LocalAgent inventory');
  await selectLocalAgent(page, agentB.localAgentRef, waitForEvidence);
  lifecycleEvents.push(timelineEvent('switch-to-stream-b', 'agent_switch', streamB.stream_id, agentB, null));

  let anchorB = '';
  for (const declaredTurn of streamB.turns.slice(0, 7)) {
    const captured = await executeDeclaredTurn({
      page, pageProblems, handoff: updatedHandoff, declaredTurn, stream: streamB, agent: agentB,
      expectedAnchorId: anchorB, waitForEvidence,
    });
    anchorB ||= captured.conversationAnchorId;
    turns.push(captured);
  }
  assert.notEqual(anchorB, anchorA, 'LocalAgent A/B Runtime conversation anchors must be distinct');

  await selectLocalAgent(page, targetAgent.localAgentRef, waitForEvidence);
  lifecycleEvents.push(timelineEvent('switch-back-to-stream-a', 'agent_switch', streamA.stream_id, targetAgent, anchorA));
  turns.push(await executeDeclaredTurn({
    page, pageProblems, handoff: updatedHandoff, declaredTurn: streamA.turns[7], stream: streamA,
    agent: targetAgent, expectedAnchorId: anchorA, waitForEvidence,
  }));
  await selectLocalAgent(page, agentB.localAgentRef, waitForEvidence);
  turns.push(await executeDeclaredTurn({
    page, pageProblems, handoff: updatedHandoff, declaredTurn: streamB.turns[7], stream: streamB,
    agent: agentB, expectedAnchorId: anchorB, waitForEvidence,
  }));
  lifecycleEvents.push(timelineEvent('cross-agent-isolation', 'cross_agent_isolation', null, null, null));

  await writeControlRequest(updatedHandoff, 'runtime-restart-request.json', { scenarioId: scenario.scenario_id });
  const restartAck = await waitForControlJson(updatedHandoff, 'runtime-restart-complete.json');
  assert.equal(restartAck.localAgentCount, 2);
  lifecycleEvents.push(timelineEvent('runtime-restart', 'runtime_restart', null, null, null, {
    runtimeStartCount: 2,
  }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForEvidence(page, () => globalThis.window.__nimiZhiyuEvidence?.runtime?.ready === true
    && globalThis.window.__nimiZhiyuEvidence?.inventory?.count === 2, 'conversation report Runtime restart recovery');

  await selectLocalAgent(page, targetAgent.localAgentRef, waitForEvidence);
  turns.push(await executeDeclaredTurn({
    page, pageProblems, handoff: updatedHandoff, declaredTurn: streamA.turns[8], stream: streamA,
    agent: targetAgent, expectedAnchorId: anchorA, waitForEvidence,
  }));
  lifecycleEvents.push(timelineEvent('post-restart-stream-a', 'post_restart_turn', streamA.stream_id, targetAgent, anchorA));
  await selectLocalAgent(page, agentB.localAgentRef, waitForEvidence);
  turns.push(await executeDeclaredTurn({
    page, pageProblems, handoff: updatedHandoff, declaredTurn: streamB.turns[8], stream: streamB,
    agent: agentB, expectedAnchorId: anchorB, waitForEvidence,
  }));
  lifecycleEvents.push(timelineEvent('post-restart-stream-b', 'post_restart_turn', streamB.stream_id, agentB, anchorB));

  await writeControlRequest(updatedHandoff, 'realm-offline-request.json', { scenarioId: scenario.scenario_id });
  const offlineAck = await waitForControlJson(updatedHandoff, 'realm-offline-complete.json');
  assert.equal(offlineAck.restOnline, false);
  lifecycleEvents.push(timelineEvent('realm-offline', 'realm_offline', null, null, null, { restOnline: false }));

  await selectLocalAgent(page, targetAgent.localAgentRef, waitForEvidence);
  turns.push(await executeDeclaredTurn({
    page, pageProblems, handoff: updatedHandoff, declaredTurn: streamA.turns[9], stream: streamA,
    agent: targetAgent, expectedAnchorId: anchorA, waitForEvidence,
  }));
  lifecycleEvents.push(timelineEvent('post-offline-stream-a', 'post_offline_turn', streamA.stream_id, targetAgent, anchorA));
  await selectLocalAgent(page, agentB.localAgentRef, waitForEvidence);
  turns.push(await executeDeclaredTurn({
    page, pageProblems, handoff: updatedHandoff, declaredTurn: streamB.turns[9], stream: streamB,
    agent: agentB, expectedAnchorId: anchorB, waitForEvidence,
  }));
  lifecycleEvents.push(timelineEvent('post-offline-stream-b', 'post_offline_turn', streamB.stream_id, agentB, anchorB));

  await writeControlRequest(updatedHandoff, 'realm-online-request.json', { cleanupAfterOfflineProof: true });
  await waitForControlJson(updatedHandoff, 'realm-online-complete.json');
  const summaryPath = process.env.NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_SUMMARY_PATH;
  if (!summaryPath) throw new Error('conversation-report-baseline requires NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_SUMMARY_PATH');
  await writeFile(summaryPath, `${JSON.stringify({
    schemaVersion: 'nimi.local-agent-conversation-report-zhiyu-summary/v1',
    scenarioId: scenario.scenario_id,
    ownerAccountId: handoff.ownerUserId,
    agents: [
      { ...targetAgent, sourceKind: 'worldCharacter', conversationAnchorId: anchorA },
      { ...agentB, sourceKind: 'realmPersona', conversationAnchorId: anchorB },
    ],
    turns,
    lifecycleEvents,
    pageProblems,
    executionStatus: conversationReportExecutionStatus(turns),
  }, null, 2)}\n`);
}
