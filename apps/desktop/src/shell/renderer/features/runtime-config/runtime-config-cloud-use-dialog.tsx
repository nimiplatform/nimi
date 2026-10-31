import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, OverlayShell, InlineAlert, ScrollShell, TextField } from '@nimiplatform/kit/ui';
import { ArrowRight, Bot, Cloud, Search } from 'lucide-react';
import { CANONICAL_CAPABILITY_IDS } from '@nimiplatform/kit/core/runtime-capabilities';
import type { NimiRuntimeConnectorCatalogEntry } from '@nimiplatform/sdk/runtime';
import { useAppStore, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { useAppsOverview } from '../apps/use-apps-overview.js';
import { AppArtworkIcon } from '../apps/apps-card-visuals.js';
import { DESKTOP_NIMI_APP_ID } from '../chat/chat-nimi-app-ai-config.js';
import { capabilityApps } from './runtime-capability-apps.js';
import { RuntimeSelect } from './runtime-config-primitives.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import { currentDesktopAccountIdForSetup } from './runtime-setup-task-ports.js';
import { getRuntimeSetupTaskStore } from './runtime-setup-task-store.js';
import { openRuntimeSetupTaskFromEntry, type RuntimeSetupTaskOpenSource } from './runtime-setup-task-open.js';

// @nimi-authority: rule.nimi.desktop.ai-consumption.cloud-services-workspace
export function CloudConnectorUseDialog(props: {
  connectorId: string;
  entry: NimiRuntimeConnectorCatalogEntry;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const navigation = useHomeNavigation();
  const authStatus = useAppStore(state => state.auth.status);
  const overview = useAppsOverview();
  const capabilities = props.entry.capabilities.filter(id => (CANONICAL_CAPABILITY_IDS as readonly string[]).includes(id));
  const [capability, setCapability] = useState(capabilities[0] ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const pendingChoice = useRef<AbortController | null>(null);
  useEffect(() => () => pendingChoice.current?.abort(), []);
  const dismiss = () => {
    pendingChoice.current?.abort();
    props.onClose();
  };
  const apps = overview.data?.status === 'loaded' && capability ? capabilityApps(overview.data, capability) : null;
  const owners: { key: string; label: string; owner: Pick<RuntimeSetupTaskOpenSource, 'kind' | 'ownerAppId'> }[] = [
    ...(capability === 'text.generate' ? [{ key: DESKTOP_NIMI_APP_ID, label: t('runtimeConfig.cloudWorkspace.nimiChat'), owner: { kind: 'app' as const, ownerAppId: DESKTOP_NIMI_APP_ID } }] : []),
    ...(apps?.apps ?? []).filter(entry => entry.identity.appId !== DESKTOP_NIMI_APP_ID).map(entry => ({ key: entry.identity.appId, label: entry.identity.displayName, owner: { kind: 'app' as const, ownerAppId: entry.identity.appId } })),
    ...(capability ? [{ key: 'local-agent', label: t('runtimeConfig.cloudWorkspace.sharedAgents'), owner: { kind: 'local-agent' as const } }] : []),
  ];
  const filteredOwners = owners.filter(owner => owner.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const appOwners = filteredOwners.filter(owner => owner.owner.kind === 'app');
  const agentOwner = filteredOwners.find(owner => owner.owner.kind === 'local-agent');
  const choose = async (owner: Pick<RuntimeSetupTaskOpenSource, 'kind' | 'ownerAppId'>) => {
    if (busy || !capability || authStatus !== 'authenticated') return;
    pendingChoice.current?.abort();
    const choice = new AbortController();
    pendingChoice.current = choice;
    setBusy(true);
    setError(false);
    const store = getRuntimeSetupTaskStore();
    try {
      await openRuntimeSetupTaskFromEntry(store, {
        navigation, capabilityContract: capability,
        cloudCatalogEntry: { connectorId: props.connectorId, providerModelId: props.entry.providerModelId },
        loadSource: async origin => {
          const accountId = await currentDesktopAccountIdForSetup();
          // Reject a dismissed entry before the shared helper can create or reuse a task.
          choice.signal.throwIfAborted();
          if (!accountId) throw new Error('Account required');
          return { ...owner, accountId, returnFocus: 'home:' + encodeURIComponent(JSON.stringify(origin)) };
        },
        openTask: taskId => {
          props.onClose();
          props.onOpenTask(taskId);
        },
      });
    } catch { if (!choice.signal.aborted) setError(true); }
    finally { if (!choice.signal.aborted) setBusy(false); }
  };
  return <OverlayShell
    open kind="dialog" size="md" onClose={dismiss}
    title={<span className="block text-xl font-semibold leading-snug tracking-tight">{t('runtimeConfig.cloudWorkspace.chooseOwner')}</span>}
    dataTestId="cloud-use-dialog"
    panelClassName="flex max-h-[90vh] flex-col overflow-hidden rounded-3xl"
    contentClassName="flex min-h-0 flex-1 flex-col gap-5 pb-5 pt-3"
  >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span className="inline-flex min-w-0 items-center gap-2 rounded-full bg-[var(--nimi-surface-active)] px-3 py-1.5 text-[var(--nimi-text-primary)]">
          <Cloud size={15} aria-hidden="true" className="shrink-0 text-[var(--nimi-action-primary-bg)]" />
          <span className="break-all font-medium">{props.entry.modelLabel}</span>
        </span>
        {capabilities.length === 1 ? <span className="text-[var(--nimi-text-secondary)]">{displayRuntimeConfigCapabilityLabel(capability, t)}</span> : null}
      </div>
      {capabilities.length > 1 ? <div><label className="mb-1 block text-xs text-[var(--nimi-text-secondary)]">{t('runtimeConfig.cloudWorkspace.filterCapability')}</label><RuntimeSelect value={capability} onChange={value => { setCapability(value); setQuery(''); }} disabled={busy} options={capabilities.map(value => ({ value, label: displayRuntimeConfigCapabilityLabel(value, t) }))} className="w-full" /></div> : !capabilities.length ? <p>{t('runtimeConfig.cloudWorkspace.capabilitiesUnknown')}</p> : null}
      {authStatus !== 'authenticated' ? <InlineAlert tone="warning">{t('runtimeConfig.cloudWorkspace.signInRequired')}</InlineAlert> : null}
      {error ? <InlineAlert tone="danger">{t('runtimeConfig.cloudWorkspace.configureFailed')}</InlineAlert> : null}
      {owners.length > 6 || query ? <TextField aria-label={t('runtimeConfig.cloudWorkspace.searchOwners')} placeholder={t('runtimeConfig.cloudWorkspace.searchOwners')} leading={<Search size={17} aria-hidden="true" />} value={query} onChange={event => setQuery(event.target.value)} className="min-h-11 rounded-xl bg-[var(--nimi-surface-panel)] text-sm focus-within:ring-1" /> : null}
      <ScrollShell className="min-h-0 max-h-[46vh] -mx-1 px-1" aria-busy={busy}>
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-2.5 p-0.5">
          {appOwners.map(owner => <li key={owner.key} className="min-w-0">
            <button
              type="button"
              className="group flex h-full min-h-[4.5rem] w-full items-center gap-3 rounded-2xl border border-transparent bg-[var(--nimi-surface-panel)] px-4 py-3 text-left text-sm font-medium text-[var(--nimi-text-primary)] transition-colors hover:border-[var(--nimi-border-subtle)] hover:bg-[var(--nimi-surface-active)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nimi-focus-ring-color)] disabled:cursor-wait disabled:opacity-50"
              disabled={busy || authStatus !== 'authenticated'} onClick={() => void choose(owner.owner)}
            >
              <AppArtworkIcon appId={owner.key} displayName={owner.label} iconUrl={apps?.iconUrls.get(owner.key)} size="xl" />
              <span className="min-w-0 flex-1 break-words leading-snug">{owner.label}</span>
              <ArrowRight size={16} aria-hidden="true" className="shrink-0 text-[var(--nimi-text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--nimi-action-primary-bg)]" />
            </button>
          </li>)}
        </ul>
        {query && !filteredOwners.length ? <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-sm text-[var(--nimi-text-secondary)]"><Search size={24} aria-hidden="true" className="text-[var(--nimi-text-muted)]" /><p>{t('runtimeConfig.cloudWorkspace.noOwnersMatch')}</p></div> : null}
      </ScrollShell>
      {agentOwner ? <button
          type="button"
          className="group flex min-h-16 w-full shrink-0 items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm text-[var(--nimi-text-secondary)] transition-colors hover:bg-[var(--nimi-surface-panel)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--nimi-focus-ring-color)] disabled:cursor-wait disabled:opacity-50"
          disabled={busy || authStatus !== 'authenticated'} onClick={() => void choose(agentOwner.owner)}
        >
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--nimi-surface-panel)]"><Bot size={22} /></span>
          <span className="flex-1 font-medium">{agentOwner.label}</span>
          <ArrowRight size={16} aria-hidden="true" className="shrink-0 text-[var(--nimi-text-muted)] transition-transform group-hover:translate-x-0.5" />
        </button> : null}
      {overview.isPending ? <p className="text-xs text-[var(--nimi-text-muted)]">{t('Common.loading')}</p> : null}
      {overview.isError || apps?.incomplete ? <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.cloudWorkspace.appsIncomplete')}</p> : null}
      <div className="flex items-center justify-between gap-5 pt-1"><p className="max-w-md text-xs leading-relaxed text-[var(--nimi-text-secondary)]">{t('runtimeConfig.cloudWorkspace.configureHint')}</p><Button size="sm" tone="ghost" className="shrink-0" onClick={dismiss}>{t('Common.cancel')}</Button></div>
  </OverlayShell>;
}
