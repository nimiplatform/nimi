import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, InlineAlert, LoadingSkeleton, Surface } from '@nimiplatform/kit/ui';
import type { NimiIntegrationConsumer, NimiIntegrationManagement, NimiIntegrationConnectionConfig, NimiIntegrationConnectionSetup, NimiIntegrationTarget } from '@nimiplatform/sdk/app';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { integrationErrorCode, integrationErrorTranslationKey } from './integration-error.js';
import { IntegrationSetupQr } from './integration-setup-qr.js';
import { integrationSetupPending, observeIntegrationSetup } from './integration-setup-observer.js';
import { integrationOperationPresentation } from './integration-operation-presentation.js';

const fieldClass = 'w-full rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-sm text-[var(--nimi-text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]';
type PermissionIntent = Readonly<{ target: NimiIntegrationTarget; consumers: readonly string[]; operations: readonly string[] }>;

// @nimi-authority: rule.nimi.runtime.integration.fixed-operations
// Home projects Runtime-owned connection and standing resource policy. Merely
// displaying this form or declaring integration.manage grants no authority.
// @nimi-authority: rule.nimi.runtime.integration.qq-onebot-protocol
export function IntegrationsPanel({ onBack }: { onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const [snapshot, setSnapshot] = useState<NimiIntegrationManagement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adapter, setAdapter] = useState('mcp');
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [appId, setAppId] = useState('');
  const [feishuMode, setFeishuMode] = useState<'manual' | 'create'>('manual');
  const [listener, setListener] = useState('127.0.0.1:6700');
  const [selfId, setSelfId] = useState('');
  const [setup, setSetup] = useState<NimiIntegrationConnectionSetup | null>(null);
	const [expiredSetupId, setExpiredSetupId] = useState('');
	const expiredSetupRef = useRef('');
	const runVersion = useRef(0);
	const setupActive = Boolean(setup && setup.setupId !== expiredSetupId && integrationSetupPending(setup.status));
	const [refreshRef, setRefreshRef] = useState('');
	const verificationCode = useRef<HTMLInputElement>(null);
  const setupRef = useRef<NimiIntegrationConnectionSetup | null>(null);
  setupRef.current = setup;
  const secret = useRef<HTMLInputElement>(null);
  const resetSetupInputs = () => {
    if (secret.current) secret.current.value = '';
    if (verificationCode.current) verificationCode.current.value = '';
    runVersion.current++; setupRef.current=null; expiredSetupRef.current='';
    setSetup(null);setExpiredSetupId('');setError('');setNotice('');
  };
  const [targetRef, setTargetRef] = useState('');
  const editorVersion = useRef(0);
  const setupEditorVersion = useRef(0);
  const editorTarget = useRef('');
  const setupMaySelect = useRef(false);
  const [consumers, setConsumers] = useState<string[]>([]);
  const [operations, setOperations] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<
    | { readonly kind: 'remove'; readonly targetRef: string; readonly name: string }
    | { readonly kind: 'narrow'; readonly intent: PermissionIntent; readonly changes: readonly { readonly app: string; readonly removed: readonly string[] }[] }
    | null
  >(null);
  const selectTarget = (value: string) => {
    editorVersion.current++;
    editorTarget.current = value;
    setTargetRef(value); setConsumers([]); setOperations([]); setConfirming(null);
  };
  const active = useRef(true);
  const load = useCallback(async () => {
    const data = await sdk.appProduct().integration.getManagement();
    if (active.current) setSnapshot(data);
  }, [sdk]);
  const showError = (cause: unknown) => {
    if (!active.current) return;
    const code = integrationErrorCode(cause);
    setError(code ? t(integrationErrorTranslationKey(code, adapter), { defaultValue: t('Integrations.unavailable') }) : t('Integrations.unavailable'));
  };
  // Mutation replies belong to one request and one setup. React state updates
  // alone cannot provide this fence because a second reply may arrive before
  // React has committed the first update.
  const applySetupReply = useCallback((next: NimiIntegrationConnectionSetup, version: number, expectedId?: string) => {
    if (!active.current || runVersion.current !== version) return false;
    if (expectedId && (setupRef.current?.setupId !== expectedId || next.setupId !== expectedId || expiredSetupRef.current === expectedId)) return false;
    const deadline = Date.parse(next.expiresAt || '');
    const currentDeadline = expectedId ? Date.parse(setupRef.current?.expiresAt || '') : deadline;
    if (!Number.isFinite(deadline) || !Number.isFinite(currentDeadline) || Date.now() >= Math.min(deadline, currentDeadline)) return false;
    const originalTargetRef = setupRef.current?.targetRef || '';
    setupRef.current = next;
    setSetup(next);
    if (next.status === 'completed') {
      const changedTarget = next.targetRef !== originalTargetRef;
      if (setupMaySelect.current && editorVersion.current === setupEditorVersion.current) {
        if (changedTarget) selectTarget(next.targetRef);
        else if (editorTarget.current !== next.targetRef) selectTarget(next.targetRef);
      }
      if (changedTarget) { setRefreshRef(''); setName(''); }
      setNotice(t(originalTargetRef && changedTarget ? 'Integrations.newConnectionCreated' : 'Integrations.connected'));
      void load().catch(showError);
    }
    if (next.status === 'already-bound') { if (setupMaySelect.current && editorVersion.current === setupEditorVersion.current && editorTarget.current !== next.targetRef) selectTarget(next.targetRef); setNotice(t('Integrations.alreadyBound')); void load().catch(showError); }
    return true;
  }, [load, t]);
  useEffect(() => {
    active.current = true;
    void load().catch(showError);
    return () => {
      runVersion.current++;
      active.current = false; if (secret.current) secret.current.value = '';
      if (verificationCode.current) verificationCode.current.value = '';
      const pending = setupRef.current;
      if (pending && integrationSetupPending(pending.status)) void sdk.appProduct().integration.cancelConnectionSetup({ setupId: pending.setupId }).catch(() => {});
      setupRef.current = null;
    };
  }, [load]);
  useEffect(() => {
    if (!setup || !setupActive) return;
    return observeIntegrationSetup({
      setup,
      query: () => sdk.appProduct().integration.getConnectionSetup({ setupId: setup.setupId }),
      update: next => {
        if (!applySetupReply(next, runVersion.current, setup.setupId)) return;
      },
      error: showError,
      expired: () => {
        if (!active.current) return;
        runVersion.current++;
        setBusy(false);
        setExpiredSetupId(setup.setupId);
        expiredSetupRef.current = setup.setupId;
        if (setupRef.current?.setupId === setup.setupId) setupRef.current = { ...setupRef.current, verificationUrl: '' };
        setSetup(current => current?.setupId === setup.setupId ? { ...current, verificationUrl: '' } : current);
        if (verificationCode.current) verificationCode.current.value = '';
        if (secret.current) secret.current.value = '';
      },
    });
  }, [setup, setupActive, sdk, load, t, applySetupReply]);
  const run = async (action: (version: number) => Promise<void>) => {
    const version = ++runVersion.current;
    setBusy(true); setError(''); setNotice('');
    try { await action(version); if (version === runVersion.current) await load(); }
    catch (cause) { if (version === runVersion.current) { showError(cause); await load().catch(() => {}); } }
    finally { if (active.current && version === runVersion.current) setBusy(false); }
  };
  const target = snapshot?.targets.find(item => item.targetRef === targetRef);
  const describeInstance = (app: NimiIntegrationConsumer | undefined, consumerRef: string) =>
    `${t(`Integrations.sourceKinds.${app?.sourceKind || 'unknown'}`)} · ${t('Integrations.instance', { id: consumerRef.slice(-8) })}`;
  const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(item => item !== value) : [...values, value];
  // Saving replaces a consumer's allowed set, so the form starts from what is allowed now.
  const allowedFor = (consumerRef: string) => snapshot?.permissions.find(item => item.consumerRef === consumerRef && item.targetRef === targetRef)?.operations ?? [];
  const toggleConsumer = (consumerRef: string) => {
    const next = toggle(consumers, consumerRef);
    setConsumers(next);
    if (operations.length === 0 && next.length === 1) setOperations([...allowedFor(next[0]!)]);
  };
  const appName = (consumerRef: string) => {
    const app = snapshot?.consumers.find(item => item.consumerRef === consumerRef);
    return app?.displayName || app?.appId || t('Integrations.unavailableApp');
  };
  const savePermissions = (intent: PermissionIntent) => run(async () => {
    for (const consumerRef of intent.consumers) await sdk.appProduct().integration.setPermission({ consumerRef, targetRef: intent.target.targetRef, operations: [...intent.operations] });
    setNotice(t('Integrations.allowed'));
  });
  const requestSave = () => {
    if (!target) return;
    const intent: PermissionIntent = Object.freeze({ target, consumers: Object.freeze([...consumers]), operations: Object.freeze([...operations]) });
    const changes = consumers
      .map(consumerRef => ({ app: appName(consumerRef), removed: allowedFor(consumerRef).filter(op => !operations.includes(op)) }))
      .filter(change => change.removed.length > 0);
    if (changes.length > 0) setConfirming({ kind: 'narrow', intent, changes });
    else void savePermissions(intent);
  };
  const removeConnection = (removeRef: string) => run(async () => {
    await sdk.appProduct().integration.removeConnection({ targetRef: removeRef });
    if (active.current) { selectTarget(''); setNotice(t('Integrations.removed')); }
  });
  const callTime = (value: string | null) => value ? new Date(value).toLocaleString(i18n.language) : t('Integrations.unknownTime');
  const operationName = (name:string, source=target) => {
    const op=source?.operations.find(item=>item.name===name);
    return op&&source?integrationOperationPresentation(source.kind,op,t).name:name;
  };
  const connect = async (version: number) => {
    setupEditorVersion.current = editorVersion.current;
    setupMaySelect.current = !refreshRef || editorTarget.current === refreshRef;
    const credential = secret.current?.value ?? '';
    if (secret.current) secret.current.value = '';
    const config: NimiIntegrationConnectionConfig = adapter === 'mcp' ? { mcp: { endpoint: endpoint.trim() } } : adapter === 'telegram' ? { telegram: {} } : adapter === 'weixin' ? { weixin: {} } : adapter === 'feishu' ? feishuMode === 'create' ? { feishu: { setupMode: 'create' } } : { feishu: { setupMode: 'manual', appId: appId.trim() } } : adapter === 'qq-official' ? { qqOfficial: { appId: appId.trim() } } : { onebotV11: { listener: listener.trim(), selfId: selfId.trim() } };
    const started = await sdk.appProduct().integration.startConnectionSetup({ targetRef: refreshRef, adapter, ...(adapter === 'weixin' ? {} : { displayName: name.trim() }), accountLabel: '', config });
    if (!applySetupReply(started, version)) {
      if (integrationSetupPending(started.status)) await sdk.appProduct().integration.cancelConnectionSetup({ setupId: started.setupId }).catch(() => {});
      return;
    }
    if (started.status === 'awaiting-input' && adapter !== 'weixin') {
      const submitted = await sdk.appProduct().integration.submitConnectionSetup({ setupId: started.setupId, secret: credential, verificationCode: '' });
      applySetupReply(submitted, version, started.setupId);
    }
  };
  const submitVerification = () => {
    const code = verificationCode.current?.value || '';
    if (!/^[0-9]{1,32}$/u.test(code)) {
      setError(t('Integrations.verificationInvalid'));
      verificationCode.current?.focus();
      return;
    }
    void run(async version => {
      if (verificationCode.current) verificationCode.current.value = '';
      const next = await sdk.appProduct().integration.submitConnectionSetup({ setupId: setup!.setupId, secret: '', verificationCode: code });
      applySetupReply(next, version, setup!.setupId);
    });
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
          <h2 className="font-semibold">{t(refreshRef ? 'Integrations.refreshConnection' : 'Integrations.addConnection')}</h2>
          {refreshRef ? <><p className="mt-2 text-sm">{t(adapter === 'weixin' ? 'Integrations.weixinRefreshHelp' : 'Integrations.refreshIdentityHelp')}</p><Button className="mt-2" tone="secondary" disabled={busy || setupActive} onClick={() => { resetSetupInputs();setRefreshRef(''); }}>{t('Integrations.addInstead')}</Button></> : null}
          <form className="mt-4 flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void run(connect); }}>
            <label className="flex flex-col gap-1.5 text-sm">{t('Integrations.kind')}<select className={fieldClass} value={adapter} onChange={event => { resetSetupInputs();setAdapter(event.target.value); }} disabled={busy || Boolean(refreshRef) || setupActive}>{['mcp','telegram','weixin','feishu','qq-official','onebot-v11'].map(id => <option key={id} value={id}>{t(`Integrations.adapters.${id}`)}</option>)}</select></label>
            {adapter !== 'weixin' ? <label className="flex flex-col gap-1.5 text-sm">{t('Integrations.name')}<input className={fieldClass} value={name} onChange={event => setName(event.target.value)} maxLength={256} required disabled={busy} /></label> : <p className="text-sm text-[var(--nimi-text-secondary)]">{t('Integrations.weixinSetupHelp')}</p>}
            {adapter === 'mcp' ? <label className="flex flex-col gap-1.5 text-sm">{t('Integrations.endpoint')}<input className={fieldClass} type="url" value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="https://example.com/mcp" required disabled={busy} /></label> : null}
            {adapter === 'feishu' ? <label className="flex flex-col gap-1.5 text-sm">{t('Integrations.feishuSetup')}<select className={fieldClass} value={feishuMode} onChange={event=>{resetSetupInputs();setFeishuMode(event.target.value as 'manual'|'create');}} disabled={busy || Boolean(refreshRef) || setupActive}><option value="manual">{t('Integrations.feishuManual')}</option><option value="create">{t('Integrations.feishuCreate')}</option></select></label> : null}
            {(adapter === 'feishu' && feishuMode === 'manual') || adapter === 'qq-official' ? <label className="flex flex-col gap-1.5 text-sm">{t('Integrations.appId')}<input className={fieldClass} value={appId} onChange={event => setAppId(event.target.value)} maxLength={256} required disabled={busy} /></label> : null}
            {adapter === 'onebot-v11' ? <><label className="flex flex-col gap-1.5 text-sm">{t('Integrations.listener')}<input className={fieldClass} value={listener} onChange={event => setListener(event.target.value)} maxLength={256} required disabled={busy} /></label><label className="flex flex-col gap-1.5 text-sm">{t('Integrations.selfId')}<input className={fieldClass} value={selfId} onChange={event => setSelfId(event.target.value)} maxLength={256} required disabled={busy} /></label></> : null}
            {adapter !== 'weixin' && !(adapter === 'feishu' && feishuMode === 'create') ? <label className="flex flex-col gap-1.5 text-sm">{t(adapter === 'telegram' ? 'Integrations.botToken' : ['feishu','qq-official'].includes(adapter) ? 'Integrations.appSecret' : adapter === 'onebot-v11' ? 'Integrations.requiredToken' : 'Integrations.bearerToken')}<input key={`${adapter}:${feishuMode}:${refreshRef}`} ref={secret} className={fieldClass} type="password" autoComplete="off" required={adapter !== 'mcp'} disabled={busy} /></label> : null}
            <p className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]">{t('Integrations.custody')}</p>
            {adapter === 'feishu' ? <div className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]"><p>{t('Integrations.feishuManualHelp')}</p><details className="mt-2"><summary>{t('Integrations.operationDetails')}</summary><p className="mt-2">{t('Integrations.feishuScopeHelp')}</p></details></div> : null}
            {adapter === 'telegram' ? <p className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]">{t('Integrations.telegramMode')}</p> : null}
            {adapter === 'qq-official' ? <p className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]">{t('Integrations.qqMode')}</p> : null}
            {adapter === 'onebot-v11' ? <div className="text-xs leading-relaxed text-[var(--nimi-text-secondary)]"><p>{t('Integrations.onebotMode')}</p><details className="mt-2"><summary>{t('Integrations.operationDetails')}</summary><p className="mt-2">{t('Integrations.onebotProtocolHelp')}</p></details></div> : null}
            {setup ? <div className="rounded-xl border border-[var(--nimi-border-subtle)] p-3 text-sm" data-testid="integration-setup"><p>{setup.setupId === expiredSetupId ? t('Integrations.setupObservationExpired') : t(`Integrations.setupStates.${setup.status}`)}</p>{setupActive ? <p>{t('Integrations.setupExpires', { time: callTime(setup.expiresAt) })}</p> : null}{setup.accountLabel ? <p>{setup.accountLabel}</p> : null}{setup.verificationUrl ? <><IntegrationSetupQr value={setup.verificationUrl} label={t('Integrations.scanQr')} /><a className="mt-2 block underline" href={setup.verificationUrl} target="_blank" rel="noreferrer">{t('Integrations.verifyLink')}</a></> : null}{setupActive && setup.adapter === 'weixin' && setup.status === 'awaiting-input' ? <><label className="mt-3 block">{t('Integrations.verificationCode')}<input ref={verificationCode} className={fieldClass} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]+" maxLength={32} aria-invalid={error === t('Integrations.verificationInvalid')} disabled={busy} /></label><Button className="mt-2" disabled={busy} onClick={submitVerification}>{t('Integrations.submitVerification')}</Button></> : null}{setupActive && setup.status === 'awaiting-new-target' ? <><p className="mt-3">{t('Integrations.newTargetConfirmation')}</p><Button type="button" className="mt-3" tone="primary" disabled={busy} onClick={() => void run(async version => { const next = await sdk.appProduct().integration.submitConnectionSetup({ setupId: setup.setupId, secret: '', verificationCode: '', action: 'create-new-target' }); applySetupReply(next, version, setup.setupId); })}>{t('Integrations.confirmNewTarget')}</Button></> : null}{setup.errorCode ? <p>{t(integrationErrorTranslationKey(setup.errorCode, setup.adapter), { defaultValue: t('Integrations.unavailable') })}</p> : null}{setupActive ? <Button className="mt-2" tone="secondary" disabled={busy} onClick={() => void run(async version => { const next = await sdk.appProduct().integration.cancelConnectionSetup({ setupId: setup.setupId }); applySetupReply(next, version, setup.setupId); })}>{t('Integrations.cancelSetup')}</Button> : null}</div> : null}
            <Button type="submit" tone="primary" disabled={busy || (adapter !== 'weixin' && !name.trim()) || setupActive}>{t(busy ? 'Integrations.working' : refreshRef ? 'Integrations.refreshConnection' : 'Integrations.connect')}</Button>
          </form>
        </Surface>
        <Surface tone="panel" padding="none" className="rounded-2xl p-5">
          <h2 className="font-semibold">{t('Integrations.allowApps')}</h2><p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{t('Integrations.permissionHelp')}</p>
          <label className="mt-4 flex flex-col gap-1.5 text-sm">{t('Integrations.target')}<select className={fieldClass} value={targetRef} onChange={event => selectTarget(event.target.value)} disabled={busy}><option value="">{t('Integrations.selectTarget')}</option>{snapshot?.targets.map(item => <option key={item.targetRef} value={item.targetRef}>{item.displayName}{item.accountLabel && !item.displayName.includes(item.accountLabel) ? ` · ${item.accountLabel}` : ''}</option>)}</select></label>
          {target ? <>
            <p className="mt-3 text-sm text-[var(--nimi-text-secondary)]">{t(target.available ? 'Integrations.available' : target.kind === 'telegram' ? 'Integrations.verificationRequired' : 'Integrations.providerOffline')}</p>
            {target.kind !== 'app' ? <Button className="mt-3" tone="danger" size="sm" disabled={busy} onClick={() => setConfirming({ kind: 'remove', targetRef: target.targetRef, name: target.displayName })}>{t('Integrations.removeConnection')}</Button> : null}
            {['weixin','feishu','qq-official','onebot-v11'].includes(target.kind) ? <Button className="ml-2 mt-3" tone="secondary" size="sm" disabled={busy || setupActive} onClick={() => { resetSetupInputs();setRefreshRef(target.targetRef); setAdapter(target.kind); setName(target.displayName); setFeishuMode('manual'); setAppId('');setSelfId('');setListener(''); }}>{t('Integrations.refreshConnection')}</Button> : null}
            {target.kind === 'telegram' && !target.available ? <Button className="mt-3" tone="secondary" size="sm" disabled={busy} onClick={() => void run(async () => {
              await sdk.appProduct().integration.putConnection({ targetRef: target.targetRef, adapter: 'telegram', config: { telegram: {} }, displayName: target.displayName, accountLabel: target.accountLabel, secret: '' });
              setNotice(t('Integrations.verified'));
            })}>{t('Integrations.verifyConnection')}</Button> : null}
            <fieldset className="mt-4 flex flex-col gap-2"><legend className="mb-2 text-sm font-medium">{t('Integrations.operations')}</legend>{target.operations.map(op => {const display=integrationOperationPresentation(target.kind,op,t);return (
              <div key={op.name} className="rounded-xl border border-[var(--nimi-border-subtle)] p-3">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={operations.includes(op.name)} disabled={busy} onChange={() => setOperations(current => toggle(current, op.name))} />
                  <span className="min-w-0 flex-1"><span className="block font-medium">{display.name}</span><span className="mt-1 block text-xs leading-relaxed text-[var(--nimi-text-secondary)]">{display.summary}</span></span>
                  <span className="shrink-0 text-xs text-[var(--nimi-text-secondary)]">{t(op.effect === 'write' ? 'Integrations.write' : 'Integrations.read')}</span>
                </label>
                <details className="ml-6 mt-2 text-xs text-[var(--nimi-text-secondary)]"><summary className="cursor-pointer">{t('Integrations.operationDetails')}</summary><p className="mt-2 break-all">{op.name}</p><p className="mt-2">{t('Integrations.descriptorSource',{source:target.displayName})}</p><p className="mt-2 whitespace-pre-wrap leading-relaxed">{op.description}</p></details>
              </div>
            );})}</fieldset>
            <fieldset className="mt-4 flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">{t('Integrations.apps')}</legend>
              {snapshot?.consumers.map(app => <label key={app.consumerRef} className="flex items-center gap-2 rounded-lg py-1 text-sm">
                <input type="checkbox" checked={consumers.includes(app.consumerRef)} disabled={busy} onChange={() => toggleConsumer(app.consumerRef)} />
                <span><span className="block">{app.displayName || app.appId}</span><span className="mt-0.5 block text-xs text-[var(--nimi-text-secondary)]">{describeInstance(app, app.consumerRef)}</span>
                  <span className="mt-0.5 block break-words text-xs text-[var(--nimi-text-secondary)]">{allowedFor(app.consumerRef).length ? t('Integrations.currentOperations', { operations: allowedFor(app.consumerRef).map(name=>operationName(name)).join(', ') }) : t('Integrations.noCurrentOperations')}</span></span>
              </label>)}
            </fieldset>
            <Button className="mt-5" tone="primary" disabled={busy || !consumers.length || !operations.length} onClick={requestSave}>{t('Integrations.allowSelected')}</Button>
          </> : <p className="mt-4 text-sm text-[var(--nimi-text-secondary)]">{t(snapshot?.targets.length?'Integrations.selectExistingTarget':'Integrations.empty')}</p>}
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
              <p className="mt-1 break-words text-xs text-[var(--nimi-text-secondary)]">{permission.operations.map(name=>operationName(name,source)).join(', ')}</p>
            </div>
            <Button tone="secondary" size="sm" disabled={busy} onClick={() => void run(async () => { await sdk.appProduct().integration.setPermission({ consumerRef: permission.consumerRef, targetRef: permission.targetRef, operations: [] }); })}>{t('Integrations.revoke')}</Button>
          </div>;
        })}</div>
        {snapshot && !snapshot.permissions.some(permission => permission.operations.length) ? <p className="mt-3 text-sm text-[var(--nimi-text-secondary)]">{t('Integrations.noPermissions')}</p> : null}
      </Surface>
      <ConfirmDialog
        open={confirming !== null}
        title={confirming?.kind === 'remove' ? t('Integrations.removeTitle', { name: confirming.name }) : t('Integrations.narrowTitle')}
        message={confirming?.kind === 'remove' ? t('Integrations.removeBody') : confirming?.kind === 'narrow' ? <div className="flex flex-col gap-2">
          <p>{confirming.intent.target.displayName}</p>
          <p>{t('Integrations.narrowBody')}</p>
          <ul className="list-disc pl-5">{confirming.changes.map(change => <li key={change.app}>{t('Integrations.narrowChange', { app: change.app, operations: change.removed.map(name=>operationName(name,confirming.intent.target)).join(', ') })}<details className="mt-1 text-xs"><summary>{t('Integrations.operationDetails')}</summary><p className="mt-1 break-all">{change.removed.join(', ')}</p></details></li>)}</ul>
        </div> : null}
        confirmLabel={confirming?.kind === 'remove' ? t('Integrations.removeConfirm') : t('Integrations.narrowConfirm')}
        cancelLabel={t('Integrations.cancel')}
        confirmTone="danger"
        loading={busy}
        onConfirm={() => {
          const current = confirming; setConfirming(null);
          if (current?.kind === 'remove') void removeConnection(current.targetRef);
          else if (current?.kind === 'narrow') void savePermissions(current.intent);
        }}
        onClose={() => setConfirming(null)}
      />
      <Surface tone="panel" padding="none" className="rounded-2xl p-5">
        <h2 className="font-semibold">{t('Integrations.calls')}</h2><p className="mt-2 text-xs text-[var(--nimi-text-secondary)]">{t('Integrations.recordsHelp')}</p>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="text-xs text-[var(--nimi-text-secondary)]"><tr><th className="py-2 pr-3">{t('Integrations.app')}</th><th className="py-2 pr-3">{t('Integrations.target')}</th><th className="py-2 pr-3">{t('Integrations.operation')}</th><th className="py-2 pr-3">{t('Integrations.time')}</th><th className="py-2">{t('Integrations.result')}</th></tr></thead>
          <tbody>{snapshot?.calls.map(call => <tr key={call.callId} className="border-t border-[var(--nimi-border-subtle)] align-top">
            <td className="py-3 pr-3"><p>{call.consumerDisplayName || t('Integrations.unknownAttribution')}</p><details className="mt-1 text-xs text-[var(--nimi-text-secondary)]"><summary className="cursor-pointer">{t('Integrations.callReference')}</summary><code className="mt-1 block break-all">{call.callId}</code></details></td>
            <td className="py-3 pr-3"><p>{call.targetDisplayName || t('Integrations.unknownAttribution')}</p>{call.accountLabel ? <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{call.accountLabel}</p> : null}</td>
            <td className="py-3 pr-3 break-words">{call.operation}</td>
            <td className="py-3 pr-3 text-xs"><time dateTime={call.createdAt || undefined}>{callTime(call.createdAt)}</time>{call.updatedAt && call.updatedAt !== call.createdAt ? <p className="mt-1 text-[var(--nimi-text-secondary)]">{t('Integrations.updatedAt', { time: callTime(call.updatedAt) })}</p> : null}</td>
            <td className="py-3"><span>{t(`Integrations.states.${call.status}`)}</span>{call.errorCode ? <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{t(`Integrations.errors.${call.errorCode}`, { defaultValue: call.errorCode })}</p> : null}</td>
          </tr>)}</tbody>
        </table></div>
        {snapshot && !snapshot.calls.length ? <p className="mt-3 text-sm text-[var(--nimi-text-secondary)]">{t('Integrations.noCalls')}</p> : null}
      </Surface>
    </div>
  );
}
