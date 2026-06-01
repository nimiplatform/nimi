import { getPlatformClient } from '@nimiplatform/sdk';
import {
  bindLocalRuntimeClientWarningListener,
  bindLocalRuntimeServiceClientProvider,
  localRuntime as sdkLocalRuntime,
  type LocalRuntimeFacade as SdkLocalRuntimeFacade,
} from '@nimiplatform/sdk/runtime';
import { emitRuntimeLog } from '@nimiplatform/kit/telemetry';
import {
  pickLocalRuntimeAssetDirectory,
  pickLocalRuntimeAssetFile,
  pickLocalRuntimeAssetManifestPath,
} from './commands-pickers';

export type * from '@nimiplatform/sdk/runtime';
export { listLocalRuntimeAssets } from '@nimiplatform/sdk/runtime';

bindLocalRuntimeServiceClientProvider(() => {
  try {
    return getPlatformClient().runtime.local;
  } catch {
    return null;
  }
});

bindLocalRuntimeClientWarningListener((warning) => {
  emitRuntimeLog(warning);
});

export type LocalRuntimeFacade = SdkLocalRuntimeFacade & {
  pickAssetFile: () => Promise<string | null>;
  pickAssetDirectory: () => Promise<string | null>;
  pickAssetManifestPath: () => Promise<string | null>;
};

export const localRuntime: LocalRuntimeFacade = {
  ...sdkLocalRuntime,
  pickAssetFile: pickLocalRuntimeAssetFile,
  pickAssetDirectory: pickLocalRuntimeAssetDirectory,
  pickAssetManifestPath: pickLocalRuntimeAssetManifestPath,
};
