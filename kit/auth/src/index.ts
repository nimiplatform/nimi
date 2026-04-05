// @nimiplatform/nimi-kit/auth — Shared authentication UI for Desktop and Relay

// Platform adapter
export type {
  AuthPlatformAdapter,
  WalletChallengeInput,
  WalletChallengeResult,
  WalletLoginInput,
} from './platform/auth-platform-adapter.js';

// Types
export type {
  AuthView,
  EmbeddedAuthStage,
  WebAuthMenuMode,
  WalletType,
  WalletProvider,
  ShellAuthWindow,
  DesktopCallbackRequest,
  RememberedLogin,
  AuthMenuProps,
  ShellAuthTheme,
  ShellAuthSession,
  ShellAuthBranding,
  ShellAuthAppearance,
  ShellAuthDesktopBrowserAuth,
  ShellAuthCopy,
  ShellAuthTestIds,
  ShellAuthBackgroundState,
  ShellAuthPageProps,
} from './types/auth-types.js';

// Style constants
export {
  buttonBase,
  buttonDefault,
  buttonOutline,
  buttonGhost,
  inputBase,
} from './types/auth-types.js';

// Logic
export {
  resolveEmailEntryRoute,
  shouldPromptPasswordSetupAfterEmailOtp,
  type EmailEntryRoute,
} from './logic/auth-email-flow.js';

export {
  loadPersistedAuthSession,
  persistAuthSession,
  persistAccessToken,
  loadPersistedAccessToken,
  clearPersistedAccessToken,
  WEB_AUTH_SESSION_KEY,
  type PersistedWebAuthSession,
} from './logic/auth-session-storage.js';

export {
  createSharedDesktopAuthSession,
  decodeJwtExpiry,
  normalizeSharedDesktopAuthUser,
  parseSharedDesktopAuthSession,
  persistSharedDesktopAuthSession,
  resolveDesktopBootstrapAuthSession,
  resolveSessionExpiry,
  type DesktopBootstrapAuthResolution,
  type PersistSharedDesktopAuthSessionInput,
  type ResolvedDesktopBootstrapAuthSession,
  type SharedDesktopAuthSession,
  type SharedDesktopAuthUser,
} from './logic/shared-desktop-auth-session.js';

export {
  useAuthFormState,
  getAuthErrorMessage,
  type AuthMode,
  type AuthFormState,
  type AuthFormActions,
  type AuthFormModel,
} from './logic/auth-form-state.js';

export {
  parseChainId,
  resolveWalletProvider,
} from './logic/wallet-helpers.js';

export {
  getGoogleClientId,
  loadGoogleScript,
} from './logic/google-helpers.js';

export {
  loadRememberedLogin,
  saveRememberedLogin,
  clearRememberedLogin,
  REMEMBER_LOGIN_KEY,
} from './logic/remember-login.js';

export {
  readLocationQueryParams,
  hasDesktopCallbackRequestInLocation,
  resolveDesktopCallbackRequestFromLocation,
  buildDesktopCallbackReturnUrl,
  submitDesktopCallbackResult,
  createDesktopCallbackState,
  createDesktopCallbackRedirectUri,
  normalizeWebAuthLaunchPath,
  resolveDesktopWebAuthLaunchBaseUrl,
  buildDesktopWebAuthLaunchUrl,
} from './logic/desktop-callback-helpers.js';

export {
  toErrorMessage,
  localizeAuthError,
  toDesktopBrowserAuthErrorMessage,
  getUserDisplayLabel,
} from '@nimiplatform/nimi-kit/core/oauth';

export {
  performDesktopWebAuth,
  type DesktopWebAuthResult,
} from './logic/desktop-web-auth.js';

// Handlers
export type { AuthMenuSetters, DesktopCallbackContext } from './logic/auth-menu-handlers.js';
export {
  applyTokens,
  handleLoginResult,
  handleGoogleLogin,
  handleSocialLogin,
  handleEmailLogin,
  handleSetPasswordAfterOtp,
} from './logic/auth-menu-handlers.js';

export {
  handleRequestEmailOtp,
  handleVerifyEmailOtp,
  handleResendOtp,
  handleVerify2Fa,
  handleConfirmDesktopAuthorization,
  handleWalletLogin,
} from './logic/auth-menu-handlers-ext.js';

// Hooks
export { useAuthFlow } from './hooks/use-auth-flow.js';

// Components
export { AuthViewMain } from './components/auth-view-main.js';
export {
  AuthViewEmailLogin,
  AuthViewEmailSetPassword,
  AuthViewEmailOtpVerify,
  AuthViewEmail2Fa,
} from './components/auth-view-email.js';
export { AuthViewDesktopAuthorize } from './components/auth-view-desktop-authorize.js';
export { AuthViewWalletSelect } from './components/auth-view-wallet-select.js';
export { CircleIconButton } from './components/auth-menu-header.js';
export { OtpInput } from './components/auth-otp-input.js';
export { MetaMaskIcon, BinanceIcon, OKXIcon } from './components/auth-wallet-icons.js';
export { AnimateIn, LoadingSpinner } from './components/primitives.js';
export { ShellAuthPage } from './components/shell-auth-page.js';
export type { DesktopShellAuthPageProps } from './components/desktop-shell-auth-page.js';
export { DesktopShellAuthPage } from './components/desktop-shell-auth-page.js';
