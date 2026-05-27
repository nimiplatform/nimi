import type { AuthPlatformAdapter } from '@nimiplatform/kit/auth';
import {
  loadMomentRuntimeAccountUser,
} from '@renderer/infra/bootstrap/moment-runtime-account.js';
import { ensureMomentBootstrapReady } from '@renderer/infra/bootstrap/moment-bootstrap.js';
import { momentTauriOAuthBridge } from '@renderer/bridge';

const MOMENT_EMBEDDED_AUTH_UNSUPPORTED =
  'Embedded auth flow is not supported in Moment desktop-browser mode.';
const MOMENT_APP_LOCAL_TOKEN_UNSUPPORTED =
  'Moment auth must use Runtime account projection; app-local token application is not supported.';

function unsupported<T>(): Promise<T> {
  return Promise.reject(new Error(MOMENT_EMBEDDED_AUTH_UNSUPPORTED));
}

export async function loadMomentCurrentUser() {
  await ensureMomentBootstrapReady();
  return loadMomentRuntimeAccountUser();
}

export function createMomentDesktopBrowserAuthAdapter(): AuthPlatformAdapter {
  return {
    checkEmail: unsupported,
    passwordLogin: unsupported,
    requestEmailOtp: unsupported,
    verifyEmailOtp: unsupported,
    verifyTwoFactor: unsupported,
    walletChallenge: unsupported,
    walletLogin: unsupported,
    oauthLogin: unsupported,
    updatePassword: unsupported,
    loadCurrentUser: loadMomentCurrentUser,
    applyToken: async () => {
      throw new Error(MOMENT_APP_LOCAL_TOKEN_UNSUPPORTED);
    },
    persistSession: async () => {
      throw new Error(MOMENT_APP_LOCAL_TOKEN_UNSUPPORTED);
    },
    clearPersistedSession: async () => {},
    oauthBridge: momentTauriOAuthBridge,
    syncAfterLogin: async () => {},
  };
}
