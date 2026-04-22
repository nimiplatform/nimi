import { createDriver } from '../driver/factory.js';
import type { AgentDataDriver } from '../driver/types.js';
import defaultScenarioJson from '../mock/scenarios/default.mock.json?raw';
import { useAvatarStore } from './app-store.js';
import { isTauriRuntime, onShellReady } from './tauri-lifecycle.js';
import { setAlwaysOnTop } from './tauri-commands.js';

export type BootstrapHandle = {
  driver: AgentDataDriver;
  shutdown(): Promise<void>;
};

export async function bootstrapAvatar(): Promise<BootstrapHandle> {
  const store = useAvatarStore.getState();

  let shellUnlisten: (() => void) | null = null;
  if (isTauriRuntime()) {
    shellUnlisten = await onShellReady((payload) => {
      useAvatarStore.getState().markShellReady({ width: payload.width, height: payload.height });
    });
    await setAlwaysOnTop(store.shell.alwaysOnTop);
  } else {
    // Browser dev mode (pnpm dev:renderer without Tauri shell) — mark shell ready immediately with current window size
    useAvatarStore.getState().markShellReady({
      width: typeof window !== 'undefined' ? window.innerWidth : 400,
      height: typeof window !== 'undefined' ? window.innerHeight : 600,
    });
  }

  const driver = createDriver({
    scenarioJson: defaultScenarioJson,
    scenarioSource: 'default.mock.json',
  });

  const unsubscribeStatus = driver.onStatusChange((status) => {
    useAvatarStore.getState().setDriverStatus(status);
  });

  const unsubscribeBundle = driver.onBundleChange((bundle) => {
    useAvatarStore.getState().setBundle(bundle);
  });

  await driver.start();

  const scenarioId = 'default';
  useAvatarStore.getState().setScenario(scenarioId, true);

  return {
    driver,
    async shutdown() {
      unsubscribeStatus();
      unsubscribeBundle();
      shellUnlisten?.();
      await driver.stop();
    },
  };
}
