// kit/core/oauth — standard shell contract only (types, parsers, OAuth bridge)
//
// Auth domain helpers (flow orchestration, callback, login handler)
// live in kit/auth/src/logic/oauth-*.ts

export type {
  OauthListenForCodePayload,
  OauthListenForCodeResult,
  OpenExternalUrlResult,
  ShellOAuthCodeBridge,
} from './oauth-types.js';
export {
  parseOauthListenForCodeResult,
  parseOpenExternalUrlResult,
} from './oauth-types.js';
