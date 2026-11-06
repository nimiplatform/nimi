import { useState } from 'react';
import { Button, SelectField, Surface } from '@nimiplatform/kit/ui';
import type { TFunction } from 'i18next';
import type { ApiConnector } from './runtime-config-state-types.js';
import type { ConnectorModelInfo } from './runtime-config-connector-sdk-service.js';
import { useRuntimeConfigConnectorSdk } from './runtime-config-connector-sdk-context.js';
import { Input } from './runtime-config-primitives.js';

type DraftBinding = { id: string; providerModelId: string; deploymentName: string };

// @nimi-authority: rule.nimi.runtime.ai-provider.azure-deployment-bindings
export function CloudAzureDeployments({ connector, disabled, onSaved, t }: {
  connector: ApiConnector; disabled: boolean; onSaved: (value: ApiConnector) => void; t: TFunction;
}) {
  const sdk = useRuntimeConfigConnectorSdk();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<ConnectorModelInfo[]>([]);
  const [rows, setRows] = useState<DraftBinding[]>([]);
  const [error, setError] = useState('');
  const savedBindings = connector.azureDeployments?.deployments ?? [];

  async function begin() {
    setBusy(true); setError('');
    try {
      setModels(await sdk.sdkListConnectorModelDescriptors(connector.id, true));
      setRows(savedBindings.map(binding => ({ ...binding, id: crypto.randomUUID() })));
      setEditing(true);
    } catch { setError(t('runtimeConfig.azureDeployments.loadFailed')); }
    finally { setBusy(false); }
  }

  const valid = rows.every(row => row.deploymentName.trim() && models.some(model => model.providerModelId === row.providerModelId))
    && new Set(rows.map(row => row.providerModelId)).size === rows.length
    && new Set(rows.map(row => row.deploymentName.trim())).size === rows.length;

  function update(id: string, patch: Partial<DraftBinding>) {
    setRows(current => current.map(row => row.id === id ? { ...row, ...patch } : row));
  }

  async function save() {
    setBusy(true); setError('');
    try {
      const saved = await sdk.sdkUpdateConnector({ connectorId: connector.id, azureDeployments: {
        deployments: rows.map(row => ({ providerModelId: row.providerModelId, deploymentName: row.deploymentName.trim() })),
      } });
      if (!saved) throw new Error();
      onSaved(saved); setEditing(false);
    } catch { setError(t('runtimeConfig.azureDeployments.saveFailed')); }
    finally { setBusy(false); }
  }

  return <Surface tone="panel" className="space-y-3 p-4" data-testid="cloud-azure-deployments">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">{t('runtimeConfig.azureDeployments.title')}</h3>
      {!editing ? <Button size="sm" tone="secondary" disabled={disabled || busy} onClick={() => void begin()}>{t('runtimeConfig.azureDeployments.configure')}</Button> : null}
    </div>
    <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.azureDeployments.description')}</p>
    {!editing ? savedBindings.length ? <dl className="space-y-2 text-sm">{savedBindings.map(binding => <div key={binding.providerModelId} className="flex flex-wrap gap-x-3">
      <dt className="font-medium">{binding.providerModelId}</dt><dd className="break-all text-[var(--nimi-text-secondary)]">{binding.deploymentName}</dd>
    </div>)}</dl> : <p className="text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.azureDeployments.unconfigured')}</p> : <div className="space-y-4">
      {rows.map((row, index) => <div key={row.id} role="group" aria-label={t('runtimeConfig.azureDeployments.binding', { index: index + 1 })} className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="space-y-1"><p className="text-xs font-medium">{t('runtimeConfig.azureDeployments.model')}</p>
          <SelectField aria-label={t('runtimeConfig.azureDeployments.modelAt', { index: index + 1 })} value={row.providerModelId || 'unselected'} disabled={disabled || busy}
            options={[{ value: 'unselected', label: t('runtimeConfig.azureDeployments.choose') }, ...models.map(model => ({ value: model.providerModelId, label: model.modelLabel || model.providerModelId }))]}
            onValueChange={value => update(row.id, { providerModelId: value === 'unselected' ? '' : value })} />
        </div>
        <Input label={t('runtimeConfig.azureDeployments.deploymentAt', { index: index + 1 })} value={row.deploymentName} disabled={disabled || busy} onChange={value => update(row.id, { deploymentName: value })} />
        <Button size="sm" tone="ghost" disabled={disabled || busy} aria-label={t('runtimeConfig.azureDeployments.removeAt', { index: index + 1 })} onClick={() => setRows(current => current.filter(item => item.id !== row.id))}>{t('runtimeConfig.azureDeployments.remove')}</Button>
      </div>)}
      <Button size="sm" tone="secondary" disabled={disabled || busy || rows.length >= 128} onClick={() => setRows(current => [...current, { id: crypto.randomUUID(), providerModelId: '', deploymentName: '' }])}>{t('runtimeConfig.azureDeployments.add')}</Button>
      {!valid && rows.length ? <p role="status" className="text-xs text-[var(--nimi-text-secondary)]">{t('runtimeConfig.azureDeployments.complete')}</p> : null}
      <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.azureDeployments.reselect')}</p>
      <div className="flex gap-2"><Button size="sm" disabled={disabled || busy || !valid} onClick={() => void save()}>{t('runtimeConfig.azureDeployments.save')}</Button><Button size="sm" tone="ghost" disabled={busy} onClick={() => setEditing(false)}>{t('runtimeConfig.azureDeployments.cancel')}</Button></div>
    </div>}
    {error ? <p role="alert" className="text-xs text-[var(--nimi-status-danger)]">{error}</p> : null}
  </Surface>;
}
