import type { NimiRealmOAuthProvider } from '@nimiplatform/sdk/realm';

export type ProfileOauthAvailability = {
  enabled: boolean;
  disabledReason: string;
};

const RUNTIME_OWNED_REASON = 'Account linking is managed by RuntimeAccountService';

export const profileOauthPlatform = {
  availability(_provider: NimiRealmOAuthProvider): ProfileOauthAvailability {
    return { enabled: false, disabledReason: RUNTIME_OWNED_REASON };
  },
  async linkProvider(_provider: NimiRealmOAuthProvider): Promise<void> {
    throw new Error(RUNTIME_OWNED_REASON);
  },
  async unlinkProvider(_provider: NimiRealmOAuthProvider): Promise<void> {
    throw new Error(RUNTIME_OWNED_REASON);
  },
};
