import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useHomeRemoteAccessQuery } from './home-remote-access-query.js';
import { useHomeDestination, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { useTranslation } from 'react-i18next';
import { Button, NimiText, SearchField, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { ChevronDown, Globe2, Network, Pause, Radio, SearchX, ShieldCheck, Unplug } from 'lucide-react';
import { RemoteAccessConnectionState, RemoteSourceAccessState, type GetRemoteAccessStateResponse } from '@nimiplatform/sdk/runtime/wire-types';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { InlineFeedback } from '../../ui/feedback/inline-feedback.js';

const copy = {
  en: { title: 'Remote access', intro: 'Let approved applications connect directly to this PC. Keep Nimi Home running and prevent sleep. Some networks cannot connect directly.',
    enable: 'Enable remote access', disable: 'Disable remote access', disabled: 'Remote access is off.', connecting: 'Connecting to the account service…', listening: 'Recently online. Waiting for a direct connection.', activationPending: 'Remote access is waiting for this primary binding to activate.', unavailable: 'New connections are currently unavailable.',
    primary: 'Bind this PC as your primary Runtime before enabling access.', loading: 'Reading remote access status…', error: 'Could not read or change remote access. Check your account and connection.',
    empty: 'No sources have requested access yet.', allow: 'Allow this source', reject: 'Reject this request', pause: 'Pause access', resume: 'Resume access', pending: 'Waiting for your confirmation', allowed: 'Allowed', paused: 'Paused', changed: 'Source changed — confirm again',
    manager: 'Official management client', app: 'Ecosystem application', scope: 'Declared access', capability: 'Capability references', count: 'Connected clients',
    managerScope: 'This client can manage your Runtime configuration and service after verifying your ownership on each connection.',
    appScope: 'The application can use admitted capabilities and update its own AI configuration. Cloud calls use this PC’s connections and may incur costs.',
    scopedAppScope: 'The application can use services within the declared access below. Specific resources and operations still need their own permission.',
    once: 'Approval applies to this account, primary Runtime, and source version. You can switch browsers or devices without confirming again if those stay the same.',
    unsupported: 'Operations remain subject to current support and resource permissions.', working: 'Saving…', audit: 'The change took effect, but its audit record could not be completed.',
    connections: 'Current connections', connection: 'Connection', connectedAt: 'Connected', timeUnknown: 'Connection time unavailable', endConnection: 'End connection', ended: 'The selected connection has ended.',
    connectionHint: 'Ending a connection interrupts its live requests, but keeps source access and other connections. Accepted background jobs follow their existing rules; the client may reconnect.',
  },
  zh: { title: '远程接入', intro: '允许获准应用直接连接这台 PC。请保持 Nimi Home 运行并避免休眠；部分网络可能无法直连。',
    enable: '开启远程接入', disable: '关闭远程接入', disabled: '远程接入已关闭。', connecting: '正在连接账号服务…', listening: '最近在线，正在等待直连请求。', activationPending: '远程接入正在等待此主绑定生效。', unavailable: '当前无法建立新的连接。',
    primary: '请先将这台 PC 绑定为主 Runtime，再开启接入。', loading: '正在读取接入状态…', error: '无法读取或更改接入状态，请检查账号与网络。',
    empty: '还没有来源请求接入。', allow: '允许此来源', reject: '拒绝本次请求', pause: '暂停访问', resume: '恢复访问', pending: '等待你确认', allowed: '已允许', paused: '已暂停', changed: '来源已变化，需要重新确认',
    manager: '官方管理端', app: '生态应用', scope: '应用声明', capability: '能力引用', count: '已连接客户端',
    managerScope: '允许此管理端管理 Runtime 配置和服务；每次连接仍需验证你的所有者身份。',
    appScope: '应用按已开放能力使用服务，并可修改自己的 AI 配置。云调用使用这台 PC 的连接，可能产生费用。',
    scopedAppScope: '应用只能在下方声明范围内调用服务；具体资源和操作仍需单独授权。',
    once: '此许可与当前账号、主 Runtime 和来源版本绑定。这三项未变时，换浏览器或设备不必重新确认。', unsupported: '具体操作仍受当前支持范围和资源权限约束。', working: '正在保存…', audit: '修改已生效，但审计记录未能完成。',
    connections: '当前连接', connection: '连接', connectedAt: '建立于', timeUnknown: '连接时间暂不可用', endConnection: '结束连接', ended: '已结束所选连接。',
    connectionHint: '结束连接会中断这条连接上的实时请求，保留来源许可和其他连接。已受理的后台任务按原规则继续；客户端可重新连接。',
  },
};

const accessLabels: Record<string, readonly [string, string]> = {
  'runtime.consume': ['AI use and this application’s AI settings', '使用 AI 和修改本应用的 AI 配置'],
  'realm.data': ['Permitted online data', '获准的线上数据'],
  'agent.local': ['Access your agents', '访问你的智能体'],
  'agent.acquire': ['Discover characters and add partners', '发现角色和建立伙伴'],
  'agent.configure': ['Agent configuration', '智能体配置'],
  'app.activity': ['Application activity', '应用动态'],
  'agent.work': ['Agent tasks', '智能体任务'],
  'integration.consume': ['Use permitted integration operations', '调用已获准的集成操作'],
  'integration.provide': ['Provide application functions', '提供应用功能'],
  'integration.manage': ['Manage application integrations', '管理应用集成'],
};

// @nimi-authority: rule.nimi.runtime.remote-access.source-admission
// @nimi-authority: rule.nimi.runtime.remote-access.connection-management
export function HomeRemoteAccess({ primaryBindingId, thisRuntime, primaryStateKnown, validAfter, primaryRuntime, managementEntry }: {
  account: string; realm: string; primaryBindingId: string; thisRuntime: boolean; primaryStateKnown: boolean; validAfter: string;
  primaryRuntime?: ReactNode; managementEntry?: ReactNode;
}) {
  const sdk = useDesktopRendererSdk();
  const { i18n } = useTranslation();
  const c = copy[i18n.language.startsWith('zh') ? 'zh' : 'en'];
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'info' | 'error'; message: string; technicalDetail?: string } | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'connected' | 'paused'>('all');
  const submitting = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const query = useHomeRemoteAccessQuery();
  const destination = useHomeDestination();
  const navigation = useHomeNavigation();
  useEffect(() => {
    setSearch('');
    setFilter('all');
  }, [destination.connectionAppId, destination.connectionSourceId]);
  const sameBinding = Boolean(thisRuntime && primaryBindingId && query.data?.bindingId === primaryBindingId);
  const enabled = Boolean(query.data?.enabled && (sameBinding || !thisRuntime));
  const binding = enabled ? query.data?.bindingId || '' : primaryBindingId;
  const connectedSources = new Set((query.data?.connections ?? []).map(connection => connection.clientId));
  const sourcePriority = (source: GetRemoteAccessStateResponse['sources'][number]) => source.state === RemoteSourceAccessState.PENDING || source.state === RemoteSourceAccessState.CHANGED ? 2 : connectedSources.has(source.clientId) ? 1 : 0;
  const sources = sameBinding ? (query.data?.sources || []).filter(source => (!destination.connectionAppId || source.appId === destination.connectionAppId) && (!destination.connectionSourceId || source.clientId === destination.connectionSourceId))
    .sort((a, b) => sourcePriority(b) - sourcePriority(a)) : [];
  const api = sdk.accountProduct().remoteAccess;
  async function action(work: () => Promise<{ state?: GetRemoteAccessStateResponse; auditDiagnostic?: unknown }>, successMessage?: string) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setFeedback(null);
    try {
      const result = await work();
      if (!mounted.current) return;
      if (result.auditDiagnostic) setFeedback({ kind: 'info', message: c.audit });
      await query.refetch();
      if (mounted.current && successMessage && !result.auditDiagnostic) setFeedback({ kind: 'info', message: successMessage });
    } catch (reason) {
      if (mounted.current) setFeedback({ kind: 'error', message: c.error, technicalDetail: extractNimiErrorFields(reason).reasonCode || undefined });
    } finally { submitting.current = false; if (mounted.current) setBusy(false); }
  }
  const zh = i18n.language.startsWith('zh');
  const activationPending = Date.parse(validAfter) > Date.now();
  const listening = enabled && !activationPending && query.data?.connectionState === RemoteAccessConnectionState.LISTENING;
  const status = !enabled ? c.disabled : activationPending ? c.activationPending : listening ? (sameBinding && Boolean(query.data?.connectedPeers)
    ? (zh ? '获准应用已与这台 PC 建立直连。' : 'Approved applications are directly connected to this PC.') : c.listening)
    : query.data?.connectionState === RemoteAccessConnectionState.CONNECTING ? c.connecting : c.unavailable;
  const pendingSource = (source: GetRemoteAccessStateResponse['sources'][number]) => source.state === RemoteSourceAccessState.PENDING || source.state === RemoteSourceAccessState.CHANGED;
  const filters = [
    { id: 'all', label: zh ? '全部' : 'All', count: sources.length },
    { id: 'pending', label: zh ? '待确认' : 'Pending', count: sources.filter(pendingSource).length },
    { id: 'connected', label: zh ? '有连接' : 'Connected', count: sources.filter(source => connectedSources.has(source.clientId)).length },
    { id: 'paused', label: zh ? '已暂停' : 'Paused', count: sources.filter(source => source.state === RemoteSourceAccessState.PAUSED).length },
  ] as const;
  const searchText = search.trim().toLocaleLowerCase(i18n.language);
  const visibleSources = sources.filter(source => {
    const matchesFilter = filter === 'all' || (filter === 'pending' && pendingSource(source)) || (filter === 'connected' && connectedSources.has(source.clientId)) || (filter === 'paused' && source.state === RemoteSourceAccessState.PAUSED);
    return matchesFilter && (!searchText || [source.displayName, source.origin, source.appId].some(value => value.toLocaleLowerCase(i18n.language).includes(searchText)));
  });
  const recordsKnown = sameBinding && query.isSuccess;
  return <>
    <Surface tone="card" padding="none" className="overflow-hidden shadow-none">
      {primaryRuntime}
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className={`flex size-10 shrink-0 items-center justify-center rounded-[var(--nimi-radius-sm)] ${listening && !query.isError ? 'bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success-soft-text)]' : 'bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-secondary)]'}`}><Radio size={22} aria-hidden="true" /></div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <NimiText as="h3" role="section-title">{c.title}</NimiText>
                {!query.isPending && !query.isError && <StatusBadge tone={!enabled ? 'neutral' : listening ? 'success' : 'warning'}>{enabled ? (zh ? '已开启' : 'Enabled') : (zh ? '已关闭' : 'Off')}</StatusBadge>}
                {recordsKnown && <NimiText role="helper" className="tabular-nums">{zh ? `${query.data.connectedPeers} 条当前连接` : `${query.data.connectedPeers} current connections`}</NimiText>}
              </div>
              <NimiText role="helper">{query.isError ? (zh ? '接入状态暂不可用' : 'Access status unavailable') : query.isPending ? c.loading : status}</NimiText>
            </div>
          </div>
          <Button tone={enabled ? 'secondary' : 'primary'} disabled={busy || query.isError || !primaryStateKnown || !query.data || !binding || (!enabled && !thisRuntime)}
            onClick={() => void action(() => api.setRemoteAccessEnabled({ enabled: !enabled, expectedBindingId: binding }))}>{busy ? c.working : enabled ? c.disable : c.enable}</Button>
        </div>
        {primaryStateKnown && !thisRuntime && <NimiText role="helper">{c.primary}</NimiText>}
        <NimiText role="helper">{c.intro}</NimiText>
        {enabled && !query.isError && <NimiText role="helper">{zh ? '关闭接入会断开远程连接；已受理的后台任务仍按原规则处理。' : 'Disabling access closes remote connections. Accepted background jobs follow their existing rules.'}</NimiText>}
        {query.isError && <div className="space-y-2"><InlineFeedback feedback={{ kind: 'error', message: c.error,
          technicalDetail: extractNimiErrorFields(query.error).reasonCode || (query.error instanceof Error ? query.error.message : undefined) }} />
          <Button tone="secondary" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>{zh ? '重试读取' : 'Retry'}</Button></div>}
        {feedback && <InlineFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />}
      </div>
    </Surface>
    <div className={`grid min-w-0 items-start gap-5 ${managementEntry ? 'lg:grid-cols-[minmax(0,1fr)_17rem]' : ''}`}>
      <section className="min-w-0 space-y-3" aria-label={zh ? '应用访问' : 'Application access'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <NimiText as="h3" role="section-title">{zh ? '应用访问' : 'Application access'}</NimiText>
          {(destination.connectionAppId || destination.connectionSourceId) && <Button tone="ghost" size="sm" onClick={() => { setSearch(''); setFilter('all'); void navigation.push({ id: 'connections' }); }}>{zh ? '查看全部接入来源' : 'Show all access sources'}</Button>}
        </div>
        <Surface tone="card" padding="none" className="overflow-hidden shadow-none">
          <div className="space-y-3 border-b border-[var(--nimi-border-subtle)] p-3">
            <SearchField value={search} onChange={event => setSearch(event.target.value)} onClear={() => setSearch('')} clearLabel={zh ? '清除搜索' : 'Clear search'}
              placeholder={zh ? '搜索应用名称或来源地址' : 'Search applications or source addresses'} aria-label={zh ? '搜索接入来源' : 'Search access sources'} />
            <div className="flex flex-wrap gap-1" role="group" aria-label={zh ? '按接入状态筛选' : 'Filter by access status'}>
              {filters.map(item => <Button key={item.id} tone={filter === item.id ? 'secondary' : 'ghost'} size="sm" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
                {item.label}{recordsKnown && <span className="ml-1 tabular-nums text-[var(--nimi-text-secondary)]">{item.count}</span>}
              </Button>)}
            </div>
          </div>
          {query.isError && sources.length > 0 && <NimiText role="helper" className="px-4 pt-3">{zh ? '以下为上次读取的记录。恢复连接后才能操作。' : 'Showing previously read records. Reconnect before making changes.'}</NimiText>}
          <div className="divide-y divide-[var(--nimi-border-subtle)]">
            {visibleSources.map(source => <RemoteSourceRow key={source.clientId} source={source} locale={i18n.language} c={c}
              connections={(query.data?.connections ?? []).filter(connection => connection.clientId === source.clientId).sort((a, b) => Number(a.connectedAt?.seconds ?? 0) - Number(b.connectedAt?.seconds ?? 0) || (a.connectedAt?.nanos ?? 0) - (b.connectedAt?.nanos ?? 0) || a.connectionId.localeCompare(b.connectionId))}
              disabled={busy || query.isError || !primaryStateKnown}
              onAllow={() => void action(() => api.confirmRemoteSource({ pendingRequestId: source.pendingRequestId, expectedBindingId: primaryBindingId }))}
              onReject={() => void action(() => api.rejectRemoteSource({ pendingRequestId: source.pendingRequestId, expectedBindingId: primaryBindingId }))}
              onPause={() => void action(() => api.setRemoteSourcePaused({ clientId: source.clientId, paused: source.state !== RemoteSourceAccessState.PAUSED, expectedBindingId: primaryBindingId }))}
              onEnd={connectionId => void action(() => api.disconnectRemoteConnection({ connectionId, expectedBindingId: primaryBindingId }), c.ended)} />)}
          </div>
          {recordsKnown && visibleSources.length === 0 && <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <SearchX size={24} className="text-[var(--nimi-text-muted)]" aria-hidden="true" />
            <NimiText role="label">{sources.length === 0 ? (destination.connectionAppId || destination.connectionSourceId ? (zh ? '当前没有此应用或来源的接入记录。' : 'No current access record for this application or source.') : c.empty) : (zh ? '没有符合条件的来源' : 'No matching sources')}</NimiText>
            <NimiText role="helper">{sources.length === 0 ? (zh ? '在客户端使用同一个 Nimi 账号发起连接，首次请求会出现在这里。' : 'Connect from a client with the same Nimi account. Its first request will appear here.') : (zh ? '试试其他关键词，或查看全部来源。' : 'Try another search or view all sources.')}</NimiText>
            {sources.length > 0 && <Button tone="ghost" size="sm" onClick={() => { setSearch(''); setFilter('all'); }}>{zh ? '清除筛选' : 'Clear filters'}</Button>}
          </div>}
          {!recordsKnown && sources.length === 0 && <NimiText role="helper" className="p-4">{query.isError ? c.error : primaryStateKnown && !thisRuntime ? c.primary : c.loading}</NimiText>}
        </Surface>
      </section>
      {managementEntry}
    </div>
  </>;
}

function RemoteSourceRow({ source, connections, locale, c, disabled, onAllow, onReject, onPause, onEnd }: {
  source: GetRemoteAccessStateResponse['sources'][number];
  connections: GetRemoteAccessStateResponse['connections'];
  locale: string; c: typeof copy.en; disabled: boolean;
  onAllow: () => void; onReject: () => void; onPause: () => void; onEnd: (connectionId: string) => void;
}) {
  const zh = locale.startsWith('zh');
  const pending = source.state === RemoteSourceAccessState.PENDING || source.state === RemoteSourceAccessState.CHANGED;
  const paused = source.state === RemoteSourceAccessState.PAUSED;
  const [expanded, setExpanded] = useState(false);
  const scope = <div className="space-y-2">
    <NimiText role="body">{source.officialManager ? c.managerScope : source.appAccess.includes('runtime.consume') ? c.appScope : c.scopedAppScope}</NimiText>
    {!source.officialManager && <>
      <NimiText role="label">{c.scope}</NimiText>
      <ul className="list-disc space-y-1 pl-4 text-[length:var(--nimi-type-body-size)] text-[var(--nimi-text-secondary)]">
        {source.appAccess.map(domain => <li key={domain}>{accessLabels[domain]?.[zh ? 1 : 0] || domain}</li>)}
      </ul>
      {source.appAccess.length === 0 && <NimiText role="helper">{zh ? '未声明访问范围' : 'No declared access'}</NimiText>}
      <NimiText role="helper">{c.unsupported}</NimiText>
    </>}
    <NimiText role="helper">{c.once}</NimiText>
    {source.capabilityContractRefs.length > 0 && <details className="text-xs text-[var(--nimi-text-secondary)]">
      <summary className="cursor-pointer rounded-sm py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]">{c.capability}</summary>
      <NimiText role="helper" className="break-all pt-2">{source.capabilityContractRefs.join(', ')}</NimiText>
    </details>}
  </div>;
  return <article className="space-y-3 p-4" data-testid={`remote-source:${source.clientId}`} aria-label={source.displayName}>
    <div className="flex items-start gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--nimi-radius-sm)] bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-secondary)]">
        {source.officialManager ? <ShieldCheck size={19} aria-hidden="true" /> : <Globe2 size={19} aria-hidden="true" />}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <NimiText as="h4" role="label" className="break-words text-[var(--nimi-text-primary)]">{source.displayName}</NimiText>
          <StatusBadge tone={pending ? 'warning' : 'neutral'}>{source.state === RemoteSourceAccessState.CHANGED ? c.changed : pending ? c.pending : paused ? c.paused : c.allowed}</StatusBadge>
        </div>
        <NimiText role="helper" className="break-all select-text">{source.origin}</NimiText>
        {(source.officialManager || connections.length > 0) && <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {source.officialManager && <NimiText role="helper">{c.manager}</NimiText>}
          {connections.length > 0 && <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--nimi-status-success-soft-text)]"><Network size={13} aria-hidden="true" />{zh ? `${connections.length} 条连接` : `${connections.length} connected`}</span>}
        </div>}
      </div>
      {!pending && <Button tone="ghost" size="sm" aria-label={`${zh ? '查看访问详情' : 'View access details'} · ${source.displayName}`} aria-expanded={expanded} onClick={() => setExpanded(!expanded)} trailingIcon={<ChevronDown size={14} className={expanded ? 'rotate-180' : ''} aria-hidden="true" />}>{zh ? '详情' : 'Details'}</Button>}
    </div>
    {(pending || expanded) && <div className="space-y-3 border-t border-[var(--nimi-border-subtle)] pt-3">
      {scope}
      <div className="flex flex-wrap gap-2">
        {pending ? <>
          <Button disabled={disabled || !source.pendingRequestId} onClick={onAllow}>{c.allow}</Button>
          <Button tone="secondary" disabled={disabled || !source.pendingRequestId} onClick={onReject}>{c.reject}</Button>
        </> : <Button tone="secondary" size="sm" leadingIcon={paused ? undefined : <Pause size={14} aria-hidden="true" />} disabled={disabled} onClick={onPause}>{paused ? c.resume : c.pause}</Button>}
      </div>
      {!pending && !paused && <NimiText role="helper">{zh ? '暂停会断开此来源的所有连接并阻止再次接入，保留已有数据。' : 'Pausing closes all connections from this source and blocks access while keeping its data.'}</NimiText>}
    </div>}
    {!pending && connections.length > 0 && <div className="space-y-2 border-t border-[var(--nimi-border-subtle)] pt-3">
      {connections.map(connection => <div key={connection.connectionId} data-testid="remote-connection" data-connection-id={connection.connectionId} className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <NimiText role="body">{c.connection} <span className="font-mono text-xs">{connection.connectionId.slice(0, 8)}</span></NimiText>
          <NimiText role="helper" className="tabular-nums">{connection.connectedAt ? `${c.connectedAt} ${new Date(Number(connection.connectedAt.seconds) * 1000 + connection.connectedAt.nanos / 1_000_000).toLocaleString(locale)}` : c.timeUnknown}</NimiText>
        </div>
        <Button tone="ghost" size="sm" leadingIcon={<Unplug size={14} aria-hidden="true" />} disabled={disabled} onClick={() => onEnd(connection.connectionId)}>{c.endConnection}</Button>
      </div>)}
      <NimiText role="helper">{c.connectionHint}</NimiText>
    </div>}
  </article>;
}
