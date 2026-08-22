import { useEffect, useMemo, useRef, useState } from 'react';
import { createInitialZhiyuEvidence, type ZhiyuEvidence } from './evidence';
import {
  appendSubmittedUserMessage,
  cancelStreamingChatMessages,
  chatStatusFromProjection,
  chatStatusFromResult,
  chatStatusFromSubmitRefreshFailure,
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
import { projectZhiyuHomeProductState } from './home-product-state';
import { projectZhiyuIdentitySafetyEvidence } from './identity-safety-evidence';
import { projectZhiyuAvatarLaunchAction } from '../avatar/avatar-launch';
import type { ZhiyuCanonicalRendererBindings } from '../../renderer/contract';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import { sameZhiyuRuntimeAgentInventory } from '../agent/agent-inventory-projection';
import { projectZhiyuAuthorizedAgentCenterHandle } from '../agent/agent-center-handle';
import {
  isZhiyuDirectLocalAppSubmitEnabled,
  refreshZhiyuDirectLocalAppSubmitGate,
} from './direct-local-app-submit-gate';

export function ZhiyuCanonicalApp(props: { readonly bindings: ZhiyuCanonicalRendererBindings }) {
  const { bindings } = props;
  const [evidence, setEvidence] = useState<ZhiyuEvidence>(() => createInitialZhiyuEvidence());
  const [selectedAgentHandle, setSelectedAgentHandle] = useState<NimiLocalAppAgentHandle | null>(null);
  const [selectedLocalAgentRefreshKey, setSelectedLocalAgentRefreshKey] = useState(0);
  const [draft, setDraft] = useState('');
  const activeChatAbortRef = useRef<AbortController | null>(null);
  const latestAgentInventoryRef = useRef<ZhiyuEvidence['inventory']>(evidence.inventory);
  const renderEvidence = useMemo(() => projectZhiyuIdentitySafetyEvidence(evidence), [evidence]);
  const agentCenterHandle = projectZhiyuAuthorizedAgentCenterHandle(renderEvidence);
  const agentCenterSession = useMemo(
    () => bindings.app.projection.agentCenterSession(agentCenterHandle),
    [bindings, agentCenterHandle],
  );
  const latestConversationIdentityRef = useRef<ZhiyuRuntimeChatApplyIdentity>(
    zhiyuRuntimeChatApplyIdentity(evidence.conversation),
  );

  useEffect(() => {
    latestAgentInventoryRef.current = renderEvidence.inventory;
    bindings.app.events.onProjectionChanged?.(renderEvidence);
    latestConversationIdentityRef.current = zhiyuRuntimeChatApplyIdentity(renderEvidence.conversation);
  }, [bindings, renderEvidence]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const home = await bindings.app.projection.loadHome({ selectedAgentHandle });
      if (!active) {
        return;
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
  }, [bindings]);

  useEffect(() => {
    const agentHandle = renderEvidence.conversation.agentHandle;
    const conversationAnchorId = renderEvidence.conversation.conversationAnchorId;
    if (!renderEvidence.conversation.ready || !agentHandle || !conversationAnchorId) {
      return undefined;
    }

    let active = true;
    void (async () => {
      try {
        const hydrated = await bindings.app.projection.hydrateConversation({
          agentHandle,
          conversationAnchorId,
          currentSource: renderEvidence.source,
          currentChat: renderEvidence.chat,
        });
        if (!active) return;
        setEvidence((current) => {
          if (
            current.conversation.agentHandle !== agentHandle
            || current.conversation.conversationAnchorId !== conversationAnchorId
          ) {
            return current;
          }
          const chat = hydrated.chat.conversationAnchorId === conversationAnchorId
            ? mergeChatTranscript(current.chat, hydrated.chat)
            : current.chat;
          return {
            ...current,
            source: hydrated.source,
            chat,
            turn: turnStatusFromChat(chat),
          };
        });
      } catch {
        // Production returns typed failure evidence; an unexpected binding rejection cannot invent transcript state.
      }
    })();

    return () => {
      active = false;
    };
  }, [
    bindings,
    renderEvidence.conversation.ready,
    renderEvidence.conversation.agentHandle,
    renderEvidence.conversation.conversationAnchorId,
  ]);

  useEffect(() => {
    const agentHandle = renderEvidence.conversation.agentHandle;
    const conversationAnchorId = renderEvidence.conversation.conversationAnchorId;
    if (!renderEvidence.conversation.ready || !agentHandle || !conversationAnchorId) {
      return undefined;
    }
    return bindings.app.events.subscribeConversation({
      agentHandle,
      conversationAnchorId,
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

  const submitEnabled = isZhiyuDirectLocalAppSubmitEnabled({
    evidence: renderEvidence,
    draft,
  });
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
    const initial = createInitialZhiyuEvidence();
    setSelectedAgentHandle(agentHandle);
    setSelectedLocalAgentRefreshKey((current) => current + 1);
    setDraft('');
    setEvidence((current) => ({
      ...current,
      chat: initial.chat,
      turn: initial.turn,
      composer: initial.composer,
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
      agentCenterSession={agentCenterSession}
      onDraftChange={setDraft}
      onSubmit={handleSubmit}
      onStopChat={handleStopChat}
      onSelectLocalAgent={handleSelectLocalAgent}
      onDesktopOpenRuntimeSettings={bindings.app.commands.openDesktopRuntimeSettings}
      onDesktopOpenSelectPartner={bindings.app.commands.openDesktopSelectPartner}
      onAvatarLaunch={() => {
        void handleAvatarLaunch();
      }}
    />
  );
}
