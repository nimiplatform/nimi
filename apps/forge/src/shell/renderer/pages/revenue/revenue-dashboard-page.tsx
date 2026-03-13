/**
 * Revenue Dashboard Page (FG-REV-002/003/004)
 *
 * KPI cards, earnings chart, breakdown table, Stripe Connect status.
 */

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  useBalancesQuery,
  useSparkHistoryQuery,
  useGemHistoryQuery,
  useRevenueShareConfigQuery,
  useConnectStatusQuery,
  useCanWithdrawQuery,
  type HistoryEntry,
} from '@renderer/hooks/use-revenue-queries.js';
import { useRevenueMutations } from '@renderer/hooks/use-revenue-mutations.js';

type TimeRange = '7d' | '30d' | '90d' | '1y';

function formatCurrency(amount: number): string {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

export default function RevenueDashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = useRevenueMutations();

  const balancesQuery = useBalancesQuery();
  const sparkHistory = useSparkHistoryQuery();
  const gemHistory = useGemHistoryQuery();
  const revenueConfig = useRevenueShareConfigQuery();
  const connectStatus = useConnectStatusQuery();
  const canWithdrawQuery = useCanWithdrawQuery();

  const [timeRange, setTimeRange] = useState<TimeRange>('30d');

  const balances = balancesQuery.data;
  const connect = connectStatus.data;

  // Filter history by time range
  const filteredSpark = useMemo(() => {
    const entries = sparkHistory.data || [];
    const rangeMap: Record<TimeRange, number> = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
    const cutoff = daysAgo(rangeMap[timeRange]);
    return entries.filter((e) => new Date(e.createdAt) >= cutoff);
  }, [sparkHistory.data, timeRange]);

  const rangeTotal = useMemo(() => {
    return filteredSpark.reduce((sum, e) => sum + Math.max(0, e.amount), 0);
  }, [filteredSpark]);

  const withdrawable = canWithdrawQuery.data;

  const loading = balancesQuery.isLoading || sparkHistory.isLoading;

  async function handleConnectOnboarding() {
    try {
      const result = await mutations.connectOnboardingMutation.mutateAsync({});
      const record = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
      const url = record.url ? String(record.url) : null;
      if (url) {
        window.open(url, '_blank');
      }
    } catch {
      // Error handled by mutation
    }
  }

  async function handleOpenDashboard() {
    try {
      const result = await mutations.connectDashboardMutation.mutateAsync();
      const record = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
      const url = record.url ? String(record.url) : null;
      if (url) {
        window.open(url, '_blank');
      }
    } catch {
      // Error handled by mutation
    }
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">{t('pages.revenueDashboard')}</h1>
            <p className="mt-1 text-sm text-neutral-400">
              {t('revenue.subtitle', 'Track your earnings and manage payouts')}
            </p>
          </div>
          <button
            onClick={() => navigate('/revenue/withdrawals')}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-neutral-200 transition-colors"
          >
            {t('revenue.withdrawals', 'Withdrawals')}
          </button>
        </div>

        {/* KPI Cards */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-4">
            <KpiCard
              label={t('revenue.sparkBalance', 'Spark Balance')}
              value={formatCurrency(balances?.sparkBalance || 0)}
              color="text-yellow-400"
            />
            <KpiCard
              label={t('revenue.gemBalance', 'Gem Balance')}
              value={formatCurrency(balances?.gemBalance || 0)}
              color="text-purple-400"
            />
            <KpiCard
              label={t('revenue.earningsRange', `${timeRange} Earnings`)}
              value={formatCurrency(rangeTotal)}
              color="text-green-400"
            />
            <KpiCard
              label={t('revenue.pendingWithdrawal', 'Withdrawable')}
              value={formatCurrency(Number(withdrawable?.amount ?? withdrawable?.withdrawableAmount ?? 0))}
              color="text-cyan-400"
            />
          </div>
        )}

        {/* Connect Status */}
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">
                {t('revenue.stripeConnect', 'Stripe Connect')}
              </p>
              <p className="text-xs text-neutral-500 mt-0.5">
                {connect?.status === 'connected'
                  ? t('revenue.connectConnected', 'Your payout account is connected')
                  : t('revenue.connectNotConnected', 'Set up payouts to withdraw your earnings')}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${
                connect?.status === 'connected' ? 'bg-green-500/20 text-green-400' :
                connect?.status === 'onboarding' ? 'bg-yellow-500/20 text-yellow-400' :
                connect?.status === 'restricted' ? 'bg-red-500/20 text-red-400' :
                'bg-neutral-700 text-neutral-400'
              }`}>
                {connect?.status || 'unknown'}
              </span>
              {connect?.status === 'connected' ? (
                <button
                  onClick={() => void handleOpenDashboard()}
                  disabled={mutations.connectDashboardMutation.isPending}
                  className="rounded px-3 py-1.5 text-xs font-medium text-white bg-neutral-800 hover:bg-neutral-700 transition-colors"
                >
                  {t('revenue.openDashboard', 'Open Dashboard')}
                </button>
              ) : (
                <button
                  onClick={() => void handleConnectOnboarding()}
                  disabled={mutations.connectOnboardingMutation.isPending}
                  className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black hover:bg-neutral-200 transition-colors"
                >
                  {t('revenue.setupPayouts', 'Set Up Payouts')}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Time range selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">{t('revenue.timeRange', 'Time Range')}:</span>
          {(['7d', '30d', '90d', '1y'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                timeRange === range
                  ? 'bg-white text-black'
                  : 'bg-neutral-800 text-neutral-400 hover:text-white'
              }`}
            >
              {range}
            </button>
          ))}
        </div>

        {/* Earnings chart placeholder */}
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
          <h3 className="text-sm font-semibold text-white mb-3">
            {t('revenue.earningsChart', 'Earnings Over Time')}
          </h3>
          <div className="h-48 flex items-center justify-center">
            {filteredSpark.length === 0 ? (
              <p className="text-sm text-neutral-500">
                {t('revenue.noData', 'No earnings data for this period')}
              </p>
            ) : (
              <MiniChart data={filteredSpark} />
            )}
          </div>
        </div>

        {/* Revenue share config */}
        {revenueConfig.data && (
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-5 py-4">
            <h3 className="text-sm font-semibold text-white mb-2">
              {t('revenue.revenueShare', 'Revenue Share Configuration')}
            </h3>
            <div className="flex gap-6 text-xs text-neutral-400">
              <span>Creator: <strong className="text-white">{String(revenueConfig.data.creatorPercent ?? revenueConfig.data.creatorShare ?? '—')}%</strong></span>
              <span>Platform: <strong className="text-white">{String(revenueConfig.data.platformPercent ?? revenueConfig.data.platformShare ?? '—')}%</strong></span>
            </div>
          </div>
        )}

        {/* Transaction table */}
        <div>
          <h3 className="text-sm font-semibold text-white mb-3">
            {t('revenue.recentTransactions', 'Recent Transactions')}
          </h3>
          {filteredSpark.length === 0 ? (
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-8 text-center">
              <p className="text-sm text-neutral-500">
                {t('revenue.noTransactions', 'No transactions found.')}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-neutral-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-800 bg-neutral-900">
                    <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500">Date</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500">Type</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-neutral-500">Amount</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSpark.slice(0, 20).map((entry) => (
                    <tr key={entry.id} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                      <td className="px-4 py-2 text-neutral-400">{formatDate(entry.createdAt)}</td>
                      <td className="px-4 py-2">
                        <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-300">
                          {entry.type}
                        </span>
                      </td>
                      <td className={`px-4 py-2 text-right font-medium ${entry.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {entry.amount >= 0 ? '+' : ''}{formatCurrency(entry.amount)}
                      </td>
                      <td className="px-4 py-2 text-neutral-500 truncate max-w-[200px]">{entry.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`text-xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

function MiniChart({ data }: { data: HistoryEntry[] }) {
  // Simple inline SVG sparkline chart
  if (data.length < 2) {
    return <p className="text-sm text-neutral-500">Insufficient data</p>;
  }

  const w = 600;
  const h = 160;
  const padding = 20;

  const sorted = [...data].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const values = sorted.map((e) => Math.max(0, e.amount));
  const maxVal = Math.max(...values, 1);

  const points = values.map((v, i) => {
    const x = padding + (i / (values.length - 1)) * (w - padding * 2);
    const y = h - padding - (v / maxVal) * (h - padding * 2);
    return `${x},${y}`;
  });

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full">
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-green-400"
      />
      {values.map((v, i) => {
        const x = padding + (i / (values.length - 1)) * (w - padding * 2);
        const y = h - padding - (v / maxVal) * (h - padding * 2);
        return <circle key={i} cx={x} cy={y} r="3" className="fill-green-400" />;
      })}
    </svg>
  );
}
