import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Settings2 } from 'lucide-react';
import { AgentLifecycleStatus } from '@nimiplatform/sdk/runtime/wire-types';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import type { NimiLocalAppAgentReference } from '@nimiplatform/sdk/app';
import { Button, IconButton, InlineAlert, LoadingSkeleton } from '@nimiplatform/kit/ui';
import { createBrowserAppConversationHostPort, createCanonicalConversationMediaReader, reconcileAgentSubmission,
  observeLocalAppConversation, useAgentComposerPersistence, type AgentPendingSubmission, type CanonicalConversationProjection,
  type LocalAppConversationObservation } from '@nimiplatform/kit/features/chat/headless';
import { useAgentIntroduction, useLocalAppConversationHistory, useLocalAppConversationPlayback, useLocalAppConversationQuote, type ConversationReadPosition } from '@nimiplatform/kit/features/chat/runtime';
import { AgentIntroduction, CanonicalComposer, CanonicalConversationPane, CanonicalTranscriptView, getMessageInteractionCopy,
  LocalAppConversationMediaStopButton, LocalAppConversationPlayer, LocalAppConversationQuotePreview, } from '@nimiplatform/kit/features/chat/ui';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat';
import { useAppStoreApi, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import type { HomeDestination } from '../../app-shell/providers/home-navigation.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { RelationshipActionsMenu } from '../relationship/relationship-actions-menu.js';
import { readHomePartner } from '../agents/partner-navigation.js';
import { useHomeAppActivity } from '../system-entry/system-entry-context.js';
import { homePartnerDraftKey } from '../home/home-partner-draft.js';
import { useContactsScope } from './contacts-scope.js';
import { toAgentReferenceTargetSummary } from './chat-sidebar-targets.js';
import { ChatComposerLeadingAvatar } from './chat-shared-composer-leading-avatar.js';
import { ChatAgentSceneBackground } from './chat-agent-scene-background.js';
import { CHAT_COMPOSER_RAIL_RESERVE_CLASS, CHAT_CONTENT_WIDTH_CLASS, CHAT_CONTENT_POSITION_CLASS,
  CHAT_TRANSCRIPT_BOTTOM_RESERVE_CLASS, CHAT_TRANSCRIPT_SCROLL_VIEWPORT_CLASS } from './chat-shared-content-layout.js';
import { ChatCompanionReadReceipt } from './chat-companion-read-receipt.js';
import { localAgentConfigurationFailure, toChatUserFacingRuntimeError } from './chat-runtime-error-message.js';
import { useChatReadPosition } from './use-chat-read-position.js';
import { launchAgentConversationFromDisplay } from './agent-conversation-launcher.js';
import { AgentFollowUpControl } from './chat-agent-follow-up-control.js';
import { AgentSubmissionRecovery } from './chat-agent-submission-recovery.js';
import { isPrimaryReply, materializeCanonicalConversationBundle } from './chat-agent-canonical-conversation-projection.js';

type Target = NonNullable<HomeDestination['partnerChat']>;
type Reference = NimiLocalAppAgentReference;

function createDraft() {
  let text = '';
  let revision = 0;
  const listeners = new Set<() => void>();
  return {
    get current() { return text; },
    set current(value) { if (value !== text) { text = value; revision++; listeners.forEach(listener => listener()); } },
    get revision() { return revision; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

// @nimi-authority: rule.nimi.desktop.agent-projection.r002
export function HomePartnerConversation({ target, railReserved = true }: { target: Target; railReserved?: boolean }) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const navigation = useHomeNavigation();
  const { auth, accountId, scope } = useContactsScope();
  const selected = useQuery({
    queryKey: ['home-contact-conversation', scope, target.localAgentRef],
    enabled: auth.status === 'authenticated',
    retry: false, gcTime: 0, networkMode: 'always',
    queryFn: async ({ signal }) => {
      const partner = await readHomePartner({ sdk, accountId, localAgentRef: target.localAgentRef, isCurrent: () => !signal.aborted });
      if (!partner || partner.lifecycle !== AgentLifecycleStatus.ACTIVE) return { partner };
      signal.throwIfAborted();
      const { reference } = await sdk.resolveDesktopAgentReference({ localAgentRef: target.localAgentRef });
      if (!reference) throw new Error('Partner unavailable');
      signal.throwIfAborted();
      const selectedReference = reference as Reference; // The Desktop resolver validates the same public handle format.
      const { conversationAnchorId } = await sdk.conversation().open({ agentHandle: selectedReference.agentHandle });
      return { partner, reference: selectedReference, conversationAnchorId };
    },
  });
  if (auth.status !== 'authenticated' && auth.status !== 'refresh-pending') return <p className="p-4">{t('runtimeConfig.partners.signIn')}</p>;
  if (selected.isPending) return <LoadingSkeleton lines={4} />;
  if (selected.isError) return <InlineAlert tone="warning" action={<Button onClick={() => { void selected.refetch(); }}>{t('Common.retry')}</Button>}>{t('runtimeConfig.partners.unavailable')}</InlineAlert>;
  const { partner, reference, conversationAnchorId } = selected.data!;
  if (!reference || !conversationAnchorId) return <div className="space-y-3 p-4">
    <p>{partner?.displayName} · {t(`runtimeConfig.partners.lifecycle.${partner?.lifecycle ?? 0}`, { defaultValue: t('runtimeConfig.partners.unavailable') })}</p>
    {partner ? <Button onClick={() => { void navigation.push({ id: 'contacts', contactView: 'partners', partner: { localAgentRef: target.localAgentRef } }); }}>{t('Chat.contactsProfile')}</Button> : null}
  </div>;
  return <PartnerTranscript key={reference.agentHandle + ':' + conversationAnchorId}
    target={target} reference={reference} anchor={conversationAnchorId} scope={scope}
    accountId={accountId} railReserved={railReserved} refreshReference={() => { void selected.refetch(); }} />;
}

function PartnerTranscript({ target, reference, anchor, scope, accountId, railReserved, refreshReference }: {
  target: Target; reference: Reference; anchor: string; scope: string; accountId: string; railReserved: boolean; refreshReference: () => void;
}) {
  const { t, i18n } = useTranslation();
  const copy = getMessageInteractionCopy(i18n.language);
  const sdk = useDesktopRendererSdk();
  const navigation = useHomeNavigation();
  const store = useAppStoreApi();
  const activity = useHomeAppActivity();
  const client = useCallback(() => sdk.appProduct(), [sdk]);
  const conversation = useCallback(() => sdk.conversation(), [sdk]);
  const getIntroduction = useCallback<ReturnType<typeof client>['agents']['getIntroduction']>(
    request => client().agents.getIntroduction(request), [client],
  );
  const { introduction, unavailable: introductionUnavailable, retry: retryIntroduction } = useAgentIntroduction({
    agentHandle: reference.agentHandle, getIntroduction,
  });
  const composer = useRef<HTMLDivElement>(null);
  const identity = useMemo(() => ({ agentHandle: reference.agentHandle, conversationAnchorId: anchor }), [reference.agentHandle, anchor]);
  const current = useRef(false);
  const [projection, setProjection] = useState<CanonicalConversationProjection | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<{ message: string; configuration: boolean } | null>(null);
  const [mediaRevision, setMediaRevision] = useState(0);
  const observer = useRef<LocalAppConversationObservation | null>(null);
  const media = useRef<ReturnType<typeof createCanonicalConversationMediaReader> | null>(null);
  const position = useRef<ConversationReadPosition | null>(null);
  const [draft] = useState(createDraft);
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<{ artifactId: string; name: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [working, setWorking] = useState(false);
  const locked = useRef(false);
  const port = useMemo(() => createBrowserAppConversationHostPort(), []);
  const report = (reason: unknown) => {
    if (!current.current) return;
    const described = toChatUserFacingRuntimeError(reason, t('Chat.contactsActionFailed'), t, { localAgent: true });
    setError({ message: described.message, configuration: localAgentConfigurationFailure(described.code) });
  };
  const updateDraft = useCallback((value: string) => { draft.current = value; setText(value); }, [draft]);
  const isCurrent = useCallback(() => current.current, []);
  useEffect(() => {
    current.current = true;
    const access = store.getState().auth;
    const unsubscribe = store.subscribe(state => { if (state.auth.user?.id !== access.user?.id ||
      state.auth.authorizationRevision !== access.authorizationRevision || state.auth.user?.realmEnvironmentId !== access.user?.realmEnvironmentId) {
      current.current = false;
      observer.current?.close();
      media.current?.close();
      void port.voiceInput.cancel();
    } });
    const call = conversation();
    observer.current = observeLocalAppConversation({ conversation: call, scope: identity, onProjection: setProjection,
      onStatus: (status, reason) => {
        if (status === 'error') { setUnavailable(true); setProjection(null); report(reason); }
        if (status === 'ready') setUnavailable(false);
      } });
    media.current = createCanonicalConversationMediaReader({ conversation: call, scope: identity, onChange: () => setMediaRevision(n => n + 1),
      onAccessDenied: reason => observer.current?.invalidateAccess(reason) });
    return () => {
      current.current = false;
      unsubscribe();
      observer.current?.close();
      media.current?.close();
      void port.voiceInput.cancel();
    };
  }, [identity, conversation, port, store]);

  const scopeKey = scope + ':' + reference.agentHandle + ':' + anchor;
  const accessDenied = unavailable;
  const quote = useLocalAppConversationQuote({ ...identity, scopeKey, conversation, accessDenied,
    onAccessDenied: reason => observer.current?.invalidateAccess(reason) });
  const history = useLocalAppConversationHistory({ ...identity, scopeKey, conversation, accessDenied,
    liveProjection: projection, capturePosition: () => position.current, onAccessDenied: reason => observer.current?.invalidateAccess(reason) });
  const readPosition = useChatReadPosition('partner:' + anchor, {
    positionRequest: history.positionRequest, onPositionChange: value => { position.current = value; }, onUserNavigate: history.cancelNavigation,
  });
  const playback = useLocalAppConversationPlayback({ agentHandle: unavailable ? null : identity.agentHandle, conversationAnchorId: anchor, conversation, accessKey: scopeKey });
  const persistence = useAgentComposerPersistence({ scopeKey, ...identity, agentBinding: reference.agentBinding, client, draft, isCurrent,
    subscribe: draft.subscribe, onRestored: () => setText(draft.current), quoteDraft: quote.draftRef, subscribeQuote: quote.subscribe });
  const pending = persistence.submission;
  const prefill = target.draft;
  const [consumedPrefill, setConsumedPrefill] = useState<string>();
  const draftConflict = Boolean(prefill && prefill.text !== consumedPrefill && (text || quote.state.status !== 'empty' || pending));
  const finishPrefill = useCallback(() => {
    void navigation.replace({ id: 'contacts', partnerChat: { localAgentRef: target.localAgentRef } });
  }, [navigation, target.localAgentRef]);
  const takePrefill = useCallback((append: boolean) => {
    if (!prefill || !current.current) return;
    if (!append) { finishPrefill(); return; }
    updateDraft(draft.current ? draft.current + '\n' + prefill.text : prefill.text);
    setConsumedPrefill(prefill.text);
  }, [prefill, updateDraft, draft, finishPrefill]);
  useEffect(() => {
    if (!prefill || persistence.status !== 'saved') return;
    if (prefill.text !== consumedPrefill) {
      if (!draftConflict) takePrefill(true);
      return;
    }
    const sourceKey = prefill.source ? homePartnerDraftKey(accountId, prefill.source) : null;
    if (prefill.source && sourceKey && store.getState().homePartnerDrafts[sourceKey] === prefill.text) {
      store.getState().setHomePartnerDraft(accountId, prefill.source, '');
    }
    finishPrefill();
  }, [prefill, consumedPrefill, persistence.status, draftConflict, takePrefill, accountId, store, finishPrefill]);

  const positioned = useRef<string | null>(null);
  useEffect(() => {
    const id = target.messageId ?? projection?.messages.find(message => message.turnId === target.turnId && isPrimaryReply(message))?.messageId;
    if (id && projection && positioned.current !== id) {
      positioned.current = id;
      void history.locate(id);
    }
  }, [target.messageId, target.turnId, projection, history.locate]);

  const visible = history.projection;
  const messages = useMemo(() => {
    if (!visible) return [];
    const { messages: records } = materializeCanonicalConversationBundle({
      projection: visible, media: media.current ?? undefined, nowMs: 0,
      thread: { id: anchor, title: reference.displayName, updatedAtMs: 0, lastMessageAtMs: null,
        targetSnapshot: { ...identity, displayName: reference.displayName, avatarUrl: reference.avatarUrl,
          handle: '', worldId: null, worldName: null, bio: null, ownershipType: null, greeting: null, builtinDocsContext: null } },
    });
    return records.map((message): ConversationCanonicalMessage => {
      const emptyReply = message.role === 'assistant' && message.kind === 'text' && message.status === 'error' && !message.contentText.trim();
      return {
        id: message.id, sessionId: anchor, targetId: reference.agentHandle, source: 'agent',
        role: message.role, kind: message.kind === 'image' && message.status === 'pending' ? 'image-pending' : message.kind,
        createdAt: '', text: emptyReply
          ? t(message.metadataJson?.canonicalTerminalReason === 'user_cancel' ? 'Chat.agentReplyStopped' : 'Chat.agentReplyIncomplete')
          : message.contentText,
        error: message.error?.message,
        status: message.status === 'pending' && message.kind === 'text' ? 'streaming' : message.status,
        metadata: { ...message.metadataJson, artifactId: message.artifactId, mediaUrl: message.mediaUrl,
          mediaMimeType: message.mediaMimeType, ...(message.kind === 'image' ? { caption: message.contentText } : {}) },
      };
    });
  }, [visible, anchor, reference, identity, mediaRevision, t]);
  const replies = new Map(activity.recent.records.filter(record => record.source.kind === 'runtime-agent' &&
    record.agent?.agentRef === reference.activityAgentRef && record.userView.unread).map(record => [record.key, record]));

  const run = async (action: () => Promise<void>, rethrow = false) => {
    if (locked.current || !current.current) return;
    locked.current = true;
    setWorking(true); setError(null);
    try { await action(); } catch (reason) { report(reason); if (rethrow) throw reason; }
    finally { locked.current = false; if (current.current) setWorking(false); }
  };
  const send = async (value: string, retryOfTurnId?: string) => {
    if (pending || unavailable) return;
    const requestId = crypto.randomUUID();
    const draftRevision = draft.revision;
    const quoteRevision = quote.revision;
    const artifactIds = !retryOfTurnId && attachment ? [attachment.artifactId] : [];
    const quotation = !retryOfTurnId ? quote.state.input : null;
    const submission: AgentPendingSubmission = { requestId, conversationAnchorId: anchor, text: value.trim(), artifactIds,
      ...(retryOfTurnId ? { retryOfTurnId } : {}), ...(quotation ? { quote: quotation } : {}) };
    await persistence.prepare(submission, { textRevision: draftRevision, quoteRevision });
    if (!current.current) return;
    try {
      const admitted = await reconcileAgentSubmission({
        conversation: conversation(), agentHandle: identity.agentHandle, submission,
        sendIfMissing: true, isCurrent,
      });
      if (!admitted) return;
    } catch (reason) {
      const code = extractNimiErrorFields(reason).reasonCode?.toUpperCase();
      if (current.current && (code === 'AGENT_BUSY' || code === 'AI_CONFIG_NOT_FOUND')) {
        const retained = quote.revision === quoteRevision ? quote.draftRef.current : null;
        const clearing = persistence.acknowledge(requestId);
        if (retained && !quote.draftRef.current) quote.draftRef.current = retained;
        await clearing;
      }
      throw reason;
    }
    if (!current.current) return;
    if (!retryOfTurnId && draft.revision === draftRevision) updateDraft('');
    if (!retryOfTurnId && quote.revision === quoteRevision) quote.cancel();
    if (artifactIds.length) setAttachment(slot => slot && artifactIds.includes(slot.artifactId) ? null : slot);
    await persistence.acknowledge(requestId);
  };
  const openProfile = (settings?: 'overview') => { void navigation.push({ id: 'contacts', contactView: 'partners',
    partner: { localAgentRef: target.localAgentRef, settingsSection: settings } }); };
  const refresh = () => {
    setError(null);
    void observer.current?.refresh();
  };
  const openZhiyu = (initialComposerText?: string) => run(async () => {
    await launchAgentConversationFromDisplay({
      initialComposerText,
      target: { ...identity, displayName: reference.displayName, avatarUrl: reference.avatarUrl, handle: '',
        worldId: null, worldName: null, bio: null, ownershipType: null, greeting: null, builtinDocsContext: null },
    });
  });
  const regenerate = [...(projection?.turns ?? [])].reverse().find(turn => turn.canRegenerate);
  const located = target.turnId ? projection?.messages.some(message => message.turnId === target.turnId && isPrimaryReply(message)) : true;
  const failedTarget = history.status === 'error' || Boolean(projection && target.turnId && !target.messageId && !located);
  const selectedTarget = toAgentReferenceTargetSummary(reference);
  const pickImage = async () => {
    if (!current.current || !projection) return [];
    const picked = await port.attachments.pickImage();
    if (!current.current) return [];
    if (picked.status !== 'selected') {
      if (picked.reasonCode === 'IMAGE_PICKER_CANCELLED') return [];
      throw new Error(picked.message || t('Chat.contactsActionFailed'));
    }
    const uploaded = await conversation().uploadAttachment({ ...identity, mimeType: picked.mimeType, bytes: picked.bytes, ...(picked.displayName ? { displayName: picked.displayName } : {}) });
    return current.current ? [{ artifactId: uploaded.artifactId, name: picked.displayName ?? '' }] : [];
  };
  const toggleRecording = () => { void run(async () => {
    const revision = draft.revision;
    const result = await port.voiceInput.record();
    if (!current.current) return;
    setRecording(result.status === 'recording');
    if (result.status === 'unavailable') throw new Error(result.message || t('Chat.contactsActionFailed'));
    if (result.status === 'recorded') {
      const { text: spoken } = await conversation().transcribeVoice({ ...identity, requestId: crypto.randomUUID(), mimeType: result.mimeType, audioBytes: result.bytes });
      if (current.current && draft.revision === revision && spoken) updateDraft(draft.current ? draft.current + '\n' + spoken : spoken);
    }
  }); };
  return <div className="relative flex min-h-0 min-w-0 flex-1" data-testid="home-partner-conversation">
    <ChatAgentSceneBackground />
    <CanonicalConversationPane selectedTarget={selectedTarget} chrome="transparent" viewMode="chat"
      onBackToTargets={() => {}} onViewModeChange={() => {}} stagePanel={null}
      topContent={error || failedTarget || history.returnPosition || history.status === 'history' ? <div className={railReserved ? 'space-y-2 pr-[76px]' : 'space-y-2'}>
    {error ? <InlineAlert tone="warning" action={unavailable ? <Button size="sm" onClick={() => { refreshReference(); refresh(); }}>{t('Common.retry')}</Button> :
      error.configuration ? <Button size="sm" onClick={() => openProfile('overview')}>{t('Chat.contactsManage')}</Button> : undefined}>{error.message}</InlineAlert> : null}
    {failedTarget ? <InlineAlert tone="warning" action={<div className="flex flex-wrap gap-2">
      <Button size="sm" tone="ghost" onClick={() => { if (history.status === 'error') void history.retry(); else refresh(); }}>{t('Common.retry')}</Button>
      <Button size="sm" onClick={() => { history.returnToLatest(); void navigation.replace({ id: 'contacts', partnerChat: { localAgentRef: target.localAgentRef } }); }}>{t('Chat.contactsOpenConversation')}</Button></div>}>{t('Chat.contactsReplyUnavailable')}</InlineAlert> : null}
    {history.returnPosition || history.status === 'history' ? <Button className="self-start" size="sm" tone="ghost" onClick={() => { void history.returnToPrevious(); }}>{t('Chat.contactsReturnHistory')}</Button> : null}
      </div> : undefined}
      transcript={<CanonicalTranscriptView messages={messages} copy={copy} activeConversationId={anchor} agentName={reference.displayName} agentAvatarUrl={reference.avatarUrl}
      loading={!projection && !unavailable || history.status === 'loading'} emptyTitle="" emptyEyebrow="" emptyDescription=""
      widthClassName={CHAT_CONTENT_WIDTH_CLASS} widthPositionClassName={CHAT_CONTENT_POSITION_CLASS}
      scrollViewportWidthClassName={railReserved ? CHAT_TRANSCRIPT_SCROLL_VIEWPORT_CLASS : 'w-full [scrollbar-gutter:stable]'} contentPaddingBottomClassName={CHAT_TRANSCRIPT_BOTTOM_RESERVE_CLASS}
      emptyStateContent={<AgentIntroduction introduction={introduction} unavailable={introductionUnavailable} onRetry={retryIntroduction}
        displayName={reference.displayName} avatarUrl={reference.avatarUrl} locale={i18n.resolvedLanguage || i18n.language}
        imageMaxSize="clamp(160px, calc(100dvh - 560px), 320px)" questionsEnabled={Boolean(projection && !unavailable)}
        onPrefill={value => {
          updateDraft(draft.current.trim() && draft.current.trim() !== value ? draft.current + '\n' + value : value);
          composer.current?.querySelector('textarea')?.focus();
        }} />}
      pendingFirstBeat={Boolean(projection?.state.textTurnId) && history.status !== 'history'}
      onStopGenerating={() => { const expectedTurnId = projection?.state.textTurnId; if (expectedTurnId) void run(async () => { await conversation().interruptTurn({ ...identity, expectedTurnId }); }); }}
      positionRequest={readPosition.positionRequest} onPositionChange={readPosition.onPositionChange} onUserNavigate={readPosition.onUserNavigate}
      messageActions={{ scopeKey, playback, onLocateMessage: history.locate, onQuote: quote.prepare,
        canQuote: row => Boolean(row.metadata?.canonicalMessageCommitted && !row.metadata?.canonicalPartial && row.kind === 'text' && (row.role === 'user' || row.role === 'assistant')),
        onOpenVoiceSettings: () => openProfile('overview') }}
      renderMessageAccessory={row => {
        if (row.role !== 'assistant' || row.kind !== 'text' || row.status !== 'complete') return null;
        const turnId = row.metadata?.canonicalTurnId;
        const reply = replies.get('turn:' + turnId);
        return <>{reply ? <ChatCompanionReadReceipt reply={reply} /> : null}
          {row.metadata?.canonicalMediaRunning && typeof turnId === 'string' ? <LocalAppConversationMediaStopButton {...identity} turnId={turnId} conversation={conversation} label={t('Chat.contactsStopMedia')} errorLabel={t('Chat.contactsActionFailed')} /> : null}
          {playback.state.messageId === row.id ? <LocalAppConversationPlayer playback={playback} copy={copy} placement="inline" /> : null}</>;
      }} />}
    composer={<div ref={composer} className={railReserved ? CHAT_COMPOSER_RAIL_RESERVE_CLASS : undefined}>
      <LocalAppConversationPlayer playback={playback} copy={copy} onLocateMessage={id => { void history.locate(id); }} />
      {projection ? <AgentFollowUpControl {...identity} state={projection.state} conversation={conversation} refresh={refresh} onOpenAgentCenter={() => openProfile('overview')} /> : null}
      {prefill && (draftConflict || persistence.status === 'unsaved') ? <InlineAlert tone="warning" action={<div className="flex gap-2">
        <Button size="sm" onClick={() => takePrefill(false)}>{t('Chat.contactsKeepDraft')}</Button>
        {persistence.status !== 'unsaved' ? <Button size="sm" onClick={() => takePrefill(true)}>{t('Chat.contactsAppendDraft')}</Button> :
          <Button size="sm" onClick={persistence.retry}>{t('Common.retry')}</Button>}
      </div>}>{t('Chat.contactsIncomingDraft')}</InlineAlert> : null}
      {persistence.status === 'unsaved' && !prefill ? <InlineAlert tone="warning" action={<Button size="sm" onClick={persistence.retry}>{t('Common.retry')}</Button>}>{t('Chat.contactsDraftUnsaved')}</InlineAlert> : null}
      {pending && pending.conversationAnchorId === anchor && !unavailable ? <AgentSubmissionRecovery
        submission={pending} agentHandle={identity.agentHandle} conversation={conversation} acknowledge={persistence.acknowledge}
        onResolved={refresh} onRestore={value => { if (!draft.current) updateDraft(value); }}
        onAdmitted={submission => { setAttachment(slot => slot && submission.artifactIds.includes(slot.artifactId) ? null : slot); }} /> : null}
      <CanonicalComposer adapter={{ submit: ({ text: value }) => run(() => send(value), true) }} text={text} onTextChange={updateDraft}
        attachments={attachment ? [attachment] : []} onAttachmentsChange={next => setAttachment(next[0] ?? null)}
        attachmentAdapter={{ openPicker: pickImage, mergeAttachments: (_previous, incoming) => incoming,
          getKey: value => value.artifactId, getKind: () => 'image', getLabel: value => value.name }}
        attachLabel={t('Chat.contactsAttach')} onSubmitError={report}
        copy={copy} widthClassName={CHAT_CONTENT_WIDTH_CLASS} widthPositionClassName={CHAT_CONTENT_POSITION_CLASS}
        placeholder={t('Chat.agentComposerPlaceholder')} sendLabel={t('Chat.contactsSend')} layout="stacked"
        submitDisabled={!projection || working || Boolean(pending || projection.state.textTurnId) || persistence.status === 'loading' || persistence.status === 'unsaved' || quote.state.status === 'preparing' || quote.state.status === 'error'}
        quoteSlot={<LocalAppConversationQuotePreview quote={quote} copy={copy} />}
        leadingSlot={<ChatComposerLeadingAvatar kind="agent" agentHandle={reference.agentHandle}
          name={reference.displayName} imageUrl={reference.avatarUrl} />}
        voiceState={projection ? { status: recording ? 'recording' : 'idle', onToggle: toggleRecording,
          onCancel: () => { setRecording(false); void port.voiceInput.cancel(); } } : undefined}
        trailingSlot={<div className="flex items-center gap-1">
          {regenerate ? <Button size="sm" tone="ghost" disabled={working || Boolean(pending || projection?.state.textTurnId)}
            onClick={() => void run(() => send('', regenerate.turnId))}>{t('Chat.contactsRegenerate')}</Button> : null}
          <IconButton size="sm" tone="ghost" icon={<Settings2 size={17} />} aria-label={t('Chat.contactsManage')}
            title={t('Chat.contactsManage')} onClick={() => openProfile('overview')} />
          <RelationshipActionsMenu label={t('Chat.partnerCard.more')} items={[
            { id: 'open-zhiyu', label: t('Chat.contactsOpenZhiyu'), onSelect: () => { void openZhiyu(); } },
            ...(text.trim() ? [{ id: 'draft-zhiyu', label: t('Chat.contactsOpenDraftZhiyu'), onSelect: () => { void openZhiyu(text); } }] : []),
          ]} />
        </div>} />
    </div>} />
  </div>;
}
