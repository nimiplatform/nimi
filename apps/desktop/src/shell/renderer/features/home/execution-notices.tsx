import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
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
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['desktop-execution-notices'], enabled: hasElectronInvoke(), retry: false, refetchInterval: 2000,
    queryFn: () => invokeChecked('desktop_execution_notices_list', {}, parseSnapshot) });
  const dismiss = useMutation({ mutationFn: (id: string) => invokeChecked('desktop_execution_notices_dismiss', { payload: { id } }, value => value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['desktop-execution-notices'] }) });
  if (query.isError) return <InlineAlert tone="warning" action={<Button tone="ghost" size="sm" onClick={() => void query.refetch()}>{t('Notifications.execution.retry')}</Button>}>{t('Notifications.execution.unavailable')}</InlineAlert>;
  if (!query.data?.notices.length) return null;
  return <section aria-label={t('Notifications.execution.notices')} className="space-y-2" data-testid="execution-notices">
    <p className="text-xs font-medium text-[var(--nimi-text-secondary)]">{t('Notifications.execution.notices')}</p>
    {query.data.notices.map(notice => <InlineAlert key={notice.id} tone="warning" action={<Button tone="ghost" size="sm" disabled={dismiss.isPending} onClick={() => dismiss.mutate(notice.id)}>{t('Notifications.execution.dismiss')}</Button>}>
      <p className="font-medium">{notice.displayName}: {t(`Notifications.execution.${notice.kind}`)}</p>
      <p>{t(notice.availableNow === null ? 'Notifications.execution.unconfirmed' : notice.availableNow ? 'Notifications.execution.restored' : 'Notifications.execution.noResume')}</p>
      <time className="text-xs" dateTime={notice.occurredAt}>{new Date(notice.occurredAt).toLocaleString()}</time>
      {notice.notification !== 'shown' ? <p className="text-xs">{t(`Notifications.execution.notification-${notice.notification}`)}</p> : null}
    </InlineAlert>)}
  </section>;
}
