import type { NimiRealmOAuthProvider } from '@nimiplatform/sdk/realm';

export type ProfileOauthAvailability = {
  enabled: boolean;
  /** i18n key for the user-facing disabled reason; render via t(). */
  disabledReason: string;
};

/**
 * Account linking is owned by RuntimeAccountService. Until it exposes linking,
 * this seam fails closed and surfaces an i18n key (not a raw string) so the
 * renderer can localize the reason and the failure feedback.
 */
export const PROFILE_OAUTH_UNAVAILABLE_REASON_KEY = 'Profile.oauthRuntimeManaged';

export const profileOauthPlatform = {
  availability(_provider: NimiRealmOAuthProvider): ProfileOauthAvailability {
    return { enabled: false, disabledReason: PROFILE_OAUTH_UNAVAILABLE_REASON_KEY };
  },
  async linkProvider(_provider: NimiRealmOAuthProvider): Promise<void> {
    throw new Error(PROFILE_OAUTH_UNAVAILABLE_REASON_KEY);
  },
  async unlinkProvider(_provider: NimiRealmOAuthProvider): Promise<void> {
    throw new Error(PROFILE_OAUTH_UNAVAILABLE_REASON_KEY);
  },
};
