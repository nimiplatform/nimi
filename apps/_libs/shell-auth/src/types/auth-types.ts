import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';
import type { TauriOAuthBridge } from '@nimiplatform/shell-core/oauth';
import type { AuthPlatformAdapter } from '../platform/auth-platform-adapter.js';

// ---------------------------------------------------------------------------
// Auth view and stage types
// ---------------------------------------------------------------------------

export type WebAuthMenuMode = 'embedded' | 'desktop-browser';
export type EmbeddedAuthStage = 'logo' | 'email' | 'credential';

export type AuthView =
  | 'main'
  | 'desktop_authorize'
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

export type GoogleWindow = Window & {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient?: (config: {
          client_id: string;
          scope: string;
          callback: (response: { access_token?: string }) => void;
        }) => { requestAccessToken: () => void };
      };
    };
  };
  ethereum?: WalletProvider;
  okxwallet?: WalletProvider;
  BinanceChain?: WalletProvider;
  binanceWallet?: WalletProvider;
};

// ---------------------------------------------------------------------------
// Desktop callback types
// ---------------------------------------------------------------------------

export type DesktopCallbackRequest = {
  callbackUrl: string;
  state: string;
};

// ---------------------------------------------------------------------------
// Remember login
// ---------------------------------------------------------------------------

export type RememberedLogin = {
  email: string;
  password: string;
  rememberMe: boolean;
};

// ---------------------------------------------------------------------------
// Component props
// ---------------------------------------------------------------------------

export type AuthMenuProps = {
  mode: WebAuthMenuMode;
  onLogoHoverChange?: (hovered: boolean) => void;
  onLogoClick?: () => void;
  logoHintText?: string;
  logoErrorText?: string | null;
  logoDisabled?: boolean;
  logoLoading?: boolean;
};

export type ShellAuthTheme = 'desktop' | 'relay-dark' | 'custom';

export type ShellAuthSession = {
  mode: WebAuthMenuMode;
  authStatus?: string;
  authError?: string | null;
  authToken?: string | null;
  authUser?: Record<string, unknown> | null;
  setAuthSession?: (user: Record<string, unknown> | null, token: string, refreshToken?: string) => void;
  setStatusBanner?: (banner: { kind: string; message: string } | null) => void;
};

export type ShellAuthBranding = {
  networkLabel: string;
  logo: ReactNode | string;
  logoAltText?: string;
};

export type ShellAuthAppearance = {
  theme: ShellAuthTheme;
  rootClassName?: string;
  rootStyle?: CSSProperties;
  shellClassName?: string;
  contentClassName?: string;
  footerPlacement?: 'inside-content' | 'outside-content';
};

export type ShellAuthDesktopBrowserAuth = {
  bridge: TauriOAuthBridge;
  baseUrl?: string;
  onRootPointerDown?: (event: ReactMouseEvent<HTMLElement>) => void;
  hintVisibility?: 'always' | 'hover-or-status';
};

export type ShellAuthCopy = {
  title?: ReactNode;
  subtitle?: ReactNode;
  desktopLogoIdleHintText?: string;
  desktopLogoHintText?: string;
  desktopAuthOpenMessage?: string;
  desktopAuthSuccessMessage?: string;
};

export type ShellAuthTestIds = {
  screen?: string;
  logoTrigger?: string;
  emailInput?: string;
  emailSubmitArrow?: string;
  alternativeToggle?: string;
  alternativePanel?: string;
  passwordInput?: string;
  otpButton?: string;
};

export type ShellAuthBackgroundState = {
  isLogoHovered: boolean;
  mode: WebAuthMenuMode;
};

export type ShellAuthPageProps = {
  adapter: AuthPlatformAdapter;
  session: ShellAuthSession;
  branding: ShellAuthBranding;
  appearance: ShellAuthAppearance;
  background?: ReactNode | ((state: ShellAuthBackgroundState) => ReactNode);
  footer?: ReactNode;
  desktopBrowserAuth?: ShellAuthDesktopBrowserAuth;
  copy?: ShellAuthCopy;
  testIds?: ShellAuthTestIds;
};

// ---------------------------------------------------------------------------
// Style constants — use CSS variable references for colors
// ---------------------------------------------------------------------------

export const buttonBase =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:border-[var(--auth-primary,#4ECCA3)] focus-visible:ring-[var(--auth-primary,#4ECCA3)]/50 focus-visible:ring-[3px]';
export const buttonDefault = 'bg-[var(--auth-primary,#4ECCA3)] text-white hover:bg-[var(--auth-primary-hover,#3dbb8f)] shadow-md';
export const buttonOutline = 'border border-[var(--auth-input-border,#ddd4c6)] bg-[var(--auth-card-bg,#fffdf9)] text-[var(--auth-text,#3b352c)] shadow-sm hover:bg-[var(--auth-hover-bg,#f0ece6)] hover:text-[var(--auth-hover-text,#4b4338)]';
export const buttonGhost = 'text-[var(--auth-text,#3b352c)] hover:bg-[var(--auth-hover-bg,#f0ece6)] hover:text-[var(--auth-hover-text,#4b4338)]';
export const inputBase =
  'placeholder:text-[var(--auth-muted,#999999)] selection:bg-[var(--auth-primary,#4ECCA3)] selection:text-white w-full min-w-0 rounded-md border border-[var(--auth-input-border,#ddd4c6)] bg-transparent text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-[var(--auth-primary,#4ECCA3)] focus-visible:ring-[var(--auth-primary,#4ECCA3)]/50 focus-visible:ring-[3px]';
