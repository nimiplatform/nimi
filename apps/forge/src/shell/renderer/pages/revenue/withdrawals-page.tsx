/**
 * Withdrawals Page (FG-REV-005)
 *
 * Withdrawal calculator, create withdrawal, history tracking.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
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

function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
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

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-500/20 text-yellow-400',
    processing: 'bg-blue-500/20 text-blue-400',
    completed: 'bg-green-500/20 text-green-400',
    failed: 'bg-red-500/20 text-red-400',
  };

  async function handleWithdraw() {
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) return;
    try {
      await mutations.createWithdrawalMutation.mutateAsync({ amount });
      await queryClient.invalidateQueries({ queryKey: ['forge', 'revenue'] });
      setWithdrawAmount('');
    } catch {
      // Error handled by mutation
    }
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/revenue')}
            className="rounded px-2 py-1 text-sm text-neutral-400 hover:text-white transition-colors"
          >
            &larr; {t('withdrawals.back', 'Back')}
          </button>
          <h1 className="text-2xl font-bold text-white">{t('pages.withdrawals')}</h1>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Connect warning */}
            {!isConnected && (
              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
                <p className="text-sm text-yellow-400">
                  {t('withdrawals.connectRequired', 'Stripe Connect must be set up before you can withdraw.')}
                </p>
                <button
                  onClick={() => navigate('/revenue')}
                  className="mt-2 rounded bg-yellow-500/20 px-3 py-1 text-xs font-medium text-yellow-400 hover:bg-yellow-500/30 transition-colors"
                >
                  {t('withdrawals.goToRevenue', 'Go to Revenue Dashboard')}
                </button>
              </div>
            )}

            {/* Withdrawal calculator */}
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5 space-y-4">
              <h3 className="text-sm font-semibold text-white">
                {t('withdrawals.calculator', 'Withdrawal Calculator')}
              </h3>

              <div className="grid grid-cols-3 gap-4 text-xs text-neutral-400">
                <div>
                  <p>Withdrawable</p>
                  <p className="text-lg font-bold text-white mt-1">
                    {formatCurrency(Number(eligible?.amount ?? eligible?.withdrawableAmount ?? 0))}
                  </p>
                </div>
                <div>
                  <p>Min Amount</p>
                  <p className="text-lg font-bold text-white mt-1">
                    {formatCurrency(Number(config?.minimumAmount ?? 0))}
                  </p>
                </div>
                <div>
                  <p>Fees</p>
                  <p className="text-lg font-bold text-white mt-1">
                    {calculation?.fee ? formatCurrency(Number(calculation.fee)) : '—'}
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <input
                  type="number"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  placeholder="Amount"
                  min="0"
                  className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
                />
                <button
                  onClick={() => void handleWithdraw()}
                  disabled={
                    mutations.createWithdrawalMutation.isPending ||
                    !isConnected ||
                    !withdrawAmount ||
                    parseFloat(withdrawAmount) <= 0
                  }
                  className="rounded-lg bg-white px-5 py-2 text-sm font-medium text-black hover:bg-neutral-200 disabled:opacity-50 transition-colors"
                >
                  {mutations.createWithdrawalMutation.isPending
                    ? t('withdrawals.processing', 'Processing...')
                    : t('withdrawals.withdraw', 'Withdraw')}
                </button>
              </div>
            </div>

            {/* History */}
            <div>
              <h3 className="text-sm font-semibold text-white mb-3">
                {t('withdrawals.history', 'Withdrawal History')}
              </h3>
              {history.length === 0 ? (
                <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-8 text-center">
                  <p className="text-sm text-neutral-500">
                    {t('withdrawals.noHistory', 'No withdrawals yet.')}
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-neutral-800 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-neutral-800 bg-neutral-900">
                        <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500">Date</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-neutral-500">Amount</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500">Status</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500">Completed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((entry) => (
                        <tr key={entry.id} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                          <td className="px-4 py-2 text-neutral-400">{formatDate(entry.createdAt)}</td>
                          <td className="px-4 py-2 text-right font-medium text-white">
                            {formatCurrency(entry.amount)}
                          </td>
                          <td className="px-4 py-2">
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              statusColors[entry.status.toLowerCase()] || 'bg-neutral-700 text-neutral-300'
                            }`}>
                              {entry.status}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-neutral-500">
                            {entry.completedAt ? formatDate(entry.completedAt) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
