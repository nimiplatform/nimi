import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { desktopBridge } from '@renderer/bridge';
import {
  createRealmSparkCheckout,
  createRealmWithdrawal,
  loadRealmCurrencyBalances,
  loadRealmGemTransactionHistory,
  loadRealmSparkPackages,
  loadRealmSparkTransactionHistory,
  loadRealmSubscriptionStatus,
  loadRealmWithdrawalEligibility,
  loadRealmWithdrawalHistory,
} from '@nimiplatform/kit/features/commerce/realm';
import { parseOptionalJsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import { formatLocaleDateTime, formatLocaleNumber } from '@renderer/i18n';
import { getDesktopRealmCommerceGiftService } from '@renderer/infra/realm/realm-commerce-service';
import { PageShell } from './settings-layout-components.js';
import {
  WalletBalanceCards,
  WalletRechargeSection,
  WalletWithdrawalSection,
} from './settings-wallet-sections.js';
import {
  WalletRecentTransactionsSection,
  WalletWithdrawalHistorySection,
  type WalletTimelineItem,
} from './settings-wallet-history-sections.js';

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

export function WalletPage() {
  const { t } = useTranslation();
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [submittingWithdrawal, setSubmittingWithdrawal] = useState(false);
  const [withdrawalMessage, setWithdrawalMessage] = useState<string | null>(null);
  const [launchingRecharge, setLaunchingRecharge] = useState(false);
  const [rechargeMessage, setRechargeMessage] = useState<string | null>(null);

  const balancesQuery = useQuery({
    queryKey: ['wallet-currency-balances'],
    queryFn: async () => loadRealmCurrencyBalances({
      service: getDesktopRealmCommerceGiftService(),
    }),
  });

  const sparkHistoryQuery = useQuery({
    queryKey: ['wallet-spark-history'],
    queryFn: async () => loadRealmSparkTransactionHistory({
      service: getDesktopRealmCommerceGiftService(),
      limit: 20,
    }),
  });

  const gemHistoryQuery = useQuery({
    queryKey: ['wallet-gem-history'],
    queryFn: async () => loadRealmGemTransactionHistory({
      service: getDesktopRealmCommerceGiftService(),
      limit: 20,
    }),
  });

  const subscriptionQuery = useQuery({
    queryKey: ['wallet-subscription'],
    queryFn: async () => loadRealmSubscriptionStatus({
      service: getDesktopRealmCommerceGiftService(),
    }),
  });

  const sparkPackagesQuery = useQuery({
    queryKey: ['wallet-spark-packages'],
    queryFn: async () => loadRealmSparkPackages({
      service: getDesktopRealmCommerceGiftService(),
    }),
  });

  const withdrawEligibilityQuery = useQuery({
    queryKey: ['wallet-withdrawal-eligibility'],
    queryFn: async () => loadRealmWithdrawalEligibility({
      service: getDesktopRealmCommerceGiftService(),
    }),
  });

  const withdrawalHistoryQuery = useQuery({
    queryKey: ['wallet-withdrawal-history'],
    queryFn: async () => loadRealmWithdrawalHistory({
      service: getDesktopRealmCommerceGiftService(),
      limit: 10,
    }),
  });

  const subscriptionPayload = parseOptionalJsonObject(subscriptionQuery.data);
  const withdrawEligibilityPayload = parseOptionalJsonObject(withdrawEligibilityQuery.data);
  const sparkBalance = formatAmount(balancesQuery.data?.sparkBalance);
  const gemBalance = formatAmount(balancesQuery.data?.gemBalance);
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
    setRechargeMessage(t('Wallet.rechargeReturnRequiresRealmEvidence'));
    void refreshSparkWalletSnapshot();
    if (checkoutStatus === 'success') {
      startRechargeRefreshLoop();
    }
  }, [refreshSparkWalletSnapshot, startRechargeRefreshLoop, t]);

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
      const checkout = await createRealmSparkCheckout({
        service: getDesktopRealmCommerceGiftService(),
        input: {
          packageId: defaultSparkPackage.id,
          successUrl: buildWalletCheckoutRedirectUrl('success'),
          cancelUrl: buildWalletCheckoutRedirectUrl('cancel'),
        },
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
      await createRealmWithdrawal({
        service: getDesktopRealmCommerceGiftService(),
        input: { gemAmount: normalized },
      });
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
      <WalletBalanceCards
        sparkBalance={sparkBalance}
        gemBalance={gemBalance}
        subscriptionTier={subscriptionTier}
        subscriptionStatus={subscriptionStatus}
        withdrawMin={withdrawMin}
        loading={loading}
      />

      <WalletRechargeSection
        defaultSparkPackageAvailable={Boolean(defaultSparkPackage)}
        defaultSparkPackageLabel={defaultSparkPackageLabel}
        defaultSparkAmount={defaultSparkAmount}
        defaultSparkPrice={defaultSparkPrice}
        packagesPending={sparkPackagesQuery.isPending}
        packagesError={sparkPackagesQuery.isError}
        launchingRecharge={launchingRecharge}
        rechargeMessage={rechargeMessage}
        onStartRecharge={() => { void handleStartRecharge(); }}
      />

      <WalletWithdrawalSection
        canWithdraw={canWithdraw}
        withdrawReason={withdrawReason}
        withdrawMin={withdrawMin}
        withdrawAmount={withdrawAmount}
        submittingWithdrawal={submittingWithdrawal}
        withdrawalMessage={withdrawalMessage}
        onWithdrawAmountChange={setWithdrawAmount}
        onCreateWithdrawal={() => { void handleCreateWithdrawal(); }}
      />

      <WalletRecentTransactionsSection timeline={timeline} />
      <WalletWithdrawalHistorySection withdrawalItems={withdrawalItems} />
    </PageShell>
  );
}
