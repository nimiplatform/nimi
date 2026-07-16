import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CANONICAL_CAPABILITY_CATALOG,
  CANONICAL_CAPABILITY_DEFERRED,
} from '@nimiplatform/kit/core/runtime-capabilities';
import {
  createNimiRuntimeAgentClient,
  createNimiRuntimeAgentConsumeClient,
  Runtime,
  type NimiRuntimeAgentConsumeEvent,
  type NimiRuntimeAgentAIConfigReadinessSnapshotProjection,
} from '@nimiplatform/sdk/runtime';
import { createInitialZhiyuEvidence, type ZhiyuEvidence } from './evidence';
import {
  appendSubmittedUserMessage,
  cancelStreamingChatMessages,
  chatStatusFromProjection,
  chatStatusFromResult,
  chatStatusFromSubmitRefreshFailure,
  createZhiyuTurnRequestId,
  ensureSubmittedUserMessageInChat,
  mergeChatTranscript,
  turnStatusFromChat,
} from './app-evidence-transitions';
import {
  shouldApplyZhiyuRuntimeChatUpdate,
  shouldContinueZhiyuRuntimeChatSubmit,
  zhiyuRuntimeChatApplyIdentity,
  type ZhiyuRuntimeChatApplyIdentity,
} from './chat-turn-apply-guard';
import { ZhiyuAgentChatSurface } from '../agent-chat/ZhiyuAgentChatSurface';
import { projectZhiyuCapabilityRoomState } from './capability-room-state';
import { projectZhiyuDiagnosticState } from './diagnostic-state';
import { projectZhiyuHomeProductState } from './home-product-state';
import { projectZhiyuIdentitySafetyEvidence } from './identity-safety-evidence';
import { projectZhiyuIdentityFloorState } from './identity-floor-state';
import { projectZhiyuAvatarLaunchAction } from '../avatar/avatar-launch';
import { launchZhiyuAvatar } from '../avatar/avatar-launch-handoff';
import { probeZhiyuAvatarPresence } from '../avatar/avatar-presence';
import {
  fetchZhiyuAgentAIConfigRouteEvidence,
  subscribeZhiyuAgentAIConfigReadiness,
  zhiyuAgentAIConfigRouteAuthRequired,
  zhiyuAgentAIConfigRouteIdentityRequired,
  type ZhiyuAgentAIConfigRouteEvidenceInput,
} from '../agent-chat/agent-ai-config';
import { zhiyuAgentAIConfigIdentityFromRouteInput, zhiyuAgentAIConfigRouteInputFromEvidence } from './agent-ai-config-route-input';
import { probeZhiyuRuntimeAgentInventory } from '../agent/agent-inventory';
import { probeZhiyuRuntimeCompanionState } from '../agent/companion-state';
import { probeZhiyuRuntimeConversationHome } from '../agent/conversation-home';
import {
  probeZhiyuRuntimeDelegationUx,
  submitZhiyuRuntimeDelegationApproval,
} from '../agent/delegation-ux';
import { projectZhiyuDiaryReflectionArtifacts } from '../agent/diary-reflection';
import { resolveZhiyuRuntimeLocalAgentSelection } from '../agent/local-agent-selection';
import { probeZhiyuRuntimeMemoryObservatory } from '../agent/memory-observatory';
import {
  projectZhiyuProposalIntakeStatus,
  submitZhiyuCapabilityProposal,
} from '../agent/proposal-intake';
import { probeZhiyuAgentTurnReadiness } from '../agent-chat/agent-turn-readiness';
import {
  hydrateZhiyuAgentChatFromRuntimeSessionSnapshot,
  projectZhiyuCompanionFromRuntimeAgentEvent,
  projectZhiyuCompanionFromRuntimeProjectionEvents,
} from '../agent-chat/agent-conversation-state';
import {
  createBrowserVoiceCaptureRecorder,
  createElectronVoiceCaptureTranscriber,
  createZhiyuVoiceCaptureController,
  projectZhiyuVoiceCaptureReadiness,
} from '../agent-chat/voice-capture';
import { projectZhiyuRuntimeSourceProjection } from '../agent/source-projection';
import { runZhiyuAgentChatTurn } from '../agent-chat/runtime-agent-turn-adapter';
import { withZhiyuRuntimeAgentBindingRequired } from '../agent-chat/runtime-agent-binding';
import {
  resolveZhiyuRuntimeAgentBindingDecisionFromHost,
  scopedBindingForRuntimeAgentRequest,
} from '../agent-chat/runtime-agent-binding';
import { probeZhiyuRuntimeAccountStatus } from '../auth/runtime-account-status';
import { requestZhiyuDesktopOpenSelectPartner } from '../desktop-open/desktop-open-action';
import { probeZhiyuRuntimeStatus } from '../runtime/runtime-status';
import { loadZhiyuSourceContextProjection } from './source-context-loader';
import { ZhiyuLocalDevelopmentJourney } from '../local-development/ZhiyuLocalDevelopmentJourney';

export function App() {
  const localDevelopment = window.__nimiZhiyuLocalDevelopment;
  if (localDevelopment?.agentId) {
    return <ZhiyuLocalDevelopmentJourney target={{ ...localDevelopment, agentId: localDevelopment.agentId }} />;
  }
  return <ZhiyuBundledApp />;
}

function ZhiyuBundledApp() {
  const [evidence, setEvidence] = useState<ZhiyuEvidence>(() => createInitialZhiyuEvidence());
  const [selectedLocalAgentRef, setSelectedLocalAgentRef] = useState<string | null>(null);
  const [selectedLocalAgentRefreshKey, setSelectedLocalAgentRefreshKey] = useState(0);
  const [draft, setDraft] = useState('');
  const activeChatAbortRef = useRef<AbortController | null>(null);
  const activeVoiceCaptureRef = useRef<ReturnType<typeof createZhiyuVoiceCaptureController> | null>(null);
  const agentAIConfigRouteInputRef = useRef<ZhiyuAgentAIConfigRouteEvidenceInput>({ subjectUserId: '' });
  const renderEvidence = useMemo(() => projectZhiyuIdentitySafetyEvidence(evidence), [evidence]);
  const latestConversationIdentityRef = useRef<ZhiyuRuntimeChatApplyIdentity>(
    zhiyuRuntimeChatApplyIdentity(evidence.conversation),
  );

  useEffect(() => {
    const routeInput = zhiyuAgentAIConfigRouteInputFromEvidence(renderEvidence);
    agentAIConfigRouteInputRef.current = routeInput;
    window.__nimiZhiyuEvidence = renderEvidence;
    latestConversationIdentityRef.current = zhiyuRuntimeChatApplyIdentity(renderEvidence.conversation);
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
      const [runtime, auth] = await Promise.all([
        probeZhiyuRuntimeStatus(),
        probeZhiyuRuntimeAccountStatus(),
      ]);
      const inventory = await probeZhiyuRuntimeAgentInventory(auth);
      const localAgent = resolveZhiyuRuntimeLocalAgentSelection({
        inventory,
        selectedLocalAgentRef,
      });
      const selectedInventoryAgent = inventory.localAgents.find(
        (agent) => agent.localAgentRef === localAgent.localAgentRef,
      );
      const source = projectZhiyuRuntimeSourceProjection({
        ownerUserId: localAgent.ownerUserId,
        runtimeSourceRef: localAgent.runtimeSourceRef,
        localAgentRef: localAgent.localAgentRef,
        sourceContextStatus: selectedInventoryAgent?.sourceContextStatus ?? null,
      });
      const diaryReflection = projectZhiyuDiaryReflectionArtifacts(localAgent);
      const [conversation, memory, companion, avatar] = await Promise.all([
        probeZhiyuRuntimeConversationHome(localAgent),
        probeZhiyuRuntimeMemoryObservatory(localAgent),
        probeZhiyuRuntimeCompanionState(localAgent),
        probeZhiyuAvatarPresence(localAgent),
      ]);
      const delegation = await probeZhiyuRuntimeDelegationUx(conversation);
      const proposal = projectZhiyuProposalIntakeStatus({ conversation });
      if (!active) {
        return;
      }
      setEvidence((current) => {
        const turn = probeZhiyuAgentTurnReadiness(conversation, current.route);
        return {
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
          turn,
        };
      });
    })();
    return () => {
      active = false;
    };
  }, [selectedLocalAgentRef, selectedLocalAgentRefreshKey]);

  const applyExecutionRoute = useCallback((route: ZhiyuEvidence['route']) => {
    setEvidence((current) => ({
      ...current,
      route,
      turn: probeZhiyuAgentTurnReadiness(current.conversation, route),
      voiceCapture: current.voiceCapture.state === 'recording' || current.voiceCapture.state === 'transcribing'
        ? current.voiceCapture
        : projectZhiyuVoiceCaptureReadiness(route),
    }));
  }, []);

  // Route evidence is a pure projection of the runtime-owned Agent AI Config
  // + readiness (K-AGCORE-144~150). Startup fetch is isolated from the core
  // Runtime bootstrap matrix; live updates arrive over the readiness
  // subscription and re-read the committed config on each change.
  useEffect(() => {
    const routeInput = zhiyuAgentAIConfigRouteInputFromEvidence(evidence);
    const subjectUserId = routeInput.subjectUserId;
    if (!subjectUserId) {
      applyExecutionRoute(zhiyuAgentAIConfigRouteAuthRequired());
      return undefined;
    }
    const identity = zhiyuAgentAIConfigIdentityFromRouteInput(routeInput);
    if (!identity) {
      applyExecutionRoute(zhiyuAgentAIConfigRouteIdentityRequired());
      return undefined;
    }
    const callInput = {
      subjectUserId,
      ...identity,
    };
    let active = true;
    let readinessIterator: AsyncIterator<NimiRuntimeAgentAIConfigReadinessSnapshotProjection> | null = null;
    void (async () => {
      const route = await fetchZhiyuAgentAIConfigRouteEvidence(routeInput);
      if (!active) {
        return;
      }
      applyExecutionRoute(route);
      try {
        // Readiness subscription is best-effort after the fail-closed
        // initial fetch, mirroring the agent event subscription pattern.
        const stream = subscribeZhiyuAgentAIConfigReadiness(callInput);
        readinessIterator = stream[Symbol.asyncIterator]();
        while (active) {
          const next = await readinessIterator.next();
          if (next.done) {
            break;
          }
          const refreshed = await fetchZhiyuAgentAIConfigRouteEvidence(routeInput);
          if (!active) {
            return;
          }
          applyExecutionRoute(refreshed);
        }
      } catch {
        // Live readiness updates degrade to explicit refresh on config edits
        // and submit; the fetched evidence above remains fail-closed truth.
      }
    })();
    return () => {
      active = false;
      void readinessIterator?.return?.();
    };
  }, [
    applyExecutionRoute,
    evidence.auth.ready,
    evidence.auth.accountId,
    evidence.conversation.ownerUserId,
    evidence.conversation.runtimeSourceRef,
    evidence.conversation.localAgentRef,
    evidence.localAgent.ownerUserId,
    evidence.localAgent.runtimeSourceRef,
    evidence.localAgent.localAgentRef,
    evidence.source.ownerUserId,
    evidence.source.runtimeSourceRef,
  ]);

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
        const consume = createNimiRuntimeAgentConsumeClient({
          runtime: {
            agents: runtime.agents,
            appMessages: runtime.appMessages,
          },
          runtimeAppId: 'nimi.zhiyu',
        });
        const [snapshot, anchorSnapshot] = await Promise.all([
          client.getSessionSnapshot(identity),
          withZhiyuRuntimeAgentBindingRequired(['runtime.agent.turn.read'], async (callOptions) => {
            const binding = resolveZhiyuRuntimeAgentBindingDecisionFromHost(['runtime.agent.turn.read']);
            return consume.anchors.getSnapshot({
              ...identity,
              subjectUserId: ownerUserId,
              scopedBinding: scopedBindingForRuntimeAgentRequest(binding),
            }, callOptions);
          }),
        ]);
        if (active) {
          setEvidence((current) => ({
            ...current,
            source: projectZhiyuRuntimeSourceProjection({
              ownerUserId,
              runtimeSourceRef,
              localAgentRef,
              sourceContextStatus: anchorSnapshot.sourceContextStatus ?? current.source.sourceContextStatus,
              turnContextSummary: anchorSnapshot.turnContextSummary ?? null,
            }),
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
    && renderEvidence.route.ready
    && turnSubmitReady
    && renderEvidence.chat.state !== 'streaming'
    && renderEvidence.composer.submitState !== 'submitting'
    && draft.trim().length > 0;
  const composerState = evidence.chat.state === 'streaming' || evidence.composer.submitState === 'submitting'
    ? 'submitting'
    : submitEnabled
      ? 'ready'
      : 'blocked';

  async function handleSubmit(textInput: string) {
    const text = textInput.trim();
    activeChatAbortRef.current?.abort('zhiyu_chat_turn_superseded');
    const activeChatAbort = new AbortController();
    activeChatAbortRef.current = activeChatAbort;
    const submittedConversation = zhiyuRuntimeChatApplyIdentity(evidence.conversation);
    const submitStillCurrent = () => activeChatAbortRef.current === activeChatAbort
      && shouldContinueZhiyuRuntimeChatSubmit({
        currentConversation: latestConversationIdentityRef.current,
        submittedConversation,
        signal: activeChatAbort.signal,
      });
    // Submit refresh re-reads the runtime AI Config + readiness; the
    // turn itself carries no bindings (K-AGCORE-147).
    const refreshedRoute = await fetchZhiyuAgentAIConfigRouteEvidence(agentAIConfigRouteInputRef.current);
    const refreshedTurn = probeZhiyuAgentTurnReadiness(evidence.conversation, refreshedRoute);
    if (!submitStillCurrent()) {
      if (activeChatAbortRef.current === activeChatAbort) {
        activeChatAbortRef.current = null;
      }
      return;
    }
    if (!refreshedRoute.ready || !refreshedTurn.ready) {
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
      expectedConversationAnchorId: submittedConversation.conversationAnchorId,
      signal: activeChatAbort.signal,
      onEvent: (_event, projection) => {
        if (activeChatAbort.signal.aborted || activeChatAbortRef.current !== activeChatAbort) {
          return;
        }
        setEvidence((current) => {
          if (!shouldApplyZhiyuRuntimeChatUpdate({
            currentConversation: current.conversation,
            submittedConversation,
          })) {
            return current;
          }
          const projectionChat = ensureSubmittedUserMessageInChat(
            chatStatusFromProjection(projection, current.conversation),
            current.conversation,
            requestId,
            text,
          );
          const chat = mergeChatTranscript(current.chat, projectionChat);
          const companion = projectZhiyuCompanionFromRuntimeProjectionEvents({
            current: current.companion,
            chat,
            ownerUserId: submittedConversation.ownerUserId || current.conversation.ownerUserId || '',
            runtimeSourceRef: submittedConversation.runtimeSourceRef || current.conversation.runtimeSourceRef || '',
          });
          return {
            ...current,
            chat,
            companion,
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
      if (!shouldApplyZhiyuRuntimeChatUpdate({
        currentConversation: current.conversation,
        submittedConversation,
      })) {
        return current;
      }
      const resultChat = ensureSubmittedUserMessageInChat(
        chatStatusFromResult(submitted),
        current.conversation,
        submitted.requestId ?? requestId,
        text,
      );
      const chat = mergeChatTranscript(current.chat, resultChat);
      const companion = projectZhiyuCompanionFromRuntimeProjectionEvents({
        current: current.companion,
        chat,
        ownerUserId: submittedConversation.ownerUserId || current.conversation.ownerUserId || '',
        runtimeSourceRef: submittedConversation.runtimeSourceRef || current.conversation.runtimeSourceRef || '',
      });
      return {
        ...current,
        chat,
        companion,
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
    if (
      submitted.ready
      && shouldApplyZhiyuRuntimeChatUpdate({
        currentConversation: latestConversationIdentityRef.current,
        submittedConversation,
      })
    ) {
      try {
        const source = await loadZhiyuSourceContextProjection({
          ownerUserId: submittedConversation.ownerUserId!,
          runtimeSourceRef: submittedConversation.runtimeSourceRef!,
          localAgentRef: submittedConversation.localAgentRef!,
          conversationAnchorId: submittedConversation.conversationAnchorId!,
        });
        if (shouldApplyZhiyuRuntimeChatUpdate({
          currentConversation: latestConversationIdentityRef.current,
          submittedConversation,
        })) {
          setEvidence((current) => ({ ...current, source }));
        }
      } catch {
        // Existing bounded source evidence remains fail-closed when refresh is unavailable.
      }
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

  async function handleVoiceCaptureToggle() {
    if (renderEvidence.voiceCapture.state === 'transcribing') {
      return;
    }
    if (renderEvidence.voiceCapture.state === 'recording') {
      const activeVoiceCapture = activeVoiceCaptureRef.current;
      if (!activeVoiceCapture) {
        setEvidence((current) => ({
          ...current,
          voiceCapture: {
            ...current.voiceCapture,
            ready: false,
            state: 'failed',
            reasonCode: 'runtime-voice-capture-recorder-missing',
            actionHint: 'start_voice_capture',
            source: 'renderer',
            message: 'Voice capture stop was requested before recording started.',
          },
        }));
        return;
      }
      const result = await activeVoiceCapture.stop();
      activeVoiceCaptureRef.current = null;
      if (result.state === 'idle' && result.transcriptText) {
        const transcriptText = result.transcriptText;
        setDraft(transcriptText);
        setEvidence((current) => ({
          ...current,
          voiceCapture: result,
          composer: {
            ...current.composer,
            draftLength: transcriptText.length,
            reasonCode: result.reasonCode,
            actionHint: 'send_runtime_agent_turn',
            source: result.source,
            message: result.message,
          },
        }));
      }
      return;
    }

    const readiness = projectZhiyuVoiceCaptureReadiness(renderEvidence.route);
    const controller = createZhiyuVoiceCaptureController({
      readiness,
      createRecorder: createBrowserVoiceCaptureRecorder,
      transcribe: (request) => createElectronVoiceCaptureTranscriber({
        route: renderEvidence.route,
        subjectUserId: renderEvidence.conversation.ownerUserId || renderEvidence.auth.accountId || '',
      })(request),
      onStateChange: (voiceCapture) => {
        setEvidence((current) => ({
          ...current,
          voiceCapture,
        }));
      },
    });
    activeVoiceCaptureRef.current = controller;
    const started = await controller.start();
    if (started.state !== 'recording') {
      activeVoiceCaptureRef.current = null;
    }
  }

  function handleSelectLocalAgent(localAgentRef: string) {
    const selected = localAgentRef.trim();
    if (!selected) {
      return;
    }
    activeChatAbortRef.current?.abort('zhiyu_chat_turn_local_agent_changed');
    const initial = createInitialZhiyuEvidence();
    setSelectedLocalAgentRef(selected);
    setSelectedLocalAgentRefreshKey((current) => current + 1);
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

  async function handleAvatarLaunch() {
    setEvidence((current) => ({
      ...current,
      avatar: {
        ...current.avatar,
        reasonCode: 'zhiyu-avatar-launch-registering-live-instance',
        actionHint: 'wait_avatar_launch_handoff',
        message: 'Registering the Avatar live instance with Runtime before launch.',
        launchHandoff: null,
      },
    }));
    const result = await launchZhiyuAvatar({
      evidence: renderEvidence,
      action: avatarLaunchAction,
    });
    setEvidence((current) => ({
      ...current,
      avatar: {
        ...current.avatar,
        ready: result.state === 'opened' ? current.avatar.ready : false,
        state: result.state === 'opened' ? current.avatar.state : 'blocked',
        reasonCode: result.reasonCode,
        actionHint: result.actionHint,
        message: result.message,
        launchHandoff: result.state === 'opened' ? result.handoff : null,
      },
    }));
  }

  return (
    <ZhiyuAgentChatSurface
      evidence={renderEvidence}
      product={product}
      draft={draft}
      submitEnabled={submitEnabled}
      composerState={composerState}
      avatarLaunchAction={avatarLaunchAction}
      onDraftChange={setDraft}
      onSubmit={handleSubmit}
      onStopChat={handleStopChat}
      onVoiceCaptureToggle={handleVoiceCaptureToggle}
      onSelectLocalAgent={handleSelectLocalAgent}
      onDesktopOpenSelectPartner={requestZhiyuDesktopOpenSelectPartner}
      onAvatarLaunch={() => {
        void handleAvatarLaunch();
      }}
    />
  );
}
