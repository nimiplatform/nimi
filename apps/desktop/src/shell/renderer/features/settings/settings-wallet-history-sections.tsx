import { useTranslation } from 'react-i18next';
import { formatLocaleDateTime } from '@renderer/i18n';
import { SectionTitle } from './settings-layout-components.js';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  WalletIcon,
} from './settings-wallet-sections.js';

export type WalletTimelineItem = {
  id: string;
  currencyType: string;
  type: string;
  description: string;
  amount: string;
  createdAt: string;
};

export type WalletWithdrawalHistoryItem = {
  id: string;
  status: string;
  gemAmount: string;
  netAmount: string;
  usdAmount: string;
  createdAt: string;
};

function parseWalletNumber(value: unknown): number {
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

function formatWalletDateTime(value: unknown): string {
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

export function WalletRecentTransactionsSection({
  timeline,
}: {
  timeline: WalletTimelineItem[];
}) {
  const { t } = useTranslation();
  return (
    <section className="mt-8">
      <SectionTitle>{t('Wallet.sectionRecentTransactions')}</SectionTitle>
      <div className="mt-3 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
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
              const amountValue = parseWalletNumber(tx.amount);
              const positive = amountValue >= 0;
              const isSpark = tx.currencyType === 'SPARK';
              return (
                <div
                  key={`${tx.currencyType}-${tx.id}`}
                  className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-gray-50/50"
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${positive ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                      {positive ? <ArrowUpIcon className="h-5 w-5" /> : <ArrowDownIcon className="h-5 w-5" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{tx.description}</p>
                      <p className="text-xs text-gray-400">{formatWalletDateTime(tx.createdAt)}</p>
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
  );
}

export function WalletWithdrawalHistorySection({
  withdrawalItems,
}: {
  withdrawalItems: WalletWithdrawalHistoryItem[];
}) {
  const { t } = useTranslation();
  return (
    <section className="mt-8">
      <SectionTitle>{t('Wallet.sectionWithdrawalHistory')}</SectionTitle>
      <div className="mt-3 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
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
              <div key={item.id} className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-gray-50/50">
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
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
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
  );
}
