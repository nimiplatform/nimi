export type {
  OauthTokenExchangePayload,
  OauthTokenExchangeResult,
  OauthListenForCodePayload,
  OauthListenForCodeResult,
  OpenExternalUrlResult,
  TauriOAuthBridge,
} from './oauth-types.js';
export {
  parseOauthTokenExchangeResult,
  parseOauthListenForCodeResult,
  parseOpenExternalUrlResult,
} from './oauth-types.js';

export type {
  SocialOauthProvider,
  SocialOauthConfig,
} from './social-oauth.js';
export {
  resolveSocialOauthConfig,
  startSocialOauth,
  toOauthProvider,
} from './social-oauth.js';

export {
  DESKTOP_CALLBACK_TIMEOUT_MS,
  DESKTOP_CALLBACK_PATH,
  readEnv,
  isLoopbackHost,
  normalizeLoopbackCallbackUrl,
  createDesktopCallbackState,
  validateDesktopCallbackState,
  createDesktopCallbackRedirectUri,
  toErrorMessage,
  localizeAuthError,
  toDesktopBrowserAuthErrorMessage,
  getUserDisplayLabel,
} from './oauth-helpers.js';

export type { OAuthLoginInput } from './oauth-login-handler.js';
export { handleSocialLogin } from './oauth-login-handler.js';
