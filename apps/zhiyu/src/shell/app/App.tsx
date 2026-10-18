import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { useNimiNavigationSnapshot } from '@nimiplatform/kit/ui/app-chrome';
import { useZhiyuNavigationOwner, type ZhiyuDestination } from './navigation.js';
import { isZhiyuAgentBusyReason } from './direct-local-app-submit-gate';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createInitialZhiyuEvidence, type ZhiyuEvidence } from './evidence';
import { useAgentComposerPersistence, reconcileAgentSubmission, AgentSubmissionSaveError, type AgentPendingSubmission } from '@nimiplatform/kit/features/chat/headless';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { turnStatusFromChat } from './app-evidence-transitions';
import { zhiyuRuntimeChatApplyIdentity, type ZhiyuRuntimeChatApplyIdentity } from './chat-turn-apply-guard';
import { ZhiyuAgentChatSurface } from '../agent-chat/ZhiyuAgentChatSurface';
import type { ZhiyuRuntimeAgentChatAttachment } from '../agent-chat/agent-conversation-state';
import { projectZhiyuHomeProductState } from './home-product-state';
import { projectZhiyuAvatarLaunchAction } from '../avatar/avatar-launch';
import type { ZhiyuCanonicalRendererBindings } from '../../renderer/contract';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import { sameZhiyuRuntimeAgentInventory } from '../agent/agent-inventory-projection';
import { projectZhiyuAuthorizedAgentCenterHandle } from '../agent/agent-center-handle';
import {
  isZhiyuDirectLocalAppSubmitEnabled,
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
  const owner = useZhiyuNavigationOwner();
  const { navigation } = owner;
  const snapshot = useNimiNavigationSnapshot<ZhiyuDestination>();
  const destination = snapshot.current.destination;
  const selectedAgentHandle = destination.agentHandle ?? null;
  const draftByPartner = useRef(new Map<string, string>());
  const draftRef = useRef('');
  const previousPosition = useRef<ZhiyuDestination | null>(null);
  const draftKey = destination.agentHandle ?? 'unselected';
  const [selectedLocalAgentRefreshKey, setSelectedLocalAgentRefreshKey] = useState(0);
  const [draft, setDraft] = useState('');
  const [pendingResourcePackPlacement, setPendingResourcePackPlacement] = useState<PendingResourcePackPlacement | null>(null);
  const observationRef = useRef<ReturnType<typeof bindings.app.events.subscribeConversation> | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submissionBusy = useRef<string | null>(null);
  const scopeKey = `${evidence.auth.accountId ?? ''}|${selectedAgentHandle ?? ''}|${evidence.conversation.conversationAnchorId ?? ''}`;
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  useEffect(() => { setSubmitting(false); setSubmissionError(null); }, [scopeKey]);
  const composerDraft = useMemo(() => {
    let text = draftByPartner.current.get(draftKey) ?? '';
    let revision = 0;
    const listeners = new Set<() => void>();
    return { get current() { return text; }, set current(value: string) { if (text !== value) { text = value; revision++; listeners.forEach(listener => listener()); } },
      get revision() { return revision; }, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  }, [selectedAgentHandle]);
  const persistence = useAgentComposerPersistence({ scopeKey, agentHandle: evidence.conversation.agentHandle ?? '',
    client: bindings.app.commands.draftClient, draft: composerDraft, subscribe: composerDraft.subscribe,
    isCurrent: () => currentScope.current === scopeKey && evidence.conversation.ready,
    onRestored: () => setDraft(composerDraft.current),
  });
  draftRef.current = draft;
  useLayoutEffect(() => {
    const previous = previousPosition.current;
    const previousKey = previous?.agentHandle ?? 'unselected';
    if (previous) draftByPartner.current.set(previousKey, draftRef.current);
    const samePartner = previous && (previous.conversationAnchorId && previous.conversationAnchorId === destination.conversationAnchorId || previous.agentHandle && previous.agentHandle === destination.agentHandle);
    const restoredDraft = samePartner ? draftRef.current : draftByPartner.current.get(draftKey) ?? '';
    composerDraft.current = restoredDraft;
    setDraft(restoredDraft);
    previousPosition.current = destination;
  }, [draftKey]);
  useLayoutEffect(() => {
    setEvidence(current => ({ ...createInitialZhiyuEvidence(), runtime: current.runtime, auth: current.auth, inventory: current.inventory }));
  }, [selectedAgentHandle]);
  useEffect(() => { owner.setHasSidebar(evidence.inventory.localAgents.length > 0); }, [evidence.inventory.localAgents.length, owner.setHasSidebar]);
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
          agentCenterSessionRef.current?.invalidate();
          agentCenterSessionRef.current?.dispose();
          void navigation.push({ id: 'partner', agentHandle: target.agentHandle as NimiLocalAppAgentHandle, conversationAnchorId: target.conversationAnchorId, panel: 'appearance' });
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
  }, [bindings, navigation]);

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
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [bindings, pendingResourcePackPlacement]);

  useEffect(() => {
    latestAgentInventoryRef.current = renderEvidence.inventory;
    bindings.app.events.onProjectionChanged?.(renderEvidence);
    latestConversationIdentityRef.current = zhiyuRuntimeChatApplyIdentity(renderEvidence.conversation);
  }, [bindings, renderEvidence]);

  useEffect(() => {
    let active = true;
    const entry = navigation.getSnapshot();
    const isCurrent = () => active && navigation.getSnapshot().generation === entry.generation && navigation.getSnapshot().current.key === entry.current.key;
    void (async () => {
      const home = await bindings.app.projection.loadHome({
        selectedAgentHandle,
        previousConversationAnchorId: destination.conversationAnchorId ?? null,
        isCurrent,
      });
      if (!isCurrent()) {
        return;
      }
      if (home.localAgent.ready && home.localAgent.agentHandle) {
        const anchor = home.conversation.ready ? home.conversation.conversationAnchorId : destination.conversationAnchorId;
        // Only Runtime proves a default/rotated opaque handle and Conversation anchor.
        if (home.localAgent.agentHandle !== selectedAgentHandle || anchor !== destination.conversationAnchorId) {
          void navigation.replace({ ...destination, agentHandle: home.localAgent.agentHandle, ...(anchor ? { conversationAnchorId: anchor } : {}) });
        }
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
  }, [bindings, navigation, selectedAgentHandle, destination.conversationAnchorId, snapshot.current.key, snapshot.generation, selectedLocalAgentRefreshKey]);

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
    const observation = bindings.app.events.subscribeConversation({
      agentHandle, conversationAnchorId,
      onChat: chat => setEvidence(current => current.conversation.agentHandle !== agentHandle || current.conversation.conversationAnchorId !== conversationAnchorId
        ? current : { ...current, chat, turn: turnStatusFromChat(chat) }),
      onStatus: status => setConnectionStatus(status),
    });
    observationRef.current = observation;
    return () => { observation.close(); if (observationRef.current === observation) observationRef.current = null; };
  }, [bindings, renderEvidence.conversation.ready, renderEvidence.conversation.agentHandle, renderEvidence.conversation.conversationAnchorId]);

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

  const submitEnabled = connectionStatus === 'ready' && !submitting && !persistence.submission && isZhiyuDirectLocalAppSubmitEnabled({ evidence: renderEvidence, draft });
  const composerState = evidence.chat.textTurnId || submitting ? 'submitting' : submitEnabled ? 'ready' : 'blocked';

  async function submitPending(submission: AgentPendingSubmission) {
    if (submissionBusy.current === currentScope.current) return;
    const scope = currentScope.current;
    const agentHandle = evidence.conversation.agentHandle;
    if (!agentHandle || submission.conversationAnchorId !== evidence.conversation.conversationAnchorId) return;
    submissionBusy.current = scope;
    setSubmitting(true);
    setSubmissionError(null);
    try {
      const admitted = await reconcileAgentSubmission({ conversation: bindings.app.commands.conversation(), agentHandle, submission,
        sendIfMissing: true, isCurrent: () => currentScope.current === scope });
      if (admitted) await persistence.acknowledge(submission.requestId);
    } catch (error) {
      if (scope !== currentScope.current) return;
      if (isZhiyuAgentBusyReason(extractNimiErrorFields(error).reasonCode)) {
        // Runtime explicitly rejected admission. The original input remains a draft.
        if (!submission.retryOfTurnId) {
          setDraft(submission.text);
          composerDraft.current = submission.text;
        }
        await persistence.acknowledge(submission.requestId);
        throw new Error('伙伴正在处理另一条消息，输入已保留，请稍后再发送。', { cause: error });
      } else setSubmissionError('暂未确认消息是否已受理。原内容已保留，可继续确认同一条消息。');
    } finally {
      if (submissionBusy.current === scope) submissionBusy.current = null;
      if (scope === currentScope.current) setSubmitting(false);
    }
  }

  async function handleSubmit(textInput: string, attachment?: ZhiyuRuntimeAgentChatAttachment, retryOfTurnId?: string) {
    if (submissionBusy.current === currentScope.current || (!retryOfTurnId && persistence.submission)) return;
    const agentHandle = evidence.conversation.agentHandle;
    const conversationAnchorId = evidence.conversation.conversationAnchorId;
    if (!agentHandle || !conversationAnchorId) return;
    const scope = currentScope.current;
    const text = textInput.trim();
    if (!text && !attachment && !retryOfTurnId) return;
    setSubmissionError(null);
    setSubmitting(true);
    submissionBusy.current = scope;
    let prepared = false;
    try {
      const requestId = await bindings.app.commands.allocateTurnRequestId();
      const uploaded = attachment ? await bindings.app.commands.conversation().uploadAttachment({ agentHandle, conversationAnchorId, ...attachment }) : null;
      if (scope !== currentScope.current) return;
      const submission: AgentPendingSubmission = { requestId, conversationAnchorId, text, artifactIds: uploaded ? [uploaded.artifactId] : [], ...(retryOfTurnId ? { retryOfTurnId } : {}) };
      const revision = composerDraft.revision;
      await persistence.prepare(submission);
      if (scope !== currentScope.current) return;
      prepared = true;
      if (!retryOfTurnId && composerDraft.revision === revision) { composerDraft.current = ''; setDraft(''); }
      if (submissionBusy.current === scope) submissionBusy.current = null;
      await submitPending(submission);
    } catch (error) {
      if (scope !== currentScope.current) return;
      // A definite admission rejection must reach Composer unchanged so its
      // text and attachment remain available for the next explicit attempt.
      if (prepared) throw error;
      logRendererEvent({ level: 'warn', area: 'zhiyu-chat', message: 'submission-preparation-failed', details: { ...extractNimiErrorFields(error instanceof Error ? error.cause ?? error : error), detail: error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined } });
      throw new Error(error instanceof AgentSubmissionSaveError ? '消息尚未发送：暂时无法保存。输入仍在，请稍后重试。' : '消息尚未发送，原输入已保留，请重试。', { cause: error }); // Keep the composer attachment when upload/save never reached admission.
    } finally {
      if (submissionBusy.current === scope) submissionBusy.current = null;
      if (scope === currentScope.current) setSubmitting(false);
    }
  }

  async function handleStopChat() {
    const agentHandle = evidence.conversation.agentHandle;
    const conversationAnchorId = evidence.conversation.conversationAnchorId;
    const expectedTurnId = evidence.chat.textTurnId;
    const scope = currentScope.current;
    if (!agentHandle || !conversationAnchorId || !expectedTurnId) return;
    try {
      await bindings.app.commands.conversation().interruptTurn({ agentHandle, conversationAnchorId, expectedTurnId });
    } catch {
      if (scope === currentScope.current) setSubmissionError('尚未确认停止结果，正在重新读取。已收到的内容会保留。');
    } finally { if (scope === currentScope.current) await observationRef.current?.refresh(); }
  }

  function handleSelectLocalAgent(agentHandle: NimiLocalAppAgentHandle) {
    agentCenterSession?.invalidate();
    agentCenterSession?.dispose();
    const initial = createInitialZhiyuEvidence();
    void navigation.push({ id: 'partner', agentHandle });
    setSelectedLocalAgentRefreshKey((current) => current + 1);
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
      submitting={submitting}
      composerState={composerState}
      draftSaveStatus={persistence.status}
      onRetryDraftSave={persistence.retry}
      interactionNotice={submissionError}
      connectionStatus={connectionStatus}
      pendingSubmission={persistence.submission}
      onAcknowledgeSubmission={persistence.acknowledge}
      onRestoreSubmission={text => {
        if (currentScope.current !== scopeKey || !text) return;
        const previous = composerDraft.current;
        const restored = previous && previous !== text ? `${previous}\n\n${text}` : text;
        composerDraft.current = restored;
        draftByPartner.current.set(draftKey, restored);
        setDraft(restored);
      }}
      onSubmissionResolved={() => { setSubmissionError(null); void observationRef.current?.refresh(); }}
      onRefreshConversation={() => { void observationRef.current?.refresh(); }}
      onReloadImages={() => { observationRef.current?.retryMedia(); }}
      onRegenerate={() => {
        if (!evidence.chat.regenerateTurnId) return;
        void handleSubmit('', undefined, evidence.chat.regenerateTurnId).catch(error => {
          if (currentScope.current === scopeKey) setSubmissionError(error instanceof Error ? error.message : '暂时无法重新回答，请稍后重试。');
        });
      }}
      conversation={bindings.app.commands.conversation}
      avatarLaunchAction={avatarLaunchAction}
      agentCenterSession={agentCenterSession}
      resourcePackPresentation={resourcePackPresentation}
      resourcePackPlacementKey={readyResourcePackPlacementKey}
      onDraftChange={value => {
        if (currentScope.current !== scopeKey) return;
        draftByPartner.current.set(draftKey, value);
        composerDraft.current = value;
        setDraft(value);
      }}
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
