import { getRuntimeDefaults } from '@renderer/bridge/runtime-defaults.js';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import { initializePlatformClient } from '@runtime/platform-client.js';
import { initI18n } from '@renderer/i18n/index.js';
import { bootstrapAuthSession } from './drift-bootstrap-auth.js';

export async function runDriftBootstrap(): Promise<void> {
  const store = useAppStore.getState();

  try {
    // Step 1: i18n
    await initI18n();

    // Step 2: Runtime Defaults
    const runtimeDefaults = await getRuntimeDefaults();
    store.setRuntimeDefaults(runtimeDefaults);

    // Step 3: Platform Client
    const { realm } = await initializePlatformClient({
      realmBaseUrl: runtimeDefaults.realm.realmBaseUrl,
      accessToken: runtimeDefaults.realm.accessToken,
      accessTokenProvider: () => useAppStore.getState().auth.token,
      subjectUserIdProvider: () => useAppStore.getState().auth.user?.id ?? '',
    });

    // Step 4: Auth Session
    await bootstrapAuthSession({
      realm,
      accessToken: runtimeDefaults.realm.accessToken,
    });

    // Step 5: Ready
    store.setBootstrapReady(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.setBootstrapError(message);
  }
}
