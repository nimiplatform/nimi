import { useState } from 'react';
import type {
  GetRuntimeHealthResponse,
  AIProviderHealthSnapshot,
  AIProviderSubHealth,
} from '@nimiplatform/sdk/runtime';
import { Card } from '../../primitives.js';
import {
  runtimeHealthStatusLabel,
  runtimeHealthStatusColor,
  providerStateColor,
  formatBytes,
  formatCpuMilli,
  timestampToIso,
  relativeTimeShort,
} from '../../../domain/diagnostics/global-audit-view-model.js';
import { useRuntimeHealthStream } from '../use-runtime-health-stream.js';

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
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white/90 text-gray-600 transition-colors hover:bg-white hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {icon}
    </button>
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
  onRefresh: () => void;
};

export function RuntimeHealthSection({
  runtimeHealth,
  providerHealth,
  loading,
  error,
  onRefresh,
}: RuntimeHealthSectionProps) {
  const [liveEnabled] = useState(true);
  const stream = useRuntimeHealthStream(liveEnabled);

  const health = stream.latestHealth
    ? {
        status: stream.latestHealth.status,
        reason: stream.latestHealth.reason,
        queueDepth: stream.latestHealth.queueDepth,
        activeWorkflows: stream.latestHealth.activeWorkflows,
        activeInferenceJobs: stream.latestHealth.activeInferenceJobs,
        cpuMilli: stream.latestHealth.cpuMilli,
        memoryBytes: stream.latestHealth.memoryBytes,
        vramBytes: stream.latestHealth.vramBytes,
        sampledAt: stream.latestHealth.sampledAt,
      }
    : runtimeHealth;

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
        <h3 className="text-sm font-semibold text-gray-900">Runtime Health</h3>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              stream.streaming
                ? 'bg-green-100 text-green-700'
                : liveEnabled
                  ? 'bg-yellow-100 text-yellow-700'
                  : 'bg-gray-100 text-gray-600'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${
              stream.streaming ? 'bg-green-500' : liveEnabled ? 'bg-yellow-500' : 'bg-gray-400'
            }`} />
            {stream.streaming ? 'Live' : liveEnabled ? 'Connecting...' : 'Off'}
          </span>
          <IconButton
            icon={<RefreshIcon className={loading ? 'animate-spin' : ''} />}
            title="Refresh"
            disabled={loading}
            onClick={onRefresh}
          />
        </div>
      </div>

      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : null}

      {stream.streamError ? (
        <p className="text-xs text-yellow-600">Stream error: {stream.streamError}</p>
      ) : null}

      {health ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-medium ${runtimeHealthStatusColor(health.status)}`}>
              {runtimeHealthStatusLabel(health.status)}
            </span>
            <span className="text-gray-600">Queue: <strong>{health.queueDepth}</strong></span>
            <span className="text-gray-600">Workflows: <strong>{health.activeWorkflows}</strong></span>
            <span className="text-gray-600">Jobs: <strong>{health.activeInferenceJobs}</strong></span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
            <span>CPU: <strong>{formatCpuMilli(health.cpuMilli)}</strong></span>
            <span>RAM: <strong>{formatBytes(health.memoryBytes)}</strong></span>
            <span>VRAM: <strong>{formatBytes(health.vramBytes)}</strong></span>
            {health.sampledAt ? (
              <span className="text-gray-400">Sampled: {relativeTimeShort(timestampToIso(health.sampledAt))}</span>
            ) : null}
          </div>
          {health.reason ? (
            <p className="text-[11px] text-gray-500">{health.reason}</p>
          ) : null}
        </div>
      ) : !loading ? (
        <p className="text-xs text-gray-500">No health data available.</p>
      ) : null}

      {/* AI Providers */}
      {providerHealth.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-gray-500">AI Providers</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 text-left text-[11px] text-gray-500">
                  <th className="pb-1.5 pr-3 font-medium">Name</th>
                  <th className="pb-1.5 pr-3 font-medium">State</th>
                  <th className="pb-1.5 pr-3 font-medium">Failures</th>
                  <th className="pb-1.5 font-medium">Last Checked</th>
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
        className="cursor-pointer border-b border-gray-200/70 hover:bg-white/80"
        onClick={onToggle}
      >
        <td className="py-1.5 pr-3 font-medium text-gray-800">
          {provider.subHealth.length > 0 ? (
            <span className="mr-1 text-gray-400">{expanded ? '\u25BC' : '\u25B6'}</span>
          ) : null}
          {provider.providerName}
        </td>
        <td className={`py-1.5 pr-3 font-medium ${providerStateColor(provider.state)}`}>
          {provider.state}
        </td>
        <td className="py-1.5 pr-3 text-gray-600">{provider.consecutiveFailures}</td>
        <td className="py-1.5 text-gray-500">
          {lastChecked}
          {provider.reason ? (
            <span className="ml-1 text-gray-400">({provider.reason})</span>
          ) : null}
        </td>
      </tr>
      {expanded && provider.subHealth.length > 0 ? (
        provider.subHealth.map((sub: AIProviderSubHealth) => (
          <tr key={sub.providerName} className="border-b border-gray-200/70 bg-white/60">
            <td className="py-1 pr-3 pl-6 text-gray-600">{sub.providerName}</td>
            <td className={`py-1 pr-3 font-medium ${providerStateColor(sub.state)}`}>
              {sub.state}
            </td>
            <td className="py-1 pr-3 text-gray-600">{sub.consecutiveFailures}</td>
            <td className="py-1 text-gray-500">
              {sub.lastCheckedAt ? relativeTimeShort(timestampToIso(sub.lastCheckedAt)) : '-'}
              {sub.reason ? (
                <span className="ml-1 text-gray-400">({sub.reason})</span>
              ) : null}
            </td>
          </tr>
        ))
      ) : null}
    </>
  );
}
