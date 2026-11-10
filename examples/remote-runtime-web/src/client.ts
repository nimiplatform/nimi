import { connectRemoteRuntime, type RemoteRuntimeConnection } from '@nimiplatform/sdk/runtime/remote';
import type { RuntimeClientSession, RuntimeClientIdentity } from '@nimiplatform/sdk/realm/runtime-client';
import { createNimiClientId } from '@nimiplatform/sdk/types';
import type { NimiLocalAppScenarioJob } from '@nimiplatform/sdk/app';
import { createNimiCloudAIConfigCapabilityIntent, createNimiLocalAIConfigCapabilityIntent, runtimeAIConfigStructToJson,
  type NimiAIConfigSnapshot, type NimiAIConfigCloudTargetOption } from '@nimiplatform/sdk/ai';

type SiteState = { user: { id: string; username: string; nimiAccountId: string | null } | null; context: string | null; nimi: RuntimeClientIdentity | null };
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (id: string, visible: boolean) => { element(id).hidden = !visible; };
const text = (id: string, value: string) => { element(id).textContent = value; };
let state: SiteState = { user: null, context: null, nimi: null };
let connection: RemoteRuntimeConnection | undefined;
let session: RuntimeClientSession | undefined;
let sessionAbort: AbortController | undefined;
let connecting: AbortController | undefined;
let snapshot: NimiAIConfigSnapshot | undefined;
let cloudTargets: readonly NimiAIConfigCloudTargetOption[] = [];
let cancelGeneration: (() => Promise<void>) | undefined;
let lastJob: NimiLocalAppScenarioJob | undefined;
const changes = new BroadcastChannel('website-account');
const performing = new Map<HTMLButtonElement, () => boolean>();
let refreshSequence = 0;

function notice(error: unknown): void { text('notice', error instanceof Error ? error.message : String(error)); show('notice', true); }
function clearNotice(): void { show('notice', false); }
function resetConnectionView(status: string): void {
  connection = undefined; snapshot = undefined; cancelGeneration = undefined;
  show('configuration', false); show('disconnect', false); show('cancel', false);
  element<HTMLButtonElement>('generate').disabled = true;
  text('connection-state', status); text('generation-state', '先连接主 Runtime');
  updateTaskControls();
}
function closeConnection(): void {
  const cancel = cancelGeneration;
  connecting?.abort(); connecting = undefined; connection?.close();
  sessionAbort?.abort(); sessionAbort = undefined; session = undefined;
  if (cancel) void cancel().catch(() => undefined);
  resetConnectionView('未连接主 Runtime');
}
function isCurrentConnection(active: RemoteRuntimeConnection | undefined): boolean {
  return !!active && connection === active && !active.closed && !!session?.active;
}
async function refresh(): Promise<void> {
  const sequence = ++refreshSequence;
  const response = await fetch('/api/session', { cache: 'no-store' });
  if (!response.ok) throw new Error('无法读取网站登录状态。');
  const next = await response.json() as SiteState;
  if (sequence !== refreshSequence) return;
  if (next.context !== state.context || next.nimi?.contextId !== state.nimi?.contextId) {
    closeConnection();
    if (next.user?.id !== state.user?.id) clearNotice();
    text('output', '生成的内容会出现在这里。当前草稿仅保留在此页面。'); element<HTMLTextAreaElement>('prompt').value = '';
    lastJob = undefined; element<HTMLInputElement>('job-reference').value = ''; element<HTMLTextAreaElement>('job-text').value = '';
    text('job-state', '尚未查询任务。'); text('job-result', '');
  }
  state = next;
  show('sign-in', !state.user); show('account', !!state.user);
  text('site-user', state.user?.username ?? '');
  text('nimi-user', state.nimi ? `${state.nimi.displayName || state.nimi.accountId} · 已验证`
    : state.user?.nimiAccountId ? '已有 Nimi 关联；请重新验证身份以连接。' : '尚未关联 Nimi');
  show('link', !state.nimi); show('unlink', !!state.user?.nimiAccountId); show('connect', !!state.nimi && !connection && !connecting);
  show('pc-help', !!state.nimi && !connection);
  updateTaskControls();
}
async function api<T>(path: string, body: Record<string, string> = {}, expected = state.context): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(expected ? { 'x-site-context': expected } : {}) }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `请求失败（${response.status}）。`);
  if (expected !== state.context) throw new Error('网站账号已改变，旧请求的结果已丢弃。');
  return result as T;
}
function action(id: string, run: () => Promise<void>, scope: 'site' | 'runtime' = 'site'): void {
  const button = element<HTMLButtonElement>(id);
  button.addEventListener('click', () => {
    const active = connection;
    void perform(button, run, () => scope === 'site' || isCurrentConnection(active));
  });
}
async function perform(button: HTMLButtonElement, run: () => Promise<void>, current = () => true): Promise<void> {
  if (performing.get(button)?.()) return;
  const owner = state.context;
  performing.set(button, current); button.disabled = true; clearNotice();
  const report = (error: unknown) => { if (state.context === owner && current()) notice(error); };
  try {
    await run();
  } catch (error) {
    report(error);
  } finally {
    if (performing.get(button) === current) {
      performing.delete(button);
      if (current()) {
        button.disabled = false;
        updateTaskControls();
        await refresh().catch(report);
      }
    }
  }
}
element<HTMLFormElement>('credentials').addEventListener('submit', event => {
  event.preventDefault();
  const button = (event as SubmitEvent).submitter as HTMLButtonElement;
  if (!button) return;
  const form = event.currentTarget as HTMLFormElement, fields = new FormData(form);
  void perform(button, async () => { await api(`/api/${button.value}`, { username: String(fields.get('username')), password: String(fields.get('password')) });
    form.reset(); changes.postMessage('account-changed'); });
});
action('logout', async () => { closeConnection(); changes.postMessage('account-changed'); await api('/api/logout'); });
action('unlink', async () => { closeConnection(); changes.postMessage('account-changed'); await api('/api/unlink'); });
action('link', async () => {
  closeConnection(); changes.postMessage('account-changed');
  const result = await api<{ authorizationUrl: string }>('/api/connect'); location.assign(result.authorizationUrl);
});
action('disconnect', async () => { closeConnection(); });
action('connect', async () => {
  closeConnection();
  const identity = state.nimi, owner = state.context;
  if (!identity || !owner) throw new Error('请先通过 Nimi 登录。');
  const abort = new AbortController(); sessionAbort = abort;
  const current = () => !abort.signal.aborted && state.context === owner && state.nimi?.contextId === identity.contextId && Date.parse(identity.expiresAt) > Date.now();
  const expiry = setTimeout(() => abort.abort(), Math.max(0, Date.parse(identity.expiresAt) - Date.now()));
  abort.signal.addEventListener('abort', () => clearTimeout(expiry), { once: true });
  session = {
    identity, get closed() { return !current(); }, get active() { return current(); }, signal: abort.signal,
    read: () => api('/api/runtime/context', {}, owner),
    createConnection: (offerSdp, bindingId) => api('/api/runtime/offer', { offerSdp, bindingId }, owner),
    readConnection: (connectionId, bindingId) => api('/api/runtime/answer', { connectionId, bindingId }, owner),
    end: async () => { abort.abort(); await api('/api/runtime/end', {}, owner); },
  };
  const attempt = new AbortController(); connecting = attempt; show('connect', false);
  try {
    const connected = await connectRemoteRuntime(session, { signal: attempt.signal, onState(value) {
      if (sessionAbort !== abort) return;
      const labels = { gathering: '正在准备直连…', 'waiting-for-pc': '正在等待 PC；首次接入请在 Home 确认。', connecting: '正在建立直连…', connected: '已直连主 Runtime', closed: '连接已关闭；需要时重新连接。' };
      if (value === 'closed') {
        resetConnectionView(labels.closed);
        show('connect', !!state.nimi);
      } else {
        text('connection-state', labels[value]);
      }
    } });
    if (!current()) { connected.close(); throw new Error('网站账号上下文已改变。'); }
    if (connected.role !== 'app') { connected.close(); throw new Error('此网站需要普通生态应用身份，不能使用管理客户端登记。'); }
    connection = connected; connecting = undefined;
    show('disconnect', true); show('pc-help', false);
    await readConfig();
  } finally { if (connecting === attempt) connecting = undefined; }
});
function appConnection() {
  if (!connection || connection.closed || connection.role !== 'app' || !session?.active) throw new Error('请先连接自己的主 Runtime。');
  return connection;
}
async function readConfig(): Promise<void> {
  const active = appConnection(), current = await active.aiConfig.get();
  if (connection !== active || active.closed) return;
  snapshot = current;
  updateTaskControls();
  const effective = current.effectiveSelections.find(item => item.capabilityContract === 'text.generate');
  const labels = { ready: '可以生成', missing: '尚未配置', blocked: '配置受限', unavailable: '资源不可用' };
  const resource = effective?.resource;
  const applied = resource?.oneofKind === 'cloud' ? `Cloud · ${resource.cloud.connector.label} / ${resource.cloud.target.label}`
    : resource?.oneofKind === 'local' ? `Local · ${resource.local.label}` : '';
  text('effective-config', effective ? `${labels[effective.state]}${applied ? ' · 当前配置：' + applied : ''}${effective.reasons.length ? ' · ' + effective.reasons.join('，') : ''}` : '尚未配置文本生成。');
  const intent = current.config?.capabilities.find(item => item.capabilityContract === 'text.generate');
  element<HTMLSelectElement>('route').value = intent?.route.oneofKind === 'cloud' ? 'cloud' : 'local';
  show('configuration', true);
  element<HTMLButtonElement>('generate').disabled = effective?.state !== 'ready';
  text('generation-state', effective?.state === 'ready' ? '通过已连接的 PC 执行' : '请完成此网站的 AI 配置');
  await loadRoute(true);
}
function selectOptions(id: string, options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>): void {
  const select = element<HTMLSelectElement>(id); select.replaceChildren();
  if (!options.length) options = [{ value: '', label: '没有可用选项', disabled: true }];
  for (const option of options) { const node = document.createElement('option'); node.value = option.value; node.textContent = option.label; node.disabled = !!option.disabled; select.append(node); }
  const available = options.find(item => !item.disabled); if (available) select.value = available.value;
}
function savedCloudIntent() {
  const route = snapshot?.config?.capabilities.find(item => item.capabilityContract === 'text.generate')?.route;
  return route?.oneofKind === 'cloud' ? route.cloud : undefined;
}
async function loadRoute(preserveSaved = false): Promise<void> {
  const cloud = element<HTMLSelectElement>('route').value === 'cloud'; show('cloud-fields', cloud);
  if (!cloud) return;
  const active = appConnection(), result = await active.aiConfig.listOptions({ kind: 'cloud-connectors', capabilityContract: 'text.generate' });
  if (connection !== active || result.kind !== 'cloud-connectors') return;
  selectOptions('connector', result.options.map(item => ({ value: item.connectorRef, label: item.label, disabled: item.state !== 'ready' })));
  const saved = preserveSaved ? savedCloudIntent() : undefined;
  if (saved) {
    if (result.options.some(item => item.connectorRef === saved.connectorRef)) element<HTMLSelectElement>('connector').value = saved.connectorRef;
    else { unavailableSelection('connector', '已保存的连接当前不可用'); cloudTargets = []; selectOptions('target', []); return; }
  }
  await loadTargets(preserveSaved);
}
function unavailableSelection(id: string, label: string): void {
  const select = element<HTMLSelectElement>(id), option = document.createElement('option');
  option.value = ''; option.textContent = label; option.disabled = true; select.append(option); select.value = '';
}
async function loadTargets(preserveSaved = false): Promise<void> {
  const connectorRef = element<HTMLSelectElement>('connector').value;
  cloudTargets = []; selectOptions('target', []);
  if (!connectorRef) return;
  const active = appConnection(), result = await active.aiConfig.listOptions({ kind: 'cloud-targets', capabilityContract: 'text.generate', connectorRef });
  if (connection !== active || result.kind !== 'cloud-targets' || element<HTMLSelectElement>('connector').value !== connectorRef) return;
  cloudTargets = result.options;
  selectOptions('target', result.options.map((item, index) => ({ value: String(index), label: item.label, disabled: item.state !== 'ready' })));
  const saved = preserveSaved ? savedCloudIntent() : undefined;
  if (saved && saved.connectorRef === connectorRef) {
    const target = runtimeAIConfigStructToJson(saved.providerModelTarget);
    const index = result.options.findIndex(item => item.implementation.implementationId === saved.implementation?.implementationId
      && item.implementation.driverId === saved.implementation?.driverId && item.implementation.driverDialect === saved.implementation?.driverDialect
      && ['provider', 'providerModelId', 'remoteModelCatalogId'].every(key => item.providerModelTarget[key] === target[key]));
    if (index >= 0) element<HTMLSelectElement>('target').value = String(index);
    else unavailableSelection('target', '已保存的模型当前不可用');
  }
}
action('refresh-config', readConfig);
element('route').addEventListener('change', () => { void loadRoute().catch(notice); });
element('connector').addEventListener('change', () => { void loadTargets().catch(notice); });
action('save-config', async () => {
  const active = appConnection(); if (!snapshot) return;
  let intent = createNimiLocalAIConfigCapabilityIntent({ capabilityContract: 'text.generate' });
  if (element<HTMLSelectElement>('route').value === 'cloud') {
    const selected = element<HTMLSelectElement>('target').value, target = selected ? cloudTargets[Number(selected)] : undefined;
    if (!target || target.state !== 'ready') throw new Error('请先选择已配置的 Cloud Connector 和可用模型。');
    intent = createNimiCloudAIConfigCapabilityIntent({ capabilityContract: 'text.generate', connectorRef: target.connectorRef,
      implementation: target.implementation, providerModelTarget: target.providerModelTarget });
  }
  const result = await active.aiConfig.overwrite({ expectedRevision: snapshot.revision,
    capabilities: [...(snapshot.config?.capabilities ?? []).filter(item => item.capabilityContract !== 'text.generate'), intent] });
  if (result.outcome === 'conflict') notice(new Error('配置已被其它管理入口修改。已读取最新状态，请检查后再保存。'));
  await readConfig();
});
async function generate(): Promise<void> {
  const active = appConnection(), prompt = element<HTMLTextAreaElement>('prompt').value.trim();
  if (!prompt) return;
  element<HTMLButtonElement>('generate').disabled = true; text('output', ''); text('generation-state', '正在生成…');
  let canceled = false;
  try {
    const stream = await active.ai.text.streamTurn({ messages: [{ role: 'user', text: prompt }] });
    if (!isCurrentConnection(active)) { await stream.cancel(); return; }
    cancelGeneration = async () => { canceled = true; await stream.cancel(); }; show('cancel', true);
    for await (const event of stream) {
      if (!isCurrentConnection(active)) break;
      if (event.type === 'delta') element('output').append(document.createTextNode(event.text));
      if (event.type === 'failed') throw new Error(`生成失败：${event.reasonCode}。${event.actionHint}`);
      if (event.type === 'completed') text('generation-state', '生成完成');
    }
  } catch (error) {
    if (isCurrentConnection(active) && !canceled) {
      notice(error);
      text('generation-state', '生成未完成；不会自动重试');
    }
  } finally {
    if (isCurrentConnection(active)) {
      if (canceled) text('generation-state', '已停止本次生成');
      cancelGeneration = undefined;
      show('cancel', false);
      element<HTMLButtonElement>('generate').disabled = false;
    }
  }
}
element<HTMLFormElement>('compose').addEventListener('submit', event => {
  event.preventDefault(); clearNotice();
  void generate().catch(notice);
});
element<HTMLButtonElement>('cancel').addEventListener('click', () => {
  const active = connection, cancel = cancelGeneration;
  void cancel?.().catch(error => {
    if (isCurrentConnection(active) && cancelGeneration === cancel) notice(error);
  });
});

function updateTaskControls(): void {
  const available = !!connection && !connection.closed && connection.role === 'app' && !!session?.active;
  const annotation = snapshot?.effectiveSelections.find(item => item.capabilityContract === 'text.annotate');
  const annotationLabel = annotation?.resource?.oneofKind === 'local' ? annotation.resource.local.label : '';
  const disable = (id: string, unavailable: boolean) => { const button = element<HTMLButtonElement>(id); button.disabled = unavailable || !!performing.get(button)?.(); };
  disable('prepare-job', !available);
  disable('submit-job', !available || annotation?.state !== 'ready');
  disable('read-job', !available || !element<HTMLInputElement>('job-reference').value.trim());
  disable('cancel-job', !available || !lastJob || ['completed', 'failed', 'canceled', 'timeout'].includes(lastJob.status));
  text('job-config', !available ? '先连接主 Runtime' : annotation?.state === 'ready' ? `本地文本标注可以执行${annotationLabel ? ' · 当前配置：' + annotationLabel : ''}。请使用与该配置匹配的语言。`
    : `文本标注尚不可用${annotation?.reasons.length ? '：' + annotation.reasons.join('，') : '，请检查 App 配置和 PC 上的本地能力。'}`);
}
function displayJob(job: NimiLocalAppScenarioJob): void {
  lastJob = job;
  const status = { submitted: '已提交', queued: '排队中', running: '执行中', completed: '已完成', failed: '失败', canceled: '已取消', timeout: '超时' };
  text('job-state', `${status[job.status]} · ${job.jobId}${job.reasonCode ? ' · ' + job.reasonCode : ''}${job.stopOutcome === 'unconfirmed' ? ' · 取消尚未确认' : ''}`);
  text('job-result', job.textAnnotation ? JSON.stringify(job.textAnnotation, null, 2) : job.reasonDetail || '');
  updateTaskControls();
}
element('job-reference').addEventListener('input', () => { lastJob = undefined; updateTaskControls(); });
action('prepare-job', async () => {
  const active = appConnection(), current = await active.aiConfig.get();
  const intent = createNimiLocalAIConfigCapabilityIntent({ capabilityContract: 'text.annotate' });
  const saved = await active.aiConfig.overwrite({ expectedRevision: current.revision,
    capabilities: [...(current.config?.capabilities ?? []).filter(item => item.capabilityContract !== intent.capabilityContract), intent] });
  if (!isCurrentConnection(active)) return;
  if (saved.outcome === 'conflict') notice(new Error('配置已改变。请检查当前配置后再保存。'));
  await readConfig();
}, 'runtime');
action('submit-job', async () => {
  const active = appConnection();
  const content = element<HTMLTextAreaElement>('job-text').value.trim(), language = element<HTMLInputElement>('job-language').value.trim();
  if (!content || !language) throw new Error('请填写待标注文本和语言。');
  const clientSubmissionId = createNimiClientId('web-annotation');
  element<HTMLInputElement>('job-reference').value = clientSubmissionId; lastJob = undefined; text('job-result', '');
  text('job-state', '正在提交；若响应中断，请用此编号查询。'); updateTaskControls();
  try {
    const result = await active.ai.scenarioJobs.submit({ type: 'text-annotate', language, texts: [content] }, { clientSubmissionId });
    if (isCurrentConnection(active)) displayJob(result.job);
  } catch (error) {
    if (isCurrentConnection(active)) text('job-state', '未取得任务结果。可按此提交编号查询；不会自动重新提交。');
    throw error;
  }
}, 'runtime');
action('read-job', async () => {
  const active = appConnection(), reference = element<HTMLInputElement>('job-reference').value.trim();
  if (!reference) throw new Error('请填写提交编号。');
  const result = await active.ai.scenarioJobs.lookupSubmission(reference);
  if (isCurrentConnection(active) && reference === element<HTMLInputElement>('job-reference').value.trim()) displayJob(result.job);
}, 'runtime');
action('cancel-job', async () => {
  const active = appConnection(), job = lastJob;
  if (!job) return;
  const result = await active.ai.scenarioJobs.cancel(job.jobId, 'User requested cancellation in the reference website.');
  if (isCurrentConnection(active) && lastJob === job) displayJob(result.job);
}, 'runtime');
changes.onmessage = () => { closeConnection(); void refresh().catch(notice); };
window.addEventListener('pagehide', closeConnection);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh().catch(notice); });
setInterval(() => { void refresh().catch(error => { closeConnection(); notice(error); }); }, 5000);
void refresh().catch(notice);
