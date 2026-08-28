import { createNimiCanonicalRendererHostBindings } from '@nimiplatform/kit/shell/renderer/host';
import {
  createAppAgentCenterSession,
  type AgentCenterHostMechanics,
  type AgentCenterSession,
} from '@nimiplatform/kit/features/agent-center';

import type {
  NimiLocalAppAgentConfigureClient,
  NimiLocalAppAgentHandle,
  NimiLocalAppAgentMemoryItem,
  NimiLocalAppAgentMemoryProjection,
  NimiLocalAppAgentPresentationProfile,
} from '@nimiplatform/sdk/app';

import type { ZhiyuCanonicalRendererBindings, ZhiyuHomeProjection } from '../renderer/contract.js';
import type { ZhiyuRuntimeAgentChatTurnResult } from '../shell/agent-chat/runtime-agent-turn-adapter.js';
import { createInitialZhiyuEvidence, type ZhiyuEvidence } from '../shell/app/evidence.js';
import type { ZhiyuSimulatorJsonValue, ZhiyuSimulatorPrepareContext } from './protocol.js';

const SIMULATED_LOCAL_AGENT_PARTICIPATION = Object.freeze([
  Object.freeze({ role: 'conversation.primary' as const, capabilityContract: 'text.generate' as const }),
  Object.freeze({ role: 'memory.embedding' as const, capabilityContract: 'text.embed' as const }),
  Object.freeze({ role: 'conversation.input.voice' as const, capabilityContract: 'audio.transcribe' as const }),
  Object.freeze({ role: 'conversation.output.voice' as const, capabilityContract: 'audio.synthesize' as const }),
  Object.freeze({ role: 'conversation.realtime' as const, capabilityContract: 'realtime.interact' as const }),
  Object.freeze({ role: 'conversation.action.image' as const, capabilityContract: 'image.generate' as const }),
]);

type JsonRecord = { readonly [key: string]: ZhiyuSimulatorJsonValue };
type ScenarioAgent = {
  readonly localAgentRef: string;
  readonly runtimeSourceRef: string;
  readonly displayName: string;
};
type Projection = {
  readonly protocolRevision: 1;
  readonly scenario: {
    readonly ownerUserId: string;
    readonly agents: readonly ScenarioAgent[];
    readonly responseText: string;
  };
  readonly turnSequence: number;
  readonly ecosystemReference: JsonRecord | null;
  readonly personaReference: JsonRecord | null;
  readonly handoff: JsonRecord | null;
  readonly carry: JsonRecord | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function projection(context: ZhiyuSimulatorPrepareContext): Projection {
  const value = context.projection.get();
  if (!isRecord(value)
    || value.protocolRevision !== 1
    || !isRecord(value.scenario)
    || typeof value.scenario.ownerUserId !== 'string'
    || !Array.isArray(value.scenario.agents)
    || typeof value.scenario.responseText !== 'string'
    || !Number.isSafeInteger(value.turnSequence)
    || (value.ecosystemReference !== null && !isRecord(value.ecosystemReference))
    || (value.personaReference !== null && !isRecord(value.personaReference))
    || (value.handoff !== null && !isRecord(value.handoff))
    || (value.carry !== null && !isRecord(value.carry))) {
    throw new Error('ZHIYU_SIMULATOR_PROJECTION_INVALID');
  }
  return value as unknown as Projection;
}

function ecosystemRevisionOf(value: Projection): number | null {
  const reference = value.ecosystemReference;
  return reference && Number.isSafeInteger(reference.ecosystemRevision)
    ? reference.ecosystemRevision as number
    : null;
}

function personaDisplayNameOf(value: Projection): string | null {
  const reference = value.personaReference;
  if (!reference || !isRecord(reference.persona) || typeof reference.persona.displayName !== 'string') {
    return null;
  }
  return reference.persona.displayName;
}

/** 生态 revision text stays the primary status; the simulated persona joins
 * it with an explicit 模拟 honesty marker (P-SIM-001). */
function companionStatusText(value: Projection): string {
  const revision = ecosystemRevisionOf(value);
  const personaName = personaDisplayNameOf(value);
  if (revision !== null && personaName) return `生态 revision ${revision} · 模拟居民 ${personaName}`;
  if (revision !== null) return `生态 revision ${revision}`;
  if (personaName) return `模拟居民 ${personaName} · 模拟身份投影`;
  return '等待与你对话';
}

function simulatedAgentHandle(localAgentRef: string): NimiLocalAppAgentHandle {
  return `sim-agent-handle:${localAgentRef}` as NimiLocalAppAgentHandle;
}

function simulatedHome(
  context: ZhiyuSimulatorPrepareContext,
  selectedAgentHandle: NimiLocalAppAgentHandle | null,
): ZhiyuHomeProjection {
  const scenario = projection(context).scenario;
  const selected = scenario.agents.find((agent) => simulatedAgentHandle(agent.localAgentRef) === selectedAgentHandle)
    ?? scenario.agents[0];
  if (!selected) throw new Error('ZHIYU_SIMULATOR_AGENT_REQUIRED');
  const currentProjection = projection(context);
  const initial = createInitialZhiyuEvidence();
  const identity = {
    ownerUserId: scenario.ownerUserId,
    runtimeSourceRef: selected.runtimeSourceRef,
    localAgentRef: selected.localAgentRef,
  };
  const simulatedStatus = {
    source: 'simulator',
    message: 'Deterministic Simulator scenario projection is ready.',
  };
  return {
    runtime: {
      transport: 'electron-ipc',
      ready: true,
      reasonCode: 'runtime-ready',
      actionHint: 'continue_runtime_account_probe',
      ...simulatedStatus,
    },
    auth: {
      transport: 'electron-ipc',
      ready: true,
      state: 'authenticated',
      reasonCode: 'runtime-account-ready',
      accountReasonCode: 'OK',
      actionHint: 'continue_runtime_agent_inventory',
      ...simulatedStatus,
      accountId: scenario.ownerUserId,
      displayName: 'Simulator User',
      productionInert: false,
    },
    source: {
      ...initial.source,
      ready: true,
      reasonCode: 'runtime-source-context-ready',
      actionHint: 'continue_runtime_local_agent',
      ...simulatedStatus,
      projectionState: 'ready',
    },
    inventory: {
      transport: 'electron-ipc',
      ready: true,
      reasonCode: 'runtime-local-agent-inventory-ready',
      actionHint: 'select_runtime_local_agent',
      ...simulatedStatus,
      ownerUserId: scenario.ownerUserId,
      count: scenario.agents.length,
      localAgents: scenario.agents.map((agent) => ({
        agentHandle: simulatedAgentHandle(agent.localAgentRef),
        displayName: agent.displayName,
        avatarUrl: null,
      })),
    },
    localAgent: {
      transport: 'electron-ipc',
      ready: true,
      reasonCode: 'runtime-local-agent-selected',
      actionHint: 'open_runtime_agent_home',
      ...simulatedStatus,
      agentHandle: simulatedAgentHandle(selected.localAgentRef),
      ...identity,
    },
    conversation: {
      transport: 'electron-ipc',
      ready: true,
      reasonCode: 'conversation-anchor-open',
      actionHint: 'send_runtime_agent_turn',
      ...simulatedStatus,
      agentHandle: simulatedAgentHandle(selected.localAgentRef),
      ...identity,
      conversationAnchorId: `sim-conversation:${selected.localAgentRef}`,
      threadId: `sim-thread:${selected.localAgentRef}`,
    },
    companion: {
      ...initial.companion,
      ready: true,
      state: 'projected',
      reasonCode: 'runtime-agent-state-projected',
      actionHint: 'inspect_runtime_agent_state_projection',
      ...simulatedStatus,
      ...identity,
      observedAt: new Date(context.clock.now()).toISOString(),
      stateUpdatedAt: new Date(context.clock.now()).toISOString(),
      executionState: 'idle',
      statusText: companionStatusText(currentProjection),
      participationMode: 'idle',
      participationSource: 'simulator-state-engine',
      projectedFields: ['executionState', 'statusText', 'participationMode'],
    },
    delegation: initial.delegation,
    proposal: initial.proposal,
    avatar: { ...initial.avatar, ...identity },
  };
}

function simulatedTurnReady(conversation: ZhiyuEvidence['conversation']): ZhiyuEvidence['turn'] {
  if (!conversation.ready || !conversation.ownerUserId || !conversation.runtimeSourceRef
    || !conversation.localAgentRef || !conversation.conversationAnchorId) {
    throw new Error('ZHIYU_SIMULATOR_CONVERSATION_IDENTITY_INVALID');
  }
  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'runtime-turn-ready',
    actionHint: 'send_runtime_agent_turn',
    source: 'simulator',
    message: 'Deterministic Simulator turn channel is ready.',
    ownerUserId: conversation.ownerUserId,
    runtimeSourceRef: conversation.runtimeSourceRef,
    localAgentRef: conversation.localAgentRef,
    conversationAnchorId: conversation.conversationAnchorId,
    requestId: null,
    runtimeTurnId: null,
    runtimeStreamId: null,
    messageId: null,
  };
}

async function invoke(
  context: ZhiyuSimulatorPrepareContext,
  type: string,
  payload: JsonRecord,
): Promise<{ readonly revision: number }> {
  const result = await context.commands.invoke(type, payload);
  if (!result.ok || !isRecord(result.value) || !Number.isSafeInteger(result.value.revision)) {
    throw new Error(`ZHIYU_SIMULATOR_COMMAND_REJECTED:${type}`);
  }
  return { revision: result.value.revision as number };
}

function simulatedAgentCenterSession(
  context: ZhiyuSimulatorPrepareContext,
  agentHandle: Parameters<ZhiyuCanonicalRendererBindings['app']['projection']['agentCenterSession']>[0],
  conversationAnchorId: Parameters<ZhiyuCanonicalRendererBindings['app']['projection']['agentCenterSession']>[1],
): AgentCenterSession | null {
  const scenario = projection(context).scenario;
  const selected = scenario.agents.find((agent) => simulatedAgentHandle(agent.localAgentRef) === agentHandle);
  if (!agentHandle || !selected) return null;

  type SharedSnapshot = Awaited<ReturnType<NimiLocalAppAgentConfigureClient['sharedAIConfig']['get']>>;
  type SharedCapabilities = NonNullable<SharedSnapshot['config']>['capabilities'];
  let capabilities: SharedCapabilities = [{
    capabilityContract: 'text.generate',
    requiredFeatures: [],
    route: { oneofKind: 'local', local: {} },
  }];
  let aiConfigRevision = '1';
  const sharedAIConfig = () => Object.freeze({
    owner: { owner: { oneofKind: 'runtimeLocalAgentSubsystem' as const, runtimeLocalAgentSubsystem: {} } },
    capabilities: [...capabilities],
  });

  type SimulatedAutonomy = Awaited<ReturnType<NimiLocalAppAgentConfigureClient['autonomy']['snapshot']>>;
  let autonomyRevision = '1';
  let autonomy: SimulatedAutonomy = Object.freeze({
    enabled: true,
    config: Object.freeze({
      mode: 'low' as const,
      dailyTokenBudget: 4_096,
      maxTokensPerHook: 512,
    }),
    budgetExhausted: false,
    usedTokensInWindow: 0,
    autonomyRevision,
  });

  let presentationRevision = '1';
  let presentationProfile: NimiLocalAppAgentPresentationProfile = simulatedPresentationProfile(presentationRevision);
  let previousPresentationProfile: NimiLocalAppAgentPresentationProfile | null = null;
  const presentationResult = () => ({
    profile: { ...presentationProfile },
    previousProfile: previousPresentationProfile,
    defaultVoiceReference: presentationProfile.defaultVoiceReference,
    avatarAutoplay: presentationProfile.avatarAutoplay,
    presentationRevision,
  });

  let memoryItems: NimiLocalAppAgentMemoryItem[] = [Object.freeze({
    memoryId: `sim-memory:${agentHandle}:1`,
    content: '模拟伙伴记得你偏好简洁、直接的回答。',
    epistemicStatus: 'explicit',
    lifecycle: 'current',
    occurredAt: new Date(context.clock.now() - 60_000).toISOString(),
    updatedAt: new Date(context.clock.now() - 60_000).toISOString(),
    sourceExplanation: '来自当前模拟会话中已提交的用户事实。',
  })];
  let memoryEnabled = true;
  let forgottenMemoryCount = 0;
  const memoryProjection = (
    outcome: NimiLocalAppAgentMemoryProjection['outcome'] = memoryEnabled ? 'ready' : 'unconfigured',
  ): NimiLocalAppAgentMemoryProjection => {
    const currentCount = memoryItems.filter((item) => item.lifecycle === 'current').length;
    const supersededCount = memoryItems.filter((item) => item.lifecycle === 'superseded').length;
    return Object.freeze({
      outcome,
      enabled: memoryEnabled,
      adoptionRequired: false,
      items: Object.freeze([...memoryItems]),
      currentCount,
      supersededCount,
      forgottenCount: forgottenMemoryCount,
      nextPageToken: null,
    });
  };

  const client: NimiLocalAppAgentConfigureClient = {
    sharedAIConfig: {
      async get() {
        return Object.freeze({
          config: sharedAIConfig(),
          revision: aiConfigRevision,
          effectiveSelections: Object.freeze([]),
          participation: SIMULATED_LOCAL_AGENT_PARTICIPATION,
        });
      },
      async overwrite(input) {
        if (input.expectedRevision !== aiConfigRevision) {
          return Object.freeze({
            outcome: 'conflict' as const,
            config: sharedAIConfig(),
            revision: aiConfigRevision,
            reasonCode: 'AGENT_AI_CONFIG_REVISION_CONFLICT' as const,
            participation: SIMULATED_LOCAL_AGENT_PARTICIPATION,
          });
        }
        capabilities = [...input.capabilities];
        aiConfigRevision = String(BigInt(aiConfigRevision) + 1n);
        return Object.freeze({
          outcome: 'committed' as const,
          config: sharedAIConfig(),
          revision: aiConfigRevision,
          participation: SIMULATED_LOCAL_AGENT_PARTICIPATION,
        });
      },
      async listOptions(input) {
        if (input.kind === 'voice-assets') {
          return Object.freeze({
            kind: 'voice-assets' as const,
            options: Object.freeze([Object.freeze({ voiceAssetId: 'simulator-custom-voice' })]),
            truncated: false,
          });
        }
        if (input.kind === 'preset-voices') {
          return Object.freeze({ kind: 'preset-voices' as const, options: Object.freeze([]), truncated: false });
        }
        return Object.freeze({
          kind: 'local-loadouts' as const,
          options: input.capabilityContract === 'text.generate' ? Object.freeze([{
            loadoutRef: 'simulated-text-loadout',
            label: 'Simulated local text model',
            capabilityContract: 'text.generate',
            implementation: {
              implementationId: 'simulated.local.text',
              driverId: 'simulated',
              driverDialect: 'simulated/text/v1',
            },
            supportedFeatures: Object.freeze([]),
            state: 'ready' as const,
            reasons: Object.freeze([]),
          }]) : Object.freeze([]),
          truncated: false,
        });
      },
    },
    autonomy: {
      async snapshot(input) {
        assertSimulatedHandle(input.agentHandle, agentHandle);
        return autonomy;
      },
      async update(input) {
        assertSimulatedHandle(input.agentHandle, agentHandle);
        if (input.expectedAutonomyRevision !== autonomyRevision) {
          throw new Error('ZHIYU_SIMULATOR_AUTONOMY_REVISION_CONFLICT');
        }
        const config = input.intent.config ?? autonomy.config ?? {
          mode: 'low' as const,
          dailyTokenBudget: 4_096,
          maxTokensPerHook: 512,
        };
        autonomyRevision = String(BigInt(autonomyRevision) + 1n);
        autonomy = Object.freeze({
          ...autonomy,
          enabled: input.intent.enabled ?? autonomy.enabled,
          config: Object.freeze({
            ...config,
            mode: simulatedAutonomyMode(config.mode),
            dailyTokenBudget: simulatedNonNegativeInteger(config.dailyTokenBudget, 'DAILY_TOKEN_BUDGET'),
            maxTokensPerHook: simulatedNonNegativeInteger(config.maxTokensPerHook, 'MAX_TOKENS_PER_HOOK'),
          }),
          autonomyRevision,
        });
        return autonomy;
      },
    },
    presentation: {
      async snapshot(input) {
        assertSimulatedHandle(input.agentHandle, agentHandle);
        return presentationResult();
      },
      async commit(input) {
        assertSimulatedHandle(input.agentHandle, agentHandle);
        if (input.expectedPresentationRevision !== presentationRevision) {
          throw new Error('ZHIYU_SIMULATOR_PRESENTATION_REVISION_CONFLICT');
        }
        previousPresentationProfile = presentationProfile;
        presentationRevision = String(BigInt(presentationRevision) + 1n);
        presentationProfile = Object.freeze({
          ...presentationProfile,
          ...input.intent,
          revision: presentationRevision,
        });
        return presentationResult();
      },
    },
    memory: {
      async inspect(input) {
        assertSimulatedHandle(input.agentHandle, agentHandle);
        return memoryProjection();
      },
      async correct(input) {
        assertSimulatedHandle(input.agentHandle, agentHandle);
        const index = memoryItems.findIndex((item) => item.memoryId === input.memoryId && item.lifecycle === 'current');
        if (index < 0 || !input.correctedContent.trim()) throw new Error('ZHIYU_SIMULATOR_MEMORY_CORRECTION_REJECTED');
        memoryItems = memoryItems.map((item, itemIndex) => itemIndex === index
          ? Object.freeze({ ...item, content: input.correctedContent, updatedAt: new Date(context.clock.now()).toISOString() })
          : item);
        return Object.freeze({
          outcome: 'committed' as const,
          affectedMemoryIds: Object.freeze([input.memoryId]),
          projection: memoryProjection('committed'),
        });
      },
      async forget(input) {
        assertSimulatedHandle(input.agentHandle, agentHandle);
        const targets = new Set(input.memoryIds);
        const affectedMemoryIds = memoryItems
          .filter((item) => targets.has(item.memoryId) && item.lifecycle === 'current')
          .map((item) => item.memoryId);
        memoryItems = memoryItems.filter((item) => !affectedMemoryIds.includes(item.memoryId));
        forgottenMemoryCount += affectedMemoryIds.length;
        const outcome = affectedMemoryIds.length > 0 ? 'forgotten' as const : 'no_effect' as const;
        return Object.freeze({
          outcome,
          affectedMemoryIds: Object.freeze(affectedMemoryIds),
          projection: memoryProjection(outcome),
        });
      },
      async setEnabled(input) {
        assertSimulatedHandle(input.agentHandle, agentHandle);
        memoryEnabled = input.enabled;
        return Object.freeze({
          outcome: 'committed' as const,
          affectedMemoryIds: Object.freeze([]),
          projection: memoryProjection('committed'),
        });
      },
      async deleteAll(input) {
        assertSimulatedHandle(input.agentHandle, agentHandle);
        const affectedMemoryIds = memoryItems.map((item) => item.memoryId);
        memoryItems = [];
        forgottenMemoryCount = 0;
        return Object.freeze({
          outcome: 'deleted' as const,
          affectedMemoryIds: Object.freeze(affectedMemoryIds),
          projection: memoryProjection('deleted'),
        });
      },
    },
    manager: {
      async snapshot(input) {
        assertSimulatedHandle(input.agentHandle, agentHandle);
        const currentMemoryCount = memoryProjection().currentCount;
        return Object.freeze({
          lifecycleStatus: 'active' as const,
          executionState: 'idle' as const,
          statusText: '模拟伙伴已就绪',
          currentEmotion: 'calm',
          source: Object.freeze({
            ready: true,
            state: 'ready' as const,
            reasonCode: 'none' as const,
            capturedAt: Object.freeze({ seconds: String(Math.floor(context.clock.now() / 1_000)), nanos: 0 }),
            coverageSections: Object.freeze([
              Object.freeze({ section: 'identity' as const, state: 'complete' as const, requiredCount: 1, resolvedCount: 1, omittedCount: 0 }),
              Object.freeze({ section: 'presentation' as const, state: 'complete' as const, requiredCount: 1, resolvedCount: 1, omittedCount: 0 }),
              Object.freeze({ section: 'knowledge' as const, state: 'complete' as const, requiredCount: 1, resolvedCount: 1, omittedCount: 0 }),
            ]),
            lorebookReady: true,
            lorebookItemCount: 1,
            lorebookEstimatedTokens: '64',
          }),
          context: Object.freeze({
            ready: true,
            state: 'ready' as const,
            reasonCode: 'none' as const,
            lanes: Object.freeze([
              Object.freeze({ laneId: 'source_identity' as const, state: 'included' as const, includedItemCount: 1, omittedItemCount: 0, truncatedItemCount: 0, allocatedTokens: '64', usedTokens: '32' }),
              Object.freeze({ laneId: 'canonical_memory' as const, state: memoryEnabled ? 'included' as const : 'empty' as const, includedItemCount: memoryEnabled ? currentMemoryCount : 0, omittedItemCount: 0, truncatedItemCount: 0, allocatedTokens: '64', usedTokens: memoryEnabled ? '32' : '0' }),
            ]),
            inputBudgetTokens: '1024',
            usedTokens: memoryEnabled ? '64' : '32',
            requiredInputTokens: memoryEnabled ? '64' : '32',
            requiredContextWindowTokens: '256',
            truncation: Object.freeze([Object.freeze({ reason: 'none' as const, omittedItemCount: 0, truncatedItemCount: 0 })]),
            transcriptTurnCount: 1,
            memoryItemCount: currentMemoryCount,
            mediaCount: 0,
            toolCount: 0,
            sourceAdapterStatus: 'ready' as const,
            sourceSelectionStatus: 'ready' as const,
            conversationSummaryStatus: 'absent' as const,
            privateRecallCount: memoryEnabled ? currentMemoryCount : 0,
          }),
          actionAvailability: Object.freeze({
            getSharedAIConfig: Object.freeze({ state: 'available' as const, reason: null }),
            overwriteSharedAIConfig: Object.freeze({ state: 'available' as const, reason: null }),
            readAutonomy: Object.freeze({ state: 'available' as const, reason: null }),
            updateAutonomy: Object.freeze({ state: 'available' as const, reason: null }),
            inspectMemory: Object.freeze({ state: 'available' as const, reason: null }),
            correctMemory: memoryEnabled
              ? Object.freeze({ state: 'available' as const, reason: null })
              : Object.freeze({ state: 'unavailable' as const, reason: 'memory-disabled' as const }),
            forgetMemory: memoryEnabled
              ? Object.freeze({ state: 'available' as const, reason: null })
              : Object.freeze({ state: 'unavailable' as const, reason: 'memory-disabled' as const }),
            switchMemory: Object.freeze({ state: 'available' as const, reason: null }),
            deleteAllMemory: Object.freeze({ state: 'available' as const, reason: null }),
            replaceAppearance: Object.freeze({ state: 'available' as const, reason: null }),
            restorePreviousAppearance: previousPresentationProfile
              ? Object.freeze({ state: 'available' as const, reason: null })
              : Object.freeze({ state: 'unavailable' as const, reason: 'previous-presentation-unavailable' as const }),
          }),
        });
      },
    },
  };

  const hostMechanics: AgentCenterHostMechanics = Object.freeze({
    async selectAvatar(kind: 'live2d' | 'vrm') {
      const extension = kind === 'vrm' ? 'vrm' : 'zip';
      return Object.freeze({
        intent: Object.freeze({ backendKind: kind, avatarAssetReference: `asset://simulator/avatar.${extension}` }),
        importedAssets: Object.freeze([Object.freeze({
          role: 'avatar' as const,
          fileName: `simulator-avatar.${extension}`,
          mediaType: kind === 'vrm' ? 'model/gltf-binary' : 'application/zip',
          content: new Uint8Array([1, 2, 3]),
          sha256: 'simulator-deterministic-avatar',
        })]),
      });
    },
    async selectBackground() {
      return Object.freeze({
        intent: Object.freeze({ backgroundAssetReference: 'asset://simulator/background.png' }),
        importedAssets: Object.freeze([Object.freeze({
          role: 'background' as const,
          fileName: 'simulator-background.png',
          mediaType: 'image/png',
          content: new Uint8Array([4, 5, 6]),
          sha256: 'simulator-deterministic-background',
        })]),
      });
    },
    async resolveCommittedPreview() {
      return Object.freeze({
        state: 'ready' as const,
        tier: 'avatar_preview_service' as const,
        previewImageRef: '/__nimi/avatar-preview/simulator.png',
        visiblePixels: 64,
        nonPlaceholder: true as const,
        warnings: Object.freeze([]),
      });
    },
  });

  return createAppAgentCenterSession({
    handle: agentHandle,
    client,
    ...(conversationAnchorId ? { conversationAnchorId } : {}),
    hostMechanics,
  });
}

function simulatedPresentationProfile(revision: string): NimiLocalAppAgentPresentationProfile {
  return Object.freeze({
    backendKind: 'sprite2d' as const,
    avatarAssetRef: 'asset://simulator/avatar.png',
    expressionProfileRef: '',
    idlePreset: 'idle-breathe',
    interactionPolicyRef: '',
    defaultVoiceReference: '',
    avatarAutoplay: false,
    backgroundAssetRef: '',
    revision,
  });
}

function simulatedAutonomyMode(value: string): 'off' | 'low' | 'medium' | 'high' {
  if (value === 'off' || value === 'low' || value === 'medium' || value === 'high') {
    return value;
  }
  throw new Error('ZHIYU_SIMULATOR_AUTONOMY_MODE_INVALID');
}

function simulatedNonNegativeInteger(value: string | number, field: string): number {
  const normalized = typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(value)
    ? Number(value)
    : value;
  if (typeof normalized !== 'number'
    || !Number.isSafeInteger(normalized)
    || normalized < 0) {
    throw new Error(`ZHIYU_SIMULATOR_${field}_INVALID`);
  }
  return normalized;
}

function assertSimulatedHandle(input: NimiLocalAppAgentHandle, expected: NimiLocalAppAgentHandle): void {
  if (input !== expected) throw new Error('ZHIYU_SIMULATOR_AGENT_CENTER_HANDLE_CHANGED');
}

export function createZhiyuSimulatorBindings(
  context: ZhiyuSimulatorPrepareContext,
): ZhiyuCanonicalRendererBindings {
  let currentRoute = context.route.get();
  const routeListeners = new Set<() => void>();
  const unsubscribeRoute = context.route.subscribe((route) => {
    currentRoute = route;
    for (const listener of routeListeners) listener();
  });
  const cleanupRegistration = context.cleanup.add(() => {
    routeListeners.clear();
    unsubscribeRoute();
  });
  if (!cleanupRegistration.ok) throw new Error('ZHIYU_SIMULATOR_EVENT_CLEANUP_REJECTED');
  return createNimiCanonicalRendererHostBindings({
    scope: context.kit.scope,
    capabilities: context.kit.capabilities,
    localization: context.kit.localization,
    kit: context.kit,
    sdk: Object.freeze({}),
    app: {
      projection: Object.freeze({
        agentCenterSession: (
          agentHandle: Parameters<ZhiyuCanonicalRendererBindings['app']['projection']['agentCenterSession']>[0],
          conversationAnchorId: Parameters<ZhiyuCanonicalRendererBindings['app']['projection']['agentCenterSession']>[1],
        ) => simulatedAgentCenterSession(context, agentHandle, conversationAnchorId),
        loadHome: ({ selectedAgentHandle }: { readonly selectedAgentHandle: NimiLocalAppAgentHandle | null }) => (
          Promise.resolve(simulatedHome(context, selectedAgentHandle))
        ),
        loadAgentInventory: async () => simulatedHome(context, null).inventory,
        projectTurnReadiness: simulatedTurnReady,
        async hydrateConversation(input: Parameters<ZhiyuCanonicalRendererBindings['app']['projection']['hydrateConversation']>[0]) {
          return { source: input.currentSource, chat: input.currentChat };
        },
      }),
      commands: Object.freeze({
        async transcribeVoice() {
          throw new Error('Protected voice transcription is unavailable in the simulator.');
        },
        async allocateTurnRequestId() {
          const accepted = await invoke(context, 'zhiyu.turn.allocate', {});
          return `zhiyu-turn-sim-${accepted.revision}`;
        },
        async runTurn(input: Parameters<ZhiyuCanonicalRendererBindings['app']['commands']['runTurn']>[0]): Promise<ZhiyuRuntimeAgentChatTurnResult> {
          const requestId = typeof input.requestId === 'string' ? input.requestId.trim() : '';
          const text = typeof input.text === 'string' ? input.text.trim() : '';
          if (!requestId || !text || !input.conversation.agentHandle || !input.conversation.conversationAnchorId) {
            throw new Error('ZHIYU_SIMULATOR_TURN_INPUT_INVALID');
          }
          if (input.signal?.aborted) throw new Error('ZHIYU_SIMULATOR_TURN_ABORTED');
          await invoke(context, 'zhiyu.turn.submit', { requestId, text });
          const scenario = projection(context).scenario;
          const createdAt = new Date(context.clock.now()).toISOString();
          const identity = input.conversation;
          const conversationAnchorId = identity.conversationAnchorId;
          const agentHandle = identity.agentHandle;
          if (!conversationAnchorId || !agentHandle) throw new Error('ZHIYU_SIMULATOR_TURN_IDENTITY_LOST');
          const messages = [{
            id: `${requestId}:user`,
            sessionId: conversationAnchorId,
            targetId: agentHandle,
            source: 'human' as const,
            role: 'user' as const,
            text,
            createdAt,
            status: 'complete' as const,
            kind: 'text' as const,
            metadata: { turnId: requestId },
          }, {
            id: `${requestId}:assistant`,
            sessionId: conversationAnchorId,
            targetId: agentHandle,
            source: 'agent' as const,
            role: 'agent' as const,
            text: scenario.responseText,
            createdAt,
            status: 'complete' as const,
            kind: 'text' as const,
            metadata: { turnId: requestId },
          }];
          return {
            transport: 'electron-ipc',
            ready: true,
            state: 'completed',
            reasonCode: 'runtime-agent-chat-completed',
            actionHint: 'send_runtime_agent_turn',
            source: 'simulator',
            message: 'Deterministic Simulator response committed.',
            agentHandle,
            ownerUserId: identity.ownerUserId,
            runtimeSourceRef: identity.runtimeSourceRef,
            localAgentRef: identity.localAgentRef,
            conversationAnchorId,
            requestId,
            events: [],
            messages,
            reasoningText: null,
            outputText: scenario.responseText,
            diagnostics: null,
          };
        },
        async openDesktopRuntimeSettings(): Promise<void> {
          return undefined;
        },
        async openDesktopSelectPartner(): ReturnType<ZhiyuCanonicalRendererBindings['app']['commands']['openDesktopSelectPartner']> {
          return {
            state: 'rejected' as const,
            actionId: 'desktop_open_select_partner' as const,
            reasonCode: 'desktop-open-target-unsupported',
            actionHint: 'select_simulated_partner',
            message: 'Desktop navigation is unavailable; choose a partner in this simulated instance.',
          };
        },
        async launchAvatar(): ReturnType<ZhiyuCanonicalRendererBindings['app']['commands']['launchAvatar']> {
          return {
            state: 'blocked' as const,
            reasonCode: 'zhiyu-avatar-simulator-effect-forbidden',
            actionHint: 'inspect_simulated_companion_state',
            message: 'Avatar host launch is intentionally unavailable in the Simulator.',
          };
        },
      }),
      events: Object.freeze({
        subscribeConversation(input: Parameters<ZhiyuCanonicalRendererBindings['app']['events']['subscribeConversation']>[0]) {
          void input;
          return () => undefined;
        },
      }),
    },
    route: Object.freeze({
      get: () => ({ pathname: currentRoute.pathname }),
      subscribe(listener: () => void) {
        routeListeners.add(listener);
        return () => routeListeners.delete(listener);
      },
    }),
    clock: Object.freeze({ now: () => context.clock.now() }),
    surfaceLifecycle: context.kit.surfaceLifecycle,
  });
}
