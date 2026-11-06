import { useState } from 'react';
import { Button, SelectField, Surface } from '@nimiplatform/kit/ui';
import type { TFunction } from 'i18next';
import type { ApiConnector } from './runtime-config-state-types.js';
import type { ConnectorModelInfo } from './runtime-config-connector-sdk-service.js';
import { useRuntimeConfigConnectorSdk } from './runtime-config-connector-sdk-context.js';
import { Input } from './runtime-config-primitives.js';

type DraftBinding = { id: string; providerModelId: string; invocationModelId: string };

// @nimi-authority: rule.nimi.runtime.ai-provider.bedrock-native-routing
export function CloudBedrockInvocations({ connector, disabled, onSaved, t }: {
  connector: ApiConnector; disabled: boolean; onSaved: (value: ApiConnector) => void; t: TFunction;
}) {
  const sdk = useRuntimeConfigConnectorSdk();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<ConnectorModelInfo[]>([]);
  const [rows, setRows] = useState<DraftBinding[]>([]);
  const [error, setError] = useState('');
  const savedBindings = connector.bedrockInvocations?.invocations ?? [];

  async function begin() {
    setBusy(true); setError('');
    try {
      setModels(await sdk.sdkListConnectorModelDescriptors(connector.id, true));
      setRows(savedBindings.map(binding => ({ ...binding, id: crypto.randomUUID() })));
      setEditing(true);
    } catch { setError(t('runtimeConfig.bedrockInvocations.loadFailed')); }
    finally { setBusy(false); }
  }

  const valid = rows.every(row => row.invocationModelId.trim() && models.some(model => model.providerModelId === row.providerModelId))
    && new Set(rows.map(row => row.providerModelId)).size === rows.length
    && new Set(rows.map(row => row.invocationModelId.trim())).size === rows.length;

  function update(id: string, patch: Partial<DraftBinding>) {
    setRows(current => current.map(row => row.id === id ? { ...row, ...patch } : row));
  }

  async function save() {
    setBusy(true); setError('');
    try {
      const saved = await sdk.sdkUpdateConnector({ connectorId: connector.id, bedrockInvocations: {
        invocations: rows.map(row => ({ providerModelId: row.providerModelId, invocationModelId: row.invocationModelId.trim() })),
      } });
      if (!saved) throw new Error();
      onSaved(saved); setEditing(false);
    } catch { setError(t('runtimeConfig.bedrockInvocations.saveFailed')); }
    finally { setBusy(false); }
  }

  return <Surface tone="panel" className="space-y-3 p-4" data-testid="cloud-bedrock-invocations">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">{t('runtimeConfig.bedrockInvocations.title')}</h3>
      {!editing ? <Button size="sm" tone="secondary" disabled={disabled || busy} onClick={() => void begin()}>{t('runtimeConfig.bedrockInvocations.configure')}</Button> : null}
    </div>
    <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.bedrockInvocations.description')}</p>
    {!editing ? savedBindings.length ? <dl className="space-y-2 text-sm">{savedBindings.map(binding => <div key={binding.providerModelId} className="flex flex-wrap gap-x-3">
      <dt className="font-medium">{binding.providerModelId}</dt><dd className="break-all text-[var(--nimi-text-secondary)]">{binding.invocationModelId}</dd>
    </div>)}</dl> : <p className="text-sm text-[var(--nimi-text-secondary)]">{t('runtimeConfig.bedrockInvocations.unconfigured')}</p> : <div className="space-y-4">
      {rows.map((row, index) => <div key={row.id} role="group" aria-label={t('runtimeConfig.bedrockInvocations.binding', { index: index + 1 })} className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="space-y-1"><p className="text-xs font-medium">{t('runtimeConfig.bedrockInvocations.model')}</p>
          <SelectField aria-label={t('runtimeConfig.bedrockInvocations.modelAt', { index: index + 1 })} value={row.providerModelId || 'unselected'} disabled={disabled || busy}
            options={[{ value: 'unselected', label: t('runtimeConfig.bedrockInvocations.choose') }, ...models.map(model => ({ value: model.providerModelId, label: model.modelLabel || model.providerModelId }))]}
            onValueChange={value => update(row.id, { providerModelId: value === 'unselected' ? '' : value })} />
        </div>
        <Input label={t('runtimeConfig.bedrockInvocations.deploymentAt', { index: index + 1 })} value={row.invocationModelId} disabled={disabled || busy} onChange={value => update(row.id, { invocationModelId: value })} />
        <Button size="sm" tone="ghost" disabled={disabled || busy} aria-label={t('runtimeConfig.bedrockInvocations.removeAt', { index: index + 1 })} onClick={() => setRows(current => current.filter(item => item.id !== row.id))}>{t('runtimeConfig.bedrockInvocations.remove')}</Button>
      </div>)}
      <Button size="sm" tone="secondary" disabled={disabled || busy || rows.length >= 128} onClick={() => setRows(current => [...current, { id: crypto.randomUUID(), providerModelId: '', invocationModelId: '' }])}>{t('runtimeConfig.bedrockInvocations.add')}</Button>
      {!valid && rows.length ? <p role="status" className="text-xs text-[var(--nimi-text-secondary)]">{t('runtimeConfig.bedrockInvocations.complete')}</p> : null}
      <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.bedrockInvocations.reselect')}</p>
      <div className="flex gap-2"><Button size="sm" disabled={disabled || busy || !valid} onClick={() => void save()}>{t('runtimeConfig.bedrockInvocations.save')}</Button><Button size="sm" tone="ghost" disabled={busy} onClick={() => setEditing(false)}>{t('runtimeConfig.bedrockInvocations.cancel')}</Button></div>
    </div>}
    {error ? <p role="alert" className="text-xs text-[var(--nimi-status-danger)]">{error}</p> : null}
  </Surface>;
}
