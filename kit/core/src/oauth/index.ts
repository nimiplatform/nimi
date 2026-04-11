// kit/core/oauth — Shell contract only (types, parsers, TauriOAuthBridge)
//
// Auth domain helpers (flow orchestration, callback, login handler)
// live in kit/auth/src/logic/oauth-*.ts

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
