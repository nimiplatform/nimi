/**
 * Revenue Dashboard Page (FG-REV-002/003/004)
 *
 * KPI cards, earnings chart, breakdown table, Stripe Connect status.
 */

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import {
  ForgePage,
  ForgePageHeader,
  ForgeStatCard,
  ForgeLoadingSpinner,
  ForgeEmptyState,
} from '@renderer/components/page-layout.js';
import { ForgeSegmentControl } from '@renderer/components/segment-control.js';
import { ForgeStatusBadge } from '@renderer/components/status-indicators.js';
import { ForgeListCard } from '@renderer/components/card-list.js';
import { formatDate } from '@renderer/components/format-utils.js';
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

const TIME_RANGE_OPTIONS = [
  { value: '7d' as const, label: '7d' },
  { value: '30d' as const, label: '30d' },
  { value: '90d' as const, label: '90d' },
  { value: '1y' as const, label: '1y' },
];

function formatCurrency(amount: number): string {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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
      const currentUrl = window.location.href;
      const result = await mutations.connectOnboardingMutation.mutateAsync({
        returnUrl: currentUrl,
        refreshUrl: currentUrl,
      });
      const url = result.onboardingUrl ? String(result.onboardingUrl) : null;
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
      const url = result.url ? String(result.url) : null;
      if (url) {
        window.open(url, '_blank');
      }
    } catch {
      // Error handled by mutation
    }
  }

  const connectTone = connect?.status === 'connected' ? 'success'
    : connect?.status === 'onboarding' ? 'warning'
    : connect?.status === 'restricted' ? 'danger'
    : 'neutral';

  return (
    <ForgePage maxWidth="max-w-5xl">
      <ForgePageHeader
        title={t('pages.revenueDashboard')}
        subtitle={t('revenue.subtitle', 'Track your earnings and manage payouts')}
        actions={
          <Button tone="primary" size="md" onClick={() => navigate('/revenue/withdrawals')}>
            {t('revenue.withdrawals', 'Withdrawals')}
          </Button>
        }
      />

      {/* KPI Cards */}
      {loading ? (
        <ForgeLoadingSpinner />
      ) : (
        <div className="grid grid-cols-4 gap-4">
          <ForgeStatCard
            label={t('revenue.sparkBalance', 'Spark Balance')}
            value={formatCurrency(balances?.sparkBalance || 0)}
          />
          <ForgeStatCard
            label={t('revenue.gemBalance', 'Gem Balance')}
            value={formatCurrency(balances?.gemBalance || 0)}
          />
          <ForgeStatCard
            label={t('revenue.earningsRange', `${timeRange} Earnings`)}
            value={formatCurrency(rangeTotal)}
          />
          <ForgeStatCard
            label={t('revenue.pendingWithdrawal', 'Withdrawable')}
            value={formatCurrency(Number(withdrawable?.amount ?? 0))}
          />
        </div>
      )}

      {/* Connect Status */}
      <ForgeListCard
        title={t('revenue.stripeConnect', 'Stripe Connect')}
        subtitle={connect?.status === 'connected'
          ? t('revenue.connectConnected', 'Your payout account is connected')
          : t('revenue.connectNotConnected', 'Set up payouts to withdraw your earnings')}
        badges={
          <ForgeStatusBadge
            domain="generic"
            status={connect?.status || 'unknown'}
            tone={connectTone as 'success' | 'warning' | 'danger' | 'neutral'}
          />
        }
        actions={
          connect?.status === 'connected' ? (
            <Button
              tone="secondary"
              size="sm"
              onClick={() => void handleOpenDashboard()}
              disabled={mutations.connectDashboardMutation.isPending}
            >
              {t('revenue.openDashboard', 'Open Dashboard')}
            </Button>
          ) : (
            <Button
              tone="primary"
              size="sm"
              onClick={() => void handleConnectOnboarding()}
              disabled={mutations.connectOnboardingMutation.isPending}
            >
              {t('revenue.setupPayouts', 'Set Up Payouts')}
            </Button>
          )
        }
      />

      {/* Time range selector */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-[var(--nimi-text-muted)]">{t('revenue.timeRange', 'Time Range')}:</span>
        <ForgeSegmentControl
          options={TIME_RANGE_OPTIONS}
          value={timeRange}
          onChange={setTimeRange}
        />
      </div>

      {/* Earnings chart placeholder */}
      <Surface tone="card" padding="md">
        <h3 className="mb-3 text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('revenue.earningsChart', 'Earnings Over Time')}
        </h3>
        <div className="flex h-48 items-center justify-center">
          {filteredSpark.length === 0 ? (
            <p className="text-sm text-[var(--nimi-text-muted)]">
              {t('revenue.noData', 'No earnings data for this period')}
            </p>
          ) : (
            <MiniChart data={filteredSpark} />
          )}
        </div>
      </Surface>

      {/* Revenue share config */}
      {revenueConfig.data && (
        <Surface tone="card" padding="md">
          <h3 className="mb-2 text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('revenue.revenueShare', 'Revenue Share Configuration')}
          </h3>
          <div className="flex gap-6 text-xs text-[var(--nimi-text-muted)]">
            <span>Creator: <strong className="text-[var(--nimi-text-primary)]">{String(revenueConfig.data.creatorPercent ?? '—')}%</strong></span>
            <span>Platform: <strong className="text-[var(--nimi-text-primary)]">{String(revenueConfig.data.platformPercent ?? '—')}%</strong></span>
          </div>
        </Surface>
      )}

      {/* Transaction table */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('revenue.recentTransactions', 'Recent Transactions')}
        </h3>
        {filteredSpark.length === 0 ? (
          <ForgeEmptyState message={t('revenue.noTransactions', 'No transactions found.')} />
        ) : (
          <Surface tone="card" padding="none" className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]">
                  <th className="px-4 py-2 text-left text-xs font-medium text-[var(--nimi-text-muted)]">Date</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-[var(--nimi-text-muted)]">Type</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-[var(--nimi-text-muted)]">Amount</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-[var(--nimi-text-muted)]">Description</th>
                </tr>
              </thead>
              <tbody>
                {filteredSpark.slice(0, 20).map((entry) => (
                  <tr key={entry.id} className="border-b border-[var(--nimi-border-subtle)]/50 hover:bg-[var(--nimi-surface-panel)]/30">
                    <td className="px-4 py-2 text-[var(--nimi-text-muted)]">{formatDate(entry.createdAt)}</td>
                    <td className="px-4 py-2">
                      <ForgeStatusBadge domain="generic" status={entry.type} tone="neutral" />
                    </td>
                    <td className={`px-4 py-2 text-right font-medium ${entry.amount >= 0 ? 'text-[var(--nimi-status-success)]' : 'text-[var(--nimi-status-danger)]'}`}>
                      {entry.amount >= 0 ? '+' : ''}{formatCurrency(entry.amount)}
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-2 text-[var(--nimi-text-muted)]">{entry.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Surface>
        )}
      </div>
    </ForgePage>
  );
}

function MiniChart({ data }: { data: HistoryEntry[] }) {
  // Simple inline SVG sparkline chart
  if (data.length < 2) {
    return <p className="text-sm text-[var(--nimi-text-muted)]">Insufficient data</p>;
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
    <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full">
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-[var(--nimi-status-success)]"
      />
      {values.map((v, i) => {
        const x = padding + (i / (values.length - 1)) * (w - padding * 2);
        const y = h - padding - (v / maxVal) * (h - padding * 2);
        return <circle key={i} cx={x} cy={y} r="3" className="fill-[var(--nimi-status-success)]" />;
      })}
    </svg>
  );
}
