import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CANONICAL_CAPABILITY_CATALOG,
  CANONICAL_CAPABILITY_DEFERRED,
} from '@nimiplatform/kit/core/runtime-capabilities';
import {
  createNimiRuntimeAgentClient,
  Runtime,
  type NimiRuntimeAgentConsumeEvent,
} from '@nimiplatform/sdk/runtime';
import {
  createInitialZhiyuEvidence,
  type ZhiyuCapabilityStudioStatus,
  type ZhiyuEvidence,
} from './evidence';
import {
  appendSubmittedUserMessage,
  cancelStreamingChatMessages,
  capabilityStudioFromResult,
  capabilityStudioUnavailable,
  chatStatusFromProjection,
  chatStatusFromResult,
  chatStatusFromSubmitRefreshFailure,
  createZhiyuTurnRequestId,
  ensureSubmittedUserMessageInChat,
  mergeChatTranscript,
  turnStatusFromChat,
} from './app-evidence-transitions';
import { ZhiyuAgentChatSurface } from '../agent-chat/ZhiyuAgentChatSurface';
import { projectZhiyuCapabilityRoomState } from './capability-room-state';
import { projectZhiyuDiagnosticState } from './diagnostic-state';
import { projectZhiyuHomeProductState } from './home-product-state';
import { projectZhiyuIdentitySafetyEvidence } from './identity-safety-evidence';
import { projectZhiyuIdentityFloorState } from './identity-floor-state';
import { projectZhiyuAvatarLaunchAction } from '../avatar/avatar-launch';
import { probeZhiyuAvatarPresence } from '../avatar/avatar-presence';
import {
  runZhiyuDeveloperCapabilityStudioAIConsume,
  type ZhiyuCapabilityStudioCapabilityId,
} from './developer-capability-studio';
import { ZhiyuAiConfigSettings } from '../ai-config/zhiyu-ai-config-settings';
import {
  createZhiyuAgentHomeAIScopeRef,
  createZhiyuAIConfigService,
  refreshZhiyuAIConfig,
} from '../ai-config/zhiyu-ai-config-store';
import { createZhiyuRuntimeModelPickerProviderCache } from '../ai-config/zhiyu-runtime-model-provider';
import { probeZhiyuRuntimeAgentInventory } from '../agent/agent-inventory';
import { probeZhiyuRuntimeCompanionState } from '../agent/companion-state';
import { probeZhiyuRuntimeConversationHome } from '../agent/conversation-home';
import {
  probeZhiyuRuntimeDelegationUx,
  submitZhiyuRuntimeDelegationApproval,
} from '../agent/delegation-ux';
import { projectZhiyuDiaryReflectionArtifacts } from '../agent/diary-reflection';
import { probeZhiyuLocalAgentDiscovery } from '../agent/local-agent-discovery';
import { resolveZhiyuRuntimeLocalAgentSelection } from '../agent/local-agent-selection';
import { probeZhiyuRuntimeMemoryObservatory } from '../agent/memory-observatory';
import {
  projectZhiyuProposalIntakeStatus,
  submitZhiyuCapabilityProposal,
} from '../agent/proposal-intake';
import {
  probeZhiyuAgentRouteReadiness,
  probeZhiyuAgentTurnReadiness,
} from '../agent-chat/agent-route-readiness';
import {
  hydrateZhiyuAgentChatFromRuntimeSessionSnapshot,
  projectZhiyuCompanionFromRuntimeAgentEvent,
} from '../agent-chat/agent-conversation-state';
import { probeZhiyuRuntimeSourceProjection } from '../agent/source-projection';
import { runZhiyuAgentChatTurn } from '../agent-chat/runtime-agent-turn-adapter';
import { withZhiyuRuntimeAgentBindingRequired } from '../agent-chat/runtime-agent-binding';
import { probeZhiyuRuntimeAccountStatus } from '../auth/runtime-account-status';
import { probeZhiyuRuntimeStatus } from '../runtime/runtime-status';

export function App() {
  const aiConfigScopeRef = useMemo(() => createZhiyuAgentHomeAIScopeRef(), []);
  const aiConfigService = useMemo(() => createZhiyuAIConfigService(), []);
  const modelPickerProviderResolver = useMemo(() => createZhiyuRuntimeModelPickerProviderCache(), []);
  const [aiConfig, setAiConfig] = useState(() => aiConfigService.aiConfig.get(aiConfigScopeRef));
  const [evidence, setEvidence] = useState<ZhiyuEvidence>(() => createInitialZhiyuEvidence());
  const [selectedLocalAgentRef, setSelectedLocalAgentRef] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [capabilityPrompt, setCapabilityPrompt] = useState('');
  const activeChatAbortRef = useRef<AbortController | null>(null);
  const renderEvidence = useMemo(() => projectZhiyuIdentitySafetyEvidence(evidence), [evidence]);

  useEffect(() => {
    setAiConfig(aiConfigService.aiConfig.get(aiConfigScopeRef));
    return aiConfigService.aiConfig.subscribe(aiConfigScopeRef, setAiConfig);
  }, [aiConfigScopeRef, aiConfigService]);

  useEffect(() => {
    window.__nimiZhiyuEvidence = renderEvidence;
  }, [renderEvidence]);

  useEffect(() => {
    window.__nimiZhiyuAbortActiveTurn = (reason?: string) => {
      const active = activeChatAbortRef.current;
      if (active && !active.signal.aborted) {
        active.abort(reason || 'zhiyu_chat_turn_interrupted');
      }
    };
    return () => {
      window.__nimiZhiyuAbortActiveTurn?.('zhiyu_app_unmount');
      delete window.__nimiZhiyuAbortActiveTurn;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [runtime, auth, source] = await Promise.all([
        probeZhiyuRuntimeStatus(),
        probeZhiyuRuntimeAccountStatus(),
        probeZhiyuRuntimeSourceProjection(),
      ]);
      const inventory = await probeZhiyuRuntimeAgentInventory(auth);
      const sourceLocalAgent = await probeZhiyuLocalAgentDiscovery(source.ready ? {
        ownerUserId: source.ownerUserId,
        runtimeSourceRef: source.runtimeSourceRef,
        sourceRef: source.sourceRef,
      } : {});
      const localAgent = resolveZhiyuRuntimeLocalAgentSelection({
        sourceLocalAgent,
        inventory,
        selectedLocalAgentRef,
      });
      const diaryReflection = projectZhiyuDiaryReflectionArtifacts(localAgent);
      const [conversation, memory, route, companion, avatar] = await Promise.all([
        probeZhiyuRuntimeConversationHome(localAgent),
        probeZhiyuRuntimeMemoryObservatory(localAgent),
        probeZhiyuAgentRouteReadiness({ config: aiConfig }),
        probeZhiyuRuntimeCompanionState(localAgent),
        probeZhiyuAvatarPresence(localAgent),
      ]);
      const delegation = await probeZhiyuRuntimeDelegationUx(conversation);
      const proposal = projectZhiyuProposalIntakeStatus({ conversation });
      const turn = probeZhiyuAgentTurnReadiness(conversation, route.executionBinding);
      if (!active) {
        return;
      }
      setEvidence((current) => ({
        ...current,
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
        proposal,
        avatar,
        route,
        turn,
      }));
    })();
    return () => {
      active = false;
    };
  }, [aiConfig, selectedLocalAgentRef]);

  useEffect(() => {
    const ownerUserId = renderEvidence.conversation.ownerUserId;
    const runtimeSourceRef = renderEvidence.conversation.runtimeSourceRef;
    const localAgentRef = renderEvidence.conversation.localAgentRef;
    const conversationAnchorId = renderEvidence.conversation.conversationAnchorId;
    if (
      !renderEvidence.conversation.ready
      || !ownerUserId
      || !runtimeSourceRef
      || !localAgentRef
      || !conversationAnchorId
    ) {
      return undefined;
    }

    let active = true;
    let eventIterator: AsyncIterator<NimiRuntimeAgentConsumeEvent> | null = null;
    void (async () => {
      const runtime = new Runtime({
        appId: 'nimi.zhiyu',
        transport: { type: 'electron-ipc' },
      });
      const client = createNimiRuntimeAgentClient({
        runtime,
        appId: 'nimi.zhiyu',
        getSubjectUserId: () => ownerUserId,
        withScopes: withZhiyuRuntimeAgentBindingRequired,
      });
      const identity = {
        ownerUserId,
        runtimeSourceRef,
        localAgentRef,
        conversationAnchorId,
      };

      try {
        const snapshot = await client.getSessionSnapshot(identity);
        if (active) {
          setEvidence((current) => ({
            ...current,
            chat: hydrateZhiyuAgentChatFromRuntimeSessionSnapshot({
              current: current.chat,
              ...identity,
              snapshot,
            }),
          }));
        }
      } catch {
        // Turn readiness already exposes missing binding/runtime failures; hydration must not invent success.
      }

      try {
        const stream = await client.subscribeEvents({
          ...identity,
          includeAgentEvents: true,
        });
        eventIterator = stream[Symbol.asyncIterator]();
        while (active) {
          const next = await eventIterator.next();
          if (next.done) {
            break;
          }
          const event = next.value;
          setEvidence((current) => ({
            ...current,
            companion: projectZhiyuCompanionFromRuntimeAgentEvent({
              current: current.companion,
              event,
              ownerUserId,
              runtimeSourceRef,
            }),
          }));
        }
      } catch {
        // Reactive subscription is best-effort after fail-closed initial probes.
      }
    })();

    return () => {
      active = false;
      void eventIterator?.return?.();
    };
  }, [
    renderEvidence.conversation.ready,
    renderEvidence.conversation.ownerUserId,
    renderEvidence.conversation.runtimeSourceRef,
    renderEvidence.conversation.localAgentRef,
    renderEvidence.conversation.conversationAnchorId,
  ]);

  const product = useMemo(() => projectZhiyuHomeProductState(renderEvidence), [renderEvidence]);
  const capabilityRoom = useMemo(() => projectZhiyuCapabilityRoomState({
    evidence: renderEvidence,
    catalog: CANONICAL_CAPABILITY_CATALOG,
    deferred: CANONICAL_CAPABILITY_DEFERRED,
  }), [renderEvidence]);
  const diagnostics = useMemo(() => projectZhiyuDiagnosticState(renderEvidence), [renderEvidence]);
  const identityFloor = useMemo(() => projectZhiyuIdentityFloorState(renderEvidence), [renderEvidence]);
  const avatarLaunchAction = useMemo(() => projectZhiyuAvatarLaunchAction(renderEvidence), [renderEvidence]);

  const recoverableFailedTurn = renderEvidence.chat.state === 'failed'
    && renderEvidence.chat.source === 'runtime'
    && renderEvidence.turn.source === 'runtime'
    && Boolean(renderEvidence.chat.requestId)
    && renderEvidence.chat.requestId === renderEvidence.turn.requestId
    && Boolean(renderEvidence.turn.messageId);
  const recoverableCanceledTurn = renderEvidence.chat.state === 'canceled'
    && renderEvidence.chat.reasonCode === 'runtime-agent-chat-user-canceled'
    && renderEvidence.turn.reasonCode === 'runtime-agent-chat-user-canceled'
    && Boolean(renderEvidence.chat.requestId)
    && renderEvidence.chat.requestId === renderEvidence.turn.requestId;
  const turnSubmitReady = renderEvidence.turn.ready || recoverableFailedTurn || recoverableCanceledTurn;
  const submitEnabled = renderEvidence.conversation.ready
    && Boolean(renderEvidence.route.executionBinding)
    && turnSubmitReady
    && renderEvidence.chat.state !== 'streaming'
    && renderEvidence.composer.submitState !== 'submitting'
    && draft.trim().length > 0;
  const composerState = evidence.chat.state === 'streaming' || evidence.composer.submitState === 'submitting'
    ? 'submitting'
    : submitEnabled
      ? 'ready'
      : 'blocked';
  const capabilityStudioDisabled = !renderEvidence.runtime.ready
    || !renderEvidence.auth.ready
    || !capabilityPrompt.trim()
    || renderEvidence.capabilityStudio.state === 'running';

  async function handleSubmit(textInput: string) {
    const text = textInput.trim();
    activeChatAbortRef.current?.abort('zhiyu_chat_turn_superseded');
    const refreshedConfig = await refreshZhiyuAIConfig(aiConfigScopeRef);
    setAiConfig(refreshedConfig);
    const refreshedRoute = await probeZhiyuAgentRouteReadiness({ config: refreshedConfig });
    const refreshedTurn = probeZhiyuAgentTurnReadiness(evidence.conversation, refreshedRoute.executionBinding);
    if (!refreshedRoute.ready || !refreshedRoute.executionBinding || !refreshedTurn.ready) {
      setEvidence((current) => {
        const chat = chatStatusFromSubmitRefreshFailure({
          current: current.chat,
          conversation: current.conversation,
          route: refreshedRoute,
          turn: refreshedTurn,
        });
        return {
          ...current,
          route: refreshedRoute,
          turn: refreshedTurn,
          chat,
          composer: {
            ...current.composer,
            submitState: 'failed',
            draftLength: text.length,
            reasonCode: chat.reasonCode,
            actionHint: chat.actionHint,
            source: chat.source,
            message: chat.message,
          },
        };
      });
      activeChatAbortRef.current = null;
      return;
    }
    const requestId = createZhiyuTurnRequestId();
    const activeChatAbort = new AbortController();
    activeChatAbortRef.current = activeChatAbort;
    setEvidence((current) => ({
      ...current,
      route: refreshedRoute,
      turn: refreshedTurn,
      composer: {
        ...current.composer,
        submitState: 'submitting',
        draftLength: text.trim().length,
        reasonCode: 'zhiyu-runtime-turn-submitting',
        actionHint: 'wait_runtime_agent_turn_stream',
        source: 'renderer',
        message: 'Runtime Agent chat turn is being submitted.',
      },
      chat: {
        ...appendSubmittedUserMessage(current.chat, current.conversation, requestId, text),
        ready: false,
        state: 'streaming',
        reasonCode: 'runtime-agent-chat-submitting',
        actionHint: 'wait_runtime_agent_turn_stream',
        source: 'renderer',
        message: 'Runtime Agent chat turn is being submitted.',
      },
    }));
    const submitted = await runZhiyuAgentChatTurn({
      conversation: evidence.conversation,
      route: refreshedRoute,
      text,
      requestId,
      expectedConversationAnchorId: evidence.conversation.conversationAnchorId,
      signal: activeChatAbort.signal,
      onEvent: (_event, projection) => {
        if (activeChatAbort.signal.aborted || activeChatAbortRef.current !== activeChatAbort) {
          return;
        }
        setEvidence((current) => {
          const projectionChat = ensureSubmittedUserMessageInChat(
            chatStatusFromProjection(projection, current.conversation),
            current.conversation,
            requestId,
            text,
          );
          const chat = mergeChatTranscript(current.chat, projectionChat);
          return {
            ...current,
            chat,
            turn: turnStatusFromChat(chat),
            composer: {
              ...current.composer,
              submitState: chat.state === 'streaming' ? 'submitting' : chat.ready ? 'accepted' : 'failed',
              draftLength: text.length,
              reasonCode: chat.reasonCode,
              actionHint: chat.actionHint,
              source: chat.source,
              message: chat.message,
            },
          };
        });
      },
    });
    if (activeChatAbort.signal.aborted) {
      if (activeChatAbortRef.current === activeChatAbort) {
        activeChatAbortRef.current = null;
      }
      return;
    }
    if (activeChatAbortRef.current === activeChatAbort) {
      activeChatAbortRef.current = null;
    }
    setEvidence((current) => {
      const resultChat = ensureSubmittedUserMessageInChat(
        chatStatusFromResult(submitted),
        current.conversation,
        submitted.requestId ?? requestId,
        text,
      );
      const chat = mergeChatTranscript(current.chat, resultChat);
      return {
        ...current,
        chat,
        turn: turnStatusFromChat(chat),
        composer: {
          ...current.composer,
          submitState: submitted.ready ? 'accepted' : 'failed',
          draftLength: text.trim().length,
          reasonCode: chat.reasonCode,
          actionHint: chat.actionHint,
          source: chat.source,
          message: chat.message,
        },
      };
    });
    if (submitted.ready) {
      setDraft('');
    }
  }

  function handleStopChat() {
    activeChatAbortRef.current?.abort('zhiyu_chat_turn_user_stopped');
    setEvidence((current) => {
      if (current.chat.state !== 'streaming' && current.composer.submitState !== 'submitting') {
        return current;
      }
      const messages = cancelStreamingChatMessages(current.chat.messages);
      const chat = {
        ...current.chat,
        ready: false,
        state: 'canceled' as const,
        reasonCode: 'runtime-agent-chat-user-canceled',
        actionHint: 'send_runtime_agent_turn',
        source: 'renderer',
        message: '当前回复已停止。',
        messageCount: messages.length,
        messages,
        latestAssistantText: null,
        outputText: null,
      };
      return {
        ...current,
        chat,
        turn: turnStatusFromChat(chat),
        composer: {
          ...current.composer,
          submitState: 'failed',
          reasonCode: chat.reasonCode,
          actionHint: chat.actionHint,
          source: chat.source,
          message: chat.message,
        },
      };
    });
  }

  function handleSelectLocalAgent(localAgentRef: string) {
    const selected = localAgentRef.trim();
    if (!selected) {
      return;
    }
    const initial = createInitialZhiyuEvidence();
    setSelectedLocalAgentRef(selected);
    setDraft('');
    setEvidence((current) => ({
      ...current,
      chat: initial.chat,
      turn: initial.turn,
      composer: initial.composer,
    }));
  }

  async function handleDelegationDecision(
    approvalRequestId: string,
    decision: 'approve' | 'reject',
  ) {
    const delegation = await submitZhiyuRuntimeDelegationApproval({
      conversation: evidence.conversation,
      approvalRequestId,
      decision,
    });
    setEvidence((current) => ({
      ...current,
      delegation,
    }));
  }

  async function handleProposalSubmit() {
    const proposal = await submitZhiyuCapabilityProposal({
      conversation: evidence.conversation,
    });
    setEvidence((current) => ({
      ...current,
      proposal,
    }));
  }

  async function handleCapabilityStudioRun(capabilityId: ZhiyuCapabilityStudioCapabilityId) {
    const prompt = capabilityPrompt.trim();
    if (!prompt) {
      setEvidence((current) => ({
        ...current,
        capabilityStudio: capabilityStudioUnavailable({
          capabilityId,
          reasonCode: 'zhiyu-capability-studio-prompt-required',
          actionHint: 'enter_capability_studio_prompt',
          message: 'Capability Studio prompt is required before dispatch.',
        }),
      }));
      return;
    }
    setEvidence((current) => ({
      ...current,
      capabilityStudio: {
        ...current.capabilityStudio,
        ready: false,
        state: 'running',
        reasonCode: 'zhiyu-capability-studio-running',
        actionHint: 'wait_runtime_ai_consume_result',
        source: 'renderer',
        message: `Running ${capabilityId} through Runtime.`,
        lastCapabilityId: capabilityId,
        resultKind: 'none',
        text: null,
        streamingText: capabilityId === 'chat.stream' ? '' : null,
        finishReason: null,
        vectorCount: null,
        dimensions: null,
        sample: [],
        audioJobId: null,
        audioJobStatus: null,
        audioArtifactCount: null,
        audioMimeType: null,
        audioPreviewUrl: null,
        traceId: null,
      },
    }));
    const runtime = new Runtime({
      appId: 'nimi.zhiyu',
      transport: { type: 'electron-ipc' },
    });
    const result = await runZhiyuDeveloperCapabilityStudioAIConsume({
      runtime,
      config: aiConfig,
      capabilityId,
      prompt,
      subjectUserId: renderEvidence.auth.accountId ?? undefined,
      withScopes: withZhiyuRuntimeAgentBindingRequired,
      onPartial: (streamingText) => {
        setEvidence((current) => ({
          ...current,
          capabilityStudio: {
            ...current.capabilityStudio,
            streamingText,
            text: streamingText,
            resultKind: 'text',
            message: streamingText,
          },
        }));
      },
    });
    setEvidence((current) => ({
      ...current,
      capabilityStudio: capabilityStudioFromResult(capabilityId, result),
    }));
  }

  return (
    <ZhiyuAgentChatSurface
      evidence={renderEvidence}
      product={product}
      capabilityRoom={capabilityRoom}
      diagnostics={diagnostics}
      identityFloor={identityFloor}
      draft={draft}
      capabilityPrompt={capabilityPrompt}
      submitEnabled={submitEnabled}
      composerState={composerState}
      capabilityStudioDisabled={capabilityStudioDisabled}
      avatarLaunchAction={avatarLaunchAction}
      modelConfigContent={(
        <ZhiyuAiConfigSettings
          scopeRef={aiConfigScopeRef}
          service={aiConfigService}
          providerResolver={modelPickerProviderResolver}
          runtimeReady={renderEvidence.runtime.ready}
          runtimeDetail={renderEvidence.runtime.ready ? null : renderEvidence.runtime.message}
          variant="embedded"
        />
      )}
      onDraftChange={setDraft}
      onCapabilityPromptChange={setCapabilityPrompt}
      onSubmit={handleSubmit}
      onStopChat={handleStopChat}
      onCapabilityStudioRun={(capabilityId) => {
        void handleCapabilityStudioRun(capabilityId);
      }}
      onProposalSubmit={() => {
        void handleProposalSubmit();
      }}
      onDelegationDecision={(approvalRequestId, decision) => {
        void handleDelegationDecision(approvalRequestId, decision);
      }}
      onSelectLocalAgent={handleSelectLocalAgent}
      onAvatarLaunch={() => {
        setEvidence((current) => ({
          ...current,
          avatar: {
            ...current.avatar,
            reasonCode: 'zhiyu-avatar-public-handoff-not-admitted',
            actionHint: 'admit_public_avatar_handoff',
            message: avatarLaunchAction.message,
          },
        }));
      }}
    />
  );
}
