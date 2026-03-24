import { useTranslation } from 'react-i18next';
import type { WalletType } from '../types/auth-types.js';
import { buttonBase, buttonGhost } from '../types/auth-types.js';
import { MetaMaskIcon, BinanceIcon, OKXIcon } from './auth-wallet-icons.js';

export function AuthViewWalletSelect(props: {
  pending: boolean;
  onWalletLogin: (walletType: WalletType) => void;
}) {
  const { t } = useTranslation();
  const { pending, onWalletLogin } = props;

  return (
    <div className="flex flex-col items-center">
      <p
        className="mb-5 text-center text-[13px] text-[var(--nimi-text-muted)]"
        style={{ fontFamily: 'var(--font-ui)' }}
      >
        {t('Auth.selectWalletHint')}
      </p>

      <div className="w-full space-y-1">
        <button
          type="button"
          onClick={() => {
            void onWalletLogin('metamask');
          }}
          className={`${buttonBase} ${buttonGhost} h-auto w-full justify-between rounded-xl border border-transparent bg-[var(--nimi-surface-card)] px-4 py-2.5 hover:border-[var(--nimi-action-primary-bg)]/20 hover:bg-[var(--nimi-action-primary-bg)]/5`}
          disabled={pending}
        >
          <div className="flex items-center gap-3">
            <MetaMaskIcon className="h-5 w-5" />
            <span
              className="text-[15px] font-medium"
              style={{ color: 'var(--nimi-text-primary)', fontFamily: 'var(--font-ui)' }}
            >
              MetaMask
            </span>
          </div>
          <span
            className="rounded-full px-2 py-1 text-[12px] font-normal tracking-wide"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--nimi-text-muted) 12%, transparent)',
              color: 'var(--nimi-text-secondary)',
              fontFamily: 'var(--font-ui)',
            }}
          >
            Multichain
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            void onWalletLogin('binance');
          }}
          className={`${buttonBase} ${buttonGhost} h-auto w-full justify-between rounded-xl border border-transparent bg-[var(--nimi-surface-card)] px-4 py-2.5 hover:border-[var(--nimi-action-primary-bg)]/20 hover:bg-[var(--nimi-action-primary-bg)]/5`}
          disabled={pending}
        >
          <div className="flex items-center gap-3">
            <BinanceIcon className="h-5 w-5" />
            <span
              className="text-[15px] font-medium"
              style={{ color: 'var(--nimi-text-primary)', fontFamily: 'var(--font-ui)' }}
            >
              Binance Wallet
            </span>
          </div>
          <span
            className="rounded-full px-2 py-1 text-[12px] font-normal tracking-wide"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--nimi-text-muted) 12%, transparent)',
              color: 'var(--nimi-text-secondary)',
              fontFamily: 'var(--font-ui)',
            }}
          >
            Multichain
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            void onWalletLogin('okx');
          }}
          className={`${buttonBase} ${buttonGhost} h-auto w-full justify-between rounded-xl border border-transparent bg-[var(--nimi-surface-card)] px-4 py-2.5 hover:border-[var(--nimi-action-primary-bg)]/20 hover:bg-[var(--nimi-action-primary-bg)]/5`}
          disabled={pending}
        >
          <div className="flex items-center gap-3">
            <OKXIcon className="h-5 w-5" />
            <span
              className="text-[15px] font-medium"
              style={{ color: 'var(--nimi-text-primary)', fontFamily: 'var(--font-ui)' }}
            >
              OKX Wallet
            </span>
          </div>
          <span
            className="rounded-full px-2 py-1 text-[12px] font-normal tracking-wide"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--nimi-text-muted) 12%, transparent)',
              color: 'var(--nimi-text-secondary)',
              fontFamily: 'var(--font-ui)',
            }}
          >
            Multichain
          </span>
        </button>
      </div>
    </div>
  );
}
