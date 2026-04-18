import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { desktopBridge } from '@renderer/bridge';
import { parseOptionalJsonObject } from '@renderer/bridge/runtime-bridge/shared';
import { formatLocaleDateTime, formatLocaleNumber } from '@renderer/i18n';
import { PageShell, SectionTitle } from './settings-layout-components.js';

type WalletTimelineItem = {
  id: string;
  currencyType: string;
  type: string;
  description: string;
  amount: string;
  createdAt: string;
};

type SparkPackageItem = {
  id: string;
  label: string;
  sparkAmount: number;
  usdPrice: number;
  popular: boolean;
};

type WalletCheckoutStatus = 'success' | 'cancel';

function readEnv(name: string): string {
  const importMetaEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
  const fromImportMeta = String(importMetaEnv?.[name] || '').trim();
  if (fromImportMeta) {
    return fromImportMeta;
  }
  const globalProcess = (globalThis as {
    process?: { env?: Record<string, string | undefined> };
  }).process;
  return String(globalProcess?.env?.[name] || '').trim();
}

function normalizeWalletCheckoutStatus(input: unknown): WalletCheckoutStatus | null {
  const normalized = String(input || '').trim().toLowerCase();
  if (normalized === 'success') {
    return 'success';
  }
  if (normalized === 'cancel') {
    return 'cancel';
  }
  return null;
}

function toSparkPackages(input: unknown): SparkPackageItem[] {
  const root = parseOptionalJsonObject(input);
  const rawItems: unknown[] = Array.isArray(input)
    ? input
    : (Array.isArray(root?.items) ? root.items : []);
  return rawItems
    .map((item: unknown) => {
      const record = parseOptionalJsonObject(item);
      const id = String(record?.id || '').trim();
      if (!id) {
        return null;
      }
      const label = String(record?.label || id).trim() || id;
      const sparkAmount = parseNumber(record?.sparkAmount);
      const usdPrice = parseNumber(record?.usdPrice);
      const popular = record?.popular === true;
      return {
        id,
        label,
        sparkAmount,
        usdPrice,
        popular,
      };
    })
    .filter((item): item is SparkPackageItem => Boolean(item));
}

function pickDefaultSparkPackage(packages: SparkPackageItem[]): SparkPackageItem | null {
  if (packages.length === 0) {
    return null;
  }
  const sortByPrice = (left: SparkPackageItem, right: SparkPackageItem) =>
    left.usdPrice - right.usdPrice;
  const popularPackages = packages.filter((item) => item.popular).sort(sortByPrice);
  if (popularPackages.length > 0) {
    return popularPackages[0] || null;
  }
  return [...packages].sort(sortByPrice)[0] || null;
}

function resolveCheckoutBaseUrl(): URL {
  const fallbackOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const raw = readEnv('NIMI_WEB_URL') || fallbackOrigin;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error();
    }
    return parsed;
  } catch {
    return new URL(fallbackOrigin);
  }
}

function buildWalletCheckoutRedirectUrl(status: WalletCheckoutStatus): string {
  const base = resolveCheckoutBaseUrl();
  const query = new URLSearchParams();
  query.set('wallet_checkout', status);
  base.hash = `/?${query.toString()}`;
  return base.toString();
}

function readWalletCheckoutStatusFromLocation(): WalletCheckoutStatus | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const searchParams = new URLSearchParams(window.location.search);
  const searchStatus = normalizeWalletCheckoutStatus(searchParams.get('wallet_checkout'));
  if (searchStatus) {
    return searchStatus;
  }

  const hash = String(window.location.hash || '');
  const queryStart = hash.indexOf('?');
  if (queryStart < 0) {
    return null;
  }
  const hashQuery = hash.slice(queryStart + 1);
  const hashParams = new URLSearchParams(hashQuery);
  return normalizeWalletCheckoutStatus(hashParams.get('wallet_checkout'));
}

function clearWalletCheckoutStatusFromLocation(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const current = new URL(window.location.href);
  let changed = false;

  if (current.searchParams.has('wallet_checkout')) {
    current.searchParams.delete('wallet_checkout');
    changed = true;
  }

  const hashRaw = current.hash.startsWith('#') ? current.hash.slice(1) : current.hash;
  const [hashPathRaw = '/', hashQueryRaw = ''] = hashRaw.split('?');
  const hashPath = hashPathRaw || '/';
  const hashParams = new URLSearchParams(hashQueryRaw);
  if (hashParams.has('wallet_checkout')) {
    hashParams.delete('wallet_checkout');
    changed = true;
  }
  if (!changed) {
    return;
  }

  const hashQuery = hashParams.toString();
  current.hash = hashQuery ? `${hashPath}?${hashQuery}` : hashPath;
  window.history.replaceState({}, document.title, current.toString());
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

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
  const payload = parseOptionalJsonObject(input);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.map((item, index) => {
    const record = parseOptionalJsonObject(item) ?? {};
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
  const [launchingRecharge, setLaunchingRecharge] = useState(false);
  const [rechargeMessage, setRechargeMessage] = useState<string | null>(null);

  const balancesQuery = useQuery({
    queryKey: ['topbar-currency-balances'],
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

  const sparkPackagesQuery = useQuery({
    queryKey: ['wallet-spark-packages'],
    queryFn: async () => dataSync.loadSparkPackages(),
  });

  const withdrawEligibilityQuery = useQuery({
    queryKey: ['wallet-withdrawal-eligibility'],
    queryFn: async () => dataSync.loadWithdrawalEligibility(),
  });

  const withdrawalHistoryQuery = useQuery({
    queryKey: ['wallet-withdrawal-history'],
    queryFn: async () => dataSync.loadWithdrawalHistory(10),
  });

  const balancesPayload = parseOptionalJsonObject(balancesQuery.data);
  const subscriptionPayload = parseOptionalJsonObject(subscriptionQuery.data);
  const withdrawEligibilityPayload = parseOptionalJsonObject(withdrawEligibilityQuery.data);
  const sparkBalance = formatAmount(balancesPayload?.sparkBalance);
  const gemBalance = formatAmount(balancesPayload?.gemBalance);
  const subscriptionStatus = String(subscriptionPayload?.status || 'UNKNOWN');
  const subscriptionTier = String(subscriptionPayload?.tier || 'FREE');
  const canWithdraw = withdrawEligibilityPayload?.canWithdraw === true;
  const withdrawReason = String(withdrawEligibilityPayload?.reason || '');
  const withdrawMin = formatAmount(withdrawEligibilityPayload?.minAmount, 0);
  const sparkPackages = useMemo(() => toSparkPackages(sparkPackagesQuery.data), [sparkPackagesQuery.data]);
  const defaultSparkPackage = useMemo(
    () => pickDefaultSparkPackage(sparkPackages),
    [sparkPackages],
  );

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
    const payload = parseOptionalJsonObject(withdrawalHistoryQuery.data);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return items.map((item, index) => {
      const record = parseOptionalJsonObject(item) ?? {};
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

  const refreshSparkWalletSnapshot = useCallback(async () => {
    await Promise.all([
      balancesQuery.refetch(),
      sparkHistoryQuery.refetch(),
    ]);
  }, [balancesQuery, sparkHistoryQuery]);

  const startRechargeRefreshLoop = useCallback(() => {
    void (async () => {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await refreshSparkWalletSnapshot();
        if (attempt < 5) {
          await sleep(5000);
        }
      }
    })();
  }, [refreshSparkWalletSnapshot]);

  useEffect(() => {
    const checkoutStatus = readWalletCheckoutStatusFromLocation();
    if (!checkoutStatus) {
      return;
    }
    clearWalletCheckoutStatusFromLocation();
    setRechargeMessage(
      checkoutStatus === 'success'
        ? t('Wallet.rechargeCheckoutSuccess')
        : t('Wallet.rechargeCheckoutCanceled'),
    );
    void refreshSparkWalletSnapshot();
  }, [refreshSparkWalletSnapshot, t]);

  const handleStartRecharge = async () => {
    if (!defaultSparkPackage) {
      setRechargeMessage(
        sparkPackagesQuery.isError
          ? t('Wallet.rechargePackagesLoadError')
          : t('Wallet.rechargePackageUnavailable'),
      );
      return;
    }

    setLaunchingRecharge(true);
    setRechargeMessage(null);
    try {
      const checkout = await dataSync.createSparkCheckout({
        packageId: defaultSparkPackage.id,
        successUrl: buildWalletCheckoutRedirectUrl('success'),
        cancelUrl: buildWalletCheckoutRedirectUrl('cancel'),
      });
      const checkoutUrl = String(checkout?.url || '').trim();
      if (!checkoutUrl) {
        throw new Error(t('Wallet.rechargeLaunchError'));
      }
      const launchResult = await desktopBridge.openExternalUrl(checkoutUrl);
      if (!launchResult.opened) {
        throw new Error(t('Wallet.rechargeLaunchError'));
      }
      setRechargeMessage(t('Wallet.rechargeRedirecting'));
      startRechargeRefreshLoop();
    } catch (error) {
      setRechargeMessage(error instanceof Error ? error.message : t('Wallet.rechargeLaunchError'));
    } finally {
      setLaunchingRecharge(false);
    }
  };

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

  const defaultSparkPackageLabel = defaultSparkPackage?.label || '';
  const defaultSparkAmount = formatLocaleNumber(defaultSparkPackage?.sparkAmount || 0, {
    maximumFractionDigits: 0,
  });
  const defaultSparkPrice = formatLocaleNumber(defaultSparkPackage?.usdPrice || 0, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

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
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
                  <SparkIcon className="h-5 w-5 text-white" />
                </div>
                <span className="text-sm font-medium text-white/90">{t('Wallet.sparkBalance')}</span>
              </div>
              <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white">
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
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-mint-400/20">
                  <GemIcon className="h-5 w-5 text-mint-400" />
                </div>
                <span className="text-sm font-medium text-white/90">{t('Wallet.gem')}</span>
              </div>
              <span className="rounded-full bg-mint-400/20 px-3 py-1 text-xs font-medium text-mint-300">
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

      {/* Spark Recharge Section */}
      <section className="mt-8">
        <SectionTitle>{t('Wallet.sectionRecharge')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-gray-900">{t('Wallet.rechargeTitle')}</p>
              <p className="text-xs text-gray-500">
                {defaultSparkPackage
                  ? t('Wallet.rechargePackageLine', {
                    label: defaultSparkPackageLabel,
                    spark: defaultSparkAmount,
                    usd: defaultSparkPrice,
                  })
                  : (sparkPackagesQuery.isPending
                    ? t('Wallet.rechargeLoadingPackages')
                    : t('Wallet.rechargePackageUnavailable'))}
              </p>
              <p className="text-xs text-gray-500">{t('Wallet.rechargeComplianceHint')}</p>
            </div>
            <button
              type="button"
              disabled={sparkPackagesQuery.isPending || launchingRecharge || !defaultSparkPackage}
              onClick={() => { void handleStartRecharge(); }}
              className="flex items-center justify-center gap-2 rounded-xl bg-mint-500 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-mint-600 hover:shadow-md disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none"
            >
              <SparkIcon className="h-4 w-4" />
              {launchingRecharge ? t('Wallet.rechargeLaunching') : t('Wallet.recharge')}
            </button>
          </div>

          {sparkPackagesQuery.isError ? (
            <div className="mt-3 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-700">
              {t('Wallet.rechargePackagesLoadError')}
            </div>
          ) : null}

          {rechargeMessage ? (
            <div className="mt-3 rounded-lg bg-gray-50 px-4 py-2 text-sm text-gray-600">
              {rechargeMessage}
            </div>
          ) : null}
        </div>
      </section>

      {/* Withdrawal Section */}
      <section className="mt-8">
        <SectionTitle>{t('Wallet.sectionWithdrawal')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
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
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          {timeline.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                <WalletIcon className="h-6 w-6 text-gray-400" />
              </div>
              <p className="text-sm text-gray-500">{t('Wallet.noTransactions')}</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
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
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          {withdrawalItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                <ArrowUpIcon className="h-6 w-6 text-gray-400" />
              </div>
              <p className="text-sm text-gray-500">{t('Wallet.noWithdrawals')}</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
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
