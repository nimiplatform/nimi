import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  GetRuntimeHealthResponse,
  AIProviderHealthSnapshot,
  AIProviderSubHealth,
} from '@nimiplatform/sdk/runtime';
import { Tooltip } from '@nimiplatform/nimi-kit/ui';
import { Card } from './runtime-config-primitives.js';
import {
  runtimeHealthStatusLabel,
  runtimeHealthStatusColor,
  providerStateColor,
  formatBytes,
  formatCpuMilli,
  timestampToIso,
  relativeTimeShort,
} from './runtime-config-global-audit-view-model.js';

// Icon Button Component
function IconButton({
  icon,
  title,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={title} placement="top">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--nimi-border-subtle)] bg-white/90 text-[var(--nimi-text-secondary)] transition-colors hover:bg-white hover:text-[var(--nimi-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {icon}
      </button>
    </Tooltip>
  );
}

// Refresh Icon
function RefreshIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

type RuntimeHealthSectionProps = {
  runtimeHealth: GetRuntimeHealthResponse | null;
  providerHealth: AIProviderHealthSnapshot[];
  loading: boolean;
  error: string | null;
  streamConnected: boolean;
  streamError: string | null;
  stale: boolean;
  onRefresh: () => void;
};

export function RuntimeHealthSection({
  runtimeHealth,
  providerHealth,
  loading,
  error,
  streamConnected,
  streamError,
  stale,
  onRefresh,
}: RuntimeHealthSectionProps) {
  const { t } = useTranslation();
  const health = runtimeHealth;

  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());

  const toggleProvider = (name: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('runtimeConfig.runtime.runtimeHealth', { defaultValue: 'Runtime Health' })}
        </h3>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              streamConnected && !stale
                ? 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]'
                : runtimeHealth
                  ? 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] text-[var(--nimi-status-warning)]'
                  : 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[var(--nimi-text-secondary)]'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${
              streamConnected && !stale ? 'bg-[var(--nimi-status-success)]' : runtimeHealth ? 'bg-[var(--nimi-status-warning)]' : 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_55%,transparent)]'
            }`} />
            {streamConnected && !stale
              ? t('runtimeConfig.runtime.live', { defaultValue: 'Live' })
              : runtimeHealth
                ? t('runtimeConfig.runtime.connecting', { defaultValue: 'Connecting...' })
                : t('runtimeConfig.runtime.off', { defaultValue: 'Off' })}
          </span>
          <IconButton
            icon={<RefreshIcon className={loading ? 'animate-spin' : ''} />}
            title={t('runtimeConfig.runtime.refresh', { defaultValue: 'Refresh' })}
            disabled={loading}
            onClick={onRefresh}
          />
        </div>
      </div>

      {error ? (
        <p className="text-xs text-[var(--nimi-status-danger)]">{error}</p>
      ) : null}

      {streamError ? (
        <p className="text-xs text-yellow-600">
          {t('runtimeConfig.runtime.streamError', { defaultValue: 'Stream error' })}: {streamError}
        </p>
      ) : null}

      {health ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-medium ${runtimeHealthStatusColor(health.status)}`}>
              {runtimeHealthStatusLabel(health.status)}
            </span>
            <span className="text-[var(--nimi-text-secondary)]">{t('runtimeConfig.runtime.queue', { defaultValue: 'Queue' })}: <strong>{health.queueDepth}</strong></span>
            <span className="text-[var(--nimi-text-secondary)]">{t('runtimeConfig.runtime.workflows', { defaultValue: 'Workflows' })}: <strong>{health.activeWorkflows}</strong></span>
            <span className="text-[var(--nimi-text-secondary)]">{t('runtimeConfig.runtime.jobs', { defaultValue: 'Jobs' })}: <strong>{health.activeInferenceJobs}</strong></span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--nimi-text-secondary)]">
            <span>{t('runtimeConfig.runtime.cpu', { defaultValue: 'CPU' })}: <strong>{formatCpuMilli(health.cpuMilli)}</strong></span>
            <span>{t('runtimeConfig.runtime.ram', { defaultValue: 'RAM' })}: <strong>{formatBytes(health.memoryBytes)}</strong></span>
            <span>{t('runtimeConfig.runtime.vram', { defaultValue: 'VRAM' })}: <strong>{formatBytes(health.vramBytes)}</strong></span>
            {health.sampledAt ? (
              <span className="text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">
                {t('runtimeConfig.runtime.sampled', { defaultValue: 'Sampled' })}: {relativeTimeShort(timestampToIso(health.sampledAt))}
              </span>
            ) : null}
          </div>
          {health.reason ? (
            <p className="text-[11px] text-[var(--nimi-text-muted)]">{health.reason}</p>
          ) : null}
        </div>
      ) : !loading ? (
        <p className="text-xs text-[var(--nimi-text-muted)]">{t('runtimeConfig.runtime.noHealthData', { defaultValue: 'No health data available.' })}</p>
      ) : null}

      {/* AI Providers */}
      {providerHealth.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-[var(--nimi-text-muted)]">
            {t('runtimeConfig.runtime.aiProviders', { defaultValue: 'AI Providers' })}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_72%,transparent)] text-left text-[11px] text-[var(--nimi-text-muted)]">
                  <th className="pb-1.5 pr-3 font-medium">{t('runtimeConfig.runtime.name', { defaultValue: 'Name' })}</th>
                  <th className="pb-1.5 pr-3 font-medium">{t('runtimeConfig.runtime.state', { defaultValue: 'State' })}</th>
                  <th className="pb-1.5 pr-3 font-medium">{t('runtimeConfig.runtime.failures', { defaultValue: 'Failures' })}</th>
                  <th className="pb-1.5 font-medium">{t('runtimeConfig.runtime.lastChecked', { defaultValue: 'Last Checked' })}</th>
                </tr>
              </thead>
              <tbody>
                {providerHealth.map((p) => (
                  <ProviderRow
                    key={p.providerName}
                    provider={p}
                    expanded={expandedProviders.has(p.providerName)}
                    onToggle={() => toggleProvider(p.providerName)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function ProviderRow({
  provider,
  expanded,
  onToggle,
}: {
  provider: AIProviderHealthSnapshot;
  expanded: boolean;
  onToggle: () => void;
}) {
  const lastChecked = provider.lastCheckedAt
    ? relativeTimeShort(timestampToIso(provider.lastCheckedAt))
    : '-';

  return (
    <>
      <tr
        className="cursor-pointer border-b border-[var(--nimi-border-subtle)]/70 hover:bg-white/80"
        onClick={onToggle}
      >
        <td className="py-1.5 pr-3 font-medium text-[var(--nimi-text-primary)]">
          {provider.subHealth.length > 0 ? (
            <span className="mr-1 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">{expanded ? '\u25BC' : '\u25B6'}</span>
          ) : null}
          {provider.providerName}
        </td>
        <td className={`py-1.5 pr-3 font-medium ${providerStateColor(provider.state)}`}>
          {provider.state}
        </td>
        <td className="py-1.5 pr-3 text-[var(--nimi-text-secondary)]">{provider.consecutiveFailures}</td>
        <td className="py-1.5 text-[var(--nimi-text-muted)]">
          {lastChecked}
          {provider.reason ? (
            <span className="ml-1 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">({provider.reason})</span>
          ) : null}
        </td>
      </tr>
      {expanded && provider.subHealth.length > 0 ? (
        provider.subHealth.map((sub: AIProviderSubHealth) => (
          <tr key={sub.providerName} className="border-b border-[var(--nimi-border-subtle)]/70 bg-white/60">
            <td className="py-1 pr-3 pl-6 text-[var(--nimi-text-secondary)]">{sub.providerName}</td>
            <td className={`py-1 pr-3 font-medium ${providerStateColor(sub.state)}`}>
              {sub.state}
            </td>
            <td className="py-1 pr-3 text-[var(--nimi-text-secondary)]">{sub.consecutiveFailures}</td>
            <td className="py-1 text-[var(--nimi-text-muted)]">
              {sub.lastCheckedAt ? relativeTimeShort(timestampToIso(sub.lastCheckedAt)) : '-'}
              {sub.reason ? (
                <span className="ml-1 text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]">({sub.reason})</span>
              ) : null}
            </td>
          </tr>
        ))
      ) : null}
    </>
  );
}
