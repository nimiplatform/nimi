import { useTranslation } from 'react-i18next';
import type { WalletType } from './auth-helpers.js';
import {
  buttonBase,
  buttonGhost,
} from './auth-helpers.js';
import { MetaMaskIcon, BinanceIcon, OKXIcon } from './auth-wallet-icons.js';

// ---------------------------------------------------------------------------
// AuthViewWalletSelect — wallet picker shown after tapping the Address entry
// ---------------------------------------------------------------------------

export function AuthViewWalletSelect(props: {
  pending: boolean;
  onWalletLogin: (walletType: WalletType) => void;
}) {
  const { t } = useTranslation();
  const { pending, onWalletLogin } = props;

  return (
    <div className="flex flex-col items-center">
      <p className="mb-5 text-[13px] text-muted-foreground text-center" style={{ fontFamily: 'var(--font-ui)' }}>
        {t('Auth.selectWalletHint')}
      </p>

      <div className="w-full space-y-1">
        <button
          type="button"
          onClick={() => {
            void onWalletLogin('metamask');
          }}
          className={`${buttonBase} ${buttonGhost} w-full justify-between h-auto rounded-xl bg-card px-4 py-2.5 border border-transparent hover:border-mint-200 hover:bg-mint-50`}
          disabled={pending}
        >
          <div className="flex items-center gap-3">
            <MetaMaskIcon className="h-5 w-5" />
            <span className="text-[15px] font-medium" style={{ color: '#1A1A1A', fontFamily: 'var(--font-ui)' }}>MetaMask</span>
          </div>
          <span className="rounded-full px-2 py-1 text-[12px] font-normal tracking-wide" style={{ backgroundColor: '#F2F2F2', color: '#666666', fontFamily: 'var(--font-ui)' }}>
            Multichain
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            void onWalletLogin('binance');
          }}
          className={`${buttonBase} ${buttonGhost} w-full justify-between h-auto rounded-xl bg-card px-4 py-2.5 border border-transparent hover:border-mint-200 hover:bg-mint-50`}
          disabled={pending}
        >
          <div className="flex items-center gap-3">
            <BinanceIcon className="h-5 w-5" />
            <span className="text-[15px] font-medium" style={{ color: '#1A1A1A', fontFamily: 'var(--font-ui)' }}>Binance Wallet</span>
          </div>
          <span className="rounded-full px-2 py-1 text-[12px] font-normal tracking-wide" style={{ backgroundColor: '#F2F2F2', color: '#666666', fontFamily: 'var(--font-ui)' }}>
            Multichain
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            void onWalletLogin('okx');
          }}
          className={`${buttonBase} ${buttonGhost} w-full justify-between h-auto rounded-xl bg-card px-4 py-2.5 border border-transparent hover:border-mint-200 hover:bg-mint-50`}
          disabled={pending}
        >
          <div className="flex items-center gap-3">
            <OKXIcon className="h-5 w-5" />
            <span className="text-[15px] font-medium" style={{ color: '#1A1A1A', fontFamily: 'var(--font-ui)' }}>OKX Wallet</span>
          </div>
          <span className="rounded-full px-2 py-1 text-[12px] font-normal tracking-wide" style={{ backgroundColor: '#F2F2F2', color: '#666666', fontFamily: 'var(--font-ui)' }}>
            Multichain
          </span>
        </button>
      </div>
    </div>
  );
}
