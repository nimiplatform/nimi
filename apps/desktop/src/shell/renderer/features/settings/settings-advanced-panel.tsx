import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  createRealmCommerceGiftService,
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
import type { DesktopI18nResource } from '../../i18n/desktop-i18n.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import type {
  DesktopRendererRoutePort,
  DesktopRendererRouteView,
} from '../../renderer/contract.js';
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

function resolveCheckoutBaseUrl(raw: string): URL {
  const parsed = new URL(raw);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('DESKTOP_WALLET_CHECKOUT_BASE_URL_INVALID');
  }
  return parsed;
}

function buildWalletCheckoutRedirectUrl(
  status: WalletCheckoutStatus,
  checkoutBaseUrl: string,
): string {
  const base = resolveCheckoutBaseUrl(checkoutBaseUrl);
  const query = new URLSearchParams();
  query.set('wallet_checkout', status);
  base.hash = `/?${query.toString()}`;
  return base.toString();
}

function readWalletCheckoutStatusFromRoute(
  route: DesktopRendererRouteView,
): WalletCheckoutStatus | null {
  const searchParams = new URLSearchParams(route.search);
  const searchStatus = normalizeWalletCheckoutStatus(searchParams.get('wallet_checkout'));
  if (searchStatus) {
    return searchStatus;
  }

  const queryStart = route.hash.indexOf('?');
  if (queryStart < 0) {
    return null;
  }
  const hashParams = new URLSearchParams(route.hash.slice(queryStart + 1));
  return normalizeWalletCheckoutStatus(hashParams.get('wallet_checkout'));
}

function clearWalletCheckoutStatusFromRoute(route: DesktopRendererRoutePort): void {
  const current = route.get();
  const searchParams = new URLSearchParams(current.search);
  const hashRaw = current.hash.startsWith('#') ? current.hash.slice(1) : current.hash;
  const [hashPathRaw = '', hashQueryRaw = ''] = hashRaw.split('?');
  const hashParams = new URLSearchParams(hashQueryRaw);
  const searchChanged = searchParams.has('wallet_checkout');
  const hashChanged = hashParams.has('wallet_checkout');
  searchParams.delete('wallet_checkout');
  hashParams.delete('wallet_checkout');
  if (!searchChanged && !hashChanged) {
    return;
  }

  const search = searchParams.toString();
  const hashQuery = hashParams.toString();
  const hash = hashPathRaw || hashQuery
    ? `#${hashPathRaw}${hashQuery ? `?${hashQuery}` : ''}`
    : '';
  route.navigate({
    to: `${current.pathname}${search ? `?${search}` : ''}${hash}`,
    replace: true,
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

function formatAmount(value: unknown, i18n: DesktopI18nResource, digits = 2): string {
  return i18n.formatNumber(parseNumber(value), {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function formatDateTime(value: unknown, i18n: DesktopI18nResource): string {
  const raw = typeof value === 'string' ? value : '';
  if (!raw) {
    return '--';
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }
  return i18n.formatDateTime(date);
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
  const i18n = useDesktopI18nResource();
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const giftService = useMemo(
    () => createRealmCommerceGiftService({ generated: bindings.sdk.realm().generated }),
    [bindings.sdk],
  );
  const rechargeLoopCancelRef = useRef<(() => void) | null>(null);
  const processedCheckoutRouteRef = useRef<string | null>(null);
  const checkoutRoute = bindings.route.get();
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [submittingWithdrawal, setSubmittingWithdrawal] = useState(false);
  const [withdrawalMessage, setWithdrawalMessage] = useState<string | null>(null);
  const [launchingRecharge, setLaunchingRecharge] = useState(false);
  const [rechargeMessage, setRechargeMessage] = useState<string | null>(null);

  const balancesQuery = useQuery({
    queryKey: ['wallet-currency-balances'],
    queryFn: async () => loadRealmCurrencyBalances({ service: giftService }),
  });

  const sparkHistoryQuery = useQuery({
    queryKey: ['wallet-spark-history'],
    queryFn: async () => loadRealmSparkTransactionHistory({ service: giftService, limit: 20 }),
  });

  const gemHistoryQuery = useQuery({
    queryKey: ['wallet-gem-history'],
    queryFn: async () => loadRealmGemTransactionHistory({ service: giftService, limit: 20 }),
  });

  const subscriptionQuery = useQuery({
    queryKey: ['wallet-subscription'],
    queryFn: async () => loadRealmSubscriptionStatus({ service: giftService }),
  });

  const sparkPackagesQuery = useQuery({
    queryKey: ['wallet-spark-packages'],
    queryFn: async () => loadRealmSparkPackages({ service: giftService }),
  });

  const withdrawEligibilityQuery = useQuery({
    queryKey: ['wallet-withdrawal-eligibility'],
    queryFn: async () => loadRealmWithdrawalEligibility({ service: giftService }),
  });

  const withdrawalHistoryQuery = useQuery({
    queryKey: ['wallet-withdrawal-history'],
    queryFn: async () => loadRealmWithdrawalHistory({ service: giftService, limit: 10 }),
  });

  const subscriptionPayload = parseOptionalJsonObject(subscriptionQuery.data);
  const withdrawEligibilityPayload = parseOptionalJsonObject(withdrawEligibilityQuery.data);
  const sparkBalance = formatAmount(balancesQuery.data?.sparkBalance, i18n);
  const gemBalance = formatAmount(balancesQuery.data?.gemBalance, i18n);
  const subscriptionStatus = String(subscriptionPayload?.status || 'UNKNOWN');
  const subscriptionTier = String(subscriptionPayload?.tier || 'FREE');
  const canWithdraw = withdrawEligibilityPayload?.canWithdraw === true;
  const withdrawReason = String(withdrawEligibilityPayload?.reason || '');
  const withdrawMin = formatAmount(withdrawEligibilityPayload?.minAmount, i18n, 0);
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
        gemAmount: formatAmount(record.gemAmount, i18n),
        netAmount: formatAmount(record.netAmount, i18n),
        usdAmount: formatAmount(record.usdAmount, i18n),
        createdAt: formatDateTime(record.createdAt, i18n),
      };
    });
  }, [i18n, withdrawalHistoryQuery.data]);

  const refreshSparkWalletSnapshot = useCallback(async () => {
    await Promise.all([
      balancesQuery.refetch(),
      sparkHistoryQuery.refetch(),
    ]);
  }, [balancesQuery, sparkHistoryQuery]);

  const startRechargeRefreshLoop = useCallback(() => {
    rechargeLoopCancelRef.current?.();
    let active = true;
    let cancelScheduled: (() => void) | null = null;
    let attempt = 0;
    const cancel = () => {
      if (!active) return;
      active = false;
      cancelScheduled?.();
      cancelScheduled = null;
    };
    rechargeLoopCancelRef.current = cancel;

    const refresh = async () => {
      await refreshSparkWalletSnapshot();
      if (!active) return;
      attempt += 1;
      if (attempt >= 6) {
        active = false;
        if (rechargeLoopCancelRef.current === cancel) {
          rechargeLoopCancelRef.current = null;
        }
        return;
      }
      cancelScheduled = bindings.clock.schedule(5_000, (result) => {
        cancelScheduled = null;
        if (!active) return;
        if (!result.ok) {
          active = false;
          if (rechargeLoopCancelRef.current === cancel) {
            rechargeLoopCancelRef.current = null;
          }
          setRechargeMessage(t('Wallet.rechargeReturnRequiresRealmEvidence'));
          return;
        }
        void refresh();
      });
    };
    void refresh();
  }, [bindings.clock, refreshSparkWalletSnapshot, t]);

  useEffect(() => () => {
    rechargeLoopCancelRef.current?.();
    rechargeLoopCancelRef.current = null;
  }, []);

  useEffect(() => {
    const checkoutStatus = readWalletCheckoutStatusFromRoute(checkoutRoute);
    if (!checkoutStatus || processedCheckoutRouteRef.current === checkoutRoute.key) {
      return;
    }
    processedCheckoutRouteRef.current = checkoutRoute.key;
    clearWalletCheckoutStatusFromRoute(bindings.route);
    setRechargeMessage(t('Wallet.rechargeReturnRequiresRealmEvidence'));
    void refreshSparkWalletSnapshot();
    if (checkoutStatus === 'success') {
      startRechargeRefreshLoop();
    }
  }, [
    bindings.route,
    checkoutRoute.hash,
    checkoutRoute.key,
    checkoutRoute.search,
    refreshSparkWalletSnapshot,
    startRechargeRefreshLoop,
    t,
  ]);

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
        service: giftService,
        input: {
          packageId: defaultSparkPackage.id,
          successUrl: buildWalletCheckoutRedirectUrl(
            'success',
            bindings.app.projection.walletCheckoutBaseUrl(),
          ),
          cancelUrl: buildWalletCheckoutRedirectUrl(
            'cancel',
            bindings.app.projection.walletCheckoutBaseUrl(),
          ),
        },
      });
      const checkoutUrl = String(checkout?.url || '').trim();
      if (!checkoutUrl) {
        throw new Error(t('Wallet.rechargeLaunchError'));
      }
      const launchResult = await bindings.app.commands.openWalletCheckout(checkoutUrl);
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
        service: giftService,
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
  const defaultSparkAmount = i18n.formatNumber(defaultSparkPackage?.sparkAmount || 0, {
    maximumFractionDigits: 0,
  });
  const defaultSparkPrice = i18n.formatNumber(defaultSparkPackage?.usdPrice || 0, {
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
