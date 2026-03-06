import type { UsageStatRecord } from '@nimiplatform/sdk/runtime';
import { UsageWindow } from '@nimiplatform/sdk/runtime';
import { Button, Card } from '../../primitives.js';
import {
  formatTokenCount,
  formatComputeMs,
  formatNumber,
  usageWindowLabel,
  timestampToIso,
  relativeTimeShort,
} from '../../../domain/diagnostics/global-audit-view-model.js';

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

type UsageStatsSectionProps = {
  records: UsageStatRecord[];
  loading: boolean;
  error: string | null;
  hasNextPage: boolean;
  filters: {
    capability: string;
    modelId: string;
    window: number;
  };
  summary: {
    totalRequests: number;
    totalSuccess: number;
    totalErrors: number;
    totalInput: number;
    totalOutput: number;
    totalCompute: number;
  };
  onUpdateFilters: (patch: Partial<{ capability: string; modelId: string; window: number }>) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
};

export function UsageStatsSection({
  records,
  loading,
  error,
  hasNextPage,
  filters,
  summary,
  onUpdateFilters,
  onRefresh,
  onLoadMore,
}: UsageStatsSectionProps) {
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Usage Statistics</h3>
        <IconButton
          icon={<RefreshIcon className={loading ? 'animate-spin' : ''} />}
          title="Refresh"
          disabled={loading}
          onClick={onRefresh}
        />
      </div>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-mint-100 bg-[#F4FBF8] text-xs">
          {[UsageWindow.MINUTE, UsageWindow.HOUR, UsageWindow.DAY].map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => onUpdateFilters({ window: w })}
              className={`px-3 py-1.5 font-medium transition-colors ${
                filters.window === w
                  ? 'bg-mint-500 text-white'
                  : 'text-mint-700 hover:bg-mint-50'
              } ${w === UsageWindow.MINUTE ? 'rounded-l-md' : ''} ${w === UsageWindow.DAY ? 'rounded-r-md' : ''}`}
            >
              {usageWindowLabel(w)}
            </button>
          ))}
        </div>
        <input
          value={filters.capability}
          onChange={(e) => onUpdateFilters({ capability: e.target.value })}
          placeholder="Capability..."
          className="h-8 rounded-md border border-mint-100 bg-[#F4FBF8] px-2 text-xs text-gray-800 outline-none transition-all focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100"
        />
        <input
          value={filters.modelId}
          onChange={(e) => onUpdateFilters({ modelId: e.target.value })}
          placeholder="Model ID..."
          className="h-8 rounded-md border border-mint-100 bg-[#F4FBF8] px-2 text-xs text-gray-800 outline-none transition-all focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100"
        />
      </div>

      {/* Summary row */}
      {records.length > 0 ? (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-white/70 px-3 py-2 text-xs">
          <span className="text-gray-600">
            Total: <strong>{formatNumber(String(summary.totalRequests))}</strong> requests
          </span>
          <span className="text-green-700">
            Success: <strong>{formatNumber(String(summary.totalSuccess))}</strong>
          </span>
          <span className="text-red-700">
            Errors: <strong>{formatNumber(String(summary.totalErrors))}</strong>
          </span>
          <span className="text-gray-600">
            Input: <strong>{formatTokenCount(String(summary.totalInput))}</strong> tokens
          </span>
          <span className="text-gray-600">
            Output: <strong>{formatTokenCount(String(summary.totalOutput))}</strong> tokens
          </span>
          <span className="text-gray-600">
            Compute: <strong>{formatComputeMs(String(summary.totalCompute))}</strong>
          </span>
        </div>
      ) : null}

      {/* Records table */}
      <div className="overflow-x-auto max-h-[calc(100vh-36rem)]">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100 text-left text-[11px] text-gray-500">
              <th className="pb-1.5 pr-3 font-medium">Capability</th>
              <th className="pb-1.5 pr-3 font-medium">Model</th>
              <th className="pb-1.5 pr-3 font-medium">Requests</th>
              <th className="pb-1.5 pr-3 font-medium">Success</th>
              <th className="pb-1.5 pr-3 font-medium">Errors</th>
              <th className="pb-1.5 pr-3 font-medium">Input Tokens</th>
              <th className="pb-1.5 pr-3 font-medium">Output Tokens</th>
              <th className="pb-1.5 pr-3 font-medium">Compute</th>
              <th className="pb-1.5 pr-3 font-medium">Queue Wait</th>
              <th className="pb-1.5 font-medium">Bucket</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-gray-500">
                  {loading ? 'Loading usage stats...' : 'No usage data available.'}
                </td>
              </tr>
            ) : (
              records.map((r, idx) => {
                const bucketTs = timestampToIso(r.bucketStart);
                return (
                  <tr key={`${r.capability}-${r.modelId}-${idx}`} className="border-b border-gray-200/70">
                    <td className="py-1.5 pr-3 text-gray-800">{r.capability || '-'}</td>
                    <td className="py-1.5 pr-3 font-mono text-gray-700">{r.modelId || '-'}</td>
                    <td className="py-1.5 pr-3 text-gray-800">{formatNumber(r.requestCount)}</td>
                    <td className="py-1.5 pr-3 text-green-700">{formatNumber(r.successCount)}</td>
                    <td className="py-1.5 pr-3 text-red-700">{formatNumber(r.errorCount)}</td>
                    <td className="py-1.5 pr-3 text-gray-600">{formatTokenCount(r.inputTokens)}</td>
                    <td className="py-1.5 pr-3 text-gray-600">{formatTokenCount(r.outputTokens)}</td>
                    <td className="py-1.5 pr-3 text-gray-600">{formatComputeMs(r.computeMs)}</td>
                    <td className="py-1.5 pr-3 text-gray-600">{formatComputeMs(r.queueWaitMs)}</td>
                    <td className="py-1.5 text-gray-400" title={bucketTs}>
                      {bucketTs !== '-' ? relativeTimeShort(bucketTs) : '-'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Load More */}
      {hasNextPage ? (
        <div className="flex justify-center">
          <Button variant="secondary" size="sm" disabled={loading} onClick={onLoadMore}>
            {loading ? 'Loading...' : 'Load More'}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
