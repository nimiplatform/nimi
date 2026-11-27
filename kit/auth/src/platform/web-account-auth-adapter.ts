import type {
  NimiRealmOAuthLoginInput,
  NimiRealmOAuthLoginResult,
  RealmModel,
} from '@nimiplatform/kit/core/sdk-contract';

type OAuthLoginResultDto = NimiRealmOAuthLoginResult;
type CheckEmailResponseDto = RealmModel<'CheckEmailResponseDto'>;

// @nimi-authority: rule.nimi.sdks.realm-consumer.r046
export type WebAccountAuthAdapter = {
  checkEmail: (email: string) => Promise<CheckEmailResponseDto>;
  passwordLogin?: (identifier: string, password: string) => Promise<OAuthLoginResultDto>;
  requestEmailOtp: (email: string) => Promise<{ success: boolean; message?: string }>;
  verifyEmailOtp: (email: string, code: string) => Promise<OAuthLoginResultDto>;
  verifyTwoFactor: (tempToken: string, code: string) => Promise<void>;
  googleClientId?: string;
  oauthLogin: (input: NimiRealmOAuthLoginInput) => Promise<OAuthLoginResultDto>;
  beginSocialOAuth?: (provider: 'TIKTOK') => Promise<NimiRealmOAuthLoginInput | null>;
  updatePassword: (newPassword: string) => Promise<void>;
  loadCurrentUser: () => Promise<Record<string, unknown> | null>;
  completeBrowserSessionLogin: () => Promise<Record<string, unknown> | null>;
  syncAfterLogin?: () => Promise<void>;
  supportsPasswordLogin?: boolean;
};
