import {
  createNimiClient,
  type NimiLocalAppClient,
} from '@nimiplatform/sdk';
import {
  createNimiLocalAppStandardShellSurface,
} from '@nimiplatform/kit/shell/renderer/bridge';

let localAppClient: NimiLocalAppClient | null = null;

export function getNimiLocalAppClient(): NimiLocalAppClient {
  localAppClient ??= createNimiClient({
    localApp: {
      standardShell: createNimiLocalAppStandardShellSurface(),
    },
  });
  return localAppClient;
}
