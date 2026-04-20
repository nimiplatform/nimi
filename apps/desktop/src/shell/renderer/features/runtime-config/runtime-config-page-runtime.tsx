import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { CAPABILITIES_V11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { desktopBridge } from '@renderer/bridge';
import { Surface, StatusBadge as KitStatusBadge, Tooltip, cn } from '@nimiplatform/nimi-kit/ui';
import { formatLocaleDateTime } from '@renderer/i18n';
import { SectionTitle } from '@renderer/features/settings/settings-layout-components';
import { RuntimeHealthSection } from './runtime-config-runtime-health-section.js';
import { GlobalAuditSection } from './runtime-config-global-audit-section.js';
import { UsageStatsSection } from './runtime-config-usage-stats-section.js';
import { LocalDebugSection } from './runtime-config-local-debug-section.js';
import { useGlobalAuditData } from './runtime-config-use-global-audit-data.js';
import { ExternalAgentAccessPanel } from './runtime-config-external-agent-access';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { describeRuntimeDaemonIssue } from './runtime-daemon-guidance';
import { localSpeechReasonSummary } from './runtime-config-model-center-utils';
import { RuntimeConfigMemoryEmbeddingSection } from './runtime-config-memory-embedding-section';
import { Button, Card, StatusBadge } from './runtime-config-primitives';
import { RuntimePageShell } from './runtime-config-page-shell';

type RuntimeTabKey = 'overview' | 'health' | 'activity' | 'access';

// Shared tokens & tones — kept in sync with runtime-config-page-overview.tsx
const TOKEN_TEXT_PRIMARY = 'text-[var(--nimi-text-primary)]';
const TOKEN_TEXT_SECONDARY = 'text-[var(--nimi-text-secondary)]';
const TOKEN_TEXT_MUTED = 'text-[var(--nimi-text-muted)]';
const TOKEN_PANEL_CARD = 'rounded-2xl';

type RuntimeTone = 'neutral' | 'success' | 'warning' | 'danger';

const TONE_STYLES: Record<RuntimeTone, {
  surface: string;
  subtleText: string;
  badge: 'neutral' | 'success' | 'warning' | 'danger';
}> = {
  neutral: {
    surface: 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]',
    subtleText: 'text-[var(--nimi-text-secondary)]',
    badge: 'neutral',
  },
  success: {
    surface: 'border-[color-mix(in_srgb,var(--nimi-status-success)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-success)_8%,var(--nimi-surface-card))]',
    subtleText: 'text-[var(--nimi-status-success)]',
    badge: 'success',
  },
  warning: {
    surface: 'border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_8%,var(--nimi-surface-card))]',
    subtleText: 'text-[var(--nimi-status-warning)]',
    badge: 'warning',
  },
  danger: {
    surface: 'border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,var(--nimi-surface-card))]',
    subtleText: 'text-[var(--nimi-status-danger)]',
    badge: 'danger',
  },
};

type StatusDotTone = 'success' | 'warning' | 'danger' | 'muted';

function StatusDot({ tone, pulse }: { tone: StatusDotTone; pulse?: boolean }) {
  const colorMap: Record<StatusDotTone, string> = {
    success: 'bg-[var(--nimi-status-success)]',
    warning: 'bg-[var(--nimi-status-warning)]',
    danger: 'bg-[var(--nimi-status-danger)]',
    muted: 'bg-[var(--nimi-text-muted)]',
  };
  return (
    <span className="relative inline-flex h-2 w-2 items-center justify-center">
      {pulse ? (
        <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', colorMap[tone])} aria-hidden />
      ) : null}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', colorMap[tone])} />
    </span>
  );
}

function IconButton({
  icon,
  title,
  disabled,
  onClick,
  tone = 'default',
}: {
  icon: React.ReactNode;
  title: string;
  disabled?: boolean;
  onClick: () => void;
  tone?: 'default' | 'danger';
}) {
  return (
    <Tooltip content={title} placement="top">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-md text-[var(--nimi-text-muted)] transition-colors hover:text-[var(--nimi-text-primary)] disabled:cursor-not-allowed disabled:opacity-50',
          tone === 'danger'
            ? 'hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,transparent)] hover:text-[var(--nimi-status-danger)]'
            : 'hover:bg-[var(--nimi-surface-panel)]',
        )}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

type RuntimePageProps = {
  model: RuntimeConfigPanelControllerModel;
  state: RuntimeConfigStateV11;
};

export function RuntimePage({ model, state }: RuntimePageProps) {
  const { t } = useTranslation();
  const auditData = useGlobalAuditData(true);
  const [nodeMatrixExpanded, setNodeMatrixExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<RuntimeTabKey>('overview');

  const daemonRunning = model.runtimeDaemonStatus?.running === true;
  const daemonBusy = model.runtimeDaemonBusyAction !== null;
  const canManageDaemon = desktopBridge.hasTauriInvoke();
  const daemonIssue = describeRuntimeDaemonIssue({
    status: model.runtimeDaemonStatus,
    runtimeDaemonError: model.runtimeDaemonError,
  });

  // Capability summary
  const capabilitySummary = useMemo(() => {
    return CAPABILITIES_V11.map((capability) => {
      const localNode = state.local.nodeMatrix.find(
        (node) => node.capability === capability && node.available,
      );
      const hasLocalModel = state.local.models.some(
        (m) => m.status === 'active' && m.capabilities.includes(capability),
      );
      const cloudAvailable = state.connectors.some((c) => c.status === 'healthy');
      const errorNode = !localNode && !hasLocalModel && !cloudAvailable
        ? state.local.nodeMatrix.find(
          (node) => node.capability === capability && !node.available && node.reasonCode,
        )
        : undefined;
      return {
        capability,
        localAvailable: Boolean(localNode) || hasLocalModel,
        cloudAvailable,
        localProvider: localNode?.provider,
        errorReason: errorNode?.reasonCode ? String(errorNode.reasonCode) : undefined,
      };
    });
  }, [state]);

  const [copiedEndpoint, setCopiedEndpoint] = useState(false);
  const onCopyEndpoint = useCallback(() => {
    const value = state.local.endpoint;
    if (!value) return;
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : null;
    if (!clip?.writeText) return;
    void clip.writeText(value).then(() => {
      setCopiedEndpoint(true);
      window.setTimeout(() => setCopiedEndpoint(false), 1500);
    }).catch(() => undefined);
  }, [state.local.endpoint]);

  // Node matrix
  const sortedNodeMatrix = useMemo(
    () =>
      [...(state.local.nodeMatrix || [])].sort(
        (left, right) =>
          String(left.capability || '').localeCompare(String(right.capability || '')) ||
          String(left.nodeId || '').localeCompare(String(right.nodeId || '')),
      ),
    [state.local.nodeMatrix],
  );

  const providerStatusSummary = useMemo(() => {
    const grouped = new Map<
      string,
      {
        provider: string;
        total: number;
        available: number;
        reasonCodes: Set<string>;
        policyGates: Set<string>;
        npuStates: Set<string>;
      }
    >();
    for (const row of sortedNodeMatrix) {
      const provider = String(row.provider || 'llama').trim() || 'llama';
      const current = grouped.get(provider) || {
        provider,
        total: 0,
        available: 0,
        reasonCodes: new Set<string>(),
        policyGates: new Set<string>(),
        npuStates: new Set<string>(),
      };
      current.total += 1;
      if (row.available) current.available += 1;
      else if (row.reasonCode) current.reasonCodes.add(String(row.reasonCode));
      if (row.policyGate) current.policyGates.add(String(row.policyGate));
      grouped.set(provider, current);
    }
    return [...grouped.values()].sort((a, b) => a.provider.localeCompare(b.provider));
  }, [sortedNodeMatrix]);

  const availableCapabilityCount = useMemo(
    () => capabilitySummary.filter((item) => item.localAvailable || item.cloudAvailable).length,
    [capabilitySummary],
  );

  const unhealthyProviderCount = useMemo(() => {
    return auditData.providerHealth.filter((snapshot) => {
      const stateValue = String(snapshot.state || '').toLowerCase();
      return stateValue !== '' && stateValue !== 'healthy' && stateValue !== 'idle';
    }).length;
  }, [auditData.providerHealth]);

  const tabs: Array<{ key: RuntimeTabKey; label: string; badge?: number }> = [
    { key: 'overview', label: t('runtimeConfig.runtime.tabOverview', { defaultValue: 'Overview' }) },
    {
      key: 'health',
      label: t('runtimeConfig.runtime.tabHealth', { defaultValue: 'Health' }),
      badge: unhealthyProviderCount > 0 ? unhealthyProviderCount : undefined,
    },
    { key: 'activity', label: t('runtimeConfig.runtime.tabActivity', { defaultValue: 'Activity' }) },
    { key: 'access', label: t('runtimeConfig.runtime.tabAccess', { defaultValue: 'Access' }) },
  ];

  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false });
  const activeTabIndex = tabs.findIndex((tab) => tab.key === activeTab);

  useLayoutEffect(() => {
    const el = tabRefs.current[activeTabIndex];
    if (!el) return;
    setIndicator({ left: el.offsetLeft, width: el.offsetWidth, ready: true });
  }, [activeTabIndex, unhealthyProviderCount]);

  return (
    <RuntimePageShell>
      {/* Tab bar: underline-style with animated indicator (non-sticky, flows with page) */}
      <div className="relative flex items-center gap-7 border-b border-[var(--nimi-border-subtle)] overflow-x-auto">
        {tabs.map((tab, index) => {
          const isActive = tab.key === activeTab;
          return (
            <button
              key={`runtime-tab-${tab.key}`}
              type="button"
              ref={(el) => { tabRefs.current[index] = el; }}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'group relative shrink-0 px-0.5 py-2.5 text-sm font-medium transition-all duration-200 ease-out',
                isActive
                  ? 'text-[var(--nimi-text-primary)]'
                  : 'text-[var(--nimi-text-muted)] hover:-translate-y-[1px] hover:text-[var(--nimi-text-primary)]',
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                {tab.label}
                {tab.badge ? (
                  <span className={cn(
                    'inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-4 transition-colors',
                    isActive
                      ? 'bg-[var(--nimi-status-danger)] text-white'
                      : 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_14%,transparent)] text-[var(--nimi-status-danger)]',
                  )}>
                    {tab.badge}
                  </span>
                ) : null}
              </span>
              {!isActive ? (
                <span className="pointer-events-none absolute inset-x-0 -bottom-px h-[2px] origin-center scale-x-0 rounded-full bg-[var(--nimi-text-muted)] opacity-0 transition-all duration-200 ease-out group-hover:scale-x-100 group-hover:opacity-40" />
              ) : null}
            </button>
          );
        })}
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-px h-[2px] rounded-full bg-[var(--nimi-action-primary-bg)] transition-[left,width,opacity] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{
            left: indicator.left,
            width: indicator.width,
            opacity: indicator.ready ? 1 : 0,
          }}
        />
      </div>

      {activeTab === 'overview' ? (
        <>
          {/* Bento top row: Hero Console (2/3) + Endpoint (1/3) — always side-by-side */}
          <div className="grid grid-cols-3 gap-4">
            {/* Hero Console */}
            <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'col-span-2 p-5')}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <StatusDot tone={daemonRunning ? 'success' : 'danger'} pulse={daemonRunning} />
                    <h2 className={cn('text-base font-semibold', TOKEN_TEXT_PRIMARY)}>
                      {daemonRunning
                        ? t('runtimeConfig.runtime.daemonIsRunning', { defaultValue: 'Daemon is running' })
                        : t('runtimeConfig.runtime.daemonIsStopped', { defaultValue: 'Daemon is stopped' })}
                    </h2>
                  </div>
                  {model.runtimeDaemonUpdatedAt ? (
                    <p className={cn('mt-1.5 text-xs', TOKEN_TEXT_MUTED)}>
                      {t('runtimeConfig.overview.lastCheck', { defaultValue: 'Last check' })}
                      {': '}
                      {formatLocaleDateTime(model.runtimeDaemonUpdatedAt)}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button variant="secondary" size="sm" disabled={daemonBusy} onClick={() => void model.refreshRuntimeDaemonStatus()}>
                    {daemonBusy
                      ? t('runtimeConfig.overview.working', { defaultValue: 'Working...' })
                      : t('runtimeConfig.runtime.refresh', { defaultValue: 'Refresh' })}
                  </Button>
                  {daemonRunning ? (
                    <>
                      <Button variant="secondary" size="sm" disabled={!canManageDaemon || daemonBusy} onClick={() => void model.restartRuntimeDaemon()}>
                        {t('runtimeConfig.overview.restart', { defaultValue: 'Restart' })}
                      </Button>
                      <Button variant="ghost" size="sm" disabled={!canManageDaemon || daemonBusy} onClick={() => void model.stopRuntimeDaemon()}>
                        {t('runtimeConfig.overview.stop', { defaultValue: 'Stop' })}
                      </Button>
                    </>
                  ) : (
                    <Button variant="secondary" size="sm" disabled={!canManageDaemon || daemonBusy} onClick={() => void model.startRuntimeDaemon()}>
                      {t('runtimeConfig.overview.start', { defaultValue: 'Start' })}
                    </Button>
                  )}
                </div>
              </div>

              {(() => {
                const toneStyle = TONE_STYLES[daemonRunning ? 'success' : 'danger'];
                const entries = [
                  {
                    key: 'grpc',
                    label: t('runtimeConfig.runtime.grpcBind', { defaultValue: 'gRPC Bind' }),
                    value: model.runtimeDaemonStatus?.grpcAddr || '127.0.0.1:46371',
                  },
                  {
                    key: 'pid',
                    label: t('runtimeConfig.overview.pid', { defaultValue: 'PID' }),
                    value: model.runtimeDaemonStatus?.pid ? String(model.runtimeDaemonStatus.pid) : '—',
                  },
                  {
                    key: 'mode',
                    label: t('runtimeConfig.runtime.mode', { defaultValue: 'Mode' }),
                    value: model.runtimeDaemonStatus?.launchMode || '—',
                  },
                ];
                return (
                  <Surface
                    tone="card"
                    className={cn('mt-5 rounded-xl border px-5 py-4', toneStyle.surface)}
                  >
                    <div className="grid grid-cols-3 gap-4">
                      {entries.map((entry) => (
                        <div key={entry.key} className="min-w-0">
                          <p className={cn('text-[11px]', toneStyle.subtleText)}>{entry.label}</p>
                          <p className={cn('mt-1 truncate font-mono text-sm', TOKEN_TEXT_PRIMARY)}>
                            {entry.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </Surface>
                );
              })()}

              {daemonIssue ? (
                <div className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] px-3 py-3">
                  <p className="text-sm font-medium text-[var(--nimi-status-warning)]">{daemonIssue.title}</p>
                  <p className="mt-1 text-xs text-[color-mix(in_srgb,var(--nimi-status-warning)_80%,var(--nimi-text-secondary))]">{daemonIssue.message}</p>
                  <p className="mt-2 text-[11px] text-[color-mix(in_srgb,var(--nimi-status-warning)_75%,var(--nimi-text-secondary))]">{daemonIssue.rawError}</p>
                </div>
              ) : model.runtimeDaemonError ? <p className="mt-4 text-xs text-[var(--nimi-status-danger)]">{model.runtimeDaemonError}</p> : null}
            </Surface>

            {/* Endpoint — elevated to top bento, with hover copy affordance */}
            <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'group p-5')}>
              <p className={cn('text-[10px] font-semibold uppercase tracking-[0.16em]', TOKEN_TEXT_MUTED)}>
                {t('runtimeConfig.runtime.localEndpointShort', { defaultValue: 'Local Endpoint' })}
              </p>
              <div className="relative mt-3">
                <input
                  type="text"
                  value={state.local.endpoint}
                  onChange={(event) => {
                    const nextEndpoint = event.target.value;
                    model.updateState((prev) => ({
                      ...prev,
                      local: { ...prev.local, endpoint: nextEndpoint },
                    }));
                  }}
                  placeholder={t('runtimeConfig.runtime.endpointPlaceholder', { defaultValue: 'http://host:port[/base-path]' })}
                  spellCheck={false}
                  className={cn(
                    'w-full rounded-lg border border-[var(--nimi-border-subtle)] bg-transparent px-3 py-2 pr-9 font-mono text-sm outline-none transition-colors focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]',
                    TOKEN_TEXT_PRIMARY,
                  )}
                />
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <IconButton
                    icon={copiedEndpoint ? <CheckIcon /> : <CopyIcon />}
                    title={copiedEndpoint
                      ? t('runtimeConfig.runtime.copied', { defaultValue: 'Copied' })
                      : t('runtimeConfig.runtime.copy', { defaultValue: 'Copy' })}
                    onClick={onCopyEndpoint}
                  />
                </div>
              </div>
            </Surface>
          </div>

          {/* Capabilities */}
          <section className="mt-8">
            <div className="mb-4 flex items-center justify-between">
              <SectionTitle>
                {t('runtimeConfig.runtime.capabilities', { defaultValue: 'Capabilities' })}
              </SectionTitle>
              <span className={cn('text-xs', TOKEN_TEXT_MUTED)}>
                <span className={cn('font-medium', TOKEN_TEXT_PRIMARY)}>{availableCapabilityCount}</span>
                <span>{` / ${capabilitySummary.length} `}</span>
                {t('runtimeConfig.runtime.active', { defaultValue: 'active' })}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {capabilitySummary.map((item) => {
                const available = item.localAvailable || item.cloudAvailable;
                const errored = !available && Boolean(item.errorReason);
                const tone: RuntimeTone = item.localAvailable
                  ? 'success'
                  : item.cloudAvailable
                    ? 'warning'
                    : errored
                      ? 'danger'
                      : 'neutral';
                const toneStyle = TONE_STYLES[tone];

                if (available) {
                  return (
                    <Surface
                      key={`cap-runtime-${item.capability}`}
                      tone="card"
                      className={cn(
                        TOKEN_PANEL_CARD,
                        'flex min-h-[92px] flex-col border p-4 transition-all duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[0_12px_28px_rgba(15,23,42,0.08)]',
                        toneStyle.surface,
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <StatusDot tone={item.localAvailable ? 'success' : 'warning'} pulse={item.localAvailable} />
                          <span className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>{item.capability}</span>
                        </div>
                        <KitStatusBadge tone={toneStyle.badge}>
                          {item.localAvailable
                            ? t('runtimeConfig.runtime.badgeLocal', { defaultValue: 'local' })
                            : t('runtimeConfig.runtime.badgeCloud', { defaultValue: 'cloud' })}
                        </KitStatusBadge>
                      </div>
                      {item.localProvider ? (
                        <p className={cn('mt-3 text-xs', TOKEN_TEXT_SECONDARY)}>
                          <span className={TOKEN_TEXT_MUTED}>
                            {t('runtimeConfig.runtime.modelLabel', { defaultValue: 'Model' })}
                            {': '}
                          </span>
                          <span className={cn('font-mono', TOKEN_TEXT_PRIMARY)}>{item.localProvider}</span>
                        </p>
                      ) : null}
                    </Surface>
                  );
                }

                if (errored) {
                  return (
                    <Surface
                      key={`cap-runtime-${item.capability}`}
                      tone="card"
                      className={cn(
                        TOKEN_PANEL_CARD,
                        'flex min-h-[92px] flex-col border p-4 transition-all duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[0_14px_30px_rgba(220,38,38,0.12)]',
                        toneStyle.surface,
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <StatusDot tone="danger" pulse />
                          <span className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>{item.capability}</span>
                        </div>
                        <KitStatusBadge tone={toneStyle.badge}>
                          {t('runtimeConfig.runtime.badgeError', { defaultValue: 'error' })}
                        </KitStatusBadge>
                      </div>
                      <p className={cn('mt-2 text-xs', toneStyle.subtleText)}>
                        {item.errorReason}
                      </p>
                      <button
                        type="button"
                        onClick={() => setActiveTab('health')}
                        className={cn('mt-auto self-start pt-3 text-xs font-medium underline underline-offset-4 transition-colors hover:no-underline', toneStyle.subtleText)}
                      >
                        {t('runtimeConfig.runtime.viewLogs', { defaultValue: 'View logs' })}
                      </button>
                    </Surface>
                  );
                }

                // Not configured — muted, lights up on hover
                return (
                  <Surface
                    key={`cap-runtime-${item.capability}`}
                    tone="card"
                    className={cn(
                      TOKEN_PANEL_CARD,
                      'group flex min-h-[92px] flex-col items-center justify-center border border-dashed p-4 text-center transition-all duration-200 ease-out hover:-translate-y-[1px] hover:border-solid hover:border-[color-mix(in_srgb,var(--nimi-status-success)_55%,transparent)] hover:bg-[color-mix(in_srgb,var(--nimi-status-success)_6%,var(--nimi-surface-card))] hover:shadow-[0_12px_26px_rgba(15,23,42,0.06)]',
                      toneStyle.surface,
                    )}
                  >
                    <p className={cn('text-sm font-medium transition-colors group-hover:text-[var(--nimi-text-primary)]', TOKEN_TEXT_SECONDARY)}>
                      {item.capability}
                    </p>
                    <p className={cn('mt-1 text-xs', TOKEN_TEXT_MUTED)}>
                      {t('runtimeConfig.runtime.capabilityNotConfigured', { defaultValue: 'Not configured' })}
                    </p>
                    <div className="mt-3 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => model.onChangePage('local')}
                        className={cn('inline-flex items-center gap-1 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-[color-mix(in_srgb,var(--nimi-status-success)_55%,transparent)] hover:text-[var(--nimi-status-success)]', TOKEN_TEXT_SECONDARY)}
                      >
                        <PlusIcon />
                        {t('runtimeConfig.runtime.installModel', { defaultValue: 'Install Model' })}
                      </button>
                      <IconButton
                        icon={<KeyIcon />}
                        title={t('runtimeConfig.runtime.addApiKey', { defaultValue: 'Add API Key' })}
                        onClick={() => model.onChangePage('cloud')}
                      />
                    </div>
                  </Surface>
                );
              })}
            </div>
          </section>
        </>
      ) : null}

      {activeTab === 'health' ? (
        <>
          {/* Runtime Health */}
          <RuntimeHealthSection
            runtimeHealth={auditData.runtimeHealth}
            providerHealth={auditData.providerHealth}
            loading={auditData.healthLoading}
            error={auditData.healthError}
            streamConnected={auditData.healthStreamConnected}
            streamError={auditData.healthStreamError}
            stale={auditData.healthStale}
            onRefresh={() => void auditData.loadHealth()}
          />

          {/* Provider Runtime Status */}
          <section>
            <SectionTitle>
              {t('runtimeConfig.runtime.providerStatus', { defaultValue: 'Provider Runtime Status' })}
            </SectionTitle>
            <Card className="mt-3 p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="text-sm text-[var(--nimi-text-secondary)]">
                  {t('runtimeConfig.runtime.localRuntimeProviderStatus', { defaultValue: 'Local runtime provider status' })}
                </div>
                <StatusBadge status={state.local.status} />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-xl bg-[var(--nimi-surface-panel)] p-3 ring-1 ring-[color-mix(in_srgb,var(--nimi-border-subtle)_80%,transparent)]">
                  <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.runtime.lastCheckLabel', { defaultValue: 'Last Check' })}</p>
                  <p className="text-sm font-medium text-[var(--nimi-text-primary)]">
                    {state.local.lastCheckedAt ? formatLocaleDateTime(state.local.lastCheckedAt) : '-'}
                  </p>
                </div>
                <div className="rounded-xl bg-[var(--nimi-surface-panel)] p-3 ring-1 ring-[color-mix(in_srgb,var(--nimi-border-subtle)_80%,transparent)] md:col-span-2">
                  <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.runtime.detail', { defaultValue: 'Detail' })}</p>
                  <p className="text-sm font-medium text-[var(--nimi-text-primary)]">{state.local.lastDetail || '-'}</p>
                </div>
              </div>
            </Card>
          </section>

          {/* Node Matrix */}
          <section>
            <SectionTitle>
              {t('runtimeConfig.runtime.nodeMatrix', { defaultValue: 'Node Capability Matrix' })}
            </SectionTitle>
            <Card className="mt-3 p-5">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left mb-3"
                onClick={() => setNodeMatrixExpanded((prev) => !prev)}
              >
                <span className="text-sm font-medium text-[var(--nimi-text-primary)]">
                  {t('runtimeConfig.runtime.nodeMatrixShort', { defaultValue: 'Node Matrix' })}
                </span>
                <span className="text-xs text-[var(--nimi-text-muted)]">
                  {nodeMatrixExpanded
                    ? t('runtimeConfig.runtime.collapse', { defaultValue: 'Collapse' })
                    : t('runtimeConfig.runtime.expand', { defaultValue: 'Expand' })}
                </span>
              </button>
              {providerStatusSummary.length > 0 ? (
                <div className="mb-3 space-y-2 rounded-xl bg-[var(--nimi-surface-panel)] p-3 ring-1 ring-[color-mix(in_srgb,var(--nimi-border-subtle)_80%,transparent)]">
                  {providerStatusSummary.map((summary) => (
                    <p key={`provider-summary-${summary.provider}`} className="text-[11px] text-[var(--nimi-text-secondary)]">
                      provider={summary.provider}
                      {' · '}available={summary.available}/{summary.total}
                      {summary.reasonCodes.size > 0 ? ` · reasonCodes=${[...summary.reasonCodes].join(',')}` : ''}
                      {summary.policyGates.size > 0 ? ` · policyGate=${[...summary.policyGates].join(',')}` : ''}
                      {summary.npuStates.size > 0 ? ` · npuState=${[...summary.npuStates].join(',')}` : ''}
                    </p>
                  ))}
                </div>
              ) : null}
              {!nodeMatrixExpanded ? null : sortedNodeMatrix.length === 0 ? (
                <p className="text-sm text-[var(--nimi-text-muted)]">
                  {t('runtimeConfig.runtime.noNodeAvailabilityData', {
                    defaultValue: 'No node availability data. Run Refresh to probe the local runtime.',
                  })}
                </p>
              ) : (
                <div className="space-y-2">
                  {sortedNodeMatrix.map((row) => {
                    const runtimeSupportClass = String(row.providerHints?.extra?.runtime_support_class || '').trim();
                    const runtimeSupportDetail = String(row.providerHints?.extra?.runtime_support_detail || '').trim();
                    const speechReasonSummary = localSpeechReasonSummary(row.reasonCode);
                    return (
                      <div key={`node-matrix-${row.nodeId}`} className="rounded-xl bg-[var(--nimi-surface-panel)] p-3 ring-1 ring-[color-mix(in_srgb,var(--nimi-border-subtle)_80%,transparent)]">
                        <p className="text-xs font-medium text-[var(--nimi-text-primary)]">
                          {row.capability} · {row.nodeId}
                        </p>
                        <p className="text-xs text-[var(--nimi-text-secondary)]">
                          {row.available ? 'available' : 'unavailable'} · provider={row.provider || 'llama'} · adapter={
                            row.adapter
                          }
                          {row.backend ? ` · backend=${row.backend}` : ''}
                          {runtimeSupportClass ? ` · runtimeSupport=${runtimeSupportClass}` : ''}
                        </p>
                        {runtimeSupportDetail ? (
                          <p className="text-xs text-[var(--nimi-text-secondary)]">runtimeSupportDetail={runtimeSupportDetail}</p>
                        ) : null}
                        {row.policyGate ? <p className="text-xs text-[var(--nimi-text-secondary)]">policyGate={row.policyGate}</p> : null}
                        {!row.available && speechReasonSummary ? (
                          <p className="text-xs text-[var(--nimi-status-warning)]">{speechReasonSummary}</p>
                        ) : null}
                        {!row.available && row.reasonCode ? (
                          <p className="text-xs text-[var(--nimi-status-warning)]">reason={row.reasonCode}</p>
                        ) : null}
                        {(runtimeSupportClass === 'attached_only' || runtimeSupportClass === 'unsupported') ? (
                          <p className="text-xs text-[var(--nimi-status-warning)]">
                            Managed local engine is unavailable on this host. Configure an attached endpoint to use this provider.
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </section>
        </>
      ) : null}

      {activeTab === 'activity' ? (
        <>
          {/* Audit Log */}
          <GlobalAuditSection
            events={auditData.auditEvents}
            loading={auditData.auditLoading}
            error={auditData.auditError}
            hasNextPage={!!auditData.auditNextPageToken}
            filters={auditData.auditFilters}
            onUpdateFilters={auditData.updateAuditFilters}
            onRefresh={() => void auditData.loadAuditEvents()}
            onLoadMore={() => void auditData.loadNextAuditPage()}
            onExport={(format) => void auditData.exportAudit(format)}
          />

          {/* Usage Stats */}
          <UsageStatsSection
            records={auditData.usageRecords}
            loading={auditData.usageLoading}
            error={auditData.usageError}
            hasNextPage={!!auditData.usageNextPageToken}
            filters={auditData.usageFilters}
            summary={auditData.usageSummary}
            onUpdateFilters={auditData.updateUsageFilters}
            onRefresh={() => void auditData.loadUsageStats()}
            onLoadMore={() => void auditData.loadNextUsagePage()}
          />
        </>
      ) : null}

      {activeTab === 'access' ? (
        <>
          <RuntimeConfigMemoryEmbeddingSection state={state} />

          {/* External Agent Access */}
          <ExternalAgentAccessPanel />

          {/* Local Debug */}
          <LocalDebugSection collapsed={!auditData.localDebugExpanded} onToggle={auditData.toggleLocalDebug} />
        </>
      ) : null}
    </RuntimePageShell>
  );
}
