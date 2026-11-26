import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { QueryStatus } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, InlineAlert, LoadingSkeleton, NimiText, SearchField, Toggle } from '@nimiplatform/kit/ui';
import { Check, ChevronDown, ChevronRight, Globe2, Monitor, Radio, SearchX, ShieldCheck } from 'lucide-react';
import { RemoteAccessConnectionState, RemoteSourceAccessState, type GetRemoteAccessStateResponse } from '@nimiplatform/sdk/runtime/wire-types';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { useHomeDestination, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { InlineFeedback } from '../../ui/feedback/inline-feedback.js';
import { useHomeRemoteAccessQuery } from './home-remote-access-query.js';

const copy = {
  en: {
    primaryFallbackTitle: 'Primary Runtime',
    thisPcTag: 'This PC · Primary Runtime',
    otherTitle: 'This PC is not your primary Runtime',
    unboundTitle: 'Bind this PC as primary Runtime',
    loadingPrimaryTitle: 'Reading primary Runtime…',
    errorPrimaryTitle: 'Primary Runtime unavailable',
    unboundSummary: 'Bind one PC per account as your primary Runtime to enable direct remote access.',
    offSummary: 'Allow approved web and external applications to connect directly to this PC.',
    runtimeHint: 'Keep Nimi Home running and prevent sleep while using direct access; some restricted networks cannot connect directly.',
    disableHint: 'Disabling direct access closes live connections without canceling accepted background jobs.',
    remoteLabel: 'Remote access',
    enable: 'Enable remote access',
    disable: 'Disable remote access',
    connecting: 'Connecting to account service…',
    listening: 'Waiting for approved applications to connect directly.',
    listeningShort: 'Online · Waiting',
    connectedShort: (count: number) => `Connected · ${count} live`,
    connectingShort: 'Connecting…',
    activationPendingShort: 'Activating…',
    unavailableShort: 'Unavailable',
    offShort: 'Off',
    activationPending: 'Remote access is waiting for this primary Runtime binding to activate.',
    unavailable: 'New connections are currently unavailable.',
    primaryLocked: 'Bind this PC as your primary Runtime to enable direct access',
    loading: 'Reading remote access status…',
    error: 'Could not read or change remote access. Check your account and connection.',
    empty: 'Waiting for first connection request',
    allow: 'Allow this source',
    reject: 'Reject',
    pause: 'Pause access',
    resume: 'Resume access',
    pending: 'First-time request',
    allowed: 'Allowed',
    paused: 'Paused',
    changed: 'Source changed — confirm again',
    manager: 'Official manager',
    app: 'Ecosystem app',
    scope: 'Declared access',
    capability: 'Capability contracts',
    managerScope: 'This client can manage your Runtime configuration and service after verifying your ownership on each connection.',
    appScope: 'The application can use admitted capabilities and update its own AI configuration. Cloud calls use this PC’s connections and may incur costs.',
    scopedAppScope: 'The application can use services within the declared access below. Specific resources and operations still need their own permission.',
    once: 'Approval applies to this account, primary Runtime, and source version. You can switch browsers or devices without confirming again if those stay the same.',
    unsupported: 'Operations remain subject to current support and resource permissions.',
    working: 'Saving…',
    audit: 'The change took effect, but its audit record could not be completed.',
    connection: 'Connection',
    connectedAt: 'Connected',
    timeUnknown: 'Connection time unavailable',
    endConnection: 'End connection',
    ended: 'The selected connection has ended.',
    connectionHint:
      'Ending a connection interrupts its live requests without revoking source access or affecting other connections. Accepted background jobs follow their existing rules, and the client may reconnect.',
    pauseHint: 'Pausing closes all connections from this source and blocks access while keeping its data.',
  },
  zh: {
    primaryFallbackTitle: '主设备',
    thisPcTag: '本机 · 主 Runtime',
    otherTitle: '这台电脑暂未作为主设备',
    unboundTitle: '绑定这台电脑为主设备',
    loadingPrimaryTitle: '正在读取主设备状态…',
    errorPrimaryTitle: '主设备状态暂不可用',
    unboundSummary: '每个账号可指定一台电脑作为主 Runtime，绑定并开启直连后，外部应用即可安全访问本机服务。',
    offSummary: '开启远程直连后，获准的网页与外部应用即可访问本机服务。',
    runtimeHint: '直连期间请保持 Nimi Home 运行并避免电脑休眠；部分受限网络可能无法建立直连。',
    disableHint: '关闭直连不会取消已受理的后台任务。',
    remoteLabel: '远程直连',
    enable: '开启远程接入',
    disable: '关闭远程接入',
    connecting: '正在连接账号服务…',
    listening: '正在等待获准的应用从浏览器或其他设备发起直连。',
    listeningShort: '在线待连',
    connectedShort: (count: number) => `已连接 · ${count} 条活跃连接`,
    connectingShort: '连接中…',
    activationPendingShort: '等待生效',
    unavailableShort: '暂不可用',
    offShort: '已关闭',
    activationPending: '远程直连正在等待主设备绑定生效。',
    unavailable: '当前无法建立新的直连。',
    primaryLocked: '将这台电脑设为主设备后可开启',
    loading: '正在读取直连状态…',
    error: '无法读取或更改接入状态，请检查账号与网络。',
    empty: '等待首次接入请求',
    allow: '允许接入',
    reject: '拒绝',
    pause: '暂停',
    resume: '恢复访问',
    pending: '请求首次接入',
    allowed: '已允许',
    paused: '已暂停访问',
    changed: '来源已更新，需重新确认',
    manager: '官方管理端',
    app: '生态应用',
    scope: '申请的访问范围',
    capability: '能力契约',
    managerScope: '官方管理端可管理你的 Runtime 配置与服务；每次连接仍需验证你的所有者身份。',
    appScope: '允许后将按以下范围使用本机服务，并可修改其自身的 AI 配置。云端调用使用本机连接，可能产生费用。',
    scopedAppScope: '允许后只能在以下声明范围内调用服务；具体资源和操作仍需单独授权。',
    once: '许可与当前账号、主设备及来源版本绑定，三项未变时换浏览器或设备无需重复确认。',
    unsupported: '具体操作仍受当前支持范围和资源权限约束。',
    working: '正在保存…',
    audit: '修改已生效，但审计记录未能完成。',
    connection: '连接',
    connectedAt: '建立于',
    timeUnknown: '连接时间暂不可用',
    endConnection: '断开',
    ended: '已断开所选连接，应用许可保持不变。',
    connectionHint:
      '断开单条连接仅中断该连接上的实时请求，不撤销来源许可，也不影响其他连接或已受理的后台任务，客户端可重新连接；如需阻止再次接入，请暂停该来源。',
    pauseHint: '暂停会断开此来源的所有连接并阻止再次接入，同时保留已有数据。',
  },
};

const accessLabels: Record<string, readonly [string, string]> = {
  'runtime.consume': ['AI use and this application’s AI settings', '使用 AI 与配置本应用 AI'],
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

const SOURCE_AVATAR_TONES = [
  { bg: 'color-mix(in srgb, var(--nimi-action-primary-bg) 12%, transparent)', fg: 'var(--nimi-action-primary-bg)' },
  { bg: 'color-mix(in srgb, var(--nimi-status-success) 13%, transparent)', fg: 'var(--nimi-status-success)' },
  { bg: 'color-mix(in srgb, var(--nimi-color-indigo) 13%, transparent)', fg: 'var(--nimi-color-indigo)' },
  { bg: 'color-mix(in srgb, var(--nimi-status-info) 13%, transparent)', fg: 'var(--nimi-status-info)' },
] as const;

function pickSourceTone(seed: string, officialManager: boolean, pending: boolean) {
  if (pending) {
    return {
      bg: 'var(--nimi-status-warning-soft-bg)',
      fg: 'var(--nimi-status-warning-soft-text)',
    };
  }
  if (officialManager) {
    return SOURCE_AVATAR_TONES[0];
  }
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return SOURCE_AVATAR_TONES[hash % SOURCE_AVATAR_TONES.length]!;
}

function sourceInitial(displayName: string) {
  const trimmed = displayName.trim();
  return trimmed ? Array.from(trimmed)[0]!.toUpperCase() : '?';
}

function formatOriginHost(origin: string) {
  return origin.replace(/^https?:\/\//i, '');
}

// @nimi-authority: rule.nimi.runtime.remote-access.source-admission
// @nimi-authority: rule.nimi.runtime.remote-access.connection-management
export function HomeRemoteAccess({
  primaryBindingId,
  primaryDisplayName = '',
  hasOtherBinding = false,
  primarySetupOpen = false,
  primaryAction,
  primaryDrawer,
  primaryError,
  thisRuntime,
  primaryStatus,
  validAfter,
}: {
  account: string;
  realm: string;
  primaryBindingId: string;
  primaryDisplayName?: string;
  hasOtherBinding?: boolean;
  primarySetupOpen?: boolean;
  primaryAction?: ReactNode;
  primaryDrawer?: ReactNode;
  primaryError?: string;
  thisRuntime: boolean;
  primaryStatus: QueryStatus;
  validAfter: string;
}) {
  const sdk = useDesktopRendererSdk();
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const c = copy[zh ? 'zh' : 'en'];
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'info' | 'error'; message: string; technicalDetail?: string } | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'connected' | 'paused'>('all');
  const submitting = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const query = useHomeRemoteAccessQuery();
  const primaryStateKnown = primaryStatus === 'success';
  const statusFailed = query.isError || primaryStatus === 'error';
  const statusPending = query.isPending || primaryStatus === 'pending';
  const destination = useHomeDestination();
  const navigation = useHomeNavigation();

  useEffect(() => {
    setSearch('');
    setFilter('all');
  }, [destination.connectionAppId, destination.connectionSourceId]);

  const sameBinding = Boolean(thisRuntime && primaryBindingId && query.data?.bindingId === primaryBindingId);
  const enabled = Boolean(query.data?.enabled && (sameBinding || !thisRuntime));
  const binding = enabled ? query.data?.bindingId || '' : primaryBindingId;
  const connectedSources = new Set((query.data?.connections ?? []).map((connection) => connection.clientId));
  const isPendingSource = (source: GetRemoteAccessStateResponse['sources'][number]) =>
    source.state === RemoteSourceAccessState.PENDING || source.state === RemoteSourceAccessState.CHANGED;
  const sourcePriority = (source: GetRemoteAccessStateResponse['sources'][number]) =>
    isPendingSource(source) ? 2 : connectedSources.has(source.clientId) ? 1 : 0;

  const sources = sameBinding
    ? (query.data?.sources || [])
        .filter(
          (source) =>
            (!destination.connectionAppId || source.appId === destination.connectionAppId) &&
            (!destination.connectionSourceId || source.clientId === destination.connectionSourceId),
        )
        .sort((a, b) => sourcePriority(b) - sourcePriority(a))
    : [];

  const api = sdk.accountProduct().remoteAccess;
  async function action(work: () => Promise<{ state?: GetRemoteAccessStateResponse; auditDiagnostic?: unknown }>, successMessage?: string) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await work();
      if (!mounted.current) return;
      if (result.auditDiagnostic) setFeedback({ kind: 'info', message: c.audit });
      await query.refetch();
      if (mounted.current && successMessage && !result.auditDiagnostic) {
        setFeedback({ kind: 'info', message: successMessage });
      }
    } catch (reason) {
      if (mounted.current) {
        setFeedback({
          kind: 'error',
          message: c.error,
          technicalDetail: extractNimiErrorFields(reason).reasonCode || undefined,
        });
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const activationPending = Boolean(validAfter) && Date.parse(validAfter) > Date.now();
  const listening = enabled && !activationPending && query.data?.connectionState === RemoteAccessConnectionState.LISTENING;
  const connectedPeers = sameBinding ? query.data?.connectedPeers ?? 0 : 0;

  const activeStatusSummary = activationPending
    ? c.activationPending
    : listening
      ? connectedPeers > 0
        ? zh
          ? '获准的远程应用正在直连并使用本机服务。'
          : 'Approved applications are directly connected to this PC.'
        : c.listening
      : query.data?.connectionState === RemoteAccessConnectionState.CONNECTING
        ? c.connecting
        : c.unavailable;

  const remoteSubtitle = statusFailed
    ? zh
      ? '接入状态暂不可用，请检查账号与网络。'
      : 'Access status unavailable. Check your account and connection.'
    : statusPending
      ? c.loading
      : !enabled
        ? c.offSummary
        : activeStatusSummary;

  const switchStatusText = busy
    ? c.working
    : statusFailed
      ? c.unavailableShort
      : statusPending
        ? zh
          ? '读取中…'
          : 'Loading…'
        : !enabled
          ? c.offShort
          : activationPending
            ? c.activationPendingShort
            : listening
              ? connectedPeers > 0
                ? c.connectedShort(connectedPeers)
                : c.listeningShort
              : query.data?.connectionState === RemoteAccessConnectionState.CONNECTING
                ? c.connectingShort
                : c.unavailableShort;

  const filters = [
    { id: 'all', label: zh ? '全部' : 'All', count: sources.length, pendingAccent: false },
    { id: 'pending', label: zh ? '待确认' : 'Pending', count: sources.filter(isPendingSource).length, pendingAccent: true },
    {
      id: 'connected',
      label: zh ? '连接中' : 'Connected',
      count: sources.filter((source) => connectedSources.has(source.clientId)).length,
      pendingAccent: false,
    },
    {
      id: 'paused',
      label: zh ? '已暂停' : 'Paused',
      count: sources.filter((source) => source.state === RemoteSourceAccessState.PAUSED).length,
      pendingAccent: false,
    },
  ] as const;

  const searchText = search.trim().toLocaleLowerCase(i18n.language);
  const visibleSources = sources.filter((source) => {
    const matchesFilter =
      filter === 'all' ||
      (filter === 'pending' && isPendingSource(source)) ||
      (filter === 'connected' && connectedSources.has(source.clientId)) ||
      (filter === 'paused' && source.state === RemoteSourceAccessState.PAUSED);
    return (
      matchesFilter &&
      (!searchText ||
        [source.displayName, source.origin, source.appId].some((value) => value.toLocaleLowerCase(i18n.language).includes(searchText)))
    );
  });

  const visiblePending = visibleSources.filter(isPendingSource);
  const visibleManaged = visibleSources.filter((source) => !isPendingSource(source));
  const hasVisibleLiveConnections = visibleManaged.some((source) => connectedSources.has(source.clientId));

  const recordsKnown = sameBinding && query.isSuccess;
  const toggleDisabled = busy || query.isError || !primaryStateKnown || !query.data || !binding || (!enabled && !thisRuntime);

  const heroAmbientStyle: CSSProperties =
    thisRuntime && listening && !query.isError
      ? {
          backgroundImage:
            'radial-gradient(540px 180px at 94% -10%, color-mix(in srgb, var(--nimi-status-success) 10%, transparent), transparent 65%), radial-gradient(420px 150px at 8% -15%, color-mix(in srgb, var(--nimi-action-primary-bg) 8%, transparent), transparent 65%)',
        }
      : thisRuntime
        ? {
            backgroundImage:
              'radial-gradient(500px 160px at 10% -15%, color-mix(in srgb, var(--nimi-action-primary-bg) 8%, transparent), transparent 65%)',
          }
        : {
            backgroundImage:
              'radial-gradient(480px 160px at 92% -15%, color-mix(in srgb, var(--nimi-text-muted) 7%, transparent), transparent 65%)',
          };

  const nonPrimaryTitle =
    primaryStatus === 'pending'
      ? c.loadingPrimaryTitle
      : primaryStatus === 'error'
        ? c.errorPrimaryTitle
        : hasOtherBinding
          ? c.otherTitle
          : c.unboundTitle;

  const nonPrimaryDescription =
    primaryStatus === 'pending'
      ? c.loading
      : primaryStatus === 'error'
        ? primaryError || c.error
        : hasOtherBinding
          ? zh
            ? `账号当前绑定在 ${primaryDisplayName || '另一台电脑'}（另一台电脑），远程应用当前不会连接到本机。`
            : `Current primary PC: ${primaryDisplayName || 'another PC'}. Remote applications do not connect to this PC.`
          : c.unboundSummary;

  return (
    <div className="min-w-0 space-y-7">
      {/* Unified Consumer-Grade Device Hero Card */}
      <section
        aria-label={zh ? '本机主设备与远程直连' : 'Primary Runtime and remote access'}
        style={heroAmbientStyle}
        className="overflow-hidden rounded-[18px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] shadow-[var(--nimi-home-card-elevation)]"
      >
        <div className="space-y-5 p-6">
          {thisRuntime ? (
            <>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <div
                    className={`relative flex size-12 shrink-0 items-center justify-center rounded-2xl ${
                      listening && !query.isError
                        ? 'bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success-soft-text)]'
                        : 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_11%,transparent)] text-[var(--nimi-action-primary-bg)]'
                    }`}
                  >
                    <Monitor size={22} aria-hidden="true" />
                    {listening && !query.isError ? (
                      <span
                        className="absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full bg-[var(--nimi-surface-card)] shadow-sm"
                        aria-hidden="true"
                      >
                        <span className="size-2 rounded-full bg-[var(--nimi-status-success)]" />
                      </span>
                    ) : null}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <NimiText as="h3" role="section-title" className="truncate text-[1.0625rem]">
                        {primaryDisplayName || c.primaryFallbackTitle}
                      </NimiText>
                      <span className="text-xs font-medium text-[var(--nimi-action-primary-bg)]">{c.thisPcTag}</span>
                    </div>
                    <NimiText role="helper" className="leading-relaxed">
                      {remoteSubtitle}
                    </NimiText>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-3 self-end sm:self-center">
                  <div className="text-right">
                    <div className="text-[0.8125rem] font-medium text-[var(--nimi-text-primary)]">{c.remoteLabel}</div>
                    <div
                      className={`text-xs font-medium tabular-nums ${
                        listening && !query.isError
                          ? 'text-[var(--nimi-status-success)]'
                          : enabled && !query.isError
                            ? 'text-[var(--nimi-status-warning-soft-text)]'
                            : 'text-[var(--nimi-text-muted)]'
                      }`}
                    >
                      {switchStatusText}
                    </div>
                  </div>
                  <Toggle
                    checked={enabled}
                    disabled={toggleDisabled}
                    ariaLabel={enabled ? c.disable : c.enable}
                    className={enabled && listening ? 'data-[state=checked]:bg-[var(--nimi-status-success)]' : undefined}
                    onValueChange={(nextEnabled) =>
                      void action(() => api.setRemoteAccessEnabled({ enabled: nextEnabled, expectedBindingId: binding }))
                    }
                  />
                </div>
              </div>

              {primaryDrawer}

              <div className="border-t border-[var(--nimi-border-subtle)] pt-3.5 text-xs leading-relaxed text-[var(--nimi-text-muted)]">
                {c.runtimeHint}
                {enabled && !query.isError ? ` ${c.disableHint}` : ''}
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-secondary)]">
                    <Monitor size={22} aria-hidden="true" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <NimiText as="h3" role="section-title" className="text-base">
                      {nonPrimaryTitle}
                    </NimiText>
                    <NimiText role="helper" className="leading-relaxed">
                      {nonPrimaryDescription}
                    </NimiText>
                  </div>
                </div>
                {primaryAction ? <div className="shrink-0 self-start sm:self-center">{primaryAction}</div> : null}
              </div>

              {primaryDrawer}

              {!primarySetupOpen && !statusPending ? (
                <div className="flex items-center justify-between gap-4 border-t border-[var(--nimi-border-subtle)] pt-4">
                  <div className="flex min-w-0 items-center gap-2 text-[0.8125rem] text-[var(--nimi-text-muted)]">
                    <Radio size={15} className="shrink-0 opacity-60" aria-hidden="true" />
                    <span className="shrink-0">{c.remoteLabel}</span>
                    <span className="opacity-45" aria-hidden="true">
                      ·
                    </span>
                    <span className="truncate text-xs">
                      {primaryStatus === 'error' ? c.unavailable : c.primaryLocked}
                    </span>
                  </div>
                  <Toggle
                    checked={enabled}
                    disabled={toggleDisabled}
                    ariaLabel={enabled ? c.disable : c.enable}
                    onValueChange={(nextEnabled) =>
                      void action(() => api.setRemoteAccessEnabled({ enabled: nextEnabled, expectedBindingId: binding }))
                    }
                  />
                </div>
              ) : null}
            </>
          )}

          {query.isError ? (
            <div className="space-y-2 border-t border-[var(--nimi-border-subtle)] pt-4">
              <InlineFeedback
                feedback={{
                  kind: 'error',
                  message: c.error,
                  technicalDetail:
                    extractNimiErrorFields(query.error).reasonCode || (query.error instanceof Error ? query.error.message : undefined),
                }}
              />
              <Button tone="secondary" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>
                {zh ? '重新加载' : 'Retry'}
              </Button>
            </div>
          ) : null}

          {feedback ? (
            <div className="border-t border-[var(--nimi-border-subtle)] pt-4">
              <InlineFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />
            </div>
          ) : null}
        </div>
      </section>

      {/* Floating-Header External Applications & Live Connections Section */}
      <section className="min-w-0 space-y-4" aria-label={zh ? '外部应用与连接' : 'Application access'}>
        <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3.5">
            <NimiText as="h3" role="section-title" className="text-[0.9375rem]">
              {zh ? '外部应用与连接' : 'Application access'}
            </NimiText>

            {sources.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label={zh ? '按接入状态筛选' : 'Filter by access status'}>
                {filters.map((item) => {
                  const selected = filter === item.id;
                  const showDot = item.pendingAccent && item.count > 0;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setFilter(item.id)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-[transform,opacity,background-color,border-color,color] duration-150 active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] ${
                        selected
                          ? 'bg-[var(--nimi-surface-card)] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)]'
                          : 'text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)]'
                      }`}
                    >
                      {showDot ? <span className="size-1.5 rounded-full bg-[var(--nimi-status-warning)]" aria-hidden="true" /> : null}
                      <span>{item.label}</span>
                      {recordsKnown ? (
                        <span className="text-[0.6875rem] tabular-nums text-[var(--nimi-text-muted)]">{item.count}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {destination.connectionAppId || destination.connectionSourceId ? (
              <Button
                tone="ghost"
                size="sm"
                onClick={() => {
                  setSearch('');
                  setFilter('all');
                  void navigation.push({ id: 'connections' });
                }}
              >
                {zh ? '查看全部接入来源' : 'Show all access sources'}
              </Button>
            ) : null}

            {sources.length > 0 ? (
              <div className="w-full sm:w-52">
                <SearchField
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onClear={() => setSearch('')}
                  clearLabel={zh ? '清除搜索' : 'Clear search'}
                  placeholder={zh ? '搜索应用或域名' : 'Search apps or origins'}
                  aria-label={zh ? '搜索接入来源' : 'Search access sources'}
                />
              </div>
            ) : null}
          </div>
        </div>

        {query.isError && sources.length > 0 ? (
          <InlineAlert tone="warning">
            {zh ? '以下为上次读取的记录。恢复连接后才能操作。' : 'Showing the last records we could load. Reconnect to make changes.'}
          </InlineAlert>
        ) : null}

        {visiblePending.length > 0 ? (
          <div className="space-y-3">
            {visiblePending.map((source) => (
              <PendingSourceCard
                key={source.clientId}
                source={source}
                locale={i18n.language}
                c={c}
                disabled={busy || query.isError || !primaryStateKnown}
                onAllow={() =>
                  void action(() => api.confirmRemoteSource({ pendingRequestId: source.pendingRequestId, expectedBindingId: primaryBindingId }))
                }
                onReject={() =>
                  void action(() => api.rejectRemoteSource({ pendingRequestId: source.pendingRequestId, expectedBindingId: primaryBindingId }))
                }
              />
            ))}
          </div>
        ) : null}

        {visibleManaged.length > 0 ? (
          <div className="divide-y divide-[var(--nimi-border-subtle)] overflow-hidden rounded-[18px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] shadow-[var(--nimi-home-card-elevation)]">
            {visibleManaged.map((source) => (
              <ManagedSourceRow
                key={source.clientId}
                source={source}
                locale={i18n.language}
                c={c}
                connections={(query.data?.connections ?? [])
                  .filter((connection) => connection.clientId === source.clientId)
                  .sort(
                    (a, b) =>
                      Number(a.connectedAt?.seconds ?? 0) - Number(b.connectedAt?.seconds ?? 0) ||
                      (a.connectedAt?.nanos ?? 0) - (b.connectedAt?.nanos ?? 0) ||
                      a.connectionId.localeCompare(b.connectionId),
                  )}
                disabled={busy || query.isError || !primaryStateKnown}
                onPause={() =>
                  void action(() =>
                    api.setRemoteSourcePaused({
                      clientId: source.clientId,
                      paused: source.state !== RemoteSourceAccessState.PAUSED,
                      expectedBindingId: primaryBindingId,
                    }),
                  )
                }
                onEnd={(connectionId) =>
                  void action(() => api.disconnectRemoteConnection({ connectionId, expectedBindingId: primaryBindingId }), c.ended)
                }
              />
            ))}
          </div>
        ) : null}

        {hasVisibleLiveConnections ? (
          <p className="px-1 text-xs leading-relaxed text-[var(--nimi-text-muted)]">{c.connectionHint}</p>
        ) : null}

        {recordsKnown && visibleSources.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 rounded-[18px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-6 py-11 text-center shadow-[var(--nimi-home-card-elevation)]">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] text-[var(--nimi-action-primary-bg)]">
              {sources.length === 0 ? <Globe2 size={20} aria-hidden="true" /> : <SearchX size={20} aria-hidden="true" />}
            </div>
            <NimiText role="label">
              {sources.length === 0
                ? destination.connectionAppId || destination.connectionSourceId
                  ? zh
                    ? '当前没有此应用或来源的接入记录'
                    : 'No current access record for this application or source.'
                  : c.empty
                : zh
                  ? '没有找到匹配的应用'
                  : 'No matching sources'}
            </NimiText>
            <NimiText role="helper" className="max-w-sm">
              {sources.length === 0
                ? zh
                  ? '使用同一 Nimi 账号打开网页管理端或支持远程接入的应用，首次连接请求会实时显示在这里。'
                  : 'Connect from a client with the same Nimi account. Its first request will appear here.'
                : zh
                  ? '尝试更换关键词，或清除筛选查看全部应用。'
                  : 'Try another search or view all sources.'}
            </NimiText>
            {sources.length > 0 ? (
              <Button
                tone="ghost"
                size="sm"
                onClick={() => {
                  setSearch('');
                  setFilter('all');
                }}
              >
                {zh ? '清除筛选' : 'Clear filters'}
              </Button>
            ) : null}
          </div>
        ) : null}

        {!recordsKnown && sources.length === 0 ? (
          statusFailed ? (
            <InlineAlert tone="danger">{c.error}</InlineAlert>
          ) : statusPending ? (
            <div className="rounded-[18px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-5 shadow-[var(--nimi-home-card-elevation)]">
              <LoadingSkeleton lines={2} label={c.loading} />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2.5 rounded-[18px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-6 py-10 text-center shadow-[var(--nimi-home-card-elevation)]">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-muted)]">
                <ShieldCheck size={20} aria-hidden="true" />
              </div>
              <NimiText role="label">
                {primaryStateKnown && !thisRuntime
                  ? zh
                    ? '设为主设备后管理外部应用'
                    : 'Bind this PC to manage external applications'
                  : zh
                    ? '开启远程直连后管理外部应用'
                    : 'Enable remote access to manage external applications'}
              </NimiText>
            </div>
          )
        ) : null}
      </section>
    </div>
  );
}

function PendingSourceCard({
  source,
  locale,
  c,
  disabled,
  onAllow,
  onReject,
}: {
  source: GetRemoteAccessStateResponse['sources'][number];
  locale: string;
  c: typeof copy.en;
  disabled: boolean;
  onAllow: () => void;
  onReject: () => void;
}) {
  const zh = locale.startsWith('zh');
  const tone = pickSourceTone(source.clientId, source.officialManager, true);
  const scopeText = source.officialManager
    ? c.managerScope
    : source.appAccess.includes('runtime.consume')
      ? c.appScope
      : c.scopedAppScope;

  return (
    <article
      style={{
        backgroundImage:
          'radial-gradient(460px 140px at 0% 0%, color-mix(in srgb, var(--nimi-status-warning) 9%, transparent), transparent 70%)',
      }}
      className="space-y-4 rounded-[18px] border border-[var(--nimi-status-warning-soft-border)] bg-[var(--nimi-surface-card)] p-5 shadow-[var(--nimi-home-card-elevation)]"
      data-testid={`remote-source:${source.clientId}`}
      aria-label={source.displayName}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <div
            style={{ backgroundColor: tone.bg, color: tone.fg }}
            className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-[0.9375rem] font-semibold"
          >
            {source.officialManager ? <ShieldCheck size={19} aria-hidden="true" /> : sourceInitial(source.displayName)}
          </div>
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <NimiText as="h4" role="label" className="break-words text-[var(--nimi-text-primary)]">
                {source.displayName}
              </NimiText>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--nimi-status-warning-soft-text)]">
                <span className="size-1.5 rounded-full bg-[var(--nimi-status-warning)]" aria-hidden="true" />
                {source.state === RemoteSourceAccessState.CHANGED ? c.changed : c.pending}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--nimi-text-muted)]">
              <span className="font-mono break-all select-text">{formatOriginHost(source.origin)}</span>
              <span className="opacity-50" aria-hidden="true">
                ·
              </span>
              <span>{source.officialManager ? c.manager : c.app}</span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button tone="secondary" size="sm" disabled={disabled || !source.pendingRequestId} onClick={onReject}>
            {c.reject}
          </Button>
          <Button tone="primary" size="sm" disabled={disabled || !source.pendingRequestId} onClick={onAllow}>
            {c.allow}
          </Button>
        </div>
      </div>

      <div className="space-y-2.5 pl-0 sm:pl-[58px]">
        <NimiText role="body" className="text-[0.8125rem] leading-relaxed text-[var(--nimi-text-secondary)]">
          {scopeText}
        </NimiText>

        {!source.officialManager ? (
          source.appAccess.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5" aria-label={c.scope}>
              {source.appAccess.map((domain) => (
                <li
                  key={domain}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-2.5 py-1 text-xs font-medium text-[var(--nimi-text-primary)]"
                >
                  <Check size={12} className="shrink-0 text-[var(--nimi-action-primary-bg)]" aria-hidden="true" />
                  <span>{accessLabels[domain]?.[zh ? 1 : 0] || domain}</span>
                </li>
              ))}
            </ul>
          ) : (
            <NimiText role="helper">{zh ? '未声明访问范围' : 'No access scope declared'}</NimiText>
          )
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-xs text-[var(--nimi-text-muted)]">
          <span>
            {c.once} {!source.officialManager ? c.unsupported : ''}
          </span>
          {source.capabilityContractRefs.length > 0 ? (
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-1 rounded-sm font-medium text-[var(--nimi-text-secondary)] transition-colors hover:text-[var(--nimi-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] [&::-webkit-details-marker]:hidden">
                <ChevronRight size={12} className="shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
                <span>
                  {c.capability} ({source.capabilityContractRefs.length})
                </span>
              </summary>
              <div className="mt-1.5 rounded-lg bg-[var(--nimi-surface-panel)] px-2.5 py-1.5 font-mono text-[0.6875rem] break-all text-[var(--nimi-text-secondary)]">
                {source.capabilityContractRefs.join(', ')}
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ManagedSourceRow({
  source,
  connections,
  locale,
  c,
  disabled,
  onPause,
  onEnd,
}: {
  source: GetRemoteAccessStateResponse['sources'][number];
  connections: GetRemoteAccessStateResponse['connections'];
  locale: string;
  c: typeof copy.en;
  disabled: boolean;
  onPause: () => void;
  onEnd: (connectionId: string) => void;
}) {
  const zh = locale.startsWith('zh');
  const paused = source.state === RemoteSourceAccessState.PAUSED;
  const [expanded, setExpanded] = useState(false);
  const tone = pickSourceTone(source.clientId, source.officialManager, false);

  return (
    <article
      className="px-5 py-4 transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-surface-panel)_55%,var(--nimi-surface-card))]"
      data-testid={`remote-source:${source.clientId}`}
      aria-label={source.displayName}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <div
            style={paused ? undefined : { backgroundColor: tone.bg, color: tone.fg }}
            className={`flex size-10 shrink-0 items-center justify-center rounded-[13px] text-sm font-semibold ${
              paused ? 'bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-muted)]' : ''
            }`}
          >
            {source.officialManager ? <ShieldCheck size={18} aria-hidden="true" /> : sourceInitial(source.displayName)}
          </div>

          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <NimiText
                as="h4"
                role="label"
                className={`break-words ${paused ? 'text-[var(--nimi-text-muted)]' : 'text-[var(--nimi-text-primary)]'}`}
              >
                {source.displayName}
              </NimiText>
              {source.officialManager ? (
                <span className="text-xs font-medium text-[var(--nimi-action-primary-bg)]">{c.manager}</span>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono break-all select-text text-[var(--nimi-text-muted)]">{formatOriginHost(source.origin)}</span>
              <span className="text-[var(--nimi-border-subtle)]" aria-hidden="true">
                ·
              </span>
              {paused ? (
                <span className="text-[var(--nimi-text-muted)]">{c.paused}</span>
              ) : connections.length > 0 ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-[var(--nimi-status-success)]">
                  <span className="size-1.5 rounded-full bg-[var(--nimi-status-success)]" aria-hidden="true" />
                  {zh ? `${connections.length} 条实时连接` : `${connections.length} live`}
                </span>
              ) : (
                <span className="text-[var(--nimi-text-secondary)]">{c.allowed}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={disabled}
            onClick={onPause}
            className={`inline-flex min-h-8 items-center rounded-lg px-2.5 text-xs font-medium transition-[transform,background-color,color] duration-150 active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] disabled:cursor-not-allowed disabled:opacity-45 ${
              paused
                ? 'text-[var(--nimi-action-primary-bg)] hover:bg-[var(--nimi-action-ghost-hover)]'
                : 'text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)]'
            }`}
          >
            {paused ? c.resume : c.pause}
          </button>
          <button
            type="button"
            aria-label={`${zh ? '查看访问权限' : 'View access permissions'} · ${source.displayName}`}
            aria-expanded={expanded}
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-[var(--nimi-text-secondary)] transition-[transform,background-color,color] duration-150 hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)] active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
          >
            <span>{zh ? '权限' : 'Access'}</span>
            <ChevronDown size={12} className={`transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {connections.length > 0 ? (
        <div className="mt-3 ml-5 space-y-1 border-l-[1.5px] border-[var(--nimi-border-subtle)] pl-5">
          {connections.map((connection) => (
            <div
              key={connection.connectionId}
              data-testid="remote-connection"
              data-connection-id={connection.connectionId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl py-1 pl-2 pr-1.5 transition-colors hover:bg-[var(--nimi-surface-panel)]"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
                <span className="size-1.5 shrink-0 rounded-full bg-[var(--nimi-status-success)]" aria-hidden="true" />
                <span className="text-[var(--nimi-text-secondary)]">{c.connection}</span>
                <span className="font-mono text-xs text-[var(--nimi-text-muted)]">#{connection.connectionId.slice(0, 8)}</span>
                <span className="text-[var(--nimi-border-subtle)]" aria-hidden="true">
                  ·
                </span>
                <span className="tabular-nums text-[var(--nimi-text-muted)]">
                  {connection.connectedAt
                    ? `${c.connectedAt} ${new Date(Number(connection.connectedAt.seconds) * 1000 + connection.connectedAt.nanos / 1_000_000).toLocaleString(locale)}`
                    : c.timeUnknown}
                </span>
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onEnd(connection.connectionId)}
                className="rounded-lg px-2 py-1 text-xs font-medium text-[var(--nimi-text-muted)] transition-[transform,background-color,color] duration-150 hover:bg-[var(--nimi-status-danger-soft-bg)] hover:text-[var(--nimi-status-danger-soft-text)] active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {c.endConnection}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {expanded ? (
        <div className="mt-3 ml-0 space-y-2.5 rounded-2xl bg-[var(--nimi-surface-panel)] px-4 py-3.5 text-xs sm:ml-[54px]">
          <p className="leading-relaxed text-[var(--nimi-text-secondary)]">
            {source.officialManager
              ? c.managerScope
              : source.appAccess.includes('runtime.consume')
                ? c.appScope
                : c.scopedAppScope}
          </p>
          {!source.officialManager ? (
            source.appAccess.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {source.appAccess.map((domain) => (
                  <li
                    key={domain}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2.5 py-0.5 text-xs font-medium text-[var(--nimi-text-primary)]"
                  >
                    <Check size={11} className="shrink-0 text-[var(--nimi-action-primary-bg)]" aria-hidden="true" />
                    <span>{accessLabels[domain]?.[zh ? 1 : 0] || domain}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <NimiText role="helper">{zh ? '未声明访问范围' : 'No access scope declared'}</NimiText>
            )
          ) : null}
          <p className="text-xs leading-relaxed text-[var(--nimi-text-muted)]">
            {c.pauseHint} {c.once}
          </p>
          {source.capabilityContractRefs.length > 0 ? (
            <div className="font-mono text-[0.6875rem] break-all text-[var(--nimi-text-muted)]">
              {source.capabilityContractRefs.join(' · ')}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
