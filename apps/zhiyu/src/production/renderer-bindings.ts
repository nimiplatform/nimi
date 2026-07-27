import {
  createNimiCanonicalRendererHostBindings,
  type NimiRendererHostFacadeV1,
  type NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';
import {
  createNimiRuntimeAgentClient,
  createNimiRuntimeAgentConsumeClient,
  type NimiRuntimeAgentAIConfigReadinessSnapshotProjection,
  type NimiRuntimeAgentConsumeEvent,
} from '@nimiplatform/sdk/runtime';

import type { ZhiyuCanonicalRendererBindings, ZhiyuHomeProjection } from '../renderer/contract.js';
import { probeZhiyuRuntimeAgentInventory } from '../shell/agent/agent-inventory.js';
import { probeZhiyuRuntimeCompanionState } from '../shell/agent/companion-state.js';
import { probeZhiyuRuntimeConversationHome } from '../shell/agent/conversation-home.js';
import { probeZhiyuRuntimeDelegationUx } from '../shell/agent/delegation-ux.js';
import { projectZhiyuDiaryReflectionArtifacts } from '../shell/agent/diary-reflection.js';
import { resolveZhiyuRuntimeLocalAgentSelection } from '../shell/agent/local-agent-selection.js';
import { probeZhiyuRuntimeMemoryObservatory } from '../shell/agent/memory-observatory.js';
import { projectZhiyuProposalIntakeStatus } from '../shell/agent/proposal-intake.js';
import { projectZhiyuRuntimeSourceProjection } from '../shell/agent/source-projection.js';
import {
  fetchZhiyuAgentAIConfigRouteEvidence,
  subscribeZhiyuAgentAIConfigReadiness,
} from '../shell/agent-chat/agent-ai-config.js';
import {
  hydrateZhiyuAgentChatFromRuntimeSessionSnapshot,
  projectZhiyuCompanionFromRuntimeAgentEvent,
} from '../shell/agent-chat/agent-conversation-state.js';
import { probeZhiyuAgentTurnReadiness } from '../shell/agent-chat/agent-turn-readiness.js';
import { runZhiyuAgentChatTurn } from '../shell/agent-chat/runtime-agent-turn-adapter.js';
import {
  resolveZhiyuRuntimeAgentBindingDecisionFromHost,
  scopedBindingForRuntimeAgentRequest,
  withZhiyuRuntimeAgentBindingRequired,
} from '../shell/agent-chat/runtime-agent-binding.js';
import {
  createBrowserVoiceCaptureRecorder,
  createElectronVoiceCaptureTranscriber,
  createZhiyuVoiceCaptureController,
} from '../shell/agent-chat/voice-capture.js';
import type { ZhiyuEvidence } from '../shell/app/evidence.js';
import { loadZhiyuSourceContextProjection } from '../shell/app/source-context-loader.js';
import { runZhiyuVoicePlaybackAction } from '../shell/app/voice-playback-action.js';
import { probeZhiyuAvatarPresence } from '../shell/avatar/avatar-presence.js';
import { launchZhiyuAvatar } from '../shell/avatar/avatar-launch-handoff.js';
import { probeZhiyuRuntimeAccountStatus } from '../shell/auth/runtime-account-status.js';
import { getZhiyuRuntime } from '../shell/auth/runtime-platform.js';
import { requestZhiyuDesktopOpenSelectPartner } from '../shell/desktop-open/desktop-open-action.js';
import { probeZhiyuRuntimeStatus } from '../shell/runtime/runtime-status.js';
import { createZhiyuProductionTurnRequestId } from './turn-request-id.js';
import { createZhiyuProductionAgentCenterAdapters } from './agent-center-adapters.js';

function productionRoutePort(): ZhiyuCanonicalRendererBindings['route'] {
  return Object.freeze({
    get: () => ({ pathname: window.location.pathname }),
    subscribe(listener: () => void) {
      window.addEventListener('popstate', listener);
      return () => window.removeEventListener('popstate', listener);
    },
  });
}

async function loadHome(selectedLocalAgentRef: string | null): Promise<ZhiyuHomeProjection> {
  const [runtime, auth] = await Promise.all([
    probeZhiyuRuntimeStatus(),
    probeZhiyuRuntimeAccountStatus(),
  ]);
  const inventory = await probeZhiyuRuntimeAgentInventory(auth);
  const localAgent = resolveZhiyuRuntimeLocalAgentSelection({ inventory, selectedLocalAgentRef });
  const source = projectZhiyuRuntimeSourceProjection({
    ownerUserId: localAgent.ownerUserId,
    runtimeSourceRef: localAgent.runtimeSourceRef,
    localAgentRef: localAgent.localAgentRef,
    sourceContextStatus: null,
  });
  const diaryReflection = projectZhiyuDiaryReflectionArtifacts(localAgent);
  const [conversation, memory, companion, avatar] = await Promise.all([
    probeZhiyuRuntimeConversationHome(localAgent),
    probeZhiyuRuntimeMemoryObservatory(localAgent),
    probeZhiyuRuntimeCompanionState(localAgent),
    probeZhiyuAvatarPresence(localAgent),
  ]);
  const delegation = await probeZhiyuRuntimeDelegationUx(conversation);
  return {
    runtime,
    auth,
    source,
    inventory,
    localAgent,
    conversation,
    memory,
    companion,
    diaryReflection,
    delegation,
    proposal: projectZhiyuProposalIntakeStatus({ conversation }),
    avatar,
  };
}

async function hydrateConversation(input: Parameters<ZhiyuCanonicalRendererBindings['app']['projection']['hydrateConversation']>[0]) {
  const runtime = getZhiyuRuntime();
  const client = createNimiRuntimeAgentClient({
    runtime,
    appId: 'nimi.zhiyu',
    getSubjectUserId: () => input.ownerUserId,
    withScopes: withZhiyuRuntimeAgentBindingRequired,
  });
  const consume = createNimiRuntimeAgentConsumeClient({
    runtime: { agents: runtime.agents, appMessages: runtime.appMessages },
    runtimeAppId: 'nimi.zhiyu',
  });
  const identity = {
    ownerUserId: input.ownerUserId,
    runtimeSourceRef: input.runtimeSourceRef,
    localAgentRef: input.localAgentRef,
    conversationAnchorId: input.conversationAnchorId,
  };
  const [snapshot, anchorSnapshot] = await Promise.all([
    client.getSessionSnapshot(identity),
    withZhiyuRuntimeAgentBindingRequired(['runtime.agent.turn.read'], (callOptions) => {
      const binding = resolveZhiyuRuntimeAgentBindingDecisionFromHost(['runtime.agent.turn.read']);
      return consume.anchors.getSnapshot({
        ...identity,
        subjectUserId: input.ownerUserId,
        scopedBinding: scopedBindingForRuntimeAgentRequest(binding),
      }, callOptions);
    }),
  ]);
  return {
    source: projectZhiyuRuntimeSourceProjection({
      ownerUserId: input.ownerUserId,
      runtimeSourceRef: input.runtimeSourceRef,
      localAgentRef: input.localAgentRef,
      sourceContextStatus: anchorSnapshot.sourceContextStatus ?? input.currentSource.sourceContextStatus,
      turnContextSummary: anchorSnapshot.turnContextSummary ?? null,
    }),
    chat: hydrateZhiyuAgentChatFromRuntimeSessionSnapshot({
      current: input.currentChat,
      ...identity,
      snapshot,
    }),
  };
}

export function createZhiyuProductionBindings(
  kit: NimiRendererHostFacadeV1<NimiRendererHostMethodMap>,
): ZhiyuCanonicalRendererBindings {
  return createNimiCanonicalRendererHostBindings({
    scope: kit.scope,
    capabilities: kit.capabilities,
    localization: kit.localization,
    kit,
    sdk: Object.freeze({}),
    app: {
      projection: Object.freeze({
        agentCenterAdapters: createZhiyuProductionAgentCenterAdapters,
        loadHome: ({ selectedLocalAgentRef }: Parameters<ZhiyuCanonicalRendererBindings['app']['projection']['loadHome']>[0]) => loadHome(selectedLocalAgentRef),
        loadExecutionRoute: fetchZhiyuAgentAIConfigRouteEvidence,
        projectTurnReadiness: probeZhiyuAgentTurnReadiness,
        hydrateConversation,
        loadSourceContext: loadZhiyuSourceContextProjection,
      }),
      commands: Object.freeze({
        async allocateTurnRequestId() {
          return createZhiyuProductionTurnRequestId();
        },
        runTurn: runZhiyuAgentChatTurn,
        createVoiceCapture(input: Parameters<ZhiyuCanonicalRendererBindings['app']['commands']['createVoiceCapture']>[0]) {
          return createZhiyuVoiceCaptureController({
            readiness: input.readiness,
            createRecorder: createBrowserVoiceCaptureRecorder,
            transcribe: createElectronVoiceCaptureTranscriber({
              agentId: input.agentId,
              ownerUserId: input.ownerUserId,
            }),
            onStateChange: input.onStateChange,
          });
        },
        async runVoicePlayback(evidence: ZhiyuEvidence) {
          let current = evidence;
          await runZhiyuVoicePlaybackAction(evidence, (update) => {
            current = update(current);
          });
          return current.companion;
        },
        openDesktopSelectPartner: requestZhiyuDesktopOpenSelectPartner,
        launchAvatar: ({ evidence, action }: Parameters<ZhiyuCanonicalRendererBindings['app']['commands']['launchAvatar']>[0]) => launchZhiyuAvatar({ evidence, action }),
      }),
      events: Object.freeze({
        subscribeExecutionRoute({ routeInput, onRoute }: Parameters<ZhiyuCanonicalRendererBindings['app']['events']['subscribeExecutionRoute']>[0]) {
          const subjectUserId = routeInput.subjectUserId;
          if (!subjectUserId || !routeInput.ownerUserId || !routeInput.runtimeSourceRef || !routeInput.localAgentRef) {
            return () => undefined;
          }
          let active = true;
          let iterator: AsyncIterator<NimiRuntimeAgentAIConfigReadinessSnapshotProjection> | null = null;
          void (async () => {
            try {
              const stream = subscribeZhiyuAgentAIConfigReadiness({
                subjectUserId,
                ownerUserId: routeInput.ownerUserId!,
                runtimeSourceRef: routeInput.runtimeSourceRef!,
                localAgentRef: routeInput.localAgentRef!,
              });
              iterator = stream[Symbol.asyncIterator]();
              while (active) {
                const next = await iterator.next();
                if (next.done) break;
                const route = await fetchZhiyuAgentAIConfigRouteEvidence(routeInput);
                if (active) onRoute(route);
              }
            } catch {
              // Initial route evidence remains fail-closed when live refresh is unavailable.
            }
          })();
          return () => {
            active = false;
            void iterator?.return?.();
          };
        },
        subscribeCompanion(input: Parameters<ZhiyuCanonicalRendererBindings['app']['events']['subscribeCompanion']>[0]) {
          let active = true;
          let iterator: AsyncIterator<NimiRuntimeAgentConsumeEvent> | null = null;
          void (async () => {
            const runtime = getZhiyuRuntime();
            const client = createNimiRuntimeAgentClient({
              runtime,
              appId: 'nimi.zhiyu',
              getSubjectUserId: () => input.ownerUserId,
              withScopes: withZhiyuRuntimeAgentBindingRequired,
            });
            try {
              const stream = await client.subscribeEvents({
                ownerUserId: input.ownerUserId,
                runtimeSourceRef: input.runtimeSourceRef,
                localAgentRef: input.localAgentRef,
                conversationAnchorId: input.conversationAnchorId,
                includeAgentEvents: true,
              });
              iterator = stream[Symbol.asyncIterator]();
              let companion: ZhiyuEvidence['companion'] | null = null;
              while (active) {
                const next = await iterator.next();
                if (next.done) break;
                companion = projectZhiyuCompanionFromRuntimeAgentEvent({
                  current: companion ?? (await probeZhiyuRuntimeCompanionState({
                    transport: 'electron-ipc',
                    ready: true,
                    reasonCode: 'runtime-local-agent-selected',
                    actionHint: 'open_runtime_agent_home',
                    source: 'runtime',
                    message: 'Runtime-owned LocalAgent selected.',
                    ownerUserId: input.ownerUserId,
                    runtimeSourceRef: input.runtimeSourceRef,
                    localAgentRef: input.localAgentRef,
                  })),
                  event: next.value,
                  ownerUserId: input.ownerUserId,
                  runtimeSourceRef: input.runtimeSourceRef,
                  observedAt: new Date().toISOString(),
                });
                input.onCompanion(companion);
              }
            } catch {
              // Initial companion evidence remains fail-closed when live events are unavailable.
            }
          })();
          return () => {
            active = false;
            void iterator?.return?.();
          };
        },
      }),
    },
    route: productionRoutePort(),
    clock: Object.freeze({ now: () => Date.now() }),
    surfaceLifecycle: kit.surfaceLifecycle,
  });
}
