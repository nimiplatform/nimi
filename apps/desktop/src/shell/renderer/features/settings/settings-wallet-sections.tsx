import { useTranslation } from 'react-i18next';

import { SectionTitle } from './settings-layout-components.js';

export function SparkIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

export function GemIcon({ className = '' }: { className?: string }) {
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

export function ArrowUpIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

export function ArrowDownIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  );
}

export function WalletIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" />
      <path d="M4 6v12a2 2 0 0 0 2 2h14v-4" />
      <path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z" />
    </svg>
  );
}

export function AlertIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

export function WalletBalanceCards({
  sparkBalance,
  gemBalance,
  subscriptionTier,
  subscriptionStatus,
  withdrawMin,
  loading,
}: {
  sparkBalance: string;
  gemBalance: string;
  subscriptionTier: string;
  subscriptionStatus: string;
  withdrawMin: string;
  loading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div
        className="relative overflow-hidden rounded-2xl p-6 text-white shadow-lg"
        style={{ background: 'linear-gradient(to bottom right, var(--nimi-action-primary-bg), var(--nimi-action-primary-bg-hover))' }}
      >
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
  );
}

export function WalletRechargeSection({
  defaultSparkPackageAvailable,
  defaultSparkPackageLabel,
  defaultSparkAmount,
  defaultSparkPrice,
  packagesPending,
  packagesError,
  launchingRecharge,
  rechargeMessage,
  onStartRecharge,
}: {
  defaultSparkPackageAvailable: boolean;
  defaultSparkPackageLabel: string;
  defaultSparkAmount: string;
  defaultSparkPrice: string;
  packagesPending: boolean;
  packagesError: boolean;
  launchingRecharge: boolean;
  rechargeMessage: string | null;
  onStartRecharge: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="mt-8">
      <SectionTitle>{t('Wallet.sectionRecharge')}</SectionTitle>
      <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-gray-900">{t('Wallet.rechargeTitle')}</p>
            <p className="text-xs text-gray-500">
              {defaultSparkPackageAvailable
                ? t('Wallet.rechargePackageLine', {
                  label: defaultSparkPackageLabel,
                  spark: defaultSparkAmount,
                  usd: defaultSparkPrice,
                })
                : (packagesPending
                  ? t('Wallet.rechargeLoadingPackages')
                  : t('Wallet.rechargePackageUnavailable'))}
            </p>
            <p className="text-xs text-gray-500">{t('Wallet.rechargeComplianceHint')}</p>
          </div>
          <button
            type="button"
            disabled={packagesPending || launchingRecharge || !defaultSparkPackageAvailable}
            onClick={() => { onStartRecharge(); }}
            className="flex items-center justify-center gap-2 rounded-xl bg-mint-500 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-mint-600 hover:shadow-md disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none"
          >
            <SparkIcon className="h-4 w-4" />
            {launchingRecharge ? t('Wallet.rechargeLaunching') : t('Wallet.recharge')}
          </button>
        </div>

        {packagesError ? (
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
  );
}

export function WalletWithdrawalSection({
  canWithdraw,
  withdrawReason,
  withdrawMin,
  withdrawAmount,
  submittingWithdrawal,
  withdrawalMessage,
  onWithdrawAmountChange,
  onCreateWithdrawal,
}: {
  canWithdraw: boolean;
  withdrawReason: string;
  withdrawMin: string;
  withdrawAmount: string;
  submittingWithdrawal: boolean;
  withdrawalMessage: string | null;
  onWithdrawAmountChange: (value: string) => void;
  onCreateWithdrawal: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="mt-8">
      <SectionTitle>{t('Wallet.sectionWithdrawal')}</SectionTitle>
      <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
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

        {!canWithdraw && withdrawReason ? (
          <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{withdrawReason}</span>
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <input
              type="number"
              min="1"
              value={withdrawAmount}
              onChange={(event) => onWithdrawAmountChange(event.target.value)}
              placeholder={t('Wallet.gemAmount')}
              disabled={!canWithdraw || submittingWithdrawal}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100 disabled:opacity-50"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-gray-400">{t('Wallet.gemUnit')}</span>
          </div>
          <button
            type="button"
            disabled={!canWithdraw || submittingWithdrawal}
            onClick={() => { onCreateWithdrawal(); }}
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
  );
}
