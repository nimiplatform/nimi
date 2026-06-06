import type { JsonObject } from './internal/utils.js';
import type { RealmFetchImpl } from './realm/client-types.js';
import type {
  RuntimeAppSession,
  RuntimeClientDefaults,
  RuntimeOptions,
  RuntimeTransportConfig,
} from './runtime/index.js';

type PlatformSessionUser = JsonObject | null;

export type PlatformAuthSessionStore = {
  getAccessToken?: () => string | Promise<string>;
  getRefreshToken?: () => string | Promise<string>;
  getSubjectUserId?: () => string | Promise<string>;
  getCurrentUser?: () => PlatformSessionUser | Promise<PlatformSessionUser>;
  setAuthSession?: (
    user: PlatformSessionUser,
    accessToken: string,
    refreshToken?: string,
  ) => void | Promise<void>;
  clearAuthSession?: () => void | Promise<void>;
};

export type PlatformClientInput = {
  authMode?: 'local-first-party-runtime' | 'web-cloud' | 'external-principal';
  appId?: string;
  realmBaseUrl?: string;
  accessToken?: string;
  accessTokenProvider?: () => string | Promise<string>;
  refreshTokenProvider?: () => string | Promise<string>;
  subjectUserIdProvider?: () => string | Promise<string>;
  sessionStore?: PlatformAuthSessionStore | null;
  runtimeTransport?: RuntimeTransportConfig | null;
  runtimeAppSession?: RuntimeAppSession | null;
  runtimeDefaults?: RuntimeClientDefaults;
  runtimeOptions?: Omit<RuntimeOptions, 'appId' | 'transport' | 'auth' | 'subjectContext' | 'defaults'>;
  realmFetchImpl?: RealmFetchImpl;
  allowAnonymousRealm?: boolean;
  // K-AUTHSVC-014: when true, the local first-party caller registration declares
  // developer_registration so the runtime developer-registration gate (off by
  // default) may admit a not-yet-admitted local app for developer testing. The
  // runtime gate, not this flag, performs admission.
  developerRegistration?: boolean;
};
