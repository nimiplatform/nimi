import { useTranslation } from 'react-i18next';
import type { WalletType } from '../types/auth-types.js';
import { buttonBase, buttonGhost } from '../types/auth-types.js';
import { MetaMaskIcon, BinanceIcon, OKXIcon } from './auth-wallet-icons.js';

export function AuthViewWalletSelect(props: {
  pending: boolean;
  onWalletLogin: (walletType: WalletType) => void;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const { pending, onWalletLogin, onBack } = props;

  return (
    <div className="flex flex-col items-center">
      <p className="mb-5 text-center text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-muted)]">
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
            <span className="text-[length:var(--nimi-type-body-md-size)] font-medium text-[var(--nimi-text-primary)]">
              MetaMask
            </span>
          </div>
          <span
            className="rounded-full px-2 py-1 text-[length:var(--nimi-type-caption-size)] font-normal tracking-wide text-[var(--nimi-text-secondary)]"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--nimi-text-muted) 12%, transparent)',
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
            <span className="text-[length:var(--nimi-type-body-md-size)] font-medium text-[var(--nimi-text-primary)]">
              Binance Wallet
            </span>
          </div>
          <span
            className="rounded-full px-2 py-1 text-[length:var(--nimi-type-caption-size)] font-normal tracking-wide text-[var(--nimi-text-secondary)]"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--nimi-text-muted) 12%, transparent)',
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
            <span className="text-[length:var(--nimi-type-body-md-size)] font-medium text-[var(--nimi-text-primary)]">
              OKX Wallet
            </span>
          </div>
          <span
            className="rounded-full px-2 py-1 text-[length:var(--nimi-type-caption-size)] font-normal tracking-wide text-[var(--nimi-text-secondary)]"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--nimi-text-muted) 12%, transparent)',
            }}
          >
            Multichain
          </span>
        </button>
      </div>
      {onBack ? (
        <div className="nimi-shell-auth-secondary-actions">
          <button
            type="button"
            onClick={onBack}
            disabled={pending}
            className="nimi-shell-auth-secondary-action"
          >
            {t('Common.back', { defaultValue: 'Back' })}
          </button>
        </div>
      ) : null}
    </div>
  );
}
