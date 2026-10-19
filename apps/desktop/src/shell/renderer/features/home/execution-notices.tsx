import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, InlineAlert, OverlayShell } from '@nimiplatform/kit/ui';
import { ArrowRight, History } from 'lucide-react';
import { hasElectronInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { invokeChecked } from '../../bridge/runtime-bridge/invoke.js';

const PREFERENCES_PATH = 'execution-notices/preferences.v1.json';
type Notice = {
  id: string; displayName: string; kind: 'stopped' | 'connection-unavailable' | 'scope-unavailable';
  occurredAt: string; availableNow: boolean | null; notification: 'disabled' | 'unsupported' | 'requested' | 'shown' | 'failed';
};
type NoticeSnapshot = { notices: readonly Notice[]; systemSupported: boolean };

function useExecutionNotificationPreferences() {
  const sdk = useDesktopRendererSdk();
  const account = useAppStore(state => state.auth.user?.id ?? null);
  const authenticated = useAppStore(state => state.auth.status === 'authenticated');
  const queryClient = useQueryClient();
  const key = ['desktop-execution-notification-preferences', account] as const;
  const query = useQuery({ queryKey: key, enabled: authenticated, retry: false, queryFn: async () => {
    try {
      const { value } = await sdk.appProduct().storage.readJson(PREFERENCES_PATH);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Execution notification preferences are invalid');
      const record = value as Record<string, unknown>;
      if (record.version !== 1 || typeof record.systemEnabled !== 'boolean') throw new Error('Execution notification preferences are invalid');
      return { systemEnabled: record.systemEnabled };
    } catch (error) {
      const code = error && typeof error === 'object' && 'reasonCode' in error ? error.reasonCode : '';
      if (code === 'APP_STORAGE_ENTRY_NOT_FOUND') return { systemEnabled: true };
      throw error;
    }
  } });
  const mutation = useMutation({ mutationFn: async (systemEnabled: boolean) => {
    await sdk.appProduct().storage.writeJson(PREFERENCES_PATH, { version: 1, systemEnabled });
    return { systemEnabled };
  }, onSuccess: value => queryClient.setQueryData(key, value) });
  return { query, mutation, authenticated };
}

/** A display preference projection; no credential, consent or Runtime access is granted. */
export function ExecutionNotificationPreferenceSync() {
  const { i18n } = useTranslation();
  const { query, authenticated } = useExecutionNotificationPreferences();
  const enabled = authenticated && !query.isError && query.data?.systemEnabled === true;
  const language = i18n.resolvedLanguage?.startsWith('zh') ? 'zh' : 'en';
  useEffect(() => {
    if (!hasElectronInvoke()) return;
    void invokeChecked('desktop_execution_notices_preferences', { payload: { enabled, language } }, value => value).catch(() => undefined);
    return () => { void invokeChecked('desktop_execution_notices_preferences', { payload: { enabled: false, language } }, value => value).catch(() => undefined); };
  }, [enabled, language]);
  return null;
}

export function ExecutionNotificationSetting() {
  const { t } = useTranslation();
  const { query, mutation } = useExecutionNotificationPreferences();
  return <section className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4" aria-label={t('Notifications.execution.title')}>
    <label className="flex items-center justify-between gap-4"><span className="font-medium">{t('Notifications.execution.title')}</span><input type="checkbox" aria-label={t('Notifications.execution.title')} checked={query.data?.systemEnabled ?? false} disabled={!query.data || mutation.isPending} onChange={event => mutation.mutate(event.target.checked)} /></label>
    <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{t('Notifications.execution.description')}</p>
    <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{t('Notifications.execution.osLimit')}</p>
    {query.isError || mutation.isError ? <div role="status" className="mt-2 text-sm"><span>{t('Notifications.execution.failed')}</span><Button tone="ghost" size="sm" onClick={() => void query.refetch()}>{t('Notifications.execution.retry')}</Button></div> : null}
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
export function HomeExecutionNotices() {
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
    <OverlayShell open={open} kind="drawer" size="S" title={<div className="flex items-center justify-between gap-3"><span>{t('Notifications.execution.notices')}</span><Button tone="ghost" size="sm" onClick={() => setOpen(false)}>{t('Common.close')}</Button></div>}
      onClose={() => setOpen(false)} panelClassName="flex h-full flex-col" contentClassName="min-h-0 flex-1 overflow-y-auto pb-6"
      data-testid="execution-notices-drawer">
      <p className="mb-5 text-sm leading-6 text-[var(--nimi-text-secondary)]">{t('Notifications.execution.summaryDescription')}</p>
      {query.isError ? <InlineAlert tone="warning" action={<Button tone="ghost" size="sm" onClick={() => void query.refetch()}>{t('Notifications.execution.retry')}</Button>}>{t('Notifications.execution.unavailable')}</InlineAlert> : null}
      <ul className="divide-y divide-[var(--nimi-border-subtle)]" data-testid="execution-notices-list">
        {notices.map(notice => <li key={notice.id} className="py-4 first:pt-0" data-testid="execution-notice-row">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold">{notice.displayName}</p>
              <p className="mt-1 text-sm">{t(`Notifications.execution.${notice.kind}`)}</p>
            </div>
            <Button tone="ghost" size="sm" className="shrink-0" disabled={dismiss.isPending} onClick={() => dismiss.mutate(notice.id)}>{t('Notifications.execution.dismiss')}</Button>
          </div>
          <p className="mt-2 text-xs leading-5 text-[var(--nimi-text-secondary)]">{t(notice.availableNow === null ? 'Notifications.execution.unconfirmed' : notice.availableNow ? 'Notifications.execution.restored' : 'Notifications.execution.noResume')}</p>
          <time className="mt-1 block text-xs text-[var(--nimi-text-muted)]" dateTime={notice.occurredAt}>{new Date(notice.occurredAt).toLocaleString()}</time>
          {notice.notification !== 'shown' ? <details className="mt-2 text-xs text-[var(--nimi-text-muted)]">
            <summary className="cursor-pointer">{t('Notifications.execution.notificationDetails')}</summary>
            <p className="mt-1 leading-5">{t(`Notifications.execution.notification-${notice.notification}`)}</p>
          </details> : null}
          {dismiss.isError && dismiss.variables === notice.id ? <div role="alert" className="mt-2 text-sm text-[var(--nimi-status-danger)]">{t('Notifications.execution.dismissFailed')} <Button tone="ghost" size="sm" onClick={() => dismiss.mutate(notice.id)}>{t('Notifications.execution.retry')}</Button></div> : null}
        </li>)}
      </ul>
      {!notices.length && !query.isError ? <p role="status" className="py-8 text-center text-sm text-[var(--nimi-text-secondary)]">{t('Notifications.execution.empty')}</p> : null}
    </OverlayShell>
  </>;
}
