import { invokeModLlm } from './invoke-text';
import type { ExecuteLocalKernelTurnInput, ExecuteLocalKernelTurnResult } from './types';
import { buildLocalId, estimateTokens } from './utils';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { createOfflineError, getOfflineCoordinator } from '@runtime/offline';

export async function executeLocalKernelTurn(input: ExecuteLocalKernelTurnInput): Promise<ExecuteLocalKernelTurnResult> {
  if (getOfflineCoordinator().getTier() === 'L2') {
    throw createOfflineError({
      source: 'runtime',
      reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      message: 'Runtime unavailable. Local kernel execution is disabled in read-only mode.',
      actionHint: 'retry-runtime-when-online',
    });
  }
  const prompt = [
    `世界: ${input.worldId || 'unknown-world'}`,
    `智能体: ${input.agentId || 'unknown-agent'}`,
    `模式: ${input.mode}`,
    `回合: ${input.turnIndex}`,
    `用户输入: ${input.userInputText}`,
    '请用简洁中文回复，并保持叙事连续性。',
  ].join('\n');
  const result = await invokeModLlm({
    modId: 'core.kernel',
    provider: input.provider,
    prompt,
    mode: input.mode === 'SCENE_TURN' ? 'SCENE_TURN' : 'STORY',
    worldId: input.worldId,
    agentId: input.agentId,
    localProviderEndpoint: input.localProviderEndpoint,
    localProviderModel: input.localProviderModel,
    localOpenAiEndpoint: input.localOpenAiEndpoint,
    connectorId: input.connectorId,
    fetchImpl: input.fetchImpl,
  });
  const assistantText = String(result.text || '').trim();
  const tokenRequested = estimateTokens(prompt);
  const tokenActual = estimateTokens(assistantText);
  return {
    requestId: input.requestId,
    sessionId: input.sessionId,
    turnIndex: input.turnIndex,
    assistantMessage: {
      text: assistantText,
      style: input.mode === 'STORY' ? 'narration' : 'mixed',
    },
    sceneCards:
      input.mode === 'SCENE_TURN'
        ? [{ type: 'text', content: assistantText }]
        : undefined,
    stateDelta: {
      narrativeDelta: [`回合 ${input.turnIndex}: ${input.userInputText}`],
      storyDelta: input.mode === 'STORY' ? {
        lastInput: input.userInputText,
        lastAssistant: assistantText,
        turnIndex: input.turnIndex,
      } : undefined,
      sceneDelta: input.mode === 'SCENE_TURN' ? {
        lastInput: input.userInputText,
        lastAssistant: assistantText,
        turnIndex: input.turnIndex,
      } : undefined,
      memoryWrites: [buildLocalId('memory:core'), buildLocalId('memory:working')],
    },
    ruleDecisions: [{
      ruleId: 'runtimeLlmAdapter',
      decision: 'ALLOW',
      reason: 'executed via llm-adapter runtime',
    }],
    promptTraceId: result.promptTraceId,
    auditEventIds: [buildLocalId('audit')],
    nextActions: [{
      id: `continue-${input.turnIndex + 1}`,
      label: '继续',
      kind: 'free_input',
    }],
    localOnly: true,
    localPromptTrace: {
      id: result.promptTraceId,
      sourceSegments: [],
      tokenRequested,
      tokenActual,
      droppedSegments: [],
      conflictResolutions: [],
      decision: 'ALLOW',
      decisionReason: 'runtime llm-adapter invoke',
    },
    localAuditEvents: [{
      id: buildLocalId('audit-event'),
      turnIndex: input.turnIndex,
      eventType: 'LOCAL_PROVIDER_EXECUTED',
      reasonCode: ReasonCode.LOCAL_ONLY_NOT_SYNCED,
      detail: {
        provider: input.provider,
        model: input.localProviderModel || '',
      },
    }],
  };
}
