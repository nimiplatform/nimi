import {
  createNimiAppRuntimePlatformClient,
  type NimiAppRuntimePlatformClient,
} from '@nimiplatform/sdk/app';
import {
  createNimiLocalAppStandardShellSurface,
} from '@nimiplatform/kit/shell/renderer/bridge';

let localAppClient: NimiAppRuntimePlatformClient | null = null;

export function getNimiAppRuntimePlatformClient(): NimiAppRuntimePlatformClient {
  localAppClient ??= createNimiAppRuntimePlatformClient({
    standardShell: createNimiLocalAppStandardShellSurface(),
  });
  return localAppClient;
}
