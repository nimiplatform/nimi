import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildAgentDiagnosticsViewModel } from '../src/shell/renderer/features/chat/chat-agent-diagnostics-view-model.js';
import type { AgentTurnLifecycleState } from '../src/shell/renderer/features/chat/chat-agent-shell-lifecycle.js';

const t = (_key: string, options?: { defaultValue?: string }) => options?.defaultValue || _key;

function sampleTarget() {
  return {
    agentId: 'agent-1',
    displayName: 'Companion',
    handle: '~companion',
    avatarUrl: null,
    worldId: 'world-1',
    worldName: 'World One',
    bio: 'Helpful companion',
    ownershipType: 'WORLD_OWNED' as const,
  };
}

function baseLifecycle(): AgentTurnLifecycleState {
  return {
    projectionVersion: null,
    terminal: 'running',
    outputText: '',
    reasoningText: '',
    traceId: null,
    promptTraceId: null,
    error: null,
    usage: undefined,
    diagnostics: null,
    runtimeAgentTurns: null,
  };
}

function baseInput() {
  return {
    activeTarget: sampleTarget(),
    routeReady: true,
    recentRuntimeEvents: [],
    runtimeInspect: null,
    runtimeInspectLoading: false,
    t,
    targetsPending: false,
  };
}

async function loadAgentDiagnosticsPanel() {
  Object.defineProperty(globalThis, 'React', {
    value: React,
    configurable: true,
  });
  const module = await import('../src/shell/renderer/features/chat/chat-agent-diagnostics.js');
  return module.AgentDiagnosticsPanel;
}

test('agent diagnostics view model shows empty state before any completed turn', () => {
  const viewModel = buildAgentDiagnosticsViewModel({
    ...baseInput(),
    lifecycle: baseLifecycle(),
  });

  assert.equal(viewModel.runtimeCard.value, 'Runtime ready');
  assert.equal(viewModel.stateCards.length, 0);
  assert.equal(viewModel.turnCards.length, 0);
  assert.equal(viewModel.emptyLabel, 'No recent agent turn diagnostics yet.');
});

test('agent diagnostics view model shows strict APML turn details', () => {
  const viewModel = buildAgentDiagnosticsViewModel({
    ...baseInput(),
    lifecycle: {
      ...baseLifecycle(),
      terminal: 'completed',
      traceId: 'trace-recovered',
      promptTraceId: 'prompt-recovered',
      usage: {
        inputTokens: 18,
        outputTokens: 22,
      },
      diagnostics: {
        classification: 'strict-apml',
        recoveryPath: 'none',
        suspectedTruncation: false,
        parseErrorDetail: null,
        rawOutputChars: 120,
        normalizedOutputChars: 118,
        finishReason: 'stop',
        traceId: 'trace-recovered',
        promptTraceId: 'prompt-recovered',
        usage: {
          inputTokens: 18,
          outputTokens: 22,
        },
        contextWindowSource: 'route-profile',
        maxOutputTokensRequested: 512,
        promptOverflow: false,
        requestPrompt: 'Messages:\n[\n  {\n    "role": "user",\n    "content": "你好"\n  }\n]',
        requestSystemPrompt: 'Preset:\nBe warm.',
        rawModelOutputText: '<message id="message-0">你好</message>',
        normalizedModelOutputText: '<message id="message-0">你好</message>',
        chainId: null,
        followUpDepth: null,
        maxFollowUpTurns: null,
        followUpCanceledByUser: false,
        followUpSourceActionId: null,
      },
    },
  });

  assert.equal(viewModel.emptyLabel, null);
  assert.equal(viewModel.turnCards[0]?.label, 'Last Turn');
  assert.equal(viewModel.turnCards[0]?.value, 'Completed');
  assert.match(viewModel.turnCards[0]?.detail || '', /classification=strict-apml/);
  assert.equal(viewModel.turnCards[1]?.value, 'trace-recovered');
  assert.match(viewModel.turnCards[2]?.detail || '', /Input: 18 tokens/);
  assert.equal(viewModel.turnCards[3]?.value, 'strict-apml');
  assert.equal(viewModel.turnCards[4]?.label, 'Context');
  assert.equal(viewModel.turnCards[4]?.value, 'Model profile');
  assert.match(viewModel.turnCards[4]?.detail || '', /Max output: 512 tokens/);
  assert.equal(viewModel.turnCards[5]?.label, 'Prompt');
  assert.match(viewModel.turnCards[5]?.detail || '', /Messages:/);
  assert.equal(viewModel.turnCards[6]?.label, 'Returned Data');
  assert.match(viewModel.turnCards[6]?.detail || '', /<message id="message-0">/);
});

test('agent diagnostics view model shows truncation diagnostics for failed turns', () => {
  const viewModel = buildAgentDiagnosticsViewModel({
    ...baseInput(),
    lifecycle: {
      ...baseLifecycle(),
      terminal: 'failed',
      traceId: 'trace-partial',
      promptTraceId: 'prompt-partial',
      error: {
        code: 'AGENT_OUTPUT_INVALID',
        message: [
          'Agent response was truncated before the structured reply completed.',
          '',
          'Partial output:',
          '<message id="message-0"',
        ].join('\n'),
      },
      usage: {
        inputTokens: 40,
        outputTokens: 41,
      },
      diagnostics: {
        classification: 'partial-apml',
        recoveryPath: 'none',
        suspectedTruncation: true,
        parseErrorDetail: 'APML message missing </message>',
        rawOutputChars: 84,
        normalizedOutputChars: 84,
        finishReason: 'length',
        traceId: 'trace-partial',
        promptTraceId: 'prompt-partial',
        usage: {
          inputTokens: 40,
          outputTokens: 41,
        },
        contextWindowSource: 'route-profile',
        maxOutputTokensRequested: 111,
        promptOverflow: true,
        requestPrompt: 'Messages:\n[\n  {\n    "role": "user",\n    "content": "继续说"\n  }\n]',
        requestSystemPrompt: 'Preset:\nStay concise.',
        rawModelOutputText: '<message id="message-0"',
        normalizedModelOutputText: '<message id="message-0"',
        chainId: null,
        followUpDepth: null,
        maxFollowUpTurns: null,
        followUpCanceledByUser: false,
        followUpSourceActionId: null,
      },
    },
  });

  assert.equal(viewModel.emptyLabel, null);
  assert.equal(viewModel.turnCards[0]?.value, 'Suspected truncation');
  assert.match(viewModel.turnCards[0]?.detail || '', /truncated/i);
  assert.match(viewModel.turnCards[0]?.detail || '', /Partial output:/);
  assert.match(viewModel.turnCards[0]?.detail || '', /<message id="message-0"/);
  assert.equal(viewModel.turnCards[2]?.value, 'Reached token limit');
  assert.match(viewModel.turnCards[3]?.detail || '', /parseError=APML message missing <\/message>/);
  assert.equal(viewModel.turnCards[4]?.value, 'Context limit exceeded');
  assert.match(viewModel.turnCards[4]?.detail || '', /Max output: 111 tokens/);
  assert.match(viewModel.turnCards[4]?.detail || '', /The prompt exceeded the available context window\./);
  assert.equal(viewModel.turnCards[5]?.label, 'Prompt');
  assert.equal(viewModel.turnCards[6]?.label, 'Returned Data');
});

test('agent diagnostics view model shows preflight rejection diagnostics for local prompt overflow failures', () => {
  const viewModel = buildAgentDiagnosticsViewModel({
    ...baseInput(),
    lifecycle: {
      ...baseLifecycle(),
      terminal: 'failed',
      error: {
        code: 'AI_INPUT_INVALID',
        message: 'Agent request exceeds the available input budget after prompt reduction.',
      },
      diagnostics: {
        classification: 'preflight-rejected',
        recoveryPath: 'none',
        suspectedTruncation: false,
        parseErrorDetail: 'Agent request exceeds the available input budget after prompt reduction.',
        rawOutputChars: 0,
        normalizedOutputChars: 0,
        finishReason: null,
        traceId: null,
        promptTraceId: null,
        usage: null,
        contextWindowSource: 'route-profile',
        maxOutputTokensRequested: 111,
        promptOverflow: true,
        requestPrompt: 'Messages:\n[\n  {\n    "role": "user",\n    "content": "继续说"\n  }\n]',
        requestSystemPrompt: 'Preset:\nStay concise.',
        rawModelOutputText: null,
        normalizedModelOutputText: null,
        chainId: null,
        followUpDepth: null,
        maxFollowUpTurns: null,
        followUpCanceledByUser: false,
        followUpSourceActionId: null,
        preflight: {
          totalInputTokens: 820,
          promptBudgetTokens: 512,
          systemTokens: 120,
          historyTokens: 220,
          userTokens: 480,
        },
      },
    },
  });

  assert.equal(viewModel.turnCards[0]?.value, 'Failed');
  assert.match(viewModel.turnCards[0]?.detail || '', /available input budget/i);
  assert.equal(viewModel.turnCards[3]?.value, 'preflight-rejected');
  assert.equal(viewModel.turnCards[4]?.value, 'Context limit exceeded');
  assert.match(viewModel.turnCards[4]?.detail || '', /Prompt: 820 \/ 512 tokens/);
  assert.match(viewModel.turnCards[4]?.detail || '', /System: 120 tokens/);
  assert.match(viewModel.turnCards[4]?.detail || '', /History: 220 tokens/);
  assert.match(viewModel.turnCards[4]?.detail || '', /User: 480 tokens/);
  assert.equal(viewModel.turnCards[5]?.label, 'Prompt');
  assert.equal(viewModel.turnCards[6], undefined);
});

test('agent diagnostics view model shows image execution diagnostics when present', () => {
  const viewModel = buildAgentDiagnosticsViewModel({
    ...baseInput(),
    lifecycle: {
      ...baseLifecycle(),
      terminal: 'completed',
      diagnostics: {
        classification: 'strict-apml',
        recoveryPath: 'none',
        suspectedTruncation: false,
        parseErrorDetail: null,
        rawOutputChars: 88,
        normalizedOutputChars: 88,
        finishReason: 'stop',
        traceId: 'trace-image-diag',
        promptTraceId: 'prompt-image-diag',
        usage: null,
        contextWindowSource: 'route-profile',
        maxOutputTokensRequested: 512,
        promptOverflow: false,
        requestPrompt: null,
        requestSystemPrompt: null,
        rawModelOutputText: null,
        normalizedModelOutputText: null,
        chainId: null,
        followUpDepth: null,
        maxFollowUpTurns: null,
        followUpCanceledByUser: false,
        followUpSourceActionId: null,
        image: {
          textPlanningMs: 320,
          imageJobSubmitMs: 45,
          imageLoadMs: 1200,
          imageGenerateMs: 5400,
          artifactHydrateMs: 30,
          queueWaitMs: 260,
          loadCacheHit: false,
          residentReused: false,
          residentRestarted: true,
          queueSerialized: true,
          profileOverrideStep: 25,
          profileOverrideCfgScale: 6,
          profileOverrideSampler: 'euler',
          profileOverrideScheduler: 'karras',
        },
      },
    },
  });

  const imageCard = viewModel.turnCards.find((card) => card.label === 'Image Path');
  assert.equal(imageCard?.value, 'Serialized queue');
  assert.match(imageCard?.detail || '', /imageLoadMs=1200/);
  assert.match(imageCard?.detail || '', /queueSerialized=true/);
  assert.match(imageCard?.detail || '', /profileOverrideSampler=euler/);
});

test('agent diagnostics view model shows follow-up chain diagnostics when present', () => {
  const viewModel = buildAgentDiagnosticsViewModel({
    ...baseInput(),
    lifecycle: {
      ...baseLifecycle(),
      terminal: 'completed',
      diagnostics: {
        classification: 'strict-apml',
        recoveryPath: 'none',
        suspectedTruncation: false,
        parseErrorDetail: null,
        rawOutputChars: 42,
        normalizedOutputChars: 42,
        finishReason: 'stop',
        traceId: 'trace-follow-up-chain',
        promptTraceId: 'prompt-follow-up-chain',
        usage: null,
        contextWindowSource: 'route-profile',
        maxOutputTokensRequested: 256,
        promptOverflow: false,
        requestPrompt: null,
        requestSystemPrompt: null,
        rawModelOutputText: null,
        normalizedModelOutputText: null,
        chainId: 'chain-1',
        followUpDepth: 2,
        maxFollowUpTurns: 8,
        followUpCanceledByUser: false,
        followUpSourceActionId: 'action-follow-up-2',
      },
    },
  });

  const chainCard = viewModel.turnCards.find((card) => card.label === 'Follow-up Chain');
  assert.equal(chainCard?.value, '2/8');
  assert.match(chainCard?.detail || '', /chainId=chain-1/);
  assert.match(chainCard?.detail || '', /sourceActionId=action-follow-up-2/);
});

test('agent diagnostics view model shows runtime turn evidence when lifecycle carries runtime.agent.turns anchor state', () => {
  const viewModel = buildAgentDiagnosticsViewModel({
    ...baseInput(),
    lifecycle: {
      ...baseLifecycle(),
      terminal: 'completed',
      traceId: 'trace-runtime-chat',
      promptTraceId: 'trace-runtime-chat',
      runtimeAgentTurns: {
        transport: 'runtime.agent.turns',
        conversationAnchorId: 'anchor-runtime-1',
        runtimeTurnId: 'runtime-turn-1',
        runtimeStreamId: 'runtime-stream-1',
        route: 'local',
        modelId: 'kimi-k2',
        connectorId: null,
      },
      diagnostics: {
        classification: 'strict-apml',
        recoveryPath: 'none',
        suspectedTruncation: false,
        parseErrorDetail: null,
        rawOutputChars: 42,
        normalizedOutputChars: 42,
        finishReason: 'stop',
        traceId: 'trace-runtime-chat',
        promptTraceId: 'trace-runtime-chat',
        usage: null,
        contextWindowSource: 'route-profile',
        maxOutputTokensRequested: 256,
        promptOverflow: false,
        requestPrompt: null,
        requestSystemPrompt: null,
        rawModelOutputText: null,
        normalizedModelOutputText: null,
        chainId: null,
        followUpDepth: null,
        maxFollowUpTurns: null,
        followUpCanceledByUser: false,
        followUpSourceActionId: null,
      },
    },
  });

  const runtimeChatCard = viewModel.turnCards.find((card) => card.label === 'Runtime Anchor');
  assert.equal(runtimeChatCard?.value, 'anchor-runtime-1');
  assert.match(runtimeChatCard?.detail || '', /runtimeTurnId=runtime-turn-1/);
  assert.match(runtimeChatCard?.detail || '', /runtimeStreamId=runtime-stream-1/);
  assert.match(runtimeChatCard?.detail || '', /route=local/);
  assert.match(runtimeChatCard?.detail || '', /modelId=kimi-k2/);
});

test('agent diagnostics view model shows runtime agent state and pending hook inspect when available', () => {
  const viewModel = buildAgentDiagnosticsViewModel({
    ...baseInput(),
    lifecycle: baseLifecycle(),
    runtimeInspect: {
      lifecycleStatus: 'active',
      executionState: 'life-pending',
      statusText: 'waiting to follow up',
      activeWorldId: 'world-1',
      activeUserId: 'user-1',
      autonomyMode: 'medium',
      autonomyEnabled: true,
      autonomyBudgetExhausted: false,
      autonomyUsedTokensInWindow: 88,
      autonomyDailyTokenBudget: 400,
      autonomyMaxTokensPerHook: 120,
      autonomyWindowStartedAt: '2026-04-14T00:00:00.000Z',
      autonomySuspendedUntil: null,
      pendingHooksCount: 2,
      nextScheduledFor: '2026-04-14T03:00:00.000Z',
      pendingHooks: [
        {
          hookId: 'hook-1',
          status: 'pending',
          triggerKind: 'scheduled-time',
          scheduledFor: '2026-04-14T03:00:00.000Z',
        },
        {
          hookId: 'hook-2',
          status: 'pending',
          triggerKind: 'turn-completed',
          scheduledFor: null,
        },
      ],
      recentTerminalHooks: [
        {
          hookId: 'hook-completed-1',
          status: 'completed',
          triggerKind: 'turn-completed',
          scheduledFor: '2026-04-14T02:50:00.000Z',
          admittedAt: '2026-04-14T03:10:00.000Z',
        },
      ],
      recentCanonicalMemories: [
        {
          memoryId: 'mem-dyadic-1',
          canonicalClass: 'dyadic',
          kind: 'observational',
          summary: 'user prefers jasmine tea',
          updatedAt: '2026-04-14T03:12:00.000Z',
          sourceEventId: 'turn-dyadic-1',
          policyReason: 'query_agent_memory_history',
          recallScore: 0,
        },
      ],
    },
  });

  assert.equal(viewModel.stateCards.length, 5);
  const agentStateCard = viewModel.stateCards.find((card) => card.label === 'Agent State');
  assert.equal(agentStateCard?.value, 'waiting to follow up');
  assert.match(agentStateCard?.detail || '', /lifecycle=active/);
  assert.match(agentStateCard?.detail || '', /executionState=life-pending/);
  const autonomyCard = viewModel.stateCards.find((card) => card.label === 'Autonomy');
  assert.equal(autonomyCard?.value, 'Enabled');
  assert.match(autonomyCard?.detail || '', /mode=medium/);
  assert.match(autonomyCard?.detail || '', /usedTokensInWindow=88/);
  assert.match(autonomyCard?.detail || '', /dailyTokenBudget=400/);
  const hooksCard = viewModel.stateCards.find((card) => card.label === 'Pending Hooks');
  assert.equal(hooksCard?.value, '2');
  assert.match(hooksCard?.detail || '', /nextScheduledFor=2026-04-14T03:00:00.000Z/);
  assert.match(hooksCard?.detail || '', /hook-1 · pending · scheduled-time/);
  const terminalHistoryCard = viewModel.stateCards.find((card) => card.label === 'Terminal Hook History');
  assert.equal(terminalHistoryCard?.value, 'completed');
  assert.match(terminalHistoryCard?.detail || '', /hook-completed-1 · completed/);
  const memoryCard = viewModel.stateCards.find((card) => card.label === 'Recent Memory');
  assert.equal(memoryCard?.value, 'dyadic');
  assert.match(memoryCard?.detail || '', /mem-dyadic-1 · dyadic · observational · user prefers jasmine tea/);
  assert.equal(viewModel.turnCards.length, 0);
  assert.equal(viewModel.emptyLabel, 'No recent agent turn diagnostics yet.');
});

test('agent diagnostics view model shows recent runtime events and hook history when available', () => {
  const viewModel = buildAgentDiagnosticsViewModel({
    ...baseInput(),
    lifecycle: baseLifecycle(),
    recentRuntimeEvents: [
      {
        agentId: 'agent-1',
        eventType: 2,
        eventTypeLabel: 'hook',
        sequence: '17',
        detailKind: 'hook',
        timestamp: '2026-04-14T03:00:00.000Z',
        summaryText: 'hook-1 · completed',
        hookId: 'hook-1',
        hookStatus: 'completed',
        lifecycleStatus: null,
        budgetExhausted: null,
        remainingTokens: null,
      },
      {
        agentId: 'agent-1',
        eventType: 3,
        eventTypeLabel: 'memory',
        sequence: '18',
        detailKind: 'memory',
        timestamp: '2026-04-14T03:05:00.000Z',
        summaryText: 'accepted=1 · rejected=0',
        hookId: null,
        hookStatus: null,
        lifecycleStatus: null,
        budgetExhausted: null,
        remainingTokens: null,
      },
      {
        agentId: 'agent-1',
        eventType: 5,
        eventTypeLabel: 'replication',
        sequence: '19',
        detailKind: 'replication',
        timestamp: '2026-04-14T03:06:00.000Z',
        summaryText: 'mem-dyadic-1 · synced',
        hookId: null,
        hookStatus: null,
        lifecycleStatus: null,
        budgetExhausted: null,
        remainingTokens: null,
      },
    ],
  });

  const recentEventsCard = viewModel.stateCards.find((card) => card.label === 'Recent Events');
  assert.equal(recentEventsCard?.value, 'hook');
  assert.match(recentEventsCard?.detail || '', /#17 · hook · hook-1 · completed/);
  assert.match(recentEventsCard?.detail || '', /#18 · memory · accepted=1 · rejected=0/);
  assert.match(recentEventsCard?.detail || '', /#19 · replication · mem-dyadic-1 · synced/);
  const hookHistoryCard = viewModel.stateCards.find((card) => card.label === 'Recent Hook Outcomes');
  assert.equal(hookHistoryCard?.value, 'completed');
  assert.match(hookHistoryCard?.detail || '', /hook-1 · completed/);
});

test('agent diagnostics panel renders runtime control actions when inspect data is available', async () => {
  const AgentDiagnosticsPanel = await loadAgentDiagnosticsPanel();
  const markup = renderToStaticMarkup(
    React.createElement(AgentDiagnosticsPanel, {
      activeTarget: sampleTarget(),
      lifecycle: baseLifecycle(),
      mutationPendingAction: null,
      onCancelHook: () => undefined,
      onClearDyadicContext: () => undefined,
      onClearWorldContext: () => undefined,
      onDisableAutonomy: () => undefined,
      onEnableAutonomy: () => undefined,
      onUpdateAutonomyConfig: () => undefined,
      onUpdateRuntimeState: () => undefined,
      recentRuntimeEvents: [{
        agentId: 'agent-1',
        eventType: 2,
        eventTypeLabel: 'hook',
        sequence: '17',
        detailKind: 'hook',
        timestamp: '2026-04-14T03:00:00.000Z',
        summaryText: 'hook-1 · pending',
        hookId: 'hook-1',
        hookStatus: 'pending',
        lifecycleStatus: null,
        budgetExhausted: null,
        remainingTokens: null,
      }],
      routeReady: true,
      runtimeInspect: {
        lifecycleStatus: 'active',
        executionState: 'life-pending',
        statusText: 'waiting to follow up',
        activeWorldId: 'world-1',
        activeUserId: 'user-1',
        autonomyMode: 'medium',
        autonomyEnabled: true,
        autonomyBudgetExhausted: false,
        autonomyUsedTokensInWindow: 88,
        autonomyDailyTokenBudget: 400,
        autonomyMaxTokensPerHook: 120,
        autonomyWindowStartedAt: '2026-04-14T00:00:00.000Z',
        autonomySuspendedUntil: null,
        pendingHooksCount: 1,
        nextScheduledFor: '2026-04-14T03:00:00.000Z',
        pendingHooks: [{
          hookId: 'hook-1',
          status: 'pending',
          triggerKind: 'scheduled-time',
          scheduledFor: '2026-04-14T03:00:00.000Z',
        }, {
          hookId: 'hook-2',
          status: 'running',
          triggerKind: 'turn-completed',
          scheduledFor: null,
        }],
        recentTerminalHooks: [{
          hookId: 'hook-completed-1',
          status: 'completed',
          triggerKind: 'turn-completed',
          scheduledFor: '2026-04-14T02:50:00.000Z',
          admittedAt: '2026-04-14T03:10:00.000Z',
        }],
        recentCanonicalMemories: [{
          memoryId: 'mem-dyadic-1',
          canonicalClass: 'dyadic',
          kind: 'observational',
          summary: 'user prefers jasmine tea',
          updatedAt: '2026-04-14T03:12:00.000Z',
          sourceEventId: 'turn-dyadic-1',
          policyReason: 'query_agent_memory_history',
          recallScore: 0,
        }],
      },
      runtimeInspectLoading: false,
      onRefreshInspect: () => undefined,
      t,
      targetsPending: false,
    }),
  );

  assert.match(markup, /Refresh inspect/u);
  assert.match(markup, /Apply runtime state/u);
  assert.match(markup, /Clear world context/u);
  assert.match(markup, /Clear dyadic context/u);
  assert.match(markup, /Status text/u);
  assert.match(markup, /World context/u);
  assert.match(markup, /Dyadic user/u);
  assert.match(markup, /Apply autonomy config/u);
  assert.match(markup, /Daily token budget/u);
  assert.match(markup, /Max tokens per hook/u);
  assert.match(markup, /Disable autonomy/u);
  assert.match(markup, /Avatar Override/u);
  assert.match(markup, /Debug-only override for avatar phase and mood/u);
  assert.match(markup, /Phase/u);
  assert.match(markup, /Mood/u);
  assert.match(markup, /Amplitude/u);
  assert.match(markup, /Apply avatar override/u);
  assert.match(markup, /Clear avatar override/u);
  assert.match(markup, /Cancel hook-1/u);
  assert.match(markup, /Cancel hook-2/u);
  assert.match(markup, /Runtime autonomy is on/u);
  assert.match(markup, /Terminal Hook History/u);
  assert.match(markup, /Recent Memory/u);
  assert.match(markup, /user prefers jasmine tea/u);
  assert.match(markup, /Recent Events/u);
  assert.match(markup, /Recent Hook Outcomes/u);
});
