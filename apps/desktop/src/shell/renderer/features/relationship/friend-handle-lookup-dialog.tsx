import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, InlineAlert, OverlayShell, TextField } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore, useAppStoreApi } from '../../app-shell/providers/app-store.js';
import { captureAccountActionScope } from '../../app-shell/providers/account-action-scope.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { requestFriendByHandle, type FriendHandleRequestResult } from './friend-handle-lookup.js';

export function FriendHandleLookupDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const store = useAppStoreApi();
  const queryClient = useQueryClient();
  const auth = useAppStore((state) => state.auth);
  const realmBaseUrl = useAppStore((state) => String(state.runtimeDefaults?.realm.realmBaseUrl ?? '').replace(/\/$/, ''));
  const [handle, setHandle] = useState('');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<{ accountId: string; realmBaseUrl: string; outcome: FriendHandleRequestResult['outcome'] } | null>(null);
  const request = useRef(0);
  const requestScope = useRef<ReturnType<typeof captureAccountActionScope>>(null);
  useEffect(() => () => { request.current += 1; requestScope.current?.dispose(); }, []);
  const outcome = result && result.accountId === auth.user?.id && result.realmBaseUrl === realmBaseUrl
    && (auth.status === 'authenticated' || auth.status === 'refresh-pending') ? result.outcome : null;

  const submitRequest = async (event: FormEvent) => {
    event.preventDefault();
    if (requestScope.current || pending || outcome || !handle.trim()) return;
    const scope = captureAccountActionScope(store);
    if (!scope) return;
    requestScope.current = scope;
    const current = ++request.current;
    setPending(true);
    setFailed(false);
    try {
      const response = await requestFriendByHandle(sdk.socialData.callApi, handle);
      if (request.current !== current || !scope.isCurrent()) return;
      setResult({ accountId: scope.accountId, realmBaseUrl: scope.realmBaseUrl, outcome: response.outcome });
      // The mutation is confirmed. Listings keep their own loading/error state.
      void queryClient.invalidateQueries({ queryKey: ['contacts'], exact: false });
    } catch {
      if (request.current !== current || !scope.isCurrent()) return;
      try {
        const realm = sdk.realm();
        const value = handle.trim().replace(/^@/, '');
        const known = await realm.generated.getUserByHandle({ path: { handle: value } });
        if (!scope.isCurrent()) return;
        const relation = await realm.social.getMyRelationshipWithUser({ path: { id: known.id } });
        if (request.current !== current || !scope.isCurrent()) return;
        if (relation.state === 'active' || relation.state === 'pending_outgoing') {
          setResult({ accountId: scope.accountId, realmBaseUrl: scope.realmBaseUrl, outcome: 'unchanged' });
          void queryClient.invalidateQueries({ queryKey: ['human-contacts'] });
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
    <OverlayShell open kind="dialog" onClose={onClose} title={t('Relationship.findByHandleTitle')}>
      <form onSubmit={(event) => { void submitRequest(event); }} className="flex flex-col gap-4" data-testid="friend-handle-lookup">
        <p className="text-sm text-[var(--nimi-text-secondary)]">{t('Relationship.findByHandleDescription')}</p>
        <label className="flex flex-col gap-1.5 text-sm">
          {t('Relationship.handleLabel')}
          <TextField autoFocus value={handle} onChange={(event) => { setHandle(event.target.value); setResult(null); setFailed(false); }}
            placeholder="@handle" autoComplete="off" disabled={pending} />
        </label>
        {failed ? <InlineAlert tone="danger">{t('Relationship.findByHandleFailed')}</InlineAlert> : null}
        {outcome ? <InlineAlert tone="success">{t(`Relationship.friendHandle${outcome === 'requested' ? 'Requested' : outcome === 'accepted' ? 'Accepted' : 'Unchanged'}`)}</InlineAlert> : null}
        <Button type="submit" disabled={pending || Boolean(outcome) || !handle.trim()} loading={pending}>{t('Relationship.findByHandleAction')}</Button>
      </form>
    </OverlayShell>
  );
}
