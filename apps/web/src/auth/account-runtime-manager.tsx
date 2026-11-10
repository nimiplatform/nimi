import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { completeRuntimeClientLogin, matchesRuntimeClientCallback, prepareRuntimeClientLogin, type RuntimeClientLoginOptions, type RuntimeClientLoginTransaction, type RuntimeClientSession } from '@nimiplatform/sdk/realm/runtime-client';
import type { RemoteRuntimeConnection } from '@nimiplatform/sdk/runtime/remote';
import { RemoteSourceAccessState, RuntimeServiceMode, type GetRemoteAccessStateResponse } from '@nimiplatform/sdk/runtime/wire-types';
import type { NimiAIConfigOverwriteInput, NimiAIConfigSnapshot } from '@nimiplatform/sdk/ai';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { ModelConfigAIConfigSurface, type ModelConfigCopy } from '@nimiplatform/kit/features/model-config';
import { createWebBrowserRealm, webRealmOrigin } from './browser-realm.js';
import { loadWebCurrentAccount } from './web-account-adapter.js';
import { AccountFeedback } from './account-center-layout.js';

type ManagerConnection = Extract<RemoteRuntimeConnection, { role: 'official_manager' }>;
type Login = { accountId: string; options: Omit<RuntimeClientLoginOptions, 'currentUserContext' | 'fetch'>; transaction: RuntimeClientLoginTransaction };
const storageKey = 'nimi:runtime-manager:login';
const remoteModelConfigCopy: ModelConfigCopy = {
  localChoiceDescription: 'Use the model selected on the primary PC.',
  localSelectedLabel: 'Selected on the primary PC',
  localMissingLabel: 'No on-device model is selected for this capability on the primary PC.',
  cloudNoticeDescription: 'The primary Runtime sends the request to the selected cloud provider, which may charge for it.',
};
const remoteModelConfigCopyZh: ModelConfigCopy = {
  description: '为此应用选择运行方式和模型。',
  backLabel: '返回能力列表',
  detailTitle: capability => `${capability}设置`,
  capabilityLabel: (contract, fallback) => ({
    'text.generate': '文本生成', 'text.annotate': '文本标注', 'image.generate': '图像生成',
    'speech.synthesize': '语音合成', 'speech.transcribe': '语音转写', 'music.generate': '音乐生成',
  } as Record<string, string>)[contract] ?? fallback,
  activeModelLabel: '当前模型',
  activeModelHint: '更换模型',
  activeModelConfiguredLabel: '已配置',
  activeModelSetupPendingLabel: '待配置',
  modelPickerTitle: '选择模型',
  modelPickerSearchPlaceholder: '搜索模型',
  modelPickerLoadingLabel: '正在读取可用模型…',
  modelPickerEmptyLabel: '此能力暂无可用模型。',
  configuredSummary: '模型已配置',
  emptySummary: '尚未选择模型',
  routeLabel: '运行方式',
  localLabel: '主机本地',
  cloudLabel: '云端',
  localChoiceDescription: '使用主 PC 已选定的本地模型。',
  localSelectedLabel: '主 PC 当前选择',
  localMissingLabel: '主 PC 尚未为此能力选定本地模型。',
  localBrokenLabel: '主 PC 选定的本地模型不可用。',
  localUnavailableLabel: '无法读取主 PC 的本地模型选择。',
  cloudConnectorPickerLabel: '云连接',
  cloudConnectorPickerPlaceholder: '选择已配置的云连接',
  cloudNoConnectorsLabel: '主 PC 暂无可用的云连接。',
  cloudLoadFailed: '无法读取主 PC 的云连接或模型选项。',
  cloudNoticeLabel: '云端执行',
  cloudNoticeDescription: '主 Runtime 会向所选云服务商发送请求，服务商可能收费。',
  saveLocalLabel: '保存设置',
  saveCloudLabel: '保存设置',
  savingLabel: '正在保存…',
  savedLabel: '已保存',
  clearLabel: '清除配置',
  clearingLabel: '正在清除…',
  advancedLabel: '高级设置',
  defaultsLabel: '默认参数',
  defaultsPlaceholder: '留空则不为该参数指定默认值。',
  defaultsListPlaceholder: '每行一个值',
  conflictLabel: '配置已在其他页面修改',
  conflictDescription: '已保留当前草稿。请核对最新配置后再保存。',
  conflictCurrentLabel: (revision, summary) => `当前版本 ${revision}：${summary}`,
  retryLabel: '重试',
  saveFailed: '无法保存模型设置。',
  notConfiguredLabel: '未配置',
  configuredLabel: '已配置',
  selectionRequiredLabel: '待选择',
  blockedLabel: '暂不可用',
  unavailableLabel: '不可用',
  cancelLabel: '取消',
  confirmSelectionLabel: '使用所选模型',
};

// @nimi-authority: rule.nimi.platform.product-lifecycle.remote-runtime-management
export function AccountRuntimeManager({ accountId }: { accountId: string }) {
  const { i18n } = useTranslation(), navigate = useNavigate();
  const { search } = useLocation();
  const zh = i18n.language.startsWith('zh'), say = (cn: string, en: string) => zh ? cn : en;
  const clientId = String(import.meta.env.VITE_NIMI_RUNTIME_MANAGER_CLIENT_ID || '').trim();
  const realmEnvironmentId = String(import.meta.env.VITE_NIMI_REALM_ENVIRONMENT_ID || '').trim();
  const ready = !!clientId && !!realmEnvironmentId && window.location.protocol === 'https:';
  const [connection, setConnection] = useState<ManagerConnection | null>(null);
  const [access, setAccess] = useState<GetRemoteAccessStateResponse | null>(null);
  const [state, setState] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [appId, setAppId] = useState('');
  const [config, setConfig] = useState<NimiAIConfigSnapshot | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const mounted = useRef(true), generation = useRef<string | null>(null), session = useRef<RuntimeClientSession | null>(null);
  const peer = useRef<ManagerConnection | null>(null), connecting = useRef<AbortController | null>(null), working = useRef(false);
  const selectedApp = useRef('');
  function close() {
    generation.current = null; connecting.current?.abort(); connecting.current = null;
    peer.current?.close(); peer.current = null;
    if (session.current) void session.current.end().catch(reason => { if (mounted.current) setError(String(reason.message)); });
    session.current = null;
    if (mounted.current) { setConnection(null); setAccess(null); clearConfig(); }
  }
  function clearConfig() {
    selectedApp.current = ''; setAppId(''); setConfig(null); setConfigError(null);
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; close(); };
  }, [accountId]);
  const finishLogin = useEffectEvent(() => { if (ready) void action(connect); });
  useEffect(() => {
    const callback = new URLSearchParams(search);
    if (callback.has('code') || callback.has('error')) finishLogin();
  }, [search]);
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
        if (next === 'closed') { peer.current = null; setConnection(null); setAccess(null); clearConfig(); }
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
  function isSelected(current: ManagerConnection, id: string) {
    return mounted.current && peer.current === current && !current.closed && selectedApp.current === id;
  }
  async function refreshConfig(current: ManagerConnection, id: string) {
    try {
      const next = await current.management.appAIConfig(id).get();
      if (isSelected(current, id)) { setConfig(next); setConfigError(null); }
    } catch {
      if (isSelected(current, id)) setConfigError(say('无法读取最新的应用配置，请重试。', 'Could not read the latest app configuration. Try again.'));
    }
  }
  async function readConfig(id: string) {
    clearConfig();
    selectedApp.current = id; setAppId(id);
    const current = peer.current;
    if (id && current && !current.closed) await refreshConfig(current, id);
  }
  async function overwriteConfig(current: ManagerConnection, id: string, input: NimiAIConfigOverwriteInput) {
    await verifyOwner();
    if (!isSelected(current, id)) throw new Error(say('连接或应用已改变。', 'The connection or selected app changed.'));
    const result = await current.management.appAIConfig(id).overwrite(input);
    if (isSelected(current, id)) await refreshConfig(current, id);
    return result;
  }
  const labels: Record<string, string> = {
    gathering: say('正在准备直连…', 'Preparing a direct connection…'), 'waiting-for-pc': say('等待 PC 响应；首次接入请在 Home 确认此管理来源。', 'Waiting for the PC. Confirm this management source in Home on first use.'),
    connecting: say('正在连接…', 'Connecting…'), connected: say('已直连主 Runtime；普通服务正在运行。', 'Connected directly; ordinary Runtime services are running.'),
    closed: say('连接已关闭。需要时重新连接。', 'The connection closed. Connect again when needed.'), maintenance: say('Runtime 处于维护状态。', 'Runtime is in maintenance mode.'),
    stop: say('停止请求已接受。连接关闭不单独证明主机进程已退出；停止后需在 PC 上重新启动。', 'The stop request was accepted. A closed connection alone does not prove process exit. Restart from the PC after it stops.'),
  };
  const apps = new Map<string, { name: string; capabilities: Set<string> }>();
  for (const source of access?.sources ?? []) {
    if (source.officialManager || (source.state !== RemoteSourceAccessState.ALLOWED && source.state !== RemoteSourceAccessState.PAUSED)) continue;
    const app = apps.get(source.appId) ?? { name: source.displayName, capabilities: new Set<string>() };
    for (const capability of source.capabilityContractRefs) app.capabilities.add(capability);
    apps.set(source.appId, app);
  }
  const selected = apps.get(appId);
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
      <p>{say('本地模型和云连接由主 PC 配置。这里的更改只影响所选应用。', 'The primary PC manages on-device models and cloud connectors. Changes here apply only to the selected app.')}</p>
      <label className="ac-field"><span>{say('已接入应用', 'Admitted application')}</span><select value={selected ? appId : ''} disabled={busy} onChange={event => void action(() => readConfig(event.target.value))}>
        <option value="">{say('选择应用', 'Choose an application')}</option>{Array.from(apps, ([id, app]) => <option key={id} value={id}>{app.name}</option>)}</select></label>
      {selected && <ModelConfigAIConfigSurface
        key={appId}
        context={{ owner: 'app-ai-config', appId }}
        capabilityContracts={[...selected.capabilities]}
        capabilities={config ? config.config?.capabilities ?? null : undefined}
        revision={config?.revision}
        effectiveSelections={config?.effectiveSelections}
        loading={busy && !config}
        loadError={configError}
        onRetry={() => void action(() => refreshConfig(connection, appId))}
        listOptions={query => connection.management.appAIConfig(appId).listOptions(query)}
        onOverwrite={input => overwriteConfig(connection, appId, input)}
        disabled={busy}
        copy={zh ? remoteModelConfigCopyZh : remoteModelConfigCopy}
        language={i18n.language}
        showTitle={false}
      />}
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
