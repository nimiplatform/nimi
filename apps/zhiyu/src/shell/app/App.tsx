import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createInitialZhiyuEvidence, type ZhiyuEvidence } from './evidence';
import {
  appendSubmittedUserMessage,
  cancelStreamingChatMessages,
  chatStatusFromProjection,
  chatStatusFromResult,
  chatStatusFromSubmitRefreshFailure,
  ensureSubmittedUserMessageInChat,
  mergeChatTranscript,
  shouldPreserveZhiyuDraftOnPartnerReselection,
  turnStatusFromChat,
} from './app-evidence-transitions';
import {
  shouldApplyZhiyuRuntimeChatUpdate,
  shouldContinueZhiyuRuntimeChatSubmit,
  zhiyuRuntimeChatApplyIdentity,
  type ZhiyuRuntimeChatApplyIdentity,
} from './chat-turn-apply-guard';
import { ZhiyuAgentChatSurface } from '../agent-chat/ZhiyuAgentChatSurface';
import type { ZhiyuRuntimeAgentChatAttachment } from '../agent-chat/runtime-agent-turn-adapter';
import { projectZhiyuHomeProductState } from './home-product-state';
import { projectZhiyuAvatarLaunchAction } from '../avatar/avatar-launch';
import type { ZhiyuCanonicalRendererBindings } from '../../renderer/contract';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import { sameZhiyuRuntimeAgentInventory } from '../agent/agent-inventory-projection';
import { projectZhiyuAuthorizedAgentCenterHandle } from '../agent/agent-center-handle';
import {
  isZhiyuDirectLocalAppSubmitEnabled,
  refreshZhiyuDirectLocalAppSubmitGate,
} from './direct-local-app-submit-gate';
import { createZhiyuCanonicalAgentCenterSession } from '../../renderer/agent-center-session';
import { ZhiyuResourcePackPresentationController } from '../../resource-pack/presentation-controller';
import type { ZhiyuResourcePackPlacementAck } from '../../production/resource-pack-placement-bridge';
import { isZhiyuResourcePackPlacementReady } from '../../production/resource-pack-placement-readiness';

type PendingResourcePackPlacement = Readonly<{
  placementKey: string;
  conversationAnchorId: string;
  agentHandle: NimiLocalAppAgentHandle;
}>;

const subscribeNoop = () => () => undefined;
const readNoAgentCenterSnapshot = () => null;

export function ZhiyuCanonicalApp(props: { readonly bindings: ZhiyuCanonicalRendererBindings }) {
  const { bindings } = props;
  const [evidence, setEvidence] = useState<ZhiyuEvidence>(() => createInitialZhiyuEvidence());
  const [selectedAgentHandle, setSelectedAgentHandle] = useState<NimiLocalAppAgentHandle | null>(null);
  const [selectedLocalAgentRefreshKey, setSelectedLocalAgentRefreshKey] = useState(0);
  const [draft, setDraft] = useState('');
  const [pendingResourcePackPlacement, setPendingResourcePackPlacement] = useState<PendingResourcePackPlacement | null>(null);
  const activeChatAbortRef = useRef<AbortController | null>(null);
  const resourcePackPlacementGenerationRef = useRef(0);
  const latestAgentInventoryRef = useRef<ZhiyuEvidence['inventory']>(evidence.inventory);
  const renderEvidence = evidence;
  const agentCenterHandle = projectZhiyuAuthorizedAgentCenterHandle(renderEvidence);
  const agentCenterConversationAnchorId = renderEvidence.conversation.ready
    && renderEvidence.conversation.agentHandle === agentCenterHandle
    ? renderEvidence.conversation.conversationAnchorId
    : null;
  const resourcePackController = useMemo(
    () => new ZhiyuResourcePackPresentationController(),
    [agentCenterConversationAnchorId, agentCenterHandle],
  );
  const resourcePackPresentation = useSyncExternalStore(
    resourcePackController.subscribe,
    resourcePackController.getSnapshot,
    resourcePackController.getSnapshot,
  );
  const agentCenterBinding = useMemo(
    () => bindings.app.projection.agentCenterBinding(agentCenterHandle),
    [bindings, agentCenterHandle],
  );
  const agentCenterSession = useMemo(
    () => createZhiyuCanonicalAgentCenterSession(
      agentCenterHandle,
      agentCenterConversationAnchorId,
      agentCenterBinding,
      resourcePackController,
    ),
    [agentCenterBinding, agentCenterConversationAnchorId, agentCenterHandle, resourcePackController],
  );
  const agentCenterSessionRef = useRef(agentCenterSession);
  const agentCenterSnapshot = useSyncExternalStore(
    agentCenterSession?.subscribe ?? subscribeNoop,
    agentCenterSession?.getSnapshot ?? readNoAgentCenterSnapshot,
    readNoAgentCenterSnapshot,
  );
  const latestConversationIdentityRef = useRef<ZhiyuRuntimeChatApplyIdentity>(
    zhiyuRuntimeChatApplyIdentity(evidence.conversation),
  );

  useEffect(() => () => {
    agentCenterSession?.dispose();
  }, [agentCenterSession]);

  useEffect(() => {
    agentCenterSessionRef.current = agentCenterSession;
  }, [agentCenterSession]);

  useEffect(() => () => resourcePackController.dispose(), [resourcePackController]);

  useEffect(() => {
    const subscribe = bindings.app.events.subscribeResourcePackPlacement;
    const resolveTarget = bindings.app.projection.resolveResourcePackPlacementTarget;
    const acknowledge = bindings.app.commands.acknowledgeResourcePackPlacement;
    if (!subscribe || !resolveTarget || !acknowledge) return undefined;
    let active = true;
    const unsubscribe = subscribe((request) => {
      const generation = ++resourcePackPlacementGenerationRef.current;
      const placementKey = `resource-pack-placement-${generation}`;
      setPendingResourcePackPlacement(null);
      void resolveTarget({
        agentHandle: request.agentHandle,
        isCurrent: () => active && resourcePackPlacementGenerationRef.current === generation,
      }).then((target) => {
        if (!active || resourcePackPlacementGenerationRef.current !== generation) return;
        const latest = latestConversationIdentityRef.current;
        const targetChanged = latest.agentHandle !== target.agentHandle
          || latest.conversationAnchorId !== target.conversationAnchorId;
        if (targetChanged) {
          activeChatAbortRef.current?.abort('zhiyu_resource_pack_placement_target_changed');
          agentCenterSessionRef.current?.invalidate();
          agentCenterSessionRef.current?.dispose();
          setSelectedAgentHandle(target.agentHandle as NimiLocalAppAgentHandle);
          setSelectedLocalAgentRefreshKey((current) => current + 1);
          setEvidence((current) => {
            const initial = createInitialZhiyuEvidence();
            return {
              ...initial,
              runtime: current.runtime,
              auth: current.auth,
              inventory: current.inventory,
            };
          });
        }
        setPendingResourcePackPlacement(Object.freeze({
          placementKey,
          conversationAnchorId: target.conversationAnchorId,
          agentHandle: target.agentHandle as NimiLocalAppAgentHandle,
        }));
      }).catch((error) => {
        if (!active || resourcePackPlacementGenerationRef.current !== generation) return;
        sendResourcePackPlacementAck(acknowledge, {
          status: 'failed',
          reasonCode: resourcePackPlacementFailureReason(error),
        });
      });
    });
    return () => {
      active = false;
      resourcePackPlacementGenerationRef.current += 1;
      unsubscribe();
    };
  }, [bindings]);

  useEffect(() => {
    const pending = pendingResourcePackPlacement;
    const acknowledge = bindings.app.commands.acknowledgeResourcePackPlacement;
    if (!pending || !acknowledge) return undefined;
    const timer = window.setTimeout(() => {
      sendResourcePackPlacementAck(acknowledge, {
        status: 'failed',
        reasonCode: 'destination-session-failed',
      });
      setPendingResourcePackPlacement((current) => current?.placementKey === pending.placementKey ? null : current);
    }, 6_000);
    return () => window.clearTimeout(timer);
  }, [bindings, pendingResourcePackPlacement]);

  useEffect(() => {
    latestAgentInventoryRef.current = renderEvidence.inventory;
    bindings.app.events.onProjectionChanged?.(renderEvidence);
    latestConversationIdentityRef.current = zhiyuRuntimeChatApplyIdentity(renderEvidence.conversation);
  }, [bindings, renderEvidence]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const home = await bindings.app.projection.loadHome({
        selectedAgentHandle,
        previousConversationAnchorId: latestConversationIdentityRef.current.conversationAnchorId,
        isCurrent: () => active,
      });
      if (!active) {
        return;
      }
      if (home.localAgent.ready && home.localAgent.agentHandle) {
        setSelectedAgentHandle((current) => (
          current === selectedAgentHandle ? home.localAgent.agentHandle : current
        ));
      }
      setEvidence((current) => {
        const turn = bindings.app.projection.projectTurnReadiness(home.conversation, home.inventory);
        return {
          ...current,
          ...home,
          turn,
        };
      });
    })();
    return () => {
      active = false;
    };
  }, [bindings, selectedAgentHandle, selectedLocalAgentRefreshKey]);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const refreshAgentInventory = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        const inventory = await bindings.app.projection.loadAgentInventory();
        if (!active || sameZhiyuRuntimeAgentInventory(latestAgentInventoryRef.current, inventory)) return;
        latestAgentInventoryRef.current = inventory;
        setEvidence((current) => ({ ...current, inventory }));
        setSelectedLocalAgentRefreshKey((current) => current + 1);
      } finally {
        inFlight = false;
      }
    };
    const handleWindowFocus = () => {
      void refreshAgentInventory();
      void agentCenterSession?.refresh();
    };
    const interval = window.setInterval(() => {
      void refreshAgentInventory();
    }, 2_000);
    window.addEventListener('focus', handleWindowFocus);
    void refreshAgentInventory();
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [agentCenterSession, bindings]);

  useEffect(() => {
    const agentHandle = renderEvidence.conversation.agentHandle;
    const conversationAnchorId = renderEvidence.conversation.conversationAnchorId;
    if (!renderEvidence.conversation.ready || !agentHandle || !conversationAnchorId) {
      return undefined;
    }
    return bindings.app.events.subscribeConversation({
      agentHandle,
      conversationAnchorId,
		currentSource: renderEvidence.source,
		currentChat: renderEvidence.chat,
      onChat: (incoming) => {
        setEvidence((current) => {
          if (
            current.conversation.agentHandle !== agentHandle
            || current.conversation.conversationAnchorId !== conversationAnchorId
          ) {
            return current;
          }
          const chat = mergeChatTranscript(current.chat, incoming);
          return {
            ...current,
            chat,
            turn: turnStatusFromChat(chat),
          };
        });
      },
    });
  }, [
    bindings,
    renderEvidence.conversation.ready,
    renderEvidence.conversation.agentHandle,
    renderEvidence.conversation.conversationAnchorId,
  ]);

  const product = useMemo(() => projectZhiyuHomeProductState(renderEvidence), [renderEvidence]);
  const avatarLaunchAction = useMemo(() => projectZhiyuAvatarLaunchAction(renderEvidence), [renderEvidence]);
  useEffect(() => {
    if (!pendingResourcePackPlacement
      || !renderEvidence.conversation.ready
      || renderEvidence.conversation.agentHandle !== pendingResourcePackPlacement.agentHandle
      || renderEvidence.conversation.conversationAnchorId !== pendingResourcePackPlacement.conversationAnchorId
      || !agentCenterSession) {
      return;
    }
    void agentCenterSession.refresh();
  }, [
    agentCenterSession,
    pendingResourcePackPlacement,
    renderEvidence.conversation.agentHandle,
    renderEvidence.conversation.conversationAnchorId,
    renderEvidence.conversation.ready,
  ]);
  const readyResourcePackPlacementKey = pendingResourcePackPlacement
    && renderEvidence.conversation.ready
    && renderEvidence.conversation.agentHandle === pendingResourcePackPlacement.agentHandle
    && renderEvidence.conversation.conversationAnchorId === pendingResourcePackPlacement.conversationAnchorId
    && agentCenterSession
    && isZhiyuResourcePackPlacementReady(agentCenterSnapshot)
    ? pendingResourcePackPlacement.placementKey
    : null;

  const submitEnabled = isZhiyuDirectLocalAppSubmitEnabled({
    evidence: renderEvidence,
    draft,
  });
  const composerState = evidence.chat.state === 'streaming' || evidence.composer.submitState === 'submitting'
    ? 'submitting'
    : submitEnabled
      ? 'ready'
      : 'blocked';

  async function handleSubmit(
    textInput: string,
    attachment?: ZhiyuRuntimeAgentChatAttachment,
  ) {
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
    // Re-read Runtime inventory immediately before submit so source changes or
    // Agent deletion cannot use a stale handle.
    const {
      inventory: refreshedInventory,
      turn: refreshedTurn,
    } = await refreshZhiyuDirectLocalAppSubmitGate({
      conversation: evidence.conversation,
      loadAgentInventory: bindings.app.projection.loadAgentInventory,
      projectTurnReadiness: bindings.app.projection.projectTurnReadiness,
    });
    if (!submitStillCurrent()) {
      if (activeChatAbortRef.current === activeChatAbort) {
        activeChatAbortRef.current = null;
      }
      return;
    }
    if (!refreshedTurn.ready) {
      setEvidence((current) => {
        const chat = chatStatusFromSubmitRefreshFailure({
          current: current.chat,
          conversation: current.conversation,
          turn: refreshedTurn,
        });
        return {
          ...current,
          inventory: refreshedInventory,
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
    const requestId = await bindings.app.commands.allocateTurnRequestId();
    setEvidence((current) => ({
      ...current,
      inventory: refreshedInventory,
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
        ...appendSubmittedUserMessage(
          current.chat,
          current.conversation,
          requestId,
          text,
          new Date(bindings.clock.now()).toISOString(),
        ),
        ready: false,
        state: 'streaming',
        reasonCode: 'runtime-agent-chat-submitting',
        actionHint: 'wait_runtime_agent_turn_stream',
        source: 'renderer',
        message: 'Runtime Agent chat turn is being submitted.',
      },
    }));
    const submitted = await bindings.app.commands.runTurn({
      conversation: evidence.conversation,
      text,
      ...(attachment ? { attachment } : {}),
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
            new Date(bindings.clock.now()).toISOString(),
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
        new Date(bindings.clock.now()).toISOString(),
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
    if (submitted.ready && shouldApplyZhiyuRuntimeChatUpdate({
      currentConversation: latestConversationIdentityRef.current,
      submittedConversation,
    })) {
      setDraft('');
    }
  }

  function handleStopChat() {
    activeChatAbortRef.current?.abort('zhiyu_chat_turn_user_stopped');
    setEvidence((current) => {
      if (current.chat.state !== 'streaming' && current.composer.submitState !== 'submitting') {
        return current;
      }
      const messages = cancelStreamingChatMessages(
        current.chat.messages,
        new Date(bindings.clock.now()).toISOString(),
      );
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

  function handleSelectLocalAgent(agentHandle: NimiLocalAppAgentHandle) {
    activeChatAbortRef.current?.abort('zhiyu_chat_turn_local_agent_changed');
    agentCenterSession?.invalidate();
    agentCenterSession?.dispose();
    const initial = createInitialZhiyuEvidence();
    const preserveDraft = shouldPreserveZhiyuDraftOnPartnerReselection(evidence.chat);
    setSelectedAgentHandle(agentHandle);
    setSelectedLocalAgentRefreshKey((current) => current + 1);
    if (!preserveDraft) setDraft('');
    setEvidence((current) => ({
      ...initial,
      runtime: current.runtime,
      auth: current.auth,
      inventory: current.inventory,
    }));
  }

  function handleRetryAgentCenter() {
    setSelectedLocalAgentRefreshKey((current) => current + 1);
  }

  async function handleAvatarLaunch() {
    setEvidence((current) => ({
      ...current,
      avatar: {
        ...current.avatar,
        reasonCode: 'zhiyu-avatar-host-handoff-requested',
        actionHint: 'wait_avatar_launch_handoff',
        message: 'Requesting Avatar launch or focus through the common Host handoff port.',
        hostHandoff: null,
      },
    }));
    const result = await bindings.app.commands.launchAvatar({
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
        hostHandoff: result.state === 'opened' ? result.handoff : null,
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
      agentCenterSession={agentCenterSession}
      resourcePackPresentation={resourcePackPresentation}
      resourcePackPlacementKey={readyResourcePackPlacementKey}
      onDraftChange={setDraft}
      onSubmit={handleSubmit}
      onTranscribeVoice={async (audioBytes, mimeType, signal) => {
        const agentHandle = evidence.conversation.agentHandle;
        const conversationAnchorId = evidence.conversation.conversationAnchorId;
        if (!agentHandle || !conversationAnchorId) throw new Error('Runtime conversation is unavailable.');
        const requestId = await bindings.app.commands.allocateTurnRequestId();
        const result = await bindings.app.commands.transcribeVoice({
          agentHandle,
          conversationAnchorId,
          requestId,
          mimeType,
          audioBytes,
		}, { signal });
		if (signal.aborted || latestConversationIdentityRef.current.agentHandle !== agentHandle ||
			latestConversationIdentityRef.current.conversationAnchorId !== conversationAnchorId) {
			throw new DOMException('Voice transcription is no longer current.', 'AbortError');
		}
        return result.text;
      }}
      onStopChat={handleStopChat}
      onSelectLocalAgent={handleSelectLocalAgent}
      onDesktopOpenRuntimeSettings={bindings.app.commands.openDesktopRuntimeSettings}
      onRetryAgentCenter={handleRetryAgentCenter}
      onResourcePackPlacementReady={(placementKey) => {
        const acknowledge = bindings.app.commands.acknowledgeResourcePackPlacement;
        if (!acknowledge || pendingResourcePackPlacement?.placementKey !== placementKey) return;
        sendResourcePackPlacementAck(acknowledge, {
          status: 'ready',
          reasonCode: 'zhiyu-resource-pack-placement-ready',
        });
        setPendingResourcePackPlacement(null);
      }}
      onDesktopOpenSelectPartner={bindings.app.commands.openDesktopSelectPartner}
      onAvatarLaunch={() => {
        void handleAvatarLaunch();
      }}
    />
  );
}

function sendResourcePackPlacementAck(
  acknowledge: (ack: ZhiyuResourcePackPlacementAck) => void,
  ack: ZhiyuResourcePackPlacementAck,
): void {
  acknowledge(ack);
}

function resourcePackPlacementFailureReason(
  error: unknown,
): Extract<ZhiyuResourcePackPlacementAck, { status: 'failed' }>['reasonCode'] {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const code = typeof record.code === 'string' ? record.code : '';
  return code === 'ZHIYU_RESOURCE_PACK_PLACEMENT_SESSION_UNAVAILABLE'
    ? 'destination-session-failed'
    : 'agent-resolution-failed';
}
