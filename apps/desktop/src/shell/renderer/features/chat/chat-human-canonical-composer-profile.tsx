import { useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { useRealmSocialData } from '../social/data/realm-social-data-context.js';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { finalizeNimiRealmTransferredFile, uploadNimiRealmResourceFile } from '@nimiplatform/sdk/realm';
import { CanonicalComposer } from '@nimiplatform/kit/features/chat/components/canonical-composer';
import { CHAT_CONTENT_WIDTH_CLASS, CHAT_CONTENT_POSITION_CLASS } from './chat-shared-content-layout';
import {
  createRealmChatResourceAttachmentPayload,
  type RealmChatViewDto,
} from '@nimiplatform/kit/features/chat/realm';
import { useTranslation } from 'react-i18next';
import { useRealmHumanChatData } from './data/realm-human-chat-data-context.js';
import { useAppStore, useAppStoreApi } from '../../app-shell/providers/app-store';
import { captureAccountActionScope } from '../../app-shell/providers/account-action-scope.js';
import { createHumanChatSender } from './human-chat-send.js';
import type { HumanContactAdmission } from './chat-human-contact-admission.js';
import { Button, ConfirmDialog, InlineAlert } from '@nimiplatform/kit/ui';
import { E2E_IDS } from '../../testability/e2e-ids';
import { ChatProfileCard } from '../turns/message-timeline-profile-card.js';
import { toChatProfileSummary } from '../turns/message-timeline-utils.js';
import {
  toHumanProfileData,
  type HumanProfileSource,
} from '../profile/profile-model';
import { mergeSentRealmChatMessageIntoCache } from '../turns/chat-send-cache.js';
import { formatPendingAttachmentSize, appendPendingAttachment, clearPendingAttachments, type PendingAttachment } from '../turns/turn-input-attachments';
import { ChatComposerLeadingAvatar } from './chat-shared-composer-leading-avatar';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context';

function HumanAttachmentStrip(props: {
  attachments: readonly PendingAttachment[];
  removeAttachment: (index: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2">
      {props.attachments.map((attachment, index) => (
        <div key={`${attachment.previewUrl}-${index}`} className="relative shrink-0">
          {attachment.kind === 'image' ? (
            <img
              src={attachment.previewUrl}
              alt={t('ChatTimeline.imageMessage', 'Image')}
              className="block h-20 w-20 rounded-xl object-cover"
            />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] shadow-[0_6px_20px_rgba(15,23,42,0.08)]">
              <div className="relative h-24 w-40 overflow-hidden bg-gray-900">
                <video
                  src={attachment.previewUrl}
                  className="block h-full w-full object-cover"
                  muted
                  playsInline
                  preload="metadata"
                />
              </div>
              <div className="w-40 px-3 py-2">
                <p className="truncate text-[12px] font-medium leading-4 text-[var(--nimi-text-primary)]">{attachment.name}</p>
                <p className="mt-1 text-[11px] leading-4 text-[var(--nimi-text-muted)]">{formatPendingAttachmentSize(attachment.file.size)}</p>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => props.removeAttachment(index)}
            className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white transition-colors hover:bg-black/85"
            aria-label={t('TurnInput.removeAttachment')}
            title={t('TurnInput.removeAttachment')}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

type HumanCanonicalComposerProps = {
  selectedChatId: string | null;
  contactAdmission: HumanContactAdmission;
  leadingAvatar?: {
    name: string; imageUrl?: string | null; fallbackLabel?: string | null;
    targetId?: string | null; handle?: string | null; worldName?: string | null;
  } | null;
};

export function HumanCanonicalComposer(props: HumanCanonicalComposerProps) {
  const auth = useAppStore(state => state.auth);
  const store = useAppStoreApi();
  const identity = JSON.stringify([auth.user?.realmEnvironmentId, auth.user?.id, store.navigation.getSnapshot().generation]);
  const files = useRef<{ identity: string; peers: Map<string, PendingAttachment[]> }>({ identity, peers: new Map() });
  if (files.current.identity !== identity) {
    for (const items of files.current.peers.values()) clearPendingAttachments(items, url => URL.revokeObjectURL(url));
    files.current = { identity, peers: new Map() };
  }
  useEffect(() => () => {
    for (const items of files.current.peers.values()) clearPendingAttachments(items, url => URL.revokeObjectURL(url));
    files.current.peers.clear();
  }, []);
  const peer = props.leadingAvatar?.targetId;
  if (!peer || !auth.user?.id || !auth.user?.realmEnvironmentId || (auth.status !== 'authenticated' && auth.status !== 'refresh-pending')) return null;
  return <HumanComposerForAccount key={`${identity}:${peer}`} {...props} peerAccountId={peer}
    initialAttachments={files.current.peers.get(peer) ?? []}
    rememberAttachments={items => { files.current.peers.set(peer, items); }} />;
}

function useOpenConversationProfile() {
  const navigation = useHomeNavigation();
  const viewer = useAppStore(state => state.auth.user);
  const cache = useQueryClient();
  return (id: string, displayName: string, handle?: string | null, avatarUrl?: string | null) => {
    if (viewer && id !== viewer.id) cache.setQueryData(['chat-peer-identity', viewer.realmEnvironmentId, viewer.id, id],
      { id, displayName, handle: handle || '', avatarUrl: avatarUrl ?? null });
    navigation.push({ id: 'profile', profileId: id });
  };
}

function HumanComposerForAccount(props: HumanCanonicalComposerProps & {
  peerAccountId: string; initialAttachments: PendingAttachment[]; rememberAttachments(items: PendingAttachment[]): void;
}) {
  const openProfile = useOpenConversationProfile();
  const store = useAppStoreApi();
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const realmHumanChatData = useRealmHumanChatData();
  const queryClient = useQueryClient();
  const offlineTier = useAppStore(state => state.offlineTier);
  const account = useRef<ReturnType<typeof captureAccountActionScope>>(null);
  const [offline] = useState(() => sdk.offline.capture());
  const active = useRef(true);
  const revision = useRef(0);
  const [text, setText] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState(props.initialAttachments);
  const draft = useRef({ text, pendingAttachments }); draft.current = { text, pendingAttachments };
  const [ready, setReady] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [missingAttachments, setMissingAttachments] = useState<string[]>([]);
  const missingNames = useRef<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stopRetryOpen, setStopRetryOpen] = useState(false);
  const [, refresh] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pickerResolverRef = useRef<((items: readonly PendingAttachment[] | null) => void) | null>(null);
  const isCurrent = () => active.current && Boolean(account.current?.isCurrent());
  const admission = useRef(props.contactAdmission); admission.current = props.contactAdmission;
  const admissionMessage = props.contactAdmission.state === 'loading' ? t('TurnInput.contactChecking')
    : props.contactAdmission.state === 'error' ? t('TurnInput.contactCheckFailed')
      : props.contactAdmission.state === 'denied' ? t(props.contactAdmission.blockedByMe ? 'TurnInput.contactBlockedByMe' : 'TurnInput.contactSendingUnavailable') : null;
  const errorMessage = (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    return message === 'HUMAN_CHAT_ATTACHMENT_RESELECT_REQUIRED' ? t('TurnInput.attachmentsNeedReselect')
      : message === 'HUMAN_CHAT_PENDING_SEND_REQUIRES_RETRY' ? t('TurnInput.pendingSendNeedsRetry', { count: sender.pending().length })
      : message.startsWith('OFFLINE_') ? t('TurnInput.draftStorageUnavailable') : message;
  };
  const showError = (reason: unknown) => {
    if (isCurrent()) setError(errorMessage(reason));
  };
  const saveDraft = async () => {
    const value = { peerAccountId: props.peerAccountId, text: draft.current.text,
      attachmentNames: [...missingNames.current, ...draft.current.pendingAttachments.map(item => item.name)] };
    return offline.saveHumanDraft(value);
  };
  const changeText = (value: string, persist = true) => {
    revision.current += 1; draft.current = { ...draft.current, text: value }; setText(value); if (persist) void saveDraft().catch(showError);
  };
  const changeAttachments = (items: readonly PendingAttachment[], persist = true) => {
    const next = [...items];
    const keep = new Set(next.map(item => item.previewUrl));
    for (const item of draft.current.pendingAttachments) if (!keep.has(item.previewUrl)) URL.revokeObjectURL(item.previewUrl);
    revision.current += 1; draft.current = { ...draft.current, pendingAttachments: next };
    props.rememberAttachments(next); setPendingAttachments(next); if (persist) void saveDraft().catch(showError);
  };
  const [sender] = useState(() => createHumanChatSender({
    offline, chatId: props.selectedChatId ?? '', peerAccountId: props.peerAccountId,
    isCurrent, newId: () => crypto.randomUUID(), now: Date.now,
    upload: async (attachment, onTransferred) => {
      const scope = account.current;
      if (!scope?.isCurrent()) throw new Error(t('TurnInput.uploadFailed'));
      const uploaded = await uploadNimiRealmResourceFile(sdk.realm(), {
        kind: attachment.file.type.startsWith('image/') ? 'image' : 'video', file: attachment.file,
        failureMessage: t('TurnInput.uploadFailed'), requestId: attachment.submissionRequestId,
        options: { signal: scope.signal }, cancelOnAbort: false, onTransferred,
      });
      const resourceId = uploaded.resourceId;
      if (!resourceId) throw new Error(t('TurnInput.uploadFailed'));
      const payload = createRealmChatResourceAttachmentPayload(resourceId);
      return { attachment: { ...payload.attachment } };
    },
    finalize: async transfer => {
      const scope = account.current;
      if (!scope?.isCurrent()) throw new Error(t('TurnInput.uploadFailed'));
      const resource = await finalizeNimiRealmTransferredFile(sdk.realm(), transfer, { options: { signal: scope.signal } });
      return { attachment: { ...createRealmChatResourceAttachmentPayload(resource.id).attachment } };
    },
    send: entry => realmHumanChatData.sendChatMessage(entry.chatId, String(entry.body.text ?? ''), {
      clientMessageId: entry.clientMessageId,
      type: entry.body.type === 'ATTACHMENT' ? 'ATTACHMENT' : 'TEXT',
      payload: entry.body.payload as import('@nimiplatform/sdk/types').JsonObject,
    }),
    confirmed: async (entry, message, attachment) => {
      if (!isCurrent()) return;
      if (entry.body.type === 'TEXT' && draft.current.text.trim() === entry.body.text) changeText('', false);
      if (attachment) changeAttachments(draft.current.pendingAttachments.filter(item => item.submissionRequestId !== entry.clientMessageId), false);
      await saveDraft();
      if (!isCurrent()) return;
      mergeSentRealmChatMessageIntoCache({ queryClient, message, currentUserId: account.current!.accountId,
        realmEnvironmentId: account.current!.realmEnvironmentId, selectedChatId: props.selectedChatId });
      // The server write is confirmed; a failed refresh does not turn it into a failed send.
      void queryClient.invalidateQueries({ queryKey: ['chats'] }).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: ['messages', message.chatId] }).catch(() => undefined);
    },
    changed: () => { if (isCurrent()) refresh(value => value + 1); },
  }));
  useEffect(() => {
    active.current = true; account.current = captureAccountActionScope(store, { allowRefreshing: true });
    const startRevision = revision.current;
    void Promise.all([offline.loadHumanDraft(props.peerAccountId), sender.restore(props.initialAttachments)])
      .then(([saved]) => {
        if (!isCurrent()) return;
        if (saved && revision.current === startRevision) {
          draft.current = { ...draft.current, text: saved.text }; setText(saved.text);
          const available = [...props.initialAttachments.map(item => item.name), ...sender.pending().map(entry => entry.body.attachmentName)];
          missingNames.current = saved.attachmentNames.filter(name => {
            const index = available.indexOf(name);
            if (index < 0) return true;
            available.splice(index, 1); return false;
          });
          setMissingAttachments(missingNames.current);
        }
        setReady(true);
      }).catch(showError);
    return () => {
      active.current = false;
      pickerResolverRef.current?.(null);
      account.current?.dispose(); account.current = null;
    };
  }, [loadAttempt]);
  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    let items: PendingAttachment[] = [];
    for (const file of Array.from(event.target.files ?? [])) {
      const next = appendPendingAttachment(items, file, { createObjectUrl: URL.createObjectURL, revokeObjectUrl: URL.revokeObjectURL });
      if (next) items = next;
      else setError(t('TurnInput.unsupportedFileType'));
    }
    items = items.map(item => ({ ...item, submissionRequestId: crypto.randomUUID() }));
    pickerResolverRef.current?.(items.length ? items : null); pickerResolverRef.current = null;
    event.target.value = '';
    if (items.length) {
      const remaining = [...missingNames.current];
      for (const item of items) {
        const index = remaining.indexOf(item.name);
        if (index >= 0) remaining.splice(index, 1);
      }
      missingNames.current = remaining; setMissingAttachments(remaining);
    }
  };
  const pending = sender.pending();
  const adapter = {
    submit: async ({ text: value, attachments }: { text: string; attachments: readonly PendingAttachment[] }) => {
      if (!isCurrent() || offlineTier === 'L2') throw new Error(t('TurnInput.runtimeUnavailableReadOnly'));
      if (admission.current.state !== 'allowed') throw new Error(admissionMessage || t('TurnInput.contactSendingUnavailable'));
      setError(null);
      try { await sender.submit(value, attachments); } catch (reason) {
        admission.current.refresh(); throw reason;
      }
    },
  };
  return <>
    <div className={`${CHAT_CONTENT_WIDTH_CLASS} ${CHAT_CONTENT_POSITION_CLASS} px-5`}>
      {admissionMessage ? <InlineAlert tone={props.contactAdmission.state === 'error' ? 'warning' : 'info'}>
        {admissionMessage}
        {!props.contactAdmission.deleted && props.contactAdmission.state !== 'loading' ? <Button size="sm" tone="secondary" onClick={props.contactAdmission.refresh}>
          {t('Common.retry')}
        </Button> : null}
      </InlineAlert> : null}
      {error ? <InlineAlert tone="danger">{error}{!ready ? <Button size="sm" tone="secondary" onClick={() => {
        setError(null); setLoadAttempt(value => value + 1);
      }}>{t('Common.retry')}</Button> : null}</InlineAlert> : null}
      {missingAttachments.length ? <InlineAlert tone="warning">
        <p>{t('TurnInput.attachmentsNeedReselect')}</p>
        <ul>{missingAttachments.map((name, index) => <li key={index} className="flex items-center justify-between gap-2">
          <span className="break-all">{name}</span>
          <Button size="sm" tone="ghost" aria-label={t('TurnInput.removeMissingAttachment', { name })}
            onClick={() => {
              const remaining = missingNames.current.filter((_, position) => position !== index);
              missingNames.current = remaining;
              setMissingAttachments(remaining);
              void saveDraft().catch(showError);
            }}>{t('TurnInput.removeUnavailableAttachment')}</Button>
        </li>)}</ul>
      </InlineAlert> : null}
      {pending.length ? <div className="mb-2 space-y-2 text-sm" role="status">
        <p>{t('TurnInput.pendingSendNeedsRetry', { count: pending.length })}</p>
        <ul className="space-y-1 text-[var(--nimi-text-secondary)]">{pending.map(entry => <li key={entry.clientMessageId}>
          <span>{entry.body.type === 'TEXT' ? t('TurnInput.sendItemText') : String(entry.body.attachmentName ?? '')}</span>
          {' · '}{t(entry.attempts > 0 ? 'TurnInput.sendUnconfirmed' : 'TurnInput.sendNotStarted')}
        </li>)}</ul>
        <Button size="sm" tone="secondary" disabled={sender.busy || offlineTier === 'L2' || (props.contactAdmission.state !== 'allowed' && !pending.some(entry => entry.attempts > 0))} onClick={() => {
          setError(null); void sender.retry(entry => entry.attempts > 0 || admission.current.state === 'allowed').catch(showError);
        }}>{t('TurnInput.retryPendingSend')}</Button>
        <Button size="sm" tone="ghost" disabled={sender.busy} onClick={() => setStopRetryOpen(true)}>{t('TurnInput.stopPendingSend')}</Button>
        {pending.filter(entry => entry.body.uploadNeeded === true && !entry.transferredFile && !pendingAttachments.some(item => item.submissionRequestId === entry.clientMessageId)).map(entry =>
          <div key={entry.clientMessageId}>{String(entry.body.attachmentName ?? '')} {t('TurnInput.attachmentsNeedReselect')} <Button size="sm" tone="ghost" onClick={() => {
            void sender.discardUnuploaded(entry.clientMessageId).catch(showError);
          }}>{t('TurnInput.removeUnavailableAttachment')}</Button></div>)}
      </div> : null}
    </div>
    <CanonicalComposer adapter={adapter} text={text} onTextChange={changeText} onSubmitError={showError}
      disabled={!ready || !props.selectedChatId || sender.busy || offlineTier === 'L2'} submitDisabled={pending.length > 0 || props.contactAdmission.state !== 'allowed'}
      placeholder={t('TurnInput.typeMessage')} sendLabel={t('TurnInput.send')}
      attachments={pendingAttachments} onAttachmentsChange={changeAttachments}
      attachmentAdapter={{
        openPicker: async () => props.contactAdmission.state !== 'allowed' ? null : new Promise<readonly PendingAttachment[] | null>(resolve => {
          pickerResolverRef.current = resolve; fileInputRef.current?.click();
        }),
        mergeAttachments: (existing, incoming) => [...existing, ...incoming],
      }}
      attachmentsSlot={({ attachments, removeAttachment }) => <HumanAttachmentStrip attachments={attachments} removeAttachment={removeAttachment} />}
      attachLabel={t('TurnInput.uploadFile')} layout="stacked"
      runtimeHint={offlineTier === 'L2' ? t('TurnInput.runtimeUnavailableReadOnly') : null}
      widthClassName={CHAT_CONTENT_WIDTH_CLASS} widthPositionClassName={CHAT_CONTENT_POSITION_CLASS} disableFocusBorder
      leadingSlot={props.leadingAvatar ? <ChatComposerLeadingAvatar kind="human" name={props.leadingAvatar.name}
        imageUrl={props.leadingAvatar.imageUrl || null} fallbackLabel={props.leadingAvatar.fallbackLabel || props.leadingAvatar.name}
        preview={{ kind: 'human', profileId: props.peerAccountId, handle: props.leadingAvatar.handle || null, worldName: null }}
        triggerTestId={E2E_IDS.chatHeaderProfileToggle} openProfileTestId={E2E_IDS.chatOpenUserProfile}
        onOpenHumanProfilePage={profileId => openProfile(profileId, props.leadingAvatar!.name, props.leadingAvatar!.handle, props.leadingAvatar!.imageUrl)} /> : null} />
    <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple onChange={onFileChange} className="hidden" aria-hidden="true" />
    <ConfirmDialog open={stopRetryOpen} title={t('TurnInput.stopPendingSend')} message={t('TurnInput.stopPendingSendConfirm')}
      confirmLabel={t('TurnInput.stopPendingSend')} cancelLabel={t('Common.cancel')} onClose={() => setStopRetryOpen(false)}
      onConfirm={() => {
        const stopped = sender.pending();
        void sender.stopRetrying().then(() => {
          if (!isCurrent()) return;
          if (stopped.some(entry => entry.body.type === 'TEXT' && entry.body.text === draft.current.text.trim())) changeText('');
          changeAttachments(draft.current.pendingAttachments.filter(item => !stopped.some(entry => entry.clientMessageId === item.submissionRequestId)));
          setStopRetryOpen(false); setError(null);
        }).catch(showError);
      }} />
  </>;
}

export function HumanCanonicalProfileDrawer(props: {
  selectedChat: RealmChatViewDto | null;
}) {
  const openProfile = useOpenConversationProfile();
  const realmSocialData = useRealmSocialData();
  const { t } = useTranslation();
  const i18n = useDesktopI18nResource();
  const authStatus = useAppStore((state) => state.auth.status);
  const currentUser = useAppStore((state) => state.auth.user);
  const currentUserId = String(currentUser?.id || '');

  const profilePanelTarget = useAppStore((state) => state.chatProfilePanelTarget);
  const setProfilePanelTarget = useAppStore((state) => state.setChatProfilePanelTarget);
  const otherUser = props.selectedChat?.otherUser;
  const otherUserId = String(otherUser?.id || '').trim();
  const currentUserFallback = currentUser && typeof currentUser === 'object'
    ? (currentUser as unknown as Record<string, unknown>)
    : null;
  const otherUserFallback = (otherUser as unknown as Record<string, unknown>) || null;
  const profileTargetId = profilePanelTarget === 'self' ? currentUserId : otherUserId;

  const profileQuery = useQuery({
    queryKey: ['chat-contact-profile', profilePanelTarget, profileTargetId],
    queryFn: async () => {
      if (!profileTargetId) {
        return null;
      }
      const result = await realmSocialData.loadUserProfile(profileTargetId);
      return result as unknown as Record<string, unknown>;
    },
    enabled: authStatus === 'authenticated' && profilePanelTarget !== null && Boolean(profileTargetId),
  });

  const detail = profileQuery.isError ? null : profileQuery.data;
  const profileSummary = useMemo(() => {
    const fallback = profilePanelTarget === 'self' ? currentUserFallback : otherUserFallback;
    return toChatProfileSummary({
      fallback,
      i18n,
      profile: detail || null,
    });
  }, [currentUserFallback, i18n, otherUserFallback, profilePanelTarget, detail]);

  const profileActionLabel = profilePanelTarget === 'self'
    ? t('ChatTimeline.openMyProfile')
    : t('ChatTimeline.openUserProfile');

  if (profilePanelTarget === null) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-4 py-4">
      <ChatProfileCard
        profileData={toHumanProfileData((detail || profileSummary) as unknown as HumanProfileSource)}
        onClose={() => setProfilePanelTarget(null)}
        onViewFullProfile={() => {
          if (!profileSummary.id) {
            return;
          }
          openProfile(profileSummary.id, profileSummary.displayName, profileSummary.handle, profileSummary.avatarUrl);
        }}
        viewFullProfileLabel={profileActionLabel}
      />
    </div>
  );
}
