import type { TauriOAuthBridge } from '@nimiplatform/shell-core/oauth';
import type { RealmModel } from '@nimiplatform/sdk/realm';

type AuthTokensDto = RealmModel<'AuthTokensDto'>;
type OAuthLoginResultDto = RealmModel<'OAuthLoginResultDto'>;
type CheckEmailResponseDto = RealmModel<'CheckEmailResponseDto'>;

// ---------------------------------------------------------------------------
// AuthPlatformAdapter — injection point for all platform-specific operations
// ---------------------------------------------------------------------------

export type AuthPlatformAdapter = {
  // API calls
  checkEmail: (email: string) => Promise<CheckEmailResponseDto>;
  passwordLogin?: (identifier: string, password: string) => Promise<OAuthLoginResultDto>;
  requestEmailOtp: (email: string) => Promise<{ success: boolean; message?: string }>;
  verifyEmailOtp: (email: string, code: string) => Promise<OAuthLoginResultDto>;
  verifyTwoFactor: (tempToken: string, code: string) => Promise<AuthTokensDto>;
  walletChallenge: (input: WalletChallengeInput) => Promise<WalletChallengeResult>;
  walletLogin: (input: WalletLoginInput) => Promise<OAuthLoginResultDto>;
  oauthLogin: (provider: string, accessToken: string) => Promise<OAuthLoginResultDto>;
  updatePassword: (newPassword: string) => Promise<void>;
  loadCurrentUser: () => Promise<Record<string, unknown> | null>;

  // Capability flags
  supportsPasswordLogin?: boolean;

  // Token management
  applyToken: (accessToken: string, refreshToken?: string) => Promise<void>;

  // OAuth bridge (reuses shell-core TauriOAuthBridge)
  oauthBridge: TauriOAuthBridge;

  // Data sync side effects (Desktop: loadChats/loadContacts; Relay: no-op)
  syncAfterLogin?: () => Promise<void>;

  // Login complete callback
  onLoginComplete?: () => Promise<void>;
};

// ---------------------------------------------------------------------------
// Helper types for wallet operations
// ---------------------------------------------------------------------------

export type WalletChallengeInput = {
  walletAddress: string;
  chainId: number | undefined;
  walletType: string;
};

export type WalletChallengeResult = {
  message: string;
  nonce: string;
};

export type WalletLoginInput = {
  walletAddress: string;
  chainId: number | undefined;
  nonce: string;
  message: string;
  signature: string;
  walletType: string;
};
