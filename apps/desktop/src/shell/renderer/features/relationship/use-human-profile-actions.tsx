import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAppStoreApi, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { captureAccountActionScope } from '../../app-shell/providers/account-action-scope.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast.js';
import { useRealmHumanChatData } from '../chat/data/realm-human-chat-data-context.js';
import type { HumanProfileData } from '../profile/profile-model.js';
import { BlockUserConfirmDialog, RemoveFriendConfirmDialog } from './profile-detail-dialogs.js';
import type { ProfileDetailViewProps } from './profile-detail-view-controller.js';
import { ReportUserDialog, type ReportUserTarget } from './report-user-dialog.js';

type ActionTarget = Pick<HumanProfileData, 'id' | 'displayName' | 'relationshipId'>;
type Confirmation = { action: 'remove' | 'block'; target: ActionTarget };

// @nimi-authority: rule.nimi.desktop.product-surfaces.r032
export function useHumanProfileActions(profile: HumanProfileData | null, onOpenConversation?: () => void) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererBindings().sdk;
  const store = useAppStoreApi();
  const navigation = useHomeNavigation();
  const chat = useRealmHumanChatData();
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const [reportTarget, setReportTarget] = useState<ReportUserTarget | null>(null);
  const operation = useRef<ReturnType<typeof captureAccountActionScope>>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.dispose(); }; }, []);
  useEffect(() => { setConfirmation(null); setReportTarget(null); }, [profile?.id]);
  const refresh = () => {
    for (const root of ['contacts', 'human-contacts', 'user-profile', 'human-profile-detail', 'human-relationship', 'blocked-contact-relationship', 'notification-page', 'notification-unread-count']) {
      void queryClient.invalidateQueries({ queryKey: [root] });
    }
  };
  const run = async (task: () => Promise<unknown>, success?: string) => {
    if (operation.current) return;
    const scope = captureAccountActionScope(store);
    if (!scope) { emitFeedbackToast({ kind: 'error', message: t('Profile.accountUnavailable') }); return; }
    operation.current = scope; setBusy(true);
    try {
      await task();
      if (!scope.isCurrent()) return;
      setConfirmation(null);
      if (success) emitFeedbackToast({ kind: 'success', message: success });
      refresh();
    } catch (error) {
      if (scope.isCurrent()) { setConfirmation(null); emitFeedbackToast({ kind: 'error', message: error instanceof Error ? error.message : t('Relationship.contacts.actionFailed') }); refresh(); }
    } finally {
      const current = scope.isCurrent(); scope.dispose(); if (operation.current === scope) operation.current = null;
      if (current && mounted.current) setBusy(false);
    }
  };
  const changeRelationship = (action: 'accept' | 'reject' | 'cancel' | 'remove', target: ActionTarget) => {
    const relationshipId = target.relationshipId;
    if (!relationshipId) { emitFeedbackToast({ kind: 'error', message: t('Relationship.contacts.relationshipChanged') }); return; }
    void run(() => sdk.realm().social.applyFriendshipAction({ path: { id: target.id }, body: { action, relationshipId } }), t('Relationship.contacts.actionDone.' + action));
  };
  const snapshot = (): ActionTarget | null => profile ? { id: profile.id, displayName: profile.displayName, relationshipId: profile.relationshipId } : null;
  const relationship = profile?.relationship;
  const blocked = relationship?.blockedByMe === true;
  const props: Pick<ProfileDetailViewProps, 'onMessage' | 'onAddFriend' | 'onAcceptRequest' | 'onRejectRequest' | 'onCancelRequest' | 'onBlock' | 'onUnblock' | 'onRemove' | 'onReport' | 'showMessageButton' | 'isBlockedProfile' | 'actionsPending'> = {
    actionsPending: busy,
    isBlockedProfile: blocked,
    showMessageButton: Boolean(profile && !blocked && relationship?.canMessage),
    onMessage: () => {
      const target = snapshot();
      if (!target || !relationship?.canMessage) return;
      const origin = navigation.getSnapshot().current.key;
      void run(async () => {
        const opened = await chat.startChatWithTarget(target.id);
        if (!opened?.chatId) throw new Error(t('Relationship.openChatFailed'));
        if (operation.current?.isCurrent() && navigation.getSnapshot().current.key === origin) {
          void queryClient.invalidateQueries({ queryKey: ['chats'] });
          const result = await navigation.push({ id: 'chat', chat: { mode: 'human', targetId: target.id, threadId: opened.chatId } });
          if (result.status === 'committed' || result.status === 'unchanged') onOpenConversation?.();
        }
      });
    },
    onAddFriend: !blocked && relationship?.canRequest && relationship.state === 'none' ? () => {
      const target = snapshot(); if (!target) return;
      void run(async () => {
        const result = await sdk.realm().social.addFriend({ path: { id: target.id }, body: {} });
        if (operation.current?.isCurrent()) emitFeedbackToast({ kind: 'success', message: t(result.outcome === 'requested' ? 'Relationship.friendHandleRequested' : 'Relationship.friendHandleUnchanged') });
      });
    } : undefined,
    onAcceptRequest: !blocked && relationship?.state === 'pending_incoming' ? () => { const target = snapshot(); if (target) changeRelationship('accept', target); } : undefined,
    onRejectRequest: relationship?.state === 'pending_incoming' ? () => { const target = snapshot(); if (target) changeRelationship('reject', target); } : undefined,
    onCancelRequest: relationship?.state === 'pending_outgoing' ? () => { const target = snapshot(); if (target) changeRelationship('cancel', target); } : undefined,
    onRemove: relationship?.state === 'active' ? () => { const target = snapshot(); if (target) setConfirmation({ action: 'remove', target }); } : undefined,
    onBlock: profile && relationship && !blocked ? () => { const target = snapshot(); if (target) setConfirmation({ action: 'block', target }); } : undefined,
    onUnblock: profile && blocked ? () => { const target = snapshot(); if (target) void run(() => sdk.realm().social.unblockUser({ path: { id: target.id } }), t('Relationship.contacts.actionDone.unblock')); } : undefined,
    onReport: profile ? () => setReportTarget({ id: profile.id, displayName: profile.displayName }) : undefined,
  };
  const confirm = () => {
    if (!confirmation) return;
    const { target, action } = confirmation;
    if (action === 'remove') changeRelationship(action, target);
    else void run(() => sdk.realm().social.blockUser({ path: { id: target.id }, body: {} }), t('Relationship.contacts.actionDone.block'));
  };
  const close = () => { if (!busy) setConfirmation(null); };
  const dialog = confirmation?.action === 'remove'
    ? <RemoveFriendConfirmDialog contact={confirmation.target} pending={busy} onConfirm={confirm} onCancel={close} />
    : confirmation?.action === 'block'
      ? <BlockUserConfirmDialog contact={confirmation.target} pending={busy} onConfirm={confirm} onCancel={close} />
      : null;
  return { props, dialog: <>{dialog}{reportTarget ? <ReportUserDialog target={reportTarget} onClose={() => setReportTarget(null)} /> : null}</> };
}
