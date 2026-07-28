import { createNimiCanonicalRendererHostBindings } from '@nimiplatform/kit/shell/renderer/host';

import type { ZhiyuCanonicalRendererBindings, ZhiyuHomeProjection } from '../renderer/contract.js';
import type { ZhiyuRuntimeAgentChatTurnResult } from '../shell/agent-chat/runtime-agent-turn-adapter.js';
import { createInitialZhiyuEvidence, type ZhiyuEvidence } from '../shell/app/evidence.js';
import type { ZhiyuVoiceCaptureEvidence } from '../shell/agent-chat/voice-capture-evidence.js';
import type { ZhiyuSimulatorJsonValue, ZhiyuSimulatorPrepareContext } from './protocol.js';

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

function simulatedHome(
  context: ZhiyuSimulatorPrepareContext,
  selectedLocalAgentRef: string | null,
): ZhiyuHomeProjection {
  const scenario = projection(context).scenario;
  const selected = scenario.agents.find((agent) => agent.localAgentRef === selectedLocalAgentRef)
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
      ...identity,
      sourceRef: null,
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
        ...agent,
        ownerUserId: scenario.ownerUserId,
        sourceReady: true,
      })),
    },
    localAgent: {
      transport: 'electron-ipc',
      ready: true,
      reasonCode: 'runtime-local-agent-selected',
      actionHint: 'open_runtime_agent_home',
      ...simulatedStatus,
      ...identity,
    },
    conversation: {
      transport: 'electron-ipc',
      ready: true,
      reasonCode: 'conversation-anchor-open',
      actionHint: 'send_runtime_agent_turn',
      ...simulatedStatus,
      ...identity,
      conversationAnchorId: `sim-conversation:${selected.localAgentRef}`,
      threadId: `sim-thread:${selected.localAgentRef}`,
    },
    memory: { ...initial.memory, ...identity },
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

function simulatedRoute(context: ZhiyuSimulatorPrepareContext): ZhiyuEvidence['route'] {
  return {
    transport: 'electron-ipc',
    ready: true,
    capability: 'text.generate',
    configRevision: 1,
    readinessRevision: 1,
    updatedAt: new Date(context.clock.now()).toISOString(),
    updatedByAppId: 'nimi.zhiyu',
    capabilities: {
      'text.generate': {
        state: 'ready',
        reasonCode: 'ready',
        probedAt: new Date(context.clock.now()).toISOString(),
        binding: null,
      },
    },
    executionBinding: null,
    reasonCode: 'zhiyu-agent-ai-config-ready',
    actionHint: 'send_runtime_agent_turn',
    source: 'simulator',
    message: 'Deterministic Simulator text route is ready.',
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

function simulatedVoiceUnavailable(readiness: ZhiyuVoiceCaptureEvidence): ZhiyuVoiceCaptureEvidence {
  return {
    ...readiness,
    ready: false,
    state: 'failed',
    reasonCode: 'runtime-voice-capture-effect-forbidden',
    actionHint: 'use_text_input_in_simulator',
    source: 'simulator',
    message: 'Microphone capture is intentionally unavailable in the Simulator.',
  };
}

function simulatedAgentCenterAdapters(
  evidence: ZhiyuEvidence,
): ReturnType<ZhiyuCanonicalRendererBindings['app']['projection']['agentCenterAdapters']> {
  return {
    appearance: {
      async load() {
        return {
          status: 'not_configured',
          backendKind: evidence.avatar.backendKind || null,
          avatarAssetRef: null,
          avatarAssetValid: false,
          avatarAssetChecking: false,
          validationStatus: 'selection_missing',
          validationMessage: 'Avatar asset mutation is intentionally unavailable in the Simulator.',
          validationIssueRows: [],
          backendCapabilityProfileRef: null,
          backgroundRef: null,
          backgroundValid: false,
          backgroundChecking: false,
          backgroundValidationStatus: 'selection_missing',
          backgroundValidationMessage: null,
          previewState: null,
          previewTier: null,
          previewImageRef: null,
          previewFailureReason: null,
          previewWarnings: [],
          defaultVoiceReference: null,
          avatarAutoplay: false,
          avatarImportDisabled: true,
          backgroundImportDisabled: true,
          disabledReason: 'zhiyu-agent-center-simulator-effect-forbidden',
        };
      },
    },
    runtime: null,
  };
}

export function createZhiyuSimulatorBindings(
  context: ZhiyuSimulatorPrepareContext,
): ZhiyuCanonicalRendererBindings {
  let latestProjection: ZhiyuEvidence | null = null;
  const companionListeners = new Set<(companion: ZhiyuEvidence['companion']) => void>();
  let currentRoute = context.route.get();
  const routeListeners = new Set<() => void>();
  const unsubscribeRoute = context.route.subscribe((route) => {
    currentRoute = route;
    for (const listener of routeListeners) listener();
  });
  const eventSubscription = context.events.subscribe('zhiyu.conversation.updated', () => {
    if (!latestProjection) return;
    const companion: ZhiyuEvidence['companion'] = {
      ...latestProjection.companion,
      ready: true,
      state: 'projected',
      reasonCode: 'runtime-agent-state-event-projected',
      actionHint: 'inspect_runtime_agent_state_projection',
      source: 'simulator',
      message: 'Simulator conversation event projected into companion state.',
      executionState: 'idle',
      statusText: '刚刚完成一次回复',
      observedAt: new Date(context.clock.now()).toISOString(),
    };
    for (const listener of companionListeners) listener(companion);
  });
  if (!eventSubscription.ok) throw new Error('ZHIYU_SIMULATOR_EVENT_SUBSCRIPTION_REJECTED');
  let observedEcosystemRevision = 0;
  let observedPersonaKey: string | null = null;
  const projectEcosystemCompanion = (
    value: Projection,
  ): ZhiyuEvidence['companion'] | null => {
    const revision = ecosystemRevisionOf(value) ?? 0;
    const personaName = personaDisplayNameOf(value);
    if (revision === 0 && !personaName) return null;
    const baseline = latestProjection?.companion ?? simulatedHome(context, null).companion;
    observedEcosystemRevision = Math.max(observedEcosystemRevision, revision);
    return {
      ...baseline,
      ready: true,
      state: 'projected',
      reasonCode: 'simulator-ecosystem-reference-projected',
      actionHint: 'inspect_simulated_ecosystem_revision',
      source: 'simulator',
      message: personaName
        ? `Simulated resident ${personaName} joined the shared ecosystem projection.`
        : `Shared simulated ecosystem revision ${revision} reached Zhiyu.`,
      executionState: 'idle',
      statusText: companionStatusText(value),
      observedAt: new Date(context.clock.now()).toISOString(),
    };
  };
  const unsubscribeProjection = context.projection.subscribe(() => {
    const value = projection(context);
    const revision = ecosystemRevisionOf(value) ?? 0;
    const personaReference = value.personaReference;
    const personaKey = personaReference && typeof personaReference.interactionId === 'string'
      ? personaReference.interactionId
      : null;
    if (revision <= observedEcosystemRevision && personaKey === observedPersonaKey) return;
    observedPersonaKey = personaKey;
    const companion = projectEcosystemCompanion(value);
    if (!companion) return;
    for (const listener of companionListeners) listener(companion);
  });
  const cleanupRegistration = context.cleanup.add(() => {
    routeListeners.clear();
    unsubscribeRoute();
    unsubscribeProjection();
    companionListeners.clear();
    eventSubscription.value();
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
        agentCenterAdapters: simulatedAgentCenterAdapters,
        loadHome: ({ selectedLocalAgentRef }: { readonly selectedLocalAgentRef: string | null }) => (
          Promise.resolve(simulatedHome(context, selectedLocalAgentRef))
        ),
        loadExecutionRoute: async () => simulatedRoute(context),
        projectTurnReadiness: simulatedTurnReady,
        async hydrateConversation(input: Parameters<ZhiyuCanonicalRendererBindings['app']['projection']['hydrateConversation']>[0]) {
          return { source: input.currentSource, chat: input.currentChat };
        },
        async loadSourceContext(input: Parameters<ZhiyuCanonicalRendererBindings['app']['projection']['loadSourceContext']>[0]) {
          const home = simulatedHome(context, input.localAgentRef);
          return home.source;
        },
      }),
      commands: Object.freeze({
        async allocateTurnRequestId() {
          const accepted = await invoke(context, 'zhiyu.turn.allocate', {});
          return `zhiyu-turn-sim-${accepted.revision}`;
        },
        async runTurn(input: Parameters<ZhiyuCanonicalRendererBindings['app']['commands']['runTurn']>[0]): Promise<ZhiyuRuntimeAgentChatTurnResult> {
          const requestId = typeof input.requestId === 'string' ? input.requestId.trim() : '';
          const text = typeof input.text === 'string' ? input.text.trim() : '';
          if (!requestId || !text || !input.conversation.ownerUserId || !input.conversation.runtimeSourceRef
            || !input.conversation.localAgentRef || !input.conversation.conversationAnchorId) {
            throw new Error('ZHIYU_SIMULATOR_TURN_INPUT_INVALID');
          }
          if (input.signal?.aborted) throw new Error('ZHIYU_SIMULATOR_TURN_ABORTED');
          await invoke(context, 'zhiyu.turn.submit', { requestId, text });
          const scenario = projection(context).scenario;
          const createdAt = new Date(context.clock.now()).toISOString();
          const identity = input.conversation;
          const conversationAnchorId = identity.conversationAnchorId;
          const localAgentRef = identity.localAgentRef;
          if (!conversationAnchorId || !localAgentRef) throw new Error('ZHIYU_SIMULATOR_TURN_IDENTITY_LOST');
          const messages = [{
            id: `${requestId}:user`,
            sessionId: conversationAnchorId,
            targetId: localAgentRef,
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
            targetId: localAgentRef,
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
            ownerUserId: identity.ownerUserId,
            runtimeSourceRef: identity.runtimeSourceRef,
            localAgentRef,
            conversationAnchorId,
            requestId,
            events: [],
            messages,
            reasoningText: null,
            outputText: scenario.responseText,
            diagnostics: null,
          };
        },
        createVoiceCapture(input: Parameters<ZhiyuCanonicalRendererBindings['app']['commands']['createVoiceCapture']>[0]) {
          const unavailable = simulatedVoiceUnavailable(input.readiness);
          return Object.freeze({
            async start() {
              input.onStateChange(unavailable);
              return unavailable;
            },
            async stop() {
              input.onStateChange(unavailable);
              return unavailable;
            },
          });
        },
        async runVoicePlayback(evidence: ZhiyuEvidence) {
          return {
            ...evidence.companion,
            ready: false,
            state: 'blocked' as const,
            reasonCode: 'runtime-voice-playback-effect-forbidden',
            actionHint: 'use_text_response_in_simulator',
            source: 'simulator',
            message: 'Audio playback is intentionally unavailable in the Simulator.',
          };
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
        onProjectionChanged(projection: ZhiyuEvidence) {
          latestProjection = projection;
        },
        subscribeExecutionRoute({ onRoute }: Parameters<ZhiyuCanonicalRendererBindings['app']['events']['subscribeExecutionRoute']>[0]) {
          return context.projection.subscribe(() => onRoute(simulatedRoute(context)));
        },
        subscribeCompanion({ onCompanion }: Parameters<ZhiyuCanonicalRendererBindings['app']['events']['subscribeCompanion']>[0]) {
          companionListeners.add(onCompanion);
          const value = projection(context);
          if (ecosystemRevisionOf(value) !== null || personaDisplayNameOf(value) !== null) {
            const companion = projectEcosystemCompanion(value);
            if (companion) onCompanion(companion);
          }
          return () => companionListeners.delete(onCompanion);
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
