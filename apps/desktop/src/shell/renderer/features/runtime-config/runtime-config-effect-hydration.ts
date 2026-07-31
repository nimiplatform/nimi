import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import { useTranslation } from 'react-i18next';
import {
  readStorageTextFrom,
  resolveBrowserStorage,
} from '@nimiplatform/kit/core/storage-json';
import { createRendererFlowId, logRendererEvent } from '@nimiplatform/kit/telemetry';
import {
  RUNTIME_CONFIG_STORAGE_KEY_V11,
  RUNTIME_CONFIG_STORAGE_KEY_V12,
} from './runtime-config-storage-defaults';
import { loadRuntimeConfigStateV11 } from './runtime-config-storage-persist';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';

type HydrationEffectInput = {
  bootstrapReady: boolean;
  hydrated: boolean;
  setHydrated: (next: boolean) => void;
  setState: Dispatch<SetStateAction<RuntimeConfigStateV11 | null>>;
  setStatusBanner: (banner: InlineFeedbackState | null) => void;
};

export function useRuntimeConfigHydrationEffect(input: HydrationEffectInput) {
  const { t } = useTranslation();
  const resetLoggedRef = useRef(false);
  useEffect(() => {
    if (!input.bootstrapReady || input.hydrated) return;

    const storage = resolveBrowserStorage('local');
    const hadStoredState = readStorageTextFrom(storage, RUNTIME_CONFIG_STORAGE_KEY_V12).state === 'ready'
      || readStorageTextFrom(storage, RUNTIME_CONFIG_STORAGE_KEY_V11).state === 'ready';

    const loaded = loadRuntimeConfigStateV11();

    // Connectors are no longer stored in localStorage — they come from runtime bridge
    // config (config.json) exclusively. Hydration only restores UI preferences.
    input.setState(loaded);
    input.setHydrated(true);

    const shouldEmitResetLog = !resetLoggedRef.current;
    if (shouldEmitResetLog) {
      const flowId = createRendererFlowId('runtime-config');
      logRendererEvent({
        area: 'renderer-bootstrap',
        message: 'runtime-config:v12-storage-initialized',
        flowId,
        details: {
          storageKey: RUNTIME_CONFIG_STORAGE_KEY_V12,
          hadStoredState,
        },
      });
      resetLoggedRef.current = true;
    }

    if (!hadStoredState && shouldEmitResetLog) {
      input.setStatusBanner({
        kind: 'info',
        message: t('RuntimeConfig.structureUpgraded', {
          defaultValue: 'Configuration structure upgraded. Please re-confirm model bindings.',
        }),
      });
    }
  }, [
    input.bootstrapReady,
    input.hydrated,
    input.setHydrated,
    input.setState,
    input.setStatusBanner,
    t,
  ]);
}
