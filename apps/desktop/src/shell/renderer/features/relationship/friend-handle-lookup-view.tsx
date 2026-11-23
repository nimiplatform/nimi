import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, FieldShell, InlineAlert, TextField, TextareaField } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore, useAppStoreApi } from '../../app-shell/providers/app-store.js';
import { captureAccountActionScope } from '../../app-shell/providers/account-action-scope.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import {
  MAX_FRIEND_REQUEST_MESSAGE_LENGTH,
  requestFriendByHandle,
  type FriendHandleRequestResult,
} from './friend-handle-lookup.js';
import { MyHandleShareCard } from './my-handle-share-card.js';

export type FriendHandleLookupViewProps = {
  initialHandle?: string;
  myHandle?: string;
  onSuccess?: () => void;
  onBackToFriends?: () => void;
  onOpenSentRequests?: () => void;
  onOpenReceivedRequests?: () => void;
};

// @nimi-authority: rule.nimi.desktop.product-surfaces.r018
export function FriendHandleLookupView({
  initialHandle = '',
  myHandle = '',
  onSuccess,
  onBackToFriends,
  onOpenSentRequests,
  onOpenReceivedRequests,
}: FriendHandleLookupViewProps) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const store = useAppStoreApi();
  const queryClient = useQueryClient();
  const auth = useAppStore((state) => state.auth);
  const realmBaseUrl = useAppStore((state) => String(state.runtimeDefaults?.realm.realmBaseUrl ?? '').replace(/\/$/, ''));
  const [handle, setHandle] = useState(initialHandle);
  const [requestMessage, setRequestMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<{ accountId: string; realmBaseUrl: string; outcome: FriendHandleRequestResult['outcome'] } | null>(null);
  const handleInputRef = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const requestScope = useRef<ReturnType<typeof captureAccountActionScope>>(null);

  useEffect(() => () => {
    request.current += 1;
    requestScope.current?.dispose();
  }, []);

  const outcome = result && result.accountId === auth.user?.id && result.realmBaseUrl === realmBaseUrl
    && (auth.status === 'authenticated' || auth.status === 'refresh-pending') ? result.outcome : null;
  const normalizedHandle = handle.trim().replace(/^@+/, '');

  const resetForAnother = () => {
    setHandle('');
    setRequestMessage('');
    setResult(null);
    setFailed(false);
    handleInputRef.current?.focus();
  };

  const submitRequest = async (event: FormEvent) => {
    event.preventDefault();
    if (requestScope.current || pending || outcome || !normalizedHandle) return;
    const scope = captureAccountActionScope(store);
    if (!scope) return;
    requestScope.current = scope;
    const current = ++request.current;
    setPending(true);
    setFailed(false);
    try {
      const response = await requestFriendByHandle(sdk.socialData.callApi, handle, requestMessage);
      if (request.current !== current || !scope.isCurrent()) return;
      setResult({ accountId: scope.accountId, realmBaseUrl: scope.realmBaseUrl, outcome: response.outcome });
      // The mutation is confirmed. Listings keep their own loading/error state.
      void queryClient.invalidateQueries({ queryKey: ['contacts'], exact: false });
      void queryClient.invalidateQueries({ queryKey: ['human-contacts'], exact: false });
      onSuccess?.();
    } catch {
      if (request.current !== current || !scope.isCurrent()) return;
      try {
        const realm = sdk.realm();
        const known = await realm.generated.getUserByHandle({ path: { handle: normalizedHandle } });
        if (!scope.isCurrent()) return;
        const relation = await realm.social.getMyRelationshipWithUser({ path: { id: known.id } });
        if (request.current !== current || !scope.isCurrent()) return;
        if (relation.state === 'active' || relation.state === 'pending_outgoing') {
          setResult({ accountId: scope.accountId, realmBaseUrl: scope.realmBaseUrl, outcome: 'unchanged' });
          void queryClient.invalidateQueries({ queryKey: ['human-contacts'], exact: false });
          onSuccess?.();
          return;
        }
      } catch { /* An unreadable profile or offline Realm cannot confirm the original write. */ }
      if (request.current === current && scope.isCurrent()) setFailed(true);
    } finally {
      scope.dispose();
      if (requestScope.current === scope) requestScope.current = null;
      if (request.current === current) setPending(false);
    }
  };

  return (
    <div className="space-y-4 px-1 pt-1" data-testid="friend-handle-lookup">
      <form onSubmit={(event) => { void submitRequest(event); }} className="flex flex-col gap-3.5">
        <FieldShell label={t('Relationship.handleLabel')}>
          <TextField
            ref={handleInputRef}
            autoFocus
            value={handle}
            onChange={(event) => {
              setHandle(event.target.value);
              setResult(null);
              setFailed(false);
            }}
            placeholder={t('Relationship.handlePlaceholder')}
            autoComplete="off"
            disabled={pending}
          />
        </FieldShell>

        <FieldShell
          label={t('Relationship.requestMessageLabel')}
          message={`${requestMessage.length}/${MAX_FRIEND_REQUEST_MESSAGE_LENGTH}`}
        >
          <TextareaField
            value={requestMessage}
            rows={3}
            maxLength={MAX_FRIEND_REQUEST_MESSAGE_LENGTH}
            placeholder={t('Relationship.requestMessagePlaceholder')}
            disabled={pending}
            onChange={(event) => {
              setRequestMessage(event.target.value);
              setFailed(false);
            }}
          />
        </FieldShell>

        <div className="space-y-2">
          <Button
            type="submit"
            tone="primary"
            fullWidth
            disabled={pending || Boolean(outcome) || !normalizedHandle}
            loading={pending}
          >
            {t('Relationship.findByHandleAction')}
          </Button>
          <p className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
            {t('Relationship.findByHandlePrivacyNote')}
          </p>
        </div>

        {failed ? <InlineAlert tone="danger">{t('Relationship.findByHandleFailed')}</InlineAlert> : null}

        {outcome ? (
          <div className="space-y-2.5">
            <InlineAlert tone={outcome === 'unchanged' ? 'info' : 'success'}>
              {t(`Relationship.friendHandle${outcome === 'requested' ? 'Requested' : outcome === 'accepted' ? 'Accepted' : 'Unchanged'}`)}
            </InlineAlert>
            <div className="flex flex-wrap items-center gap-2">
              {outcome === 'accepted' ? (
                onBackToFriends ? (
                  <Button type="button" size="sm" tone="secondary" onClick={onBackToFriends}>
                    {t('Relationship.backToFriends')}
                  </Button>
                ) : null
              ) : (
                <>
                  <Button type="button" size="sm" tone="secondary" onClick={resetForAnother}>
                    {t('Relationship.addAnotherFriend')}
                  </Button>
                  {outcome === 'requested' && onOpenSentRequests ? (
                    <Button type="button" size="sm" tone="ghost" onClick={onOpenSentRequests}>
                      {t('Relationship.viewSentRequests')}
                    </Button>
                  ) : null}
                  {outcome === 'unchanged' && onOpenReceivedRequests ? (
                    <Button type="button" size="sm" tone="ghost" onClick={onOpenReceivedRequests}>
                      {t('Relationship.viewCurrentRequests')}
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ) : null}
      </form>

      {myHandle ? (
        <div className="space-y-2 border-t border-[var(--nimi-border-subtle)] pt-4">
          <p className="text-xs font-medium text-[var(--nimi-text-secondary)]">
            {t('Relationship.contacts.shareMyUsernameTitle')}
          </p>
          <MyHandleShareCard handle={myHandle} />
        </div>
      ) : null}
    </div>
  );
}
