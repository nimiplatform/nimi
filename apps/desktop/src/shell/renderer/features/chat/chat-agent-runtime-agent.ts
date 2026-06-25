import { createNimiClientId } from '@nimiplatform/sdk';
import {
  createNimiRuntimeAgentTurnsModule,
  runNimiRuntimeAgentTurn,
  type NimiRuntimeAgentExecutionBinding,
} from '@nimiplatform/sdk/runtime';
import { createNimiError, ReasonCode, type JsonObject } from '@nimiplatform/sdk/types';
import {
  parseImageParams,
  resolveImageCompanionSlotsForModelFamily,
} from '@nimiplatform/kit/features/model-config/headless';
import {
  getDesktopRuntimeAgentTurnsRuntime,
  withDesktopRuntimeProtectedScopes,
} from '@renderer/infra/sdk/desktop-nimi-client-session';
import type {
  AgentRuntimeChatTurnRequest,
  AgentRuntimeChatTurnStreamPart,
} from './chat-agent-runtime-turn-types';
import { normalizeText } from './chat-agent-runtime-normalize';
import {
  resolveChatThinkingConfig,
  resolveTextExecutionSnapshotThinkingSupport,
} from './chat-shared-thinking';
import type { ConversationExecutionSnapshot } from './conversation-capability';
import type { AgentRuntimeResolvedBinding } from './chat-agent-runtime-types';
import { resolveExecutionSlice } from './chat-agent-runtime-shared';
import {
  buildRuntimeAgentDiagnostics,
  resolveRuntimeTrace,
  safeLogRuntimeAgentEvent,
  safeLogRuntimeAgentTiming,
  toDebugMetadata,
} from './chat-agent-runtime-agent-utils';

const IMAGE_COMPANION_SLOT_KIND: Record<string, string> = {
  uncond_diffusion_model: 'image',
  vae_path: 'vae',
  llm_path: 'chat',
  clip_l_path: 'clip',
  clip_g_path: 'clip',
  controlnet_path: 'controlnet',
  lora_path: 'lora',
  aux_path: 'auxiliary',
};

function resolveRuntimeAgentTextExecutionBinding(
  request: AgentRuntimeChatTurnRequest,
): NimiRuntimeAgentExecutionBinding {
  const resolved = request.textExecutionSnapshot?.conversationCapabilitySlice
    ?.resolvedTarget as ConversationExecutionSnapshot['resolvedBinding'];
  if (!resolved) {
    throw createNimiError({
      message: 'Runtime Agent text turn requires resolved text.generate binding.',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'select_runtime_route_binding',
      source: 'runtime',
    });
  }
  const route = normalizeText(resolved.source).toLowerCase();
  if (route !== 'local' && route !== 'cloud') {
    throw createNimiError({
      message: `Runtime Agent text turn route is unsupported: ${route || 'missing'}.`,
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'select_runtime_route_binding',
      source: 'runtime',
    });
  }
  const modelId = normalizeText(
    resolved.modelId
      || resolved.model
      || resolved.goRuntimeLocalModelId
      || resolved.localModelId,
  );
  if (!modelId) {
    throw createNimiError({
      message: 'Runtime Agent text turn requires resolved model id.',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'select_runtime_route_binding',
      source: 'runtime',
    });
  }
  return {
    route,
    modelId,
    ...(normalizeText(resolved.connectorId) ? { connectorId: normalizeText(resolved.connectorId) } : {}),
  };
}

function resolveRuntimeAgentImageExecutionBinding(
  request: AgentRuntimeChatTurnRequest,
): NimiRuntimeAgentExecutionBinding | null {
  if (!request.imageExecutionSnapshot) {
    return null;
  }
  const slice = resolveExecutionSlice(request.imageExecutionSnapshot, 'image.generate');
  const resolved = slice.resolvedTarget as AgentRuntimeResolvedBinding;
  return bindingFromResolvedTarget(resolved, 'Runtime Agent image action requires resolved image.generate binding.', 'select_runtime_image_route_binding');
}

function bindingFromResolvedTarget(
  resolved: AgentRuntimeResolvedBinding | ConversationExecutionSnapshot['resolvedBinding'],
  missingMessage: string,
  actionHint: string,
): NimiRuntimeAgentExecutionBinding {
  if (!resolved) {
    throw createNimiError({
      message: missingMessage,
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint,
      source: 'runtime',
    });
  }
  const route = normalizeText(resolved.source).toLowerCase();
  if (route !== 'local' && route !== 'cloud') {
    throw createNimiError({
      message: `Runtime Agent route is unsupported: ${route || 'missing'}.`,
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint,
      source: 'runtime',
    });
  }
  const modelId = normalizeText(
    resolved.modelId
      || resolved.model
      || resolved.goRuntimeLocalModelId
      || resolved.localModelId,
  );
  if (!modelId) {
    throw createNimiError({
      message: 'Runtime Agent execution binding requires resolved model id.',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint,
      source: 'runtime',
    });
  }
  return {
    route,
    modelId,
    ...(normalizeText(resolved.connectorId) ? { connectorId: normalizeText(resolved.connectorId) } : {}),
  };
}

function buildRuntimeAgentImageExecutionParams(
  request: AgentRuntimeChatTurnRequest,
): JsonObject | null {
  if (!request.imageExecutionSnapshot) {
    return null;
  }
  const slice = resolveExecutionSlice(request.imageExecutionSnapshot, 'image.generate');
  const resolved = slice.resolvedTarget as AgentRuntimeResolvedBinding;
  const rawParams = request.imageParams || {};
  const params = parseImageParams(rawParams);
  const out: JsonObject = { ...(rawParams as JsonObject) };
  if (normalizeText(params.size)) out.size = normalizeText(params.size);
  if (normalizeText(params.responseFormat)) out.responseFormat = normalizeText(params.responseFormat);
  if (normalizeText(params.seed)) out.seed = normalizeText(params.seed);
  const steps = normalizePositiveInteger(params.steps);
  const cfgScale = normalizePositiveNumber(params.cfgScale);
  const sampler = normalizeText(params.sampler);
  const scheduler = normalizeText(params.scheduler);
  if (steps) {
    out.step = steps;
    out.steps = steps;
  }
  if (cfgScale) {
    out.cfgScale = cfgScale;
    out.cfg_scale = cfgScale;
    out.guidance_scale = cfgScale;
  }
  if (sampler) out.sampler = sampler;
  if (scheduler) out.scheduler = scheduler;
  out.profile_entries = buildImageProfileEntries(resolved, rawParams);
  const entryOverrides = buildImageEntryOverrides(resolved, rawParams);
  if (entryOverrides.length > 0) out.entry_overrides = entryOverrides;
  const profileOverrides: JsonObject = {};
  if (steps) profileOverrides.step = steps;
  if (cfgScale) {
    profileOverrides.cfg_scale = cfgScale;
    profileOverrides.guidance_scale = cfgScale;
  }
  if (sampler) profileOverrides.sampler = sampler;
  if (scheduler) profileOverrides.scheduler = scheduler;
  if (Object.keys(profileOverrides).length > 0) out.profile_overrides = profileOverrides;
  return out;
}

function buildImageProfileEntries(
  resolved: AgentRuntimeResolvedBinding,
  rawParams: Record<string, unknown>,
): JsonObject[] {
  const entries: JsonObject[] = [{
    entryId: 'main',
    kind: 'asset',
    capability: 'image',
    assetId: normalizeText(resolved.goRuntimeLocalModelId || resolved.localModelId || resolved.modelId || resolved.model),
    assetKind: 'image',
    ...(normalizeText(resolved.engine || resolved.provider) ? { engine: normalizeText(resolved.engine || resolved.provider) } : {}),
  }];
  const companionSlots = asRecord(rawParams.companionSlots);
  const imageParams = parseImageParams(rawParams);
  const contractSlotKinds = new Map(
    resolveImageCompanionSlotsForModelFamily(imageParams.modelFamily)
      .map((slot) => [slot.slot, slot.kind]),
  );
  for (const [slot, localAssetId] of Object.entries(companionSlots || {})) {
    const normalizedSlot = normalizeText(slot);
    const normalizedLocalAssetId = normalizeText(localAssetId);
    if (!normalizedSlot || !normalizedLocalAssetId) continue;
    entries.push({
      entryId: normalizedSlot,
      kind: 'asset',
      capability: 'image.generate',
      assetId: normalizedLocalAssetId,
      assetKind: contractSlotKinds.get(normalizedSlot) || IMAGE_COMPANION_SLOT_KIND[normalizedSlot] || 'auxiliary',
      engineSlot: normalizedSlot,
    });
  }
  return entries;
}

function buildImageEntryOverrides(
  resolved: AgentRuntimeResolvedBinding,
  rawParams: Record<string, unknown>,
): JsonObject[] {
  const overrides: JsonObject[] = [];
  const mainLocalAssetId = normalizeText(resolved.goRuntimeLocalModelId || resolved.localModelId);
  if (mainLocalAssetId) {
    overrides.push({ entryId: 'main', localAssetId: mainLocalAssetId });
  }
  const companionSlots = asRecord(rawParams.companionSlots);
  for (const [slot, localAssetId] of Object.entries(companionSlots || {})) {
    const normalizedSlot = normalizeText(slot);
    const normalizedLocalAssetId = normalizeText(localAssetId);
    if (normalizedSlot && normalizedLocalAssetId) {
      overrides.push({ entryId: normalizedSlot, localAssetId: normalizedLocalAssetId });
    }
  }
  return overrides;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizePositiveInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function normalizePositiveNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export async function streamChatAgentRuntimeAgentTurn(
  request: AgentRuntimeChatTurnRequest,
): Promise<{ stream: AsyncIterable<AgentRuntimeChatTurnStreamPart> }> {
  const runtime = getDesktopRuntimeAgentTurnsRuntime();
  const turns = createNimiRuntimeAgentTurnsModule({
    runtime,
    getSubjectUserId: () => request.ownerUserId,
    withScopes: withDesktopRuntimeProtectedScopes,
  });
  const requestId = createNimiClientId('runtime-agent-turn-request');
  safeLogRuntimeAgentEvent({
    level: 'info',
    area: 'agent-chat-runtime',
    message: 'action:runtime-agent-turn:start',
    details: {
      localAgentRef: request.localAgentRef,
      conversationAnchorId: request.conversationAnchorId,
      threadId: request.threadId,
      requestId,
    },
  });
  const executionBinding = resolveRuntimeAgentTextExecutionBinding(request);
  const imageExecutionBinding = resolveRuntimeAgentImageExecutionBinding(request);
  const imageExecutionParams = buildRuntimeAgentImageExecutionParams(request);
  const route = executionBinding.route;
  const modelId = executionBinding.modelId;
  const connectorId = executionBinding.connectorId;
  const localIdentity = {
    ownerUserId: request.ownerUserId,
    runtimeSourceRef: request.runtimeSourceRef,
    localAgentRef: request.localAgentRef,
  };

  const requestPayloadBase = {
    ...localIdentity,
    conversationAnchorId: request.conversationAnchorId,
    threadId: request.threadId,
    systemPrompt: undefined,
    maxOutputTokens: Number.isFinite(Number(request.maxOutputTokensRequested))
      && Number(request.maxOutputTokensRequested) > 0
      ? Math.floor(Number(request.maxOutputTokensRequested))
      : undefined,
    messages: [{
      role: 'user' as const,
      content: normalizeText(request.userText),
    }],
    executionBindings: {
      'text.generate': executionBinding,
      ...(imageExecutionBinding ? { 'image.generate': imageExecutionBinding } : {}),
    },
    executionParams: {
      ...(imageExecutionParams ? { 'image.generate': imageExecutionParams } : {}),
    },
    reasoning: (() => {
      const resolved = resolveChatThinkingConfig(
        request.reasoningPreference,
        resolveTextExecutionSnapshotThinkingSupport(
          request.textExecutionSnapshot?.conversationCapabilitySlice as Parameters<typeof resolveTextExecutionSnapshotThinkingSupport>[0],
        ),
      );
      if (!resolved) {
        return undefined;
      }
      return {
        ...(normalizeText(resolved.mode) ? { mode: normalizeText(resolved.mode) as typeof resolved.mode } : {}),
        ...(normalizeText(resolved.traceMode) ? { traceMode: normalizeText(resolved.traceMode) as typeof resolved.traceMode } : {}),
        ...(Number.isFinite(Number(resolved.budgetTokens))
          ? { budgetTokens: Math.floor(Number(resolved.budgetTokens)) }
          : {}),
      };
    })(),
  };

  return runNimiRuntimeAgentTurn({
    turns,
    subscribe: {
      ...localIdentity,
      conversationAnchorId: request.conversationAnchorId,
      includeAgentEvents: false,
    },
    request: {
      ...requestPayloadBase,
      requestId,
    },
    signal: request.signal,
    interruptReason: 'desktop_agent_chat_abort',
    route,
    modelId,
    connectorId,
    logEvent: safeLogRuntimeAgentEvent,
    logTiming: (event) => {
      const stageByRunnerStage = {
        subscribe: 'desktop.runtime_agent.subscribe_ms',
        request_ack: 'desktop.runtime_agent.request_ack_ms',
        accepted_to_started: 'desktop.runtime_agent.accepted_to_started_ms',
        started_to_first_delta: 'desktop.runtime_agent.started_to_first_delta_ms',
        message_committed_to_message_sealed: 'desktop.runtime_agent.message_committed_to_message_sealed_ms',
        completed_to_ui_done: 'desktop.runtime_agent.completed_to_ui_done_ms',
      } as const;
      safeLogRuntimeAgentTiming({
        stage: stageByRunnerStage[event.stage],
        startedAt: event.startedAt,
        details: event.details,
      });
    },
    resolveTrace: resolveRuntimeTrace,
    buildMetadata: (input) => toDebugMetadata({
      prompt: normalizeText(request.userText),
      systemPrompt: null,
      conversationAnchorId: request.conversationAnchorId,
      runtimeTurnId: input.runtimeTurnId,
      runtimeStreamId: input.runtimeStreamId,
      route,
      modelId,
      connectorId,
      trace: input.trace,
      envelope: input.envelope,
      latestTimeline: input.latestTimeline || null,
    }),
    buildDiagnostics: (input) => buildRuntimeAgentDiagnostics({
      conversationAnchorId: request.conversationAnchorId,
      runtimeTurnId: input.runtimeTurnId,
      runtimeStreamId: input.runtimeStreamId,
      route,
      modelId,
      connectorId,
      trace: input.trace,
      extra: {
        ...(input.runtimeTurnTimelines.length > 0 ? { runtimeTurnTimelines: [...input.runtimeTurnTimelines] } : {}),
        ...(input.runtimeProjectionEvents.length > 0 ? { runtimeProjectionEvents: [...input.runtimeProjectionEvents] } : {}),
        ...(input.extra || {}),
      },
    }),
  });
}
