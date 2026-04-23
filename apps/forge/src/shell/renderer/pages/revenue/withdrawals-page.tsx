/**
 * Withdrawals Page (FG-REV-005)
 *
 * Withdrawal calculator, create withdrawal, history tracking.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import {
  ForgePage,
  ForgePageHeader,
  ForgeSection,
  ForgeSectionHeading,
  ForgeStatCard,
  ForgeLoadingSpinner,
  ForgeEmptyState,
} from '@renderer/components/page-layout.js';
import { LabeledTextField } from '@renderer/components/form-fields.js';
import { ForgeStatusBadge } from '@renderer/components/status-indicators.js';
import { formatDate } from '@renderer/components/format-utils.js';
import {
  useCanWithdrawQuery,
  useWithdrawalConfigQuery,
  useWithdrawalCalculateQuery,
  useWithdrawalHistoryQuery,
  useConnectStatusQuery,
} from '@renderer/hooks/use-revenue-queries.js';
import { useRevenueMutations } from '@renderer/hooks/use-revenue-mutations.js';

function formatCurrency(amount: number): string {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export default function WithdrawalsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mutations = useRevenueMutations();

  const [withdrawAmount, setWithdrawAmount] = useState('');

  const canWithdraw = useCanWithdrawQuery();
  const withdrawalConfig = useWithdrawalConfigQuery();
  const calculateQuery = useWithdrawalCalculateQuery(withdrawAmount || '0');
  const historyQuery = useWithdrawalHistoryQuery();
  const connectStatus = useConnectStatusQuery();

  const isConnected = connectStatus.data?.status === 'connected';
  const eligible = canWithdraw.data;
  const config = withdrawalConfig.data;
  const calculation = calculateQuery.data;
  const history = historyQuery.data || [];

  const loading = canWithdraw.isLoading || historyQuery.isLoading;

  async function handleWithdraw() {
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) return;
    try {
      await mutations.createWithdrawalMutation.mutateAsync({ gemAmount: withdrawAmount });
      await queryClient.invalidateQueries({ queryKey: ['forge', 'revenue'] });
      setWithdrawAmount('');
    } catch {
      // Error handled by mutation
    }
  }

  function withdrawalTone(status: string): 'warning' | 'info' | 'success' | 'danger' | 'neutral' {
    const map: Record<string, 'warning' | 'info' | 'success' | 'danger'> = {
      pending: 'warning',
      processing: 'info',
      completed: 'success',
      failed: 'danger',
    };
    return map[status.toLowerCase()] ?? 'neutral';
  }

  return (
    <ForgePage>
      <ForgePageHeader
        title={t('pages.withdrawals')}
        actions={
          <Button tone="ghost" size="sm" onClick={() => navigate('/revenue')}>
            &larr; {t('withdrawals.back', 'Back')}
          </Button>
        }
      />

      {loading ? (
        <ForgeLoadingSpinner />
      ) : (
        <>
          {/* Connect warning */}
          {!isConnected && (
            <Surface tone="card" material="glass-thin" padding="sm" className="border-[var(--nimi-status-warning)]">
              <p className="text-sm text-[var(--nimi-status-warning)]">
                {t('withdrawals.connectRequired', 'Stripe Connect must be set up before you can withdraw.')}
              </p>
              <Button
                tone="secondary"
                size="sm"
                onClick={() => navigate('/revenue')}
                className="mt-2"
              >
                {t('withdrawals.goToRevenue', 'Go to Revenue Dashboard')}
              </Button>
            </Surface>
          )}

          <ForgeSection className="space-y-4" material="glass-regular">
            <ForgeSectionHeading
              eyebrow={t('pages.withdrawals')}
              title={t('withdrawals.calculator', 'Withdrawal Calculator')}
            />

            <div className="grid grid-cols-3 gap-4">
              <ForgeStatCard
                label="Withdrawable"
                value={formatCurrency(Number(eligible?.amount ?? 0))}
              />
              <ForgeStatCard
                label="Min Amount"
                value={formatCurrency(Number(config?.minimumAmount ?? 0))}
              />
              <ForgeStatCard
                label="Fees"
                value={calculation?.fee ? formatCurrency(Number(calculation.fee)) : '—'}
              />
            </div>

            <div className="flex gap-3">
              <LabeledTextField
                label=""
                type="number"
                value={withdrawAmount}
                onChange={setWithdrawAmount}
                placeholder="Amount"
                className="flex-1"
              />
              <Button
                tone="primary"
                size="md"
                onClick={() => void handleWithdraw()}
                disabled={
                  mutations.createWithdrawalMutation.isPending ||
                  !isConnected ||
                  !withdrawAmount ||
                  parseFloat(withdrawAmount) <= 0
                }
              >
                {mutations.createWithdrawalMutation.isPending
                  ? t('withdrawals.processing', 'Processing...')
                  : t('withdrawals.withdraw', 'Withdraw')}
              </Button>
            </div>
          </ForgeSection>

          <ForgeSection className="space-y-4">
            <ForgeSectionHeading
              eyebrow={t('pages.withdrawals')}
              title={t('withdrawals.history', 'Withdrawal History')}
            />
            {history.length === 0 ? (
              <ForgeEmptyState message={t('withdrawals.noHistory', 'No withdrawals yet.')} />
            ) : (
              <Surface tone="card" material="glass-regular" padding="none" className="overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_55%,transparent)]">
                      <th className="px-4 py-2 text-left text-xs font-medium text-[var(--nimi-text-muted)]">Date</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-[var(--nimi-text-muted)]">Amount</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-[var(--nimi-text-muted)]">Status</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-[var(--nimi-text-muted)]">Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((entry) => (
                      <tr key={entry.id} className="border-b border-[var(--nimi-border-subtle)]/50 hover:bg-[color-mix(in_srgb,var(--nimi-surface-panel)_40%,transparent)]">
                        <td className="px-4 py-2 text-[var(--nimi-text-muted)]">{formatDate(entry.createdAt)}</td>
                        <td className="px-4 py-2 text-right font-medium text-[var(--nimi-text-primary)]">
                          {formatCurrency(entry.amount)}
                        </td>
                        <td className="px-4 py-2">
                          <ForgeStatusBadge
                            domain="generic"
                            status={entry.status}
                            tone={withdrawalTone(entry.status)}
                          />
                        </td>
                        <td className="px-4 py-2 text-[var(--nimi-text-muted)]">
                          {entry.completedAt ? formatDate(entry.completedAt) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Surface>
            )}
          </ForgeSection>
        </>
      )}
    </ForgePage>
  );
}
