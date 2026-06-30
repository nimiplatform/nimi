// kit/core/oauth — standard shell contract only (types, parsers, OAuth bridge)
//
// Auth domain helpers (flow orchestration, callback, login handler)
// live in kit/auth/src/logic/oauth-*.ts

export type {
  OauthTokenExchangePayload,
  OauthTokenExchangeResult,
  OauthListenForCodePayload,
  OauthListenForCodeResult,
  OpenExternalUrlResult,
  ShellOAuthCodeBridge,
  ShellOAuthBridge,
} from './oauth-types.js';
export {
  parseOauthTokenExchangeResult,
  parseOauthListenForCodeResult,
  parseOpenExternalUrlResult,
} from './oauth-types.js';
