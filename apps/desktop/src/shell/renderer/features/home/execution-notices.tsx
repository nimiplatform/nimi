import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsMutating, useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AppCardSurface, Button, InlineAlert, OverlayShell, StatusBadge } from '@nimiplatform/kit/ui';
import { ArrowRight, BellRing, ChevronDown, History, PanelRightClose, Trash2 } from 'lucide-react';
import { hasElectronInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { SYSTEM_ENTRY_HOME_COMMANDS } from '../../../shared/system-entry-types.js';
import { AppArtworkIcon } from '../apps/apps-card-visuals.js';
import { useAppStore, useAppStoreApi } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { invokeChecked } from '../../bridge/runtime-bridge/invoke.js';
import {
  changeExecutionNotificationPreferences,
  EXECUTION_NOTIFICATION_MUTATION_SCOPE,
  readExecutionNotificationPreferences,
  type ExecutionNotificationPreferenceChange,
  type ExecutionNotificationPreferences,
} from './execution-notification-preferences.js';

type Notice = {
  id: string; displayName: string; kind: 'stopped' | 'connection-unavailable' | 'scope-unavailable';
  occurredAt: string; availableNow: boolean | null; notification: 'disabled' | 'unsupported' | 'requested' | 'shown' | 'failed';
};
type NoticeSnapshot = { notices: readonly Notice[]; systemSupported: boolean };

export type ExecutionNoticeAppArtworkResolver = (displayName: string) => Readonly<{
  appId: string;
  iconUrl: string | null;
}> | null;

function useExecutionNotificationPreferences() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage?.startsWith('zh') ? 'zh' : 'en';
  const sdk = useDesktopRendererSdk();
  const store = useAppStoreApi();
  const auth = useAppStore(state => state.auth);
  const account = typeof auth.user?.id === 'string' && auth.user.id ? auth.user.id : null;
  const authenticated = auth.status === 'authenticated' && account !== null;
  const currentSdk = useRef(sdk);
  currentSdk.current = sdk;
  const queryClient = useQueryClient();
  const key = useMemo(() => ['desktop-execution-notification-preferences', account, auth.status, auth.sequence, language] as const,
    [account, auth.status, auth.sequence, language]);
  type AppliedPreferences = { preferences: ExecutionNotificationPreferences; pausedUntil: number };
  type Intent = {
    change?: ExecutionNotificationPreferenceChange;
    account: string | null;
    auth: typeof auth;
    sdk: typeof sdk;
    client: ReturnType<typeof sdk.appProduct> | null;
    language: typeof language;
    key: typeof key;
    signal?: AbortSignal;
  };
  const assertCurrent = (intent: Omit<Intent, 'change'>): void => {
    const live = store.getState().auth;
    if (intent.signal?.aborted || live !== intent.auth || currentSdk.current !== intent.sdk
      || (i18n.resolvedLanguage?.startsWith('zh') ? 'zh' : 'en') !== intent.language
      || (intent.client !== null && (live.status !== 'authenticated' || live.user?.id !== intent.account
        || currentSdk.current.appProduct() !== intent.client))) {
      throw new Error('Execution notification preference scope changed');
    }
  };
  // Reads and writes share the same native effect owner. A background refetch
  // cannot apply an old document after a newer Settings or system-entry action.
  const mutation = useMutation({
    mutationKey: [EXECUTION_NOTIFICATION_MUTATION_SCOPE],
    scope: { id: EXECUTION_NOTIFICATION_MUTATION_SCOPE },
    retry: false,
    mutationFn: async (intent: Intent): Promise<AppliedPreferences> => {
      assertCurrent(intent);
      if (intent.change) {
        await queryClient.cancelQueries({ queryKey: ['desktop-execution-notification-preferences', intent.account] });
      }
      // Capture the display generation before any account storage operation.
      // Main still owns admission; a later generation must never authorize
      // applying a document read under this one.
      let generation = 'unavailable';
      let contextFailure: unknown;
      try {
        generation = await invokeChecked(SYSTEM_ENTRY_HOME_COMMANDS.context, {}, value => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('System entry context is unavailable');
          const context = value as Record<string, unknown>;
          if (context.state !== 'ready' || typeof context.generation !== 'string'
            || !context.generation.trim() || context.generation.length > 128) {
            throw new Error('System entry context is not ready');
          }
          return context.generation;
        });
      } catch (error) {
        contextFailure = error;
      }
      assertCurrent(intent);
      const preferences = intent.client === null ? { systemEnabled: false }
        : intent.change
          ? await changeExecutionNotificationPreferences(intent.client.storage, intent.change, () => assertCurrent(intent))
          : await readExecutionNotificationPreferences(intent.client.storage);
      assertCurrent(intent);
      const pausedUntil = (preferences.pausedUntil ?? 0) > Date.now() ? preferences.pausedUntil! : 0;
      const enabled = preferences.systemEnabled && pausedUntil === 0;
      if (enabled && contextFailure) throw contextFailure;
      await invokeChecked('desktop_execution_notices_preferences', {
        payload: { enabled, language: intent.language, generation },
      }, value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)
          || Object.keys(value).join('|') !== 'applied' || (value as { applied?: unknown }).applied !== true) {
          throw new Error('Execution notification preference was not applied');
        }
        return value;
      });
      assertCurrent(intent);
      return { preferences, pausedUntil };
    },
    onSuccess: (value, intent) => {
      assertCurrent(intent);
      queryClient.setQueryData(intent.key, value);
    },
  });
  const query = useQuery({ queryKey: key, enabled: hasElectronInvoke(), retry: false, queryFn: ({ signal }) => {
    const intent: Intent = { account, auth: store.getState().auth, sdk, client: authenticated ? sdk.appProduct() : null, language, key, signal };
    return mutation.mutateAsync(intent);
  } });
  const mutationStates = useMutationState({ filters: { mutationKey: [EXECUTION_NOTIFICATION_MUTATION_SCOPE] }, select: entry => {
    const intent = entry.state.variables as Intent | undefined;
    return intent?.account === account && intent.auth.status === auth.status && intent.auth.sequence === auth.sequence
      && intent.language === language ? entry.state.status : null;
  } });
  const mutationFailed = mutationStates.filter(value => value !== null).at(-1) === 'error';
  const busy = useIsMutating({ mutationKey: [EXECUTION_NOTIFICATION_MUTATION_SCOPE] }) > 0;
  const activePause = useActiveNotificationPause(query.data?.pausedUntil);
  const pauseExpired = Boolean(query.data?.pausedUntil && activePause === 0);
  useEffect(() => {
    if (pauseExpired) void query.refetch({ cancelRefetch: false });
  }, [pauseExpired, query.refetch]);
  const update = useCallback(async (change: ExecutionNotificationPreferenceChange): Promise<void> => {
    const live = store.getState().auth;
    if (!account || live.status !== 'authenticated' || live.user?.id !== account) {
      throw new Error('Execution notification preferences require the current account');
    }
    const client = sdk.appProduct();
    await mutation.mutateAsync({ change, account, auth: live, sdk, client, language, key });
  }, [account, sdk, store, language, key, mutation.mutateAsync]);
  const confirmed = query.data !== undefined && !query.isError && !mutationFailed && !pauseExpired && !busy;
  return { query, update, busy, mutationFailed, authenticated, confirmed };
}

function useActiveNotificationPause(pausedUntil: number | undefined): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      const current = Date.now();
      setNow(current);
      if (pausedUntil && pausedUntil > current) timer = setTimeout(refresh, Math.min(pausedUntil - current, 2_147_483_647));
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [pausedUntil]);
  return pausedUntil && pausedUntil > now ? pausedUntil : 0;
}

export type HomeExecutionNotificationControls = Readonly<{
  enabled: boolean;
  pausedUntil: number;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
}>;

export function useHomeExecutionNotificationControls(): HomeExecutionNotificationControls {
  const { query, update, authenticated, confirmed } = useExecutionNotificationPreferences();
  const enabled = authenticated && confirmed && query.data?.preferences.systemEnabled === true;
  const pausedUntil = authenticated && confirmed ? query.data!.pausedUntil : 0;
  const pause = useCallback(() => update({ kind: 'pause' }), [update]);
  const resume = useCallback(() => update({ kind: 'resume' }), [update]);
  return useMemo(() => ({ enabled, pausedUntil, pause, resume }), [enabled, pausedUntil, pause, resume]);
}

/** A display preference projection; no credential, consent or Runtime access is granted. */
export function ExecutionNotificationPreferenceSync() {
  useExecutionNotificationPreferences();
  return null;
}

export function ExecutionNotificationSetting() {
  const { t, i18n } = useTranslation();
  const { query, update, busy, mutationFailed, authenticated, confirmed } = useExecutionNotificationPreferences();
  const pausedUntil = confirmed ? query.data!.pausedUntil : 0;
  const canChange = authenticated && confirmed && !busy;
  const change = (value: ExecutionNotificationPreferenceChange) => { void update(value).catch(() => undefined); };
  return <section className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4" aria-label={t('Notifications.execution.title')}>
    <label className="flex items-center justify-between gap-4"><span className="font-medium">{t('Notifications.execution.title')}</span><input type="checkbox" aria-label={t('Notifications.execution.title')} checked={confirmed && query.data!.preferences.systemEnabled} disabled={!canChange} onChange={event => change({ kind: 'system', enabled: event.target.checked })} /></label>
    <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{t('Notifications.execution.description')}</p>
    <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{t('Notifications.execution.osLimit')}</p>
    {pausedUntil ? <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm" role="status">
      <span>{t('Notifications.execution.pausedUntil', { time: new Date(pausedUntil).toLocaleTimeString(i18n.resolvedLanguage, { hour: '2-digit', minute: '2-digit' }) })}</span>
      <Button tone="ghost" size="sm" disabled={!canChange} onClick={() => change({ kind: 'resume' })}>{t('Notifications.execution.resume')}</Button>
    </div> : null}
    {query.isError || mutationFailed ? <div role="status" className="mt-2 text-sm"><span>{t('Notifications.execution.failed')}</span><Button tone="ghost" size="sm" disabled={busy} onClick={() => void query.refetch({ cancelRefetch: false })}>{t('Notifications.execution.retry')}</Button></div> : null}
  </section>;
}

function parseSnapshot(value: unknown): NoticeSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Execution notice projection is invalid');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join('|') !== 'notices|systemSupported' || typeof record.systemSupported !== 'boolean' || !Array.isArray(record.notices) || record.notices.length > 50) throw new Error('Execution notice projection is invalid');
  const notices = record.notices.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Execution notice is invalid');
    const row = value as Record<string, unknown>;
    if (Object.keys(row).sort().join('|') !== 'availableNow|displayName|id|kind|notification|occurredAt'
      || typeof row.id !== 'string' || row.id.length > 64 || typeof row.displayName !== 'string' || row.displayName.length > 256
      || (row.availableNow !== null && typeof row.availableNow !== 'boolean') || typeof row.occurredAt !== 'string' || !Number.isFinite(Date.parse(row.occurredAt))
      || !['stopped', 'connection-unavailable', 'scope-unavailable'].includes(String(row.kind))
      || !['disabled', 'unsupported', 'requested', 'shown', 'failed'].includes(String(row.notification))) throw new Error('Execution notice is invalid');
    return row as Notice;
  });
  return { notices, systemSupported: record.systemSupported };
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.execution-notice
export function HomeExecutionNotices({ appArtworkFor }: {
  appArtworkFor?: ExecutionNoticeAppArtworkResolver;
} = {}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['desktop-execution-notices'], enabled: hasElectronInvoke(), retry: false, refetchInterval: 2000,
    queryFn: () => invokeChecked('desktop_execution_notices_list', {}, parseSnapshot) });
  const dismiss = useMutation({ mutationFn: (id: string) => invokeChecked('desktop_execution_notices_dismiss', { payload: { id } }, value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).join('|') !== 'dismissed' || typeof (value as { dismissed?: unknown }).dismissed !== 'boolean') {
      throw new Error('Execution notice dismissal is invalid');
    }
    return value;
  }),
    // A false dismissal means the record was already absent at the owner.
    onSuccess: async (_value, id) => {
      await queryClient.cancelQueries({ queryKey: ['desktop-execution-notices'] });
      queryClient.setQueryData<NoticeSnapshot>(['desktop-execution-notices'], snapshot => snapshot
        ? { ...snapshot, notices: snapshot.notices.filter(notice => notice.id !== id) } : snapshot);
      await queryClient.invalidateQueries({ queryKey: ['desktop-execution-notices'] });
    } });
  const notices = query.data?.notices ?? [];
  if (!open && !query.isError && !notices.length) return null;
  return <>
    {notices.length || query.isError ? <section aria-label={t('Notifications.execution.notices')} data-testid="execution-notices-summary">
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-[var(--nimi-text-secondary)] transition-colors hover:bg-[var(--nimi-surface-card)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-focus-ring-color)]">
        <History size={14} aria-hidden="true" className="shrink-0" />
        <span className="min-w-0 flex-1">{query.isError ? t('Notifications.execution.unavailable') : t('Notifications.execution.summaryCount', { count: notices.length })}</span>
        <span>{t('Notifications.execution.viewAll')}</span><ArrowRight size={14} aria-hidden="true" className="shrink-0" />
      </button>
    </section> : null}
    <OverlayShell open={open} kind="drawer" size="S" title={<div className="flex items-center gap-3">
      <button type="button" aria-label={t('Common.close')} title={t('Common.close')} data-testid="execution-notices-close" onClick={() => setOpen(false)} className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--nimi-text-secondary)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"><PanelRightClose size={16} aria-hidden="true" /><span className="sr-only">{t('Common.close')}</span></button>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info-soft-text)]" data-testid="execution-notices-title-icon"><BellRing size={17} aria-hidden="true" /></span>
      <div className="flex min-w-0 flex-1 items-center gap-2"><span className="truncate">{t('Notifications.execution.notices')}</span>{notices.length ? <StatusBadge tone="neutral" className="shrink-0">{notices.length}</StatusBadge> : null}</div>
    </div>}
      onClose={() => setOpen(false)} panelClassName="flex h-full flex-col" contentClassName="min-h-0 flex-1 overflow-y-auto px-5 pb-6"
      data-testid="execution-notices-drawer">
      {query.isError ? <div className="mb-4"><InlineAlert tone="warning" action={<Button tone="ghost" size="sm" onClick={() => void query.refetch()}>{t('Notifications.execution.retry')}</Button>}>{t('Notifications.execution.unavailable')}</InlineAlert></div> : null}
      <ul className="flex flex-col gap-3" data-testid="execution-notices-list">
        {notices.map(notice => {
          const artwork = appArtworkFor?.(notice.displayName) ?? null;
          return <AppCardSurface key={notice.id} as="li" kind="operational-solid" className="p-4" data-testid="execution-notice-row">
            <div className="flex items-start gap-3">
              <AppArtworkIcon appId={artwork?.appId ?? notice.displayName} displayName={notice.displayName} iconUrl={artwork?.iconUrl} size="md" className="execution-notice-app-icon" />
              <div className="min-w-0 flex-1">
                <h3 className="break-words text-sm font-semibold">{notice.displayName}</h3>
                <div className="mt-2"><StatusBadge tone="warning" shape="dot">{t(`Notifications.execution.${notice.kind}`)}</StatusBadge></div>
              </div>
            </div>
            <p className={`mt-3 text-[13px] leading-5 ${notice.availableNow ? 'text-[var(--nimi-status-success)]' : 'text-[var(--nimi-text-secondary)]'}`} data-testid="execution-notice-availability">{t(notice.availableNow === null ? 'Notifications.execution.unconfirmed' : notice.availableNow ? 'Notifications.execution.restored' : 'Notifications.execution.noResume')}</p>
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--nimi-border-subtle)] pt-2.5">
              <time className="text-xs tabular-nums text-[var(--nimi-text-muted)]" dateTime={notice.occurredAt}>{new Date(notice.occurredAt).toLocaleString()}</time>
              <Button tone="ghost" size="sm" className="-mr-2 shrink-0 text-[var(--nimi-text-secondary)]" leadingIcon={<Trash2 size={13} aria-hidden="true" />} disabled={dismiss.isPending} onClick={() => dismiss.mutate(notice.id)}>{t('Notifications.execution.dismiss')}</Button>
            </div>
            {notice.notification !== 'shown' ? <details className="group mt-3 rounded-xl bg-[var(--nimi-status-neutral-soft-bg)] px-3 py-2.5 text-xs text-[var(--nimi-text-muted)]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md text-[var(--nimi-text-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] [&::-webkit-details-marker]:hidden"><span>{t('Notifications.execution.notificationDetails')}</span><ChevronDown size={14} aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-180" /></summary>
              <p className="mt-2 leading-5">{t(`Notifications.execution.notification-${notice.notification}`)}</p>
            </details> : null}
            {dismiss.isError && dismiss.variables === notice.id ? <div role="alert" className="mt-3 text-sm text-[var(--nimi-status-danger)]">{t('Notifications.execution.dismissFailed')} <Button tone="ghost" size="sm" onClick={() => dismiss.mutate(notice.id)}>{t('Notifications.execution.retry')}</Button></div> : null}
          </AppCardSurface>;
        })}
      </ul>
      {!notices.length && !query.isError ? <div role="status" className="flex flex-col items-center px-6 py-14 text-center"><span className="flex size-12 items-center justify-center rounded-2xl bg-[var(--nimi-status-neutral-soft-bg)] text-[var(--nimi-status-neutral-soft-text)]"><History size={22} aria-hidden="true" /></span><p className="mt-4 text-sm font-medium text-[var(--nimi-text-secondary)]">{t('Notifications.execution.empty')}</p></div> : null}
    </OverlayShell>
  </>;
}
