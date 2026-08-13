import type {
  CSSProperties,
  ReactNode,
} from 'react';
import type { WebAccountAuthAdapter } from '../platform/web-account-auth-adapter.js';

// ---------------------------------------------------------------------------
// Auth view and stage types
// ---------------------------------------------------------------------------

export type WebAccountAuthMode = 'embedded';
export type EmbeddedAuthStage = 'logo' | 'email' | 'credential';

export type AuthView =
  | 'main'
  | 'email_login'
  | 'email_register'
  | 'email_otp'
  | 'email_otp_verify'
  | 'email_set_password'
  | 'email_2fa'
  | 'wallet_select';

// ---------------------------------------------------------------------------
// Wallet types
// ---------------------------------------------------------------------------

export type WalletType = 'metamask' | 'okx' | 'binance';

export type WalletProvider = {
  isMetaMask?: boolean;
  isOkxWallet?: boolean;
  isOKXWallet?: boolean;
  isOkx?: boolean;
  isBinance?: boolean;
  isBinanceWallet?: boolean;
  isBinanceChain?: boolean;
  providers?: WalletProvider[];
  request: (args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }) => Promise<unknown>;
};

// ---------------------------------------------------------------------------
// Google window extension
// ---------------------------------------------------------------------------

export type WebAccountAuthWindow = Window & {
  google?: {
    accounts?: {
      id?: {
        initialize?: (config: {
          client_id: string;
          callback: (response: { credential?: string; select_by?: string }) => void;
        }) => void;
        prompt?: (listener?: (notification: {
          isNotDisplayed?: () => boolean;
          isSkippedMoment?: () => boolean;
        }) => void) => void;
      };
    };
  };
  ethereum?: WalletProvider;
  okxwallet?: WalletProvider;
  BinanceChain?: WalletProvider;
  binanceWallet?: WalletProvider;
};

// ---------------------------------------------------------------------------
// Remember login
// ---------------------------------------------------------------------------

export type RememberedLogin = {
  email: string;
  rememberMe: boolean;
};

// ---------------------------------------------------------------------------
// Component props
// ---------------------------------------------------------------------------

export type WebAccountAuthMenuProps = {
  mode: WebAccountAuthMode;
  onLogoHoverChange?: (hovered: boolean) => void;
  onLogoClick?: () => void;
  logoHintText?: string;
  logoErrorText?: string | null;
  logoDisabled?: boolean;
  logoLoading?: boolean;
};

export type WebAccountAuthTheme = 'default' | 'custom';

export type WebAccountAuthSession = {
  mode: WebAccountAuthMode;
  authStatus?: string;
  authError?: string | null;
  authUser?: Record<string, unknown> | null;
  setAuthSession?: (user: Record<string, unknown> | null) => void;
  setStatusBanner?: (banner: { kind: string; message: string } | null) => void;
};

export type WebAccountAuthBranding = {
  networkLabel: string;
  logo: ReactNode | string;
  logoAltText?: string;
};

export type WebAccountAuthAppearance = {
  theme: WebAccountAuthTheme;
  rootClassName?: string;
  rootStyle?: CSSProperties;
  shellClassName?: string;
  contentClassName?: string;
  footerPlacement?: 'inside-content' | 'outside-content';
};

/**
 * Type-level admission of `RuntimeAccountService` as the only desktop-browser
 * login authority (rule.nimi.runtime.protected-session.r028). `runtimeAccountBroker` is
 * required — there is no admitted fallback. Apps without a broker cannot
 * type-check; if you are adding a new app, mirror desktop / web and route
 * through `createLocalFirstPartyRuntimePlatformClient` +
 * `runtime.account.{beginLogin, completeLogin}`.
 */
export type DesktopBrowserAuthRuntimeBroker = {
  begin: (input: {
    callbackUrl: string;
    timeoutMs: number;
  }) => Promise<{
    loginAttemptId: string;
    authorizationUrl: string;
    state: string;
    nonce: string;
  }>;
  complete: (input: {
    loginAttemptId: string;
    code: string;
    state: string;
    nonce: string;
    callbackUrl: string;
  }) => Promise<{
    user: Record<string, unknown> | null;
  }>;
};

export type WebAccountAuthCopy = {
  title?: ReactNode;
  subtitle?: ReactNode;
  desktopLogoIdleHintText?: string;
  desktopLogoHintText?: string;
  desktopAuthOpenMessage?: string;
  desktopAuthSuccessMessage?: string;
};

export type ShellAuthSemanticIds = {
  entryAction?: string;
};

export type WebAccountAuthTestIds = {
  screen?: string;
  logoTrigger?: string;
  emailInput?: string;
  emailSubmitArrow?: string;
  alternativeToggle?: string;
  alternativePanel?: string;
  passwordInput?: string;
  otpButton?: string;
};

export type WebAccountAuthBackgroundState = {
  isLogoHovered: boolean;
  mode: WebAccountAuthMode;
};

export type WebAccountAuthPageProps = {
  adapter: WebAccountAuthAdapter;
  session: WebAccountAuthSession;
  branding: WebAccountAuthBranding;
  appearance: WebAccountAuthAppearance;
  background?: ReactNode | ((state: WebAccountAuthBackgroundState) => ReactNode);
  footer?: ReactNode;
  onActionableReady?: () => void;
  onEntryAction?: () => void;
  copy?: WebAccountAuthCopy;
  semanticIds?: ShellAuthSemanticIds;
  testIds?: WebAccountAuthTestIds;
};

// ---------------------------------------------------------------------------
// Style constants — use CSS variable references for colors
// ---------------------------------------------------------------------------

export const buttonBase =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:border-[var(--nimi-action-primary-bg)] focus-visible:ring-[var(--nimi-action-primary-bg)]/50 focus-visible:ring-[3px]';
export const buttonDefault = 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] hover:bg-[var(--nimi-action-primary-bg-hover)] shadow-md';
export const buttonOutline = 'border border-[var(--nimi-field-border)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-primary)] shadow-sm hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)]';
export const buttonGhost = 'text-[var(--nimi-text-primary)] hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)]';
export const inputBase =
  'placeholder:text-[var(--nimi-text-muted)] selection:bg-[var(--nimi-action-primary-bg)] selection:text-white w-full min-w-0 rounded-md border border-[var(--nimi-field-border)] bg-transparent text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-[var(--nimi-action-primary-bg)] focus-visible:ring-[var(--nimi-action-primary-bg)]/50 focus-visible:ring-[3px]';
