import { useTranslation } from 'react-i18next';
import type { WalletType } from './auth-helpers.js';
import {
  buttonBase,
  buttonDefault,
  buttonGhost,
} from './auth-helpers.js';
import { CircleIconButton } from './auth-menu-header.js';
import { MetaMaskIcon, BinanceIcon, OKXIcon } from './auth-wallet-icons.js';

// ---------------------------------------------------------------------------
// AuthViewMain — the initial login view with social + wallet options
// ---------------------------------------------------------------------------

export function AuthViewMain(props: {
  pending: boolean;
  onSetView: (view: 'email_otp' | 'email_login') => void;
  onGoogleLogin: () => void;
  onTwitterLogin: () => void;
  onTikTokLogin: () => void;
  onWalletLogin: (walletType: WalletType) => void;
  twitterDisabledReason?: string;
  tikTokDisabledReason?: string;
}) {
  const { t } = useTranslation();
  const {
    pending,
    onSetView,
    onGoogleLogin,
    onTwitterLogin,
    onTikTokLogin,
    onWalletLogin,
    twitterDisabledReason,
    tikTokDisabledReason,
  } = props;

  return (
    <>
      <button
        type="button"
        className={`${buttonBase} ${buttonDefault} w-[300px] mx-auto mb-2 justify-center h-auto px-4 py-3 rounded-2xl group`}
        onClick={() => {
          onSetView('email_otp');
        }}
        disabled={pending}
      >
        <svg className="mr-3 w-5 h-5 text-white/80 group-hover:text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="m2 5 8.65 5.8a2 2 0 0 0 2.7 0L22 5" />
        </svg>
        <span className="text-sm font-medium text-white">{t('Auth.continueWithEmailOtp')}</span>
      </button>

      <button
        type="button"
        onClick={() => {
          onSetView('email_login');
        }}
        className="w-[300px] mx-auto mb-4 text-center text-xs text-muted-foreground hover:text-foreground"
        disabled={pending}
      >
        <span style={{ color: '#666666' }}>{t('Auth.continueWithEmailPassword')}</span>
      </button>

      <div className="mb-6 flex items-center justify-center gap-3">
        <CircleIconButton
          label="Google login"
          onClick={() => {
            void onGoogleLogin();
          }}
          disabled={pending}
        >
          <svg viewBox="0 0 24 24" className="mx-auto h-5 w-5">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.26.81-.58z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
        </CircleIconButton>

        <CircleIconButton
          label={twitterDisabledReason ? `Twitter unavailable: ${twitterDisabledReason}` : 'Twitter login'}
          onClick={() => {
            void onTwitterLogin();
          }}
          disabled={pending || Boolean(twitterDisabledReason)}
        >
          <svg viewBox="0 0 24 24" className={`mx-auto h-4 w-4 fill-current ${twitterDisabledReason ? 'opacity-60' : ''}`}>
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </CircleIconButton>

        <CircleIconButton
          label={tikTokDisabledReason ? `TikTok unavailable: ${tikTokDisabledReason}` : 'TikTok login'}
          onClick={() => {
            void onTikTokLogin();
          }}
          disabled={pending || Boolean(tikTokDisabledReason)}
        >
          <svg viewBox="0 0 24 24" className={`mx-auto h-4 w-4 fill-current ${tikTokDisabledReason ? 'opacity-60' : ''}`}>
            <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
          </svg>
        </CircleIconButton>
      </div>

      <div className="relative mb-5">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t" style={{ borderColor: '#E5E5E5' }} />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-card px-3 text-[11px] uppercase font-semibold" style={{ color: '#888888', fontFamily: 'Inter, sans-serif', letterSpacing: '0.1em' }}>
            {t('Auth.walletSection')}
          </span>
        </div>
      </div>

      <div className="space-y-1">
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
            <span className="text-sm font-medium" style={{ color: '#1A1A1A', fontFamily: 'Inter, sans-serif', letterSpacing: '0' }}>MetaMask</span>
          </div>
          <span className="rounded-full px-2 py-1 text-[10px] tracking-wide" style={{ backgroundColor: '#F2F2F2', color: '#1A1A1A' }}>
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
            <span className="text-sm font-medium" style={{ color: '#1A1A1A', fontFamily: 'Inter, sans-serif', letterSpacing: '0' }}>Binance Wallet</span>
          </div>
          <span className="rounded-full px-2 py-1 text-[10px] tracking-wide" style={{ backgroundColor: '#F2F2F2', color: '#1A1A1A' }}>
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
            <span className="text-sm font-medium" style={{ color: '#1A1A1A', fontFamily: 'Inter, sans-serif', letterSpacing: '0' }}>OKX Wallet</span>
          </div>
          <span className="rounded-full px-2 py-1 text-[10px] tracking-wide" style={{ backgroundColor: '#F2F2F2', color: '#1A1A1A' }}>
            Multichain
          </span>
        </button>
      </div>
    </>
  );
}
