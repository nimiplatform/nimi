import assert from 'node:assert/strict';
import test from 'node:test';

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
  };
}

test('agent diagnostics view model shows empty state before any completed turn', () => {
  const viewModel = buildAgentDiagnosticsViewModel({
    activeTarget: sampleTarget(),
    lifecycle: baseLifecycle(),
    routeReady: true,
    t,
    targetsPending: false,
  });

  assert.equal(viewModel.runtimeCard.value, 'Runtime ready');
  assert.equal(viewModel.turnCards.length, 0);
  assert.equal(viewModel.emptyLabel, 'No recent agent turn diagnostics yet.');
});

test('agent diagnostics view model shows recovered turn details', () => {
  const viewModel = buildAgentDiagnosticsViewModel({
    activeTarget: sampleTarget(),
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
        classification: 'json-fenced',
        recoveryPath: 'strip-fence',
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
        requestPrompt: 'UserMessage:\n你好',
        requestSystemPrompt: 'Preset:\nBe warm.',
        rawModelOutputText: '```json\n{"schemaId":"nimi.agent.chat.message-action.v1"}\n```',
        normalizedModelOutputText: '{"schemaId":"nimi.agent.chat.message-action.v1"}',
      },
    },
    routeReady: true,
    t,
    targetsPending: false,
  });

  assert.equal(viewModel.emptyLabel, null);
  assert.equal(viewModel.turnCards[0]?.label, 'Last Turn');
  assert.equal(viewModel.turnCards[0]?.value, 'Recovered');
  assert.match(viewModel.turnCards[0]?.detail || '', /classification=json-fenced/);
  assert.equal(viewModel.turnCards[1]?.value, 'trace-recovered');
  assert.match(viewModel.turnCards[2]?.detail || '', /inputTokens=18/);
  assert.equal(viewModel.turnCards[3]?.value, 'json-fenced');
  assert.match(viewModel.turnCards[4]?.detail || '', /maxOutputTokensRequested=512/);
  assert.equal(viewModel.turnCards[5]?.label, 'Prompt');
  assert.match(viewModel.turnCards[5]?.detail || '', /UserMessage:/);
  assert.equal(viewModel.turnCards[6]?.label, 'Returned Data');
  assert.match(viewModel.turnCards[6]?.detail || '', /schemaId/);
});

test('agent diagnostics view model shows truncation diagnostics for failed turns', () => {
  const viewModel = buildAgentDiagnosticsViewModel({
    activeTarget: sampleTarget(),
    lifecycle: {
      ...baseLifecycle(),
      terminal: 'failed',
      traceId: 'trace-partial',
      promptTraceId: 'prompt-partial',
      error: {
        code: 'AGENT_OUTPUT_INVALID',
        message: 'Agent response was truncated before the structured reply completed.',
      },
      usage: {
        inputTokens: 40,
        outputTokens: 41,
      },
      diagnostics: {
        classification: 'partial-json',
        recoveryPath: 'none',
        suspectedTruncation: true,
        parseErrorDetail: "Expected '}'",
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
        requestPrompt: 'UserMessage:\n继续说',
        requestSystemPrompt: 'Preset:\nStay concise.',
        rawModelOutputText: '{"schemaId":"nimi.agent.chat.message-action.v1"',
        normalizedModelOutputText: '{"schemaId":"nimi.agent.chat.message-action.v1"',
      },
    },
    routeReady: true,
    t,
    targetsPending: false,
  });

  assert.equal(viewModel.emptyLabel, null);
  assert.equal(viewModel.turnCards[0]?.value, 'Suspected truncation');
  assert.match(viewModel.turnCards[0]?.detail || '', /truncated/i);
  assert.equal(viewModel.turnCards[2]?.value, 'length');
  assert.match(viewModel.turnCards[3]?.detail || '', /parseError=Expected '\}'/);
  assert.match(viewModel.turnCards[4]?.detail || '', /promptOverflow=true/);
  assert.equal(viewModel.turnCards[5]?.label, 'Prompt');
  assert.equal(viewModel.turnCards[6]?.label, 'Returned Data');
});

test('agent diagnostics view model shows image execution diagnostics when present', () => {
  const viewModel = buildAgentDiagnosticsViewModel({
    activeTarget: sampleTarget(),
    lifecycle: {
      ...baseLifecycle(),
      terminal: 'completed',
      diagnostics: {
        classification: 'strict-json',
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
    routeReady: true,
    t,
    targetsPending: false,
  });

  const imageCard = viewModel.turnCards.find((card) => card.label === 'Image Path');
  assert.equal(imageCard?.value, 'Serialized queue');
  assert.match(imageCard?.detail || '', /imageLoadMs=1200/);
  assert.match(imageCard?.detail || '', /queueSerialized=true/);
  assert.match(imageCard?.detail || '', /profileOverrideSampler=euler/);
});
