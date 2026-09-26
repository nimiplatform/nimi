import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, InlineAlert, LoadingSkeleton, Surface } from '@nimiplatform/kit/ui';
import type { NimiIntegrationConsumer, NimiIntegrationManagement } from '@nimiplatform/sdk/app';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { integrationErrorCode } from './integration-error.js';

const fieldClass = 'w-full rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-sm text-[var(--nimi-text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]';

// @nimi-authority: rule.nimi.runtime.integration.fixed-operations
// Home projects Runtime-owned connection and standing resource policy. Merely
// displaying this form or declaring integration.manage grants no authority.
export function IntegrationsPanel({ onBack }: { onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const [snapshot, setSnapshot] = useState<NimiIntegrationManagement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adapter, setAdapter] = useState<'mcp' | 'telegram'>('mcp');
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const secret = useRef<HTMLInputElement>(null);
  const [targetRef, setTargetRef] = useState('');
  const [consumers, setConsumers] = useState<string[]>([]);
  const [operations, setOperations] = useState<string[]>([]);
  const active = useRef(true);
  const load = useCallback(async () => {
    const data = await sdk.appProduct().integration.getManagement();
    if (active.current) setSnapshot(data);
  }, [sdk]);
  const showError = (cause: unknown) => {
    if (!active.current) return;
    const code = integrationErrorCode(cause);
    setError(code ? t(`Integrations.errors.${code}`, { defaultValue: t('Integrations.unavailable') }) : t('Integrations.unavailable'));
  };
  useEffect(() => {
    active.current = true;
    void load().catch(showError);
    return () => { active.current = false; if (secret.current) secret.current.value = ''; };
  }, [load]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); await load(); }
    catch (cause) { showError(cause); await load().catch(() => {}); }
    finally { if (active.current) setBusy(false); }
  };
  const target = snapshot?.targets.find(item => item.targetRef === targetRef);
  const describeInstance = (app: NimiIntegrationConsumer | undefined, consumerRef: string) =>
    `${t(`Integrations.sourceKinds.${app?.sourceKind || 'unknown'}`)} · ${t('Integrations.instance', { id: consumerRef.slice(-8) })}`;
  const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(item => item !== value) : [...values, value];
  const callTime = (value: string | null) => value ? new Date(value).toLocaleString(i18n.language) : t('Integrations.unknownTime');
  const connect = async () => {
    const credential = secret.current?.value ?? '';
    if (secret.current) secret.current.value = '';
    const connection = await sdk.appProduct().integration.putConnection({
      targetRef: '', adapter, endpoint: adapter === 'mcp' ? endpoint.trim() : '',
      displayName: name.trim(), accountLabel: '', secret: credential,
    });
    if (active.current) { setTargetRef(connection.targetRef); setName(''); setEndpoint(''); setOperations([]); setNotice(t('Integrations.connected')); }
  };
  return (
    <div className="flex flex-col gap-6" data-testid="integrations-panel">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><Button tone="ghost" size="sm" onClick={onBack}>{t('Integrations.back')}</Button><h1 className="mt-3 text-2xl font-semibold">{t('Integrations.title')}</h1><p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{t('Integrations.description')}</p></div>
        <Button tone="secondary" disabled={busy} onClick={() => void run(load)}>{t('Integrations.refresh')}</Button>
      </header>
      {error ? <InlineAlert tone="warning">{error}</InlineAlert> : null}
      {notice ? <InlineAlert tone="info">{notice}</InlineAlert> : null}
      {!snapshot && !error ? <LoadingSkeleton lines={3} label={t('Common.loading')} /> : null}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Surface tone="panel" padding="none" className="rounded-2xl p-5">
          <h2 className="font-semibold">{t('Integrations.addConnection')}</h2>
          <form className="mt-4 flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void run(connect); }}>
            <label className="flex flex-col gap-1.5 text-sm">{t('Integrations.kind')}<select className={fieldClass} value={adapter} onChange={event => setAdapter(event.target.value as 'mcp' | 'telegram')} disabled={busy}><option value="mcp">{t('Integrations.mcp')}</option><option value="telegram">{t('Integrations.telegram')}</option></select></label>
            <label className="flex flex-col gap-1.5 text-sm">{t('Integrations.name')}<input className={fieldClass} value={name} onChange={event => setName(event.target.value)} maxLength={256} required disabled={busy} /></label>
            {adapter === 'mcp' ? <label className="flex flex-col gap-1.5 text-sm">{t('Integrations.endpoint')}<input className={fieldClass} type="url" value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="https://example.com/mcp" required disabled={busy} /></label> : null}
            <label className="flex flex-col gap-1.5 text-sm">{t(adapter === 'telegram' ? 'Integrations.botToken' : 'Integrations.bearerToken')}<input ref={secret} className={fieldClass} type="password" autoComplete="off" required={adapter === 'telegram'} disabled={busy} /></label>
            <p className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]">{t('Integrations.custody')}</p>
            {adapter === 'telegram' ? <p className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]">{t('Integrations.telegramMode')}</p> : null}
            <Button type="submit" tone="primary" disabled={busy || !name.trim()}>{t(busy ? 'Integrations.working' : 'Integrations.connect')}</Button>
          </form>
        </Surface>
        <Surface tone="panel" padding="none" className="rounded-2xl p-5">
          <h2 className="font-semibold">{t('Integrations.allowApps')}</h2><p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{t('Integrations.permissionHelp')}</p>
          <label className="mt-4 flex flex-col gap-1.5 text-sm">{t('Integrations.target')}<select className={fieldClass} value={targetRef} onChange={event => { setTargetRef(event.target.value); setConsumers([]); setOperations([]); }} disabled={busy}><option value="">{t('Integrations.selectTarget')}</option>{snapshot?.targets.map(item => <option key={item.targetRef} value={item.targetRef}>{item.displayName}{item.accountLabel ? ` · ${item.accountLabel}` : ''}</option>)}</select></label>
          {target ? <>
            <p className="mt-3 text-sm text-[var(--nimi-text-secondary)]">{t(target.available ? 'Integrations.available' : target.kind === 'telegram' ? 'Integrations.verificationRequired' : 'Integrations.providerOffline')}</p>
            {target.kind === 'telegram' && !target.available ? <Button className="mt-3" tone="secondary" size="sm" disabled={busy} onClick={() => void run(async () => {
              await sdk.appProduct().integration.putConnection({ targetRef: target.targetRef, adapter: 'telegram', endpoint: '', displayName: target.displayName, accountLabel: target.accountLabel, secret: '' });
              setNotice(t('Integrations.verified'));
            })}>{t('Integrations.verifyConnection')}</Button> : null}
            <fieldset className="mt-4 flex flex-col gap-2"><legend className="mb-2 text-sm font-medium">{t('Integrations.operations')}</legend>{target.operations.map(op => (
              <div key={op.name} className="rounded-xl border border-[var(--nimi-border-subtle)] p-3">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={operations.includes(op.name)} disabled={busy} onChange={() => setOperations(current => toggle(current, op.name))} />
                  <span className="min-w-0 flex-1"><span className="block font-medium">{op.name}</span><span className="mt-1 block text-xs leading-relaxed text-[var(--nimi-text-secondary)]">{op.description.length > 180 ? `${op.description.slice(0, 180)}…` : op.description}</span></span>
                  <span className="shrink-0 text-xs text-[var(--nimi-text-secondary)]">{t(op.effect === 'write' ? 'Integrations.write' : 'Integrations.read')}</span>
                </label>
                <details className="ml-6 mt-2 text-xs text-[var(--nimi-text-secondary)]"><summary className="cursor-pointer">{t('Integrations.operationDetails')}</summary><p className="mt-2 whitespace-pre-wrap leading-relaxed">{op.description}</p></details>
              </div>
            ))}</fieldset>
            <fieldset className="mt-4 flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">{t('Integrations.apps')}</legend>
              {snapshot?.consumers.map(app => <label key={app.consumerRef} className="flex items-center gap-2 rounded-lg py-1 text-sm">
                <input type="checkbox" checked={consumers.includes(app.consumerRef)} disabled={busy} onChange={() => setConsumers(current => toggle(current, app.consumerRef))} />
                <span><span className="block">{app.displayName || app.appId}</span><span className="mt-0.5 block text-xs text-[var(--nimi-text-secondary)]">{describeInstance(app, app.consumerRef)}</span></span>
              </label>)}
            </fieldset>
            <Button className="mt-5" tone="primary" disabled={busy || !consumers.length || !operations.length} onClick={() => void run(async () => { for (const consumerRef of consumers) await sdk.appProduct().integration.setPermission({ consumerRef, targetRef, operations }); setNotice(t('Integrations.allowed')); })}>{t('Integrations.allowSelected')}</Button>
          </> : <p className="mt-4 text-sm text-[var(--nimi-text-secondary)]">{t('Integrations.empty')}</p>}
        </Surface>
      </div>
      <Surface tone="panel" padding="none" className="rounded-2xl p-5">
        <h2 className="font-semibold">{t('Integrations.existingPermissions')}</h2>
        <div className="mt-3 divide-y divide-[var(--nimi-border-subtle)]">{snapshot?.permissions.filter(permission => permission.operations.length).map(permission => {
          const eligible = snapshot.consumers.find(app => app.consumerRef === permission.consumerRef);
          const app = eligible || permission.consumer || undefined;
          const source = snapshot.targets.find(item => item.targetRef === permission.targetRef);
          return <div className="flex items-center justify-between gap-4 py-3" key={`${permission.consumerRef}/${permission.targetRef}`}>
            <div className="min-w-0 text-sm">
              <p className="font-medium">{app?.displayName || app?.appId || t('Integrations.unavailableApp')} · {source?.displayName || t('Integrations.unavailableTarget')}</p>
              <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{describeInstance(app, permission.consumerRef)}{source?.accountLabel ? ` · ${source.accountLabel}` : ''}</p>
              {!eligible ? <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{t('Integrations.unavailablePermissionConsumer')}</p> : null}
              {source && !source.available ? <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{t('Integrations.unavailablePermissionSource')}</p> : null}
              <p className="mt-1 break-words text-xs text-[var(--nimi-text-secondary)]">{permission.operations.join(', ')}</p>
            </div>
            <Button tone="secondary" size="sm" disabled={busy} onClick={() => void run(async () => { await sdk.appProduct().integration.setPermission({ consumerRef: permission.consumerRef, targetRef: permission.targetRef, operations: [] }); })}>{t('Integrations.revoke')}</Button>
          </div>;
        })}</div>
        {snapshot && !snapshot.permissions.some(permission => permission.operations.length) ? <p className="mt-3 text-sm text-[var(--nimi-text-secondary)]">{t('Integrations.noPermissions')}</p> : null}
      </Surface>
      <Surface tone="panel" padding="none" className="rounded-2xl p-5">
        <h2 className="font-semibold">{t('Integrations.calls')}</h2><p className="mt-2 text-xs text-[var(--nimi-text-secondary)]">{t('Integrations.recordsHelp')}</p>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="text-xs text-[var(--nimi-text-secondary)]"><tr><th className="py-2 pr-3">{t('Integrations.app')}</th><th className="py-2 pr-3">{t('Integrations.target')}</th><th className="py-2 pr-3">{t('Integrations.operation')}</th><th className="py-2 pr-3">{t('Integrations.time')}</th><th className="py-2">{t('Integrations.result')}</th></tr></thead>
          <tbody>{snapshot?.calls.map(call => <tr key={call.callId} className="border-t border-[var(--nimi-border-subtle)] align-top">
            <td className="py-3 pr-3"><p>{call.consumerDisplayName || t('Integrations.unknownAttribution')}</p><details className="mt-1 text-xs text-[var(--nimi-text-secondary)]"><summary className="cursor-pointer">{t('Integrations.callReference')}</summary><code className="mt-1 block break-all">{call.callId}</code></details></td>
            <td className="py-3 pr-3"><p>{call.targetDisplayName || t('Integrations.unknownAttribution')}</p>{call.accountLabel ? <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{call.accountLabel}</p> : null}</td>
            <td className="py-3 pr-3 break-words">{call.operation}</td>
            <td className="py-3 pr-3 text-xs"><time dateTime={call.createdAt || undefined}>{callTime(call.createdAt)}</time>{call.updatedAt && call.updatedAt !== call.createdAt ? <p className="mt-1 text-[var(--nimi-text-secondary)]">{t('Integrations.updatedAt', { time: callTime(call.updatedAt) })}</p> : null}</td>
            <td className="py-3"><span>{t(`Integrations.states.${call.status}`)}</span>{call.errorCode ? <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{call.errorCode}</p> : null}</td>
          </tr>)}</tbody>
        </table></div>
        {snapshot && !snapshot.calls.length ? <p className="mt-3 text-sm text-[var(--nimi-text-secondary)]">{t('Integrations.noCalls')}</p> : null}
      </Surface>
    </div>
  );
}
