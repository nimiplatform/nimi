import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, OverlayShell, InlineAlert } from '@nimiplatform/kit/ui';
import { CANONICAL_CAPABILITY_IDS } from '@nimiplatform/kit/core/runtime-capabilities';
import type { NimiRuntimeConnectorCatalogEntry } from '@nimiplatform/sdk/runtime';
import { useAppStore, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { useAppsOverview } from '../apps/use-apps-overview.js';
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
  const pendingChoice = useRef<AbortController | null>(null);
  useEffect(() => () => pendingChoice.current?.abort(), []);
  const dismiss = () => {
    pendingChoice.current?.abort();
    props.onClose();
  };
  const apps = overview.data?.status === 'loaded' && capability ? capabilityApps(overview.data, capability) : null;
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
        loadSource: async origin => {
          const accountId = await currentDesktopAccountIdForSetup();
          // Reject a dismissed entry before the shared helper can create or reuse a task.
          choice.signal.throwIfAborted();
          if (!accountId) throw new Error('Account required');
          return { ...owner, accountId, returnFocus: 'home:' + encodeURIComponent(JSON.stringify(origin)) };
        },
        openTask: taskId => {
          // A prior unfinished draft belongs to its owner. Never replace it with a catalog hint.
          const task = store.getSnapshot().tasks.find(item => item.taskId === taskId);
          if (task && !task.draft) store.updateTask(taskId, () => ({ draft: {
            route: 'cloud', cloudConnectorRef: props.connectorId, cloudTargetSearch: props.entry.providerModelId,
          } }));
          props.onClose();
          props.onOpenTask(taskId);
        },
      });
    } catch { if (!choice.signal.aborted) setError(true); }
    finally { if (!choice.signal.aborted) setBusy(false); }
  };
  return <OverlayShell open kind="dialog" size="md" onClose={dismiss} title={t('runtimeConfig.cloudWorkspace.configureUse')} dataTestId="cloud-use-dialog">
    <div className="space-y-4">
      <p className="text-sm text-[var(--nimi-text-secondary)]">{props.entry.modelLabel}</p>
      {capabilities.length ? <RuntimeSelect value={capability} onChange={setCapability} disabled={busy} options={capabilities.map(value => ({ value, label: displayRuntimeConfigCapabilityLabel(value, t) }))} className="w-full" /> : <p>{t('runtimeConfig.cloudWorkspace.capabilitiesUnknown')}</p>}
      {authStatus !== 'authenticated' ? <InlineAlert tone="warning">{t('runtimeConfig.cloudWorkspace.signInRequired')}</InlineAlert> : null}
      {error ? <InlineAlert tone="danger">{t('runtimeConfig.cloudWorkspace.configureFailed')}</InlineAlert> : null}
      <div className="grid gap-2">
        {capability === 'text.generate' ? <Button tone="secondary" disabled={busy || authStatus !== 'authenticated'} onClick={() => void choose({ kind: 'app', ownerAppId: DESKTOP_NIMI_APP_ID })}>{t('runtimeConfig.cloudWorkspace.nimiChat')}</Button> : null}
        {(apps?.apps ?? []).filter(entry => entry.identity.appId !== DESKTOP_NIMI_APP_ID).map(entry => <Button key={entry.identity.appId} tone="secondary" disabled={busy || authStatus !== 'authenticated'} onClick={() => void choose({ kind: 'app', ownerAppId: entry.identity.appId })}>{entry.identity.displayName}</Button>)}
        {capability ? <Button tone="secondary" disabled={busy || authStatus !== 'authenticated'} onClick={() => void choose({ kind: 'local-agent' })}>{t('runtimeConfig.cloudWorkspace.sharedAgents')}</Button> : null}
      </div>
      {overview.isPending ? <p className="text-xs text-[var(--nimi-text-muted)]">{t('Common.loading')}</p> : null}
      {overview.isError || apps?.incomplete ? <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.cloudWorkspace.appsIncomplete')}</p> : null}
      <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.cloudWorkspace.configureHint')}</p>
    </div>
  </OverlayShell>;
}
