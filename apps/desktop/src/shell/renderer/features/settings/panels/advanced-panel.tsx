import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { formatLocaleDateTime, formatLocaleNumber } from '@renderer/i18n';
import { PageShell, SectionTitle } from '../settings-layout-components';

type WalletTimelineItem = {
  id: string;
  currencyType: string;
  type: string;
  description: string;
  amount: string;
  createdAt: string;
};

function parseNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function formatAmount(value: unknown, digits = 2): string {
  return formatLocaleNumber(parseNumber(value), {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function formatDateTime(value: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  if (!raw) {
    return '--';
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }
  return formatLocaleDateTime(date);
}

function toTimelineItems(input: unknown): WalletTimelineItem[] {
  const payload = input && typeof input === 'object' ? (input as Record<string, unknown>) : null;
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.map((item, index) => {
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const id = typeof record.id === 'string' ? record.id : `tx-${index}`;
    return {
      id,
      currencyType: typeof record.currencyType === 'string' ? record.currencyType : 'SPARK',
      type: typeof record.type === 'string' ? record.type : 'UNKNOWN',
      description: typeof record.description === 'string'
        ? record.description
        : (typeof record.type === 'string' ? record.type : 'Transaction'),
      amount: typeof record.amount === 'string' ? record.amount : '0',
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
    };
  });
}

// Icon Components
function SparkIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

function GemIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h12l4 6-10 13L2 9z" />
      <path d="M12 22V9" />
      <path d="M12 9L2 9" />
      <path d="M12 9l10 0" />
      <path d="M6 3l6 6" />
      <path d="M18 3l-6 6" />
    </svg>
  );
}

function ArrowUpIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function ArrowDownIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  );
}

function WalletIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" />
      <path d="M4 6v12a2 2 0 0 0 2 2h14v-4" />
      <path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z" />
    </svg>
  );
}

function AlertIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

export function WalletPage() {
  const { t } = useTranslation();
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [submittingWithdrawal, setSubmittingWithdrawal] = useState(false);
  const [withdrawalMessage, setWithdrawalMessage] = useState<string | null>(null);

  const balancesQuery = useQuery({
    queryKey: ['wallet-balances'],
    queryFn: async () => dataSync.loadCurrencyBalances(),
  });

  const sparkHistoryQuery = useQuery({
    queryKey: ['wallet-spark-history'],
    queryFn: async () => dataSync.loadSparkTransactionHistory(20),
  });

  const gemHistoryQuery = useQuery({
    queryKey: ['wallet-gem-history'],
    queryFn: async () => dataSync.loadGemTransactionHistory(20),
  });

  const subscriptionQuery = useQuery({
    queryKey: ['wallet-subscription'],
    queryFn: async () => dataSync.loadSubscriptionStatus(),
  });

  const withdrawEligibilityQuery = useQuery({
    queryKey: ['wallet-withdrawal-eligibility'],
    queryFn: async () => dataSync.loadWithdrawalEligibility(),
  });

  const withdrawalHistoryQuery = useQuery({
    queryKey: ['wallet-withdrawal-history'],
    queryFn: async () => dataSync.loadWithdrawalHistory(10),
  });

  const sparkBalance = formatAmount((balancesQuery.data as Record<string, unknown> | undefined)?.sparkBalance);
  const gemBalance = formatAmount((balancesQuery.data as Record<string, unknown> | undefined)?.gemBalance);
  const subscriptionStatus = String((subscriptionQuery.data as Record<string, unknown> | undefined)?.status || 'UNKNOWN');
  const subscriptionTier = String((subscriptionQuery.data as Record<string, unknown> | undefined)?.tier || 'FREE');
  const canWithdraw = (withdrawEligibilityQuery.data as Record<string, unknown> | undefined)?.canWithdraw === true;
  const withdrawReason = String((withdrawEligibilityQuery.data as Record<string, unknown> | undefined)?.reason || '');
  const withdrawMin = formatAmount((withdrawEligibilityQuery.data as Record<string, unknown> | undefined)?.minAmount, 0);

  const timeline = useMemo(() => {
    const sparkItems = toTimelineItems(sparkHistoryQuery.data);
    const gemItems = toTimelineItems(gemHistoryQuery.data);
    return [...sparkItems, ...gemItems]
      .sort((a, b) => {
        const timeA = new Date(a.createdAt).getTime();
        const timeB = new Date(b.createdAt).getTime();
        return timeB - timeA;
      })
      .slice(0, 20);
  }, [gemHistoryQuery.data, sparkHistoryQuery.data]);

  const withdrawalItems = useMemo(() => {
    const payload = withdrawalHistoryQuery.data as Record<string, unknown> | undefined;
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return items.map((item, index) => {
      const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      return {
        id: typeof record.id === 'string' ? record.id : `wd-${index}`,
        status: typeof record.status === 'string' ? record.status : 'UNKNOWN',
        gemAmount: formatAmount(record.gemAmount),
        netAmount: formatAmount(record.netAmount),
        usdAmount: formatAmount(record.usdAmount),
        createdAt: formatDateTime(record.createdAt),
      };
    });
  }, [withdrawalHistoryQuery.data]);

  const handleCreateWithdrawal = async () => {
    const normalized = withdrawAmount.trim();
    if (!normalized) {
      setWithdrawalMessage(t('Wallet.enterAmount'));
      return;
    }

    setSubmittingWithdrawal(true);
    setWithdrawalMessage(null);
    try {
      await dataSync.createWithdrawal({ gemAmount: normalized });
      setWithdrawAmount('');
      setWithdrawalMessage(t('Wallet.withdrawalSubmitted'));
      await Promise.all([
        balancesQuery.refetch(),
        gemHistoryQuery.refetch(),
        withdrawEligibilityQuery.refetch(),
        withdrawalHistoryQuery.refetch(),
      ]);
    } catch (error) {
      setWithdrawalMessage(error instanceof Error ? error.message : t('Wallet.withdrawalError'));
    } finally {
      setSubmittingWithdrawal(false);
    }
  };

  const loading = balancesQuery.isPending
    || sparkHistoryQuery.isPending
    || gemHistoryQuery.isPending
    || subscriptionQuery.isPending
    || withdrawEligibilityQuery.isPending;

  return (
    <PageShell title={t('Wallet.pageTitle')} description={t('Wallet.pageDescription')}>
      {/* Balance Cards */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Spark Balance Card */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-mint-400 to-mint-600 p-6 text-white shadow-lg">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute bottom-0 left-0 -mb-4 -ml-4 h-20 w-20 rounded-full bg-white/10 blur-xl" />
          <div className="relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
                  <SparkIcon className="h-5 w-5 text-white" />
                </div>
                <span className="text-sm font-medium text-white/90">{t('Wallet.sparkBalance')}</span>
              </div>
              <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
                {subscriptionTier}
              </span>
            </div>
            <div className="mt-4">
              <span className="text-4xl font-bold">{sparkBalance}</span>
              <span className="ml-2 text-sm text-white/70">{t('Wallet.sparkUnit')}</span>
            </div>
            <div className="mt-2 text-xs text-white/60">
              {loading ? t('Wallet.loadingWallet') : `${t('Wallet.subscription')}: ${subscriptionStatus}`}
            </div>
          </div>
        </div>

        {/* Gem Balance Card */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 p-6 text-white shadow-lg">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-mint-400/20 blur-2xl" />
          <div className="absolute bottom-0 left-0 -mb-4 -ml-4 h-20 w-20 rounded-full bg-mint-400/10 blur-xl" />
          <div className="relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-mint-400/20 backdrop-blur-sm">
                  <GemIcon className="h-5 w-5 text-mint-400" />
                </div>
                <span className="text-sm font-medium text-white/90">{t('Wallet.gem')}</span>
              </div>
              <span className="rounded-full bg-mint-400/20 px-3 py-1 text-xs font-medium text-mint-300 backdrop-blur-sm">
                {t('Wallet.withdrawableBadge')}
              </span>
            </div>
            <div className="mt-4">
              <span className="text-4xl font-bold">{gemBalance}</span>
              <span className="ml-2 text-sm text-white/70">{t('Wallet.gemUnit')}</span>
            </div>
            <div className="mt-2 text-xs text-white/60">
              {t('Wallet.withdrawMinRequirement', { min: withdrawMin, unit: t('Wallet.gemUnit') })}
            </div>
          </div>
        </div>
      </section>

      {/* Withdrawal Section */}
      <section className="mt-8">
        <SectionTitle>{t('Wallet.sectionWithdrawal')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          {/* Status Badge */}
          <div className="flex items-center gap-3 mb-4">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${canWithdraw ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-600'}`}>
              {canWithdraw ? <ArrowUpIcon className="h-5 w-5" /> : <AlertIcon className="h-5 w-5" />}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">
                {canWithdraw ? t('Wallet.eligible') : t('Wallet.notEligible')}
              </p>
              <p className="text-xs text-gray-500">
                {t('Wallet.min')}: {withdrawMin} {t('Wallet.gemUnit')}
              </p>
            </div>
          </div>

          {/* Warning Message */}
          {!canWithdraw && withdrawReason ? (
            <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{withdrawReason}</span>
            </div>
          ) : null}

          {/* Withdrawal Input */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <input
                type="number"
                min="1"
                value={withdrawAmount}
                onChange={(event) => setWithdrawAmount(event.target.value)}
                placeholder={t('Wallet.gemAmount')}
                disabled={!canWithdraw || submittingWithdrawal}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100 disabled:opacity-50"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-gray-400">{t('Wallet.gemUnit')}</span>
            </div>
            <button
              type="button"
              disabled={!canWithdraw || submittingWithdrawal}
              onClick={() => { void handleCreateWithdrawal(); }}
              className="flex items-center gap-2 rounded-xl bg-mint-500 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-mint-600 hover:shadow-md disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none"
            >
              <WalletIcon className="h-4 w-4" />
              {submittingWithdrawal ? t('Wallet.submitting') : t('Wallet.withdraw')}
            </button>
          </div>

          {withdrawalMessage ? (
            <div className="mt-3 rounded-lg bg-gray-50 px-4 py-2 text-sm text-gray-600">
              {withdrawalMessage}
            </div>
          ) : null}
        </div>
      </section>

      {/* Recent Transactions */}
      <section className="mt-8">
        <SectionTitle>{t('Wallet.sectionRecentTransactions')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          {timeline.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                <WalletIcon className="h-6 w-6 text-gray-400" />
              </div>
              <p className="text-sm text-gray-500">{t('Wallet.noTransactions')}</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {timeline.map((tx) => {
                const amountValue = parseNumber(tx.amount);
                const positive = amountValue >= 0;
                const isSpark = tx.currencyType === 'SPARK';
                return (
                  <div 
                    key={`${tx.currencyType}-${tx.id}`} 
                    className="flex items-center justify-between px-5 py-4 hover:bg-gray-50/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${positive ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                        {positive ? <ArrowUpIcon className="h-5 w-5" /> : <ArrowDownIcon className="h-5 w-5" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{tx.description}</p>
                        <p className="text-xs text-gray-400">{formatDateTime(tx.createdAt)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`text-sm font-bold ${positive ? 'text-green-600' : 'text-red-600'}`}>
                        {positive ? '+' : ''}{tx.amount}
                      </span>
                      <span className={`ml-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${isSpark ? 'bg-mint-100 text-mint-600' : 'bg-slate-100 text-slate-600'}`}>
                        {tx.currencyType}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Withdrawal History */}
      <section className="mt-8">
        <SectionTitle>{t('Wallet.sectionWithdrawalHistory')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          {withdrawalItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                <ArrowUpIcon className="h-6 w-6 text-gray-400" />
              </div>
              <p className="text-sm text-gray-500">{t('Wallet.noWithdrawals')}</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {withdrawalItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between px-5 py-4 hover:bg-gray-50/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-mint-100 text-mint-600">
                      <ArrowUpIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{item.gemAmount} Gem</p>
                      <p className="text-xs text-gray-400">{item.createdAt}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-gray-900">{item.usdAmount} USD</p>
                    <span className={`inline-block mt-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      item.status === 'COMPLETED' ? 'bg-green-100 text-green-600' :
                      item.status === 'PENDING' ? 'bg-amber-100 text-amber-600' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {item.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </PageShell>
  );
}
