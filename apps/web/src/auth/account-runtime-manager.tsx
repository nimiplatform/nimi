import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { completeRuntimeClientLogin, matchesRuntimeClientCallback, prepareRuntimeClientLogin, type RuntimeClientLoginOptions, type RuntimeClientLoginTransaction, type RuntimeClientSession } from '@nimiplatform/sdk/realm/runtime-client';
import type { RemoteRuntimeConnection } from '@nimiplatform/sdk/runtime/remote';
import { RemoteSourceAccessState, RuntimeServiceMode, type GetRemoteAccessStateResponse } from '@nimiplatform/sdk/runtime/wire-types';
import type { NimiAIConfigSnapshot } from '@nimiplatform/sdk/ai';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { createWebBrowserRealm, webRealmOrigin } from './browser-realm.js';
import { loadWebCurrentAccount } from './web-account-adapter.js';
import { AccountFeedback } from './account-center-layout.js';

type ManagerConnection = Extract<RemoteRuntimeConnection, { role: 'official_manager' }>;
type Login = { accountId: string; options: Omit<RuntimeClientLoginOptions, 'currentUserContext' | 'fetch'>; transaction: RuntimeClientLoginTransaction };
const storageKey = 'nimi:runtime-manager:login';

// @nimi-authority: rule.nimi.platform.product-lifecycle.remote-runtime-management
export function AccountRuntimeManager({ accountId }: { accountId: string }) {
  const { i18n } = useTranslation(), navigate = useNavigate();
  const zh = i18n.language.startsWith('zh'), say = (cn: string, en: string) => zh ? cn : en;
  const clientId = String(import.meta.env.VITE_NIMI_RUNTIME_MANAGER_CLIENT_ID || '').trim();
  const realmEnvironmentId = String(import.meta.env.VITE_NIMI_REALM_ENVIRONMENT_ID || '').trim();
  const [connection, setConnection] = useState<ManagerConnection | null>(null);
  const [access, setAccess] = useState<GetRemoteAccessStateResponse | null>(null);
  const [state, setState] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [appId, setAppId] = useState('');
  const [config, setConfig] = useState<NimiAIConfigSnapshot | null>(null);
  const [configSaved, setConfigSaved] = useState(false);
  const mounted = useRef(true), generation = useRef<string | null>(null), session = useRef<RuntimeClientSession | null>(null);
  const peer = useRef<ManagerConnection | null>(null), connecting = useRef<AbortController | null>(null), working = useRef(false);
  const selectedApp = useRef('');
  function close() {
    generation.current = null; connecting.current?.abort(); connecting.current = null;
    peer.current?.close(); peer.current = null;
    if (session.current) void session.current.end().catch(reason => { if (mounted.current) setError(String(reason.message)); });
    session.current = null;
    if (mounted.current) { setConnection(null); setAccess(null); setConfig(null); setConfigSaved(false); }
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; close(); };
  }, [accountId]);
  async function action(work: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(null);
    try { await work(); }
    catch (reason) { if (mounted.current) { const fields = extractNimiErrorFields(reason); setError(`${reason instanceof Error ? reason.message : String(reason)}${fields.reasonCode ? ` (${fields.reasonCode})` : ''}`); } }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  }
  async function verifyOwner() {
    const owner = await loadWebCurrentAccount();
    if (!mounted.current || owner?.id !== accountId) { close(); throw new Error(say('账号已改变，请重新登录。', 'The account changed. Sign in again.')); }
  }
  async function connect() {
    await verifyOwner();
    const callback = new URL(window.location.href);
    if (!session.current && (callback.searchParams.has('code') || callback.searchParams.has('error'))) {
      const stored = sessionStorage.getItem(storageKey);
      navigate('/account/runtime', { replace: true });
      if (!stored) throw new Error(say('管理登录已失效，请重新验证。', 'Management sign-in expired. Verify again.'));
      const saved = JSON.parse(stored) as Login;
      if (saved.accountId !== accountId || saved.options.realmEnvironmentId !== realmEnvironmentId || saved.options.clientId !== clientId
        || saved.options.realmBaseUrl !== webRealmOrigin() || saved.options.officialWebBaseUrl !== window.location.origin
        || saved.options.redirectUri !== new URL('/account/runtime', window.location.origin).href) throw new Error('Management sign-in context changed.');
      if (!matchesRuntimeClientCallback(callback.href, saved.transaction.redirectUri) || callback.searchParams.get('state') !== saved.transaction.state) {
        throw new Error(say('此回调与当前管理登录不匹配。', 'This callback does not match the current management sign-in.'));
      }
      sessionStorage.removeItem(storageKey);
      generation.current = saved.transaction.applicationUserContext;
      session.current = await completeRuntimeClientLogin({ ...saved.options, currentUserContext: () => mounted.current ? generation.current : null }, saved.transaction, callback.href);
    }
    if (!session.current?.active) {
      const source = await createWebBrowserRealm().generated.getRuntimeClientSource({ path: { clientId } });
      if (source.role !== 'official_manager' || source.origin !== window.location.origin || source.redirectUri !== new URL('/account/runtime', window.location.origin).href) {
        throw new Error(say('当前网站没有匹配的官方管理端登记。', 'This origin has no matching official manager registration.'));
      }
      generation.current = crypto.randomUUID();
      const options = { realmBaseUrl: webRealmOrigin(), officialWebBaseUrl: window.location.origin, realmEnvironmentId,
        appId: source.appId, clientId, redirectUri: source.redirectUri };
      const prepared = await prepareRuntimeClientLogin({ ...options, currentUserContext: () => mounted.current ? generation.current : null }, accountId);
      sessionStorage.setItem(storageKey, JSON.stringify({ accountId, options, transaction: prepared.transaction } satisfies Login));
      window.location.assign(prepared.authorizationUrl); return;
    }
    const controller = new AbortController(); connecting.current = controller;
    try {
      const { connectRemoteRuntime } = await import('@nimiplatform/sdk/runtime/remote');
      if (!mounted.current || controller.signal.aborted || !session.current?.active) return;
      const connected = await connectRemoteRuntime(session.current, { signal: controller.signal, onState(next) {
        if (!mounted.current) return;
        setState(next);
        if (next === 'closed') { peer.current = null; setConnection(null); setAccess(null); setConfig(null); setConfigSaved(false); }
      } });
      if (!mounted.current || connected.role !== 'official_manager') { connected.close(); throw new Error('A verified owner-management session is required.'); }
      peer.current = connected; setConnection(connected); await readState(connected);
    } finally { if (connecting.current === controller) connecting.current = null; }
  }
  async function readState(current = peer.current) {
    if (!current || current.closed) throw new Error(say('请先连接主 Runtime。', 'Connect the primary Runtime first.'));
    await verifyOwner();
    const [service, sources] = await Promise.all([current.management.state(), current.management.access()]);
    if (!mounted.current || peer.current !== current || current.closed) return;
    setState(service.mode === RuntimeServiceMode.ORDINARY ? 'connected' : 'maintenance'); setAccess(sources);
  }
  async function readConfig(id: string) {
    selectedApp.current = id; setAppId(id); setConfig(null); setConfigSaved(false);
    const current = peer.current;
    if (!id || !current || current.closed) return;
    const next = await current.management.appAIConfig(id).get();
    if (mounted.current && peer.current === current && selectedApp.current === id) setConfig(next);
  }
  async function saveLocal() {
    const current = peer.current, previous = config, id = selectedApp.current;
    if (!current || !previous || !id) return;
    setConfigSaved(false);
    await verifyOwner();
    const { createNimiLocalAIConfigCapabilityIntent } = await import('@nimiplatform/sdk/ai');
    const result = await current.management.appAIConfig(id).overwrite({ expectedRevision: previous.revision,
      capabilities: [...(previous.config?.capabilities ?? []).filter(item => item.capabilityContract !== 'text.generate'), createNimiLocalAIConfigCapabilityIntent({ capabilityContract: 'text.generate' })] });
    if (result.outcome === 'conflict') throw new Error(say('配置已改变，请重新读取后再保存。', 'The configuration changed. Read it again before saving.'));
    await readConfig(id);
    if (mounted.current && peer.current === current && !current.closed && selectedApp.current === id) setConfigSaved(true);
  }
  const labels: Record<string, string> = {
    gathering: say('正在准备直连…', 'Preparing a direct connection…'), 'waiting-for-pc': say('等待 PC 响应；首次接入请在 Home 确认此管理来源。', 'Waiting for the PC. Confirm this management source in Home on first use.'),
    connecting: say('正在连接…', 'Connecting…'), connected: say('已直连主 Runtime；普通服务正在运行。', 'Connected directly; ordinary Runtime services are running.'),
    closed: say('连接已关闭。需要时重新连接。', 'The connection closed. Connect again when needed.'), maintenance: say('Runtime 处于维护状态。', 'Runtime is in maintenance mode.'),
    stop: say('停止请求已接受。连接关闭不单独证明主机进程已退出；停止后需在 PC 上重新启动。', 'The stop request was accepted. A closed connection alone does not prove process exit. Restart from the PC after it stops.'),
  };
  const apps = [...new Map((access?.sources ?? []).filter(item => !item.officialManager).map(item => [item.appId, item.displayName])).entries()];
  const ready = !!clientId && !!realmEnvironmentId && window.location.protocol === 'https:';
  return <section className="ac-section">
    <h2>{say('远程管理', 'Remote management')}</h2>
    <p>{say('通过此官方管理端连接你的主 Runtime。首次使用在 PC Home 确认此来源，换浏览器或设备不重复确认。', 'Connect your primary Runtime from this official manager. Confirm this source once in PC Home; another browser or device does not require another approval.')}</p>
    <p>{say('主机 Home 需保持运行并开启远程接入。当前网络必须允许直连。', 'Keep Home running with remote access enabled. The current network must allow a direct connection.')}</p>
    <AccountFeedback error={error} message={labels[state]} />
    {!ready && <p>{say('此部署尚未配置 HTTPS 官方管理来源。绑定信息仍可正常查看。', 'This deployment has no configured HTTPS manager source. Primary binding information remains available.')}</p>}
    <div className="ac-actions">
      {!connection ? <button className="ac-button" disabled={!ready || busy} onClick={() => void action(connect)}>{say('验证并连接', 'Verify and connect')}</button>
        : <><button className="ac-button ac-button--secondary" disabled={busy} onClick={() => void action(() => readState())}>{say('刷新状态', 'Refresh state')}</button>
          <button className="ac-button ac-button--secondary" disabled={busy} onClick={close}>{say('断开此客户端', 'Disconnect this client')}</button></>}
    </div>
    {connection && <>
      <p>{say('断开此客户端不会停止主 Runtime。', 'Disconnecting this client does not stop the primary Runtime.')}</p>
      <h3 className="ac-runtime-subheading">{say('应用访问', 'Application access')}</h3>
      {!access?.sources.length && <p>{say('尚无已登记的远程来源。', 'No remote sources are registered yet.')}</p>}
      {access?.sources.map(source => <div className="ac-runtime-source" key={source.clientId}><div><strong>{source.displayName}</strong><p>{source.origin}</p></div>
        {source.state === RemoteSourceAccessState.PENDING || source.state === RemoteSourceAccessState.CHANGED
          ? <span>{say('在 PC Home 确认', 'Confirm in PC Home')}</span>
          : <button className="ac-button ac-button--secondary" disabled={busy} onClick={() => void action(async () => {
            if (source.state !== RemoteSourceAccessState.PAUSED && source.clientId === session.current?.identity.clientId
              && !window.confirm(say('暂停此管理来源将立即断开当前连接。之后需要在 PC Home 或其它已获准管理端恢复访问。是否暂停？',
                'Pausing this management source disconnects you immediately. Resume access in PC Home or another approved manager. Pause this source?'))) return;
            await verifyOwner(); const result = await connection.management.pauseSource(source.clientId, source.state !== RemoteSourceAccessState.PAUSED);
            if (result.auditDiagnostic) setError(say('访问设置已生效，但审计记录未完成。', 'Access changed, but its audit record could not be completed.'));
            if (!connection.closed) await readState(connection);
          })}>{source.state === RemoteSourceAccessState.PAUSED ? say('恢复访问', 'Resume access') : say('暂停访问', 'Pause access')}</button>}</div>)}
      <h3 className="ac-runtime-subheading">{say('远程应用的 AI 配置', 'Remote application AI configuration')}</h3>
      <label className="ac-field"><span>{say('已登记应用', 'Registered application')}</span><select value={appId} disabled={busy} onChange={event => void action(() => readConfig(event.target.value))}>
        <option value="">{say('选择应用', 'Choose an application')}</option>{apps.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      {config && <><p>{config.effectiveSelections.map(item => `${item.capabilityContract}: ${item.state}`).join(' · ') || say('尚未配置能力。', 'No capability is configured.')}</p>
        <button className="ac-button ac-button--secondary" disabled={busy} onClick={() => void action(saveLocal)}>{say('将此应用的文本生成设为 Local', 'Use Local text generation for this app')}</button>
        <AccountFeedback message={configSaved ? say('已保存：此应用的文本生成使用 Local。', 'Saved: this app uses Local text generation.') : null} /></>}
      <div className="ac-runtime-stop"><h3>{say('停止主 Runtime', 'Stop the primary Runtime')}</h3><p>{say('所有远程连接将关闭。网页无法再次启动已停止的 Runtime；需要在 PC 上启动 Nimi。', 'All remote connections will close. This website cannot restart a stopped Runtime; start Nimi on the PC.')}</p>
        <button className="ac-button ac-button--danger" disabled={busy} onClick={() => {
          if (window.confirm(say('停止主 Runtime 并关闭所有远程连接？', 'Stop the primary Runtime and close all remote connections?'))) void action(async () => {
            await verifyOwner(); const result = await connection.management.stop();
            if (!result.accepted) throw new Error(say('停止请求未被接受。', 'The stop request was not accepted.'));
            close(); setState('stop');
          });
        }}>{say('停止服务', 'Stop service')}</button></div>
    </>}
  </section>;
}
