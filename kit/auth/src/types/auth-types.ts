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
  | 'email_2fa';

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
  consentCheckbox?: string;
  passwordInput?: string;
  otpButton?: string;
};

export type WebAccountAuthConsent = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode | ((inputId: string) => ReactNode);
  requiredMessage: string;
  lang?: string;
};

export type WebAccountAuthBackgroundState = {
  isLogoHovered: boolean;
  mode: WebAccountAuthMode;
};

export type WebAccountAuthAlternatives = {
  googleDisabledReason?: string;
  tikTokDisabledReason?: string;
};

export type WebAccountAuthPageProps = {
  passwordRecoveryLink?: ReactNode;
  initialStage?: 'logo' | 'email';
  adapter: WebAccountAuthAdapter;
  session: WebAccountAuthSession;
  branding: WebAccountAuthBranding;
  appearance: WebAccountAuthAppearance;
  alternatives?: WebAccountAuthAlternatives;
  consent?: WebAccountAuthConsent;
  background?: ReactNode | ((state: WebAccountAuthBackgroundState) => ReactNode);
  header?: ReactNode;
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
  'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--nimi-motion-fast,120ms)] ease-[var(--nimi-motion-ease-standard)] active:scale-[var(--nimi-motion-pressed-scale,0.97)] disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:border-[var(--nimi-field-focus)] focus-visible:ring-[length:var(--nimi-focus-ring-width)] focus-visible:ring-[var(--nimi-focus-ring-color)]';
export const buttonDefault = 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] hover:bg-[var(--nimi-action-primary-bg-hover)] shadow-md';
export const buttonOutline = 'border border-[var(--nimi-field-border)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-primary)] shadow-sm hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)]';
export const buttonGhost = 'text-[var(--nimi-text-primary)] hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-primary)]';
export const inputBase =
  'placeholder:text-[var(--nimi-text-muted)] selection:bg-[var(--nimi-action-primary-bg)] selection:text-white w-full min-w-0 rounded-md border border-[var(--nimi-field-border)] bg-transparent text-sm shadow-xs transition-[color,border-color,box-shadow] duration-[var(--nimi-motion-fast,120ms)] outline-none focus-visible:border-[var(--nimi-field-focus)] focus-visible:ring-[length:var(--nimi-focus-ring-width)] focus-visible:ring-[var(--nimi-focus-ring-color)]';

// Shared capsule input bar (email entry and password entry must not drift)
export const capsuleBar =
  'flex items-center min-h-[3.25rem] rounded-full border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] shadow-[var(--nimi-elevation-base)] focus-within:border-[var(--nimi-field-focus)] focus-within:ring-[length:var(--nimi-focus-ring-width,2px)] focus-within:ring-[var(--nimi-focus-ring-color)]';
export const capsuleBarIconButton =
  'ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--nimi-icon-muted,var(--nimi-text-muted))] transition-[background-color,color,transform] duration-[var(--nimi-motion-fast,120ms)] ease-[var(--nimi-motion-ease-standard)] hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-action-primary-bg)] active:scale-[var(--nimi-motion-pressed-scale,0.97)] aria-expanded:bg-[var(--nimi-surface-active,rgba(20,118,212,0.16))] aria-expanded:text-[var(--nimi-action-primary-bg)] aria-expanded:hover:bg-[var(--nimi-surface-active,rgba(20,118,212,0.16))] aria-expanded:hover:text-[var(--nimi-action-primary-bg-hover)] focus-visible:outline-none focus-visible:ring-[length:var(--nimi-focus-ring-width,2px)] focus-visible:ring-[var(--nimi-focus-ring-color)] disabled:cursor-not-allowed disabled:opacity-50';
export const capsuleBarInput =
  'flex-1 min-w-0 bg-transparent px-3 text-[length:var(--nimi-type-label-size,0.9375rem)] text-[var(--nimi-text-primary)] placeholder:text-[var(--nimi-text-muted)] outline-none';
export const capsuleBarSubmitButton =
  'flex h-9 w-9 items-center justify-center rounded-full bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] transition-[background-color,transform] duration-[var(--nimi-motion-fast,120ms)] ease-[var(--nimi-motion-ease-standard)] hover:bg-[var(--nimi-action-primary-bg-hover)] active:scale-[var(--nimi-motion-pressed-scale,0.97)] focus-visible:outline-none focus-visible:ring-[length:var(--nimi-focus-ring-width,2px)] focus-visible:ring-[var(--nimi-focus-ring-color)] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50';
