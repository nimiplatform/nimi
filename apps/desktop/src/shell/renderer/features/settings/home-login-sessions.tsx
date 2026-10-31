import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog, InlineAlert, NimiText } from '@nimiplatform/kit/ui';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { useAppStore, useAppStoreApi } from '../../app-shell/providers/app-store.js';
import { captureAccountActionScope } from '../../app-shell/providers/account-action-scope.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { logoutAndClearSession, useLogoutSessionDependencies } from '../auth/logout.js';
import { Button, Card, Section } from './settings-layout-components.js';

type LoginSession = RealmModel<'AccountSessionDto'>;
type Selection = LoginSession | 'others';

export function HomeLoginSessions() {
  const accountId = useAppStore((state) => String(state.auth.user?.id || ''));
  const environment = useAppStore((state) => String(state.auth.user?.realmEnvironmentId || ''));
  const { logout, feedback } = useLogoutSessionDependencies();
  const clearAuthSession = useAppStore((state) => state.clearAuthSession);
  return (
    <OwnedLoginSessions
      key={JSON.stringify([environment, accountId])}
      accountId={accountId}
      environment={environment}
      onCurrentRevoked={() =>
        logoutAndClearSession({ clearAuthSession, onFeedback: feedback }, logout)
      }
    />
  );
}

// @nimi-authority: rule.nimi.desktop.shell-runtime.r023
export function OwnedLoginSessions({
  accountId,
  environment,
  onCurrentRevoked,
}: {
  accountId: string;
  environment: string;
  onCurrentRevoked: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const store = useAppStoreApi();
  const queryClient = useQueryClient();
  const i18n = useDesktopI18nResource();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const scopeRef = useRef<ReturnType<typeof captureAccountActionScope>>(null);
  const submitting = useRef(false);
  useEffect(
    () => () => {
      scopeRef.current?.dispose();
      scopeRef.current = null;
    },
    [],
  );
  const queryKey = ['home-login-sessions', environment, accountId] as const;
  const sessions = useInfiniteQuery({
    queryKey,
    enabled: Boolean(accountId && environment),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      sdk.realm().generated.listMyAccountSessions({
        path: {},
        query: {
          expectedAccountId: accountId,
          limit: 20,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      }),
    getNextPageParam: (page) => page.nextCursor || undefined,
    retry: false,
  });
  const rows = [
    ...new Map(
      sessions.data?.pages.flatMap((page) => page.items).map((row) => [row.id, row]),
    ).values(),
  ];
  const current = rows.find((row) => row.current);
  const ordered = current ? [current, ...rows.filter((row) => !row.current)] : rows;
  const date = (value: string) =>
    i18n.formatDate(value, { dateStyle: 'medium', timeStyle: 'medium' });
  function open(target: Selection) {
    scopeRef.current?.dispose();
    const scope = captureAccountActionScope(store);
    if (!scope || scope.accountId !== accountId || scope.realmEnvironmentId !== environment) {
      scope?.dispose();
      setFeedback({ error: true, message: t('SecuritySettings.accountChanged') });
      return;
    }
    scopeRef.current = scope;
    setFeedback(null);
    setSelection(target);
  }
  function close() {
    if (submitting.current) return;
    scopeRef.current?.dispose();
    scopeRef.current = null;
    setSelection(null);
  }
  async function confirm() {
    const scope = scopeRef.current;
    if (!selection || submitting.current) return;
    if (!scope?.isCurrent()) {
      close();
      setFeedback({ error: true, message: t('SecuritySettings.accountChanged') });
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const owner = sdk.realm().generated;
      const body = { expectedAccountId: scope.accountId };
      const result =
        selection === 'others'
          ? await owner.revokeMyOtherAccountSessions({ path: {}, body })
          : await owner.revokeMyAccountSession({ path: { sessionId: selection.id }, body });
      if (!scope.isCurrent()) return;
      setSelection(null);
      setFeedback({ error: false, message: t('SecuritySettings.revoked') });
      if (result.currentRevoked) {
        try {
          await onCurrentRevoked();
        } catch {
          if (scope.isCurrent())
            setFeedback({ error: true, message: t('SecuritySettings.localExitPending') });
        }
      } else {
        queryClient.setQueryData<InfiniteData<RealmModel<'AccountSessionListDto'>>>(
          queryKey,
          (data) =>
            data && {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                items: page.items.filter((row) =>
                  selection === 'others' ? row.current : row.id !== selection.id,
                ),
              })),
            },
        );
        await sessions.refetch();
      }
    } catch {
      if (scope.isCurrent()) {
        setSelection(null);
        setFeedback({ error: true, message: t('SecuritySettings.revokeUnconfirmed') });
      }
    } finally {
      if (scopeRef.current === scope) {
        setSelection(null);
        setBusy(false);
        scope.dispose();
        scopeRef.current = null;
      }
      submitting.current = false;
    }
  }
  const title =
    selection === 'others'
      ? t('SecuritySettings.revokeOthers')
      : selection?.current
        ? t('SecuritySettings.revokeCurrent')
        : t('SecuritySettings.revokeOne');
  const consequence =
    selection === 'others'
      ? t('SecuritySettings.othersConsequence')
      : selection?.current
        ? t('SecuritySettings.currentConsequence')
        : selection
          ? t('SecuritySettings.oneConsequence', { time: date(selection.createdAt) })
          : '';
  return (
    <Section
      title={t('SecuritySettings.activeSessionsTitle')}
      description={t('SecuritySettings.activeSessionsDescription')}
    >
      <Card>
        {feedback && (
          <InlineAlert tone={feedback.error ? 'warning' : 'info'}>{feedback.message}</InlineAlert>
        )}
        {sessions.isError && (
          <InlineAlert tone="warning">{t('SecuritySettings.readFailed')}</InlineAlert>
        )}
        {sessions.isPending && <p role="status">{t('Common.loading')}</p>}
        <ul className="divide-y divide-[var(--nimi-border-subtle)]">
          {ordered.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 flex-col gap-1">
                <NimiText role="label">
                  {t(row.current ? 'SecuritySettings.currentHome' : 'SecuritySettings.otherLogin')}
                </NimiText>
                <NimiText role="caption">
                  {t('SecuritySettings.createdAt', { time: date(row.createdAt) })}
                </NimiText>
                {row.authenticatedAt && (
                  <NimiText role="caption">
                    {t('SecuritySettings.authenticatedAt', { time: date(row.authenticatedAt) })}
                  </NimiText>
                )}
              </div>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => open(row)}>
                {t(row.current ? 'SecuritySettings.revokeCurrent' : 'SecuritySettings.revokeOne')}
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || sessions.isFetching}
            onClick={() => void sessions.refetch()}
          >
            {t('SecuritySettings.refresh')}
          </Button>
          {sessions.hasNextPage && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || sessions.isFetching}
              onClick={() => void sessions.fetchNextPage()}
            >
              {t('SecuritySettings.more')}
            </Button>
          )}
          {(rows.some((row) => !row.current) || sessions.hasNextPage) && (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => open('others')}>
              {t('SecuritySettings.revokeOthers')}
            </Button>
          )}
        </div>
      </Card>
      <ConfirmDialog
        open={selection !== null}
        title={title}
        message={consequence}
        confirmLabel={title}
        cancelLabel={t('Common.cancel')}
        confirmTone="danger"
        pending={busy}
        onConfirm={confirm}
        onClose={close}
      />
    </Section>
  );
}
