import type { NimiClient } from '@nimiplatform/sdk';

const DEFAULT_APP_ID = 'nimi.desktop';

let platformClient: NimiClient | null = null;
let sdkModulePromise: Promise<typeof import('@nimiplatform/sdk')> | null = null;

async function loadSdkModule(): Promise<typeof import('@nimiplatform/sdk')> {
  if (!sdkModulePromise) {
    sdkModulePromise = import('@nimiplatform/sdk');
  }
  return sdkModulePromise;
}

export type PlatformClientRuntimeDefaults = {
  apiBaseUrl: string;
  accessToken?: string;
};

export async function initializePlatformClient(input: PlatformClientRuntimeDefaults): Promise<NimiClient> {
  const sdk = await loadSdkModule();
  const client = sdk.createNimiClient({
    appId: DEFAULT_APP_ID,
    realm: {
      baseUrl: String(input.apiBaseUrl || '').trim(),
      accessToken: String(input.accessToken || '').trim() || undefined,
    },
    runtime: {
      transport: {
        type: 'tauri-ipc',
        commandNamespace: 'runtime_bridge',
        eventNamespace: 'runtime_bridge',
      },
    },
  });
  platformClient = client;
  return client;
}

export function getPlatformClient(): NimiClient {
  if (!platformClient) {
    throw new Error('PLATFORM_CLIENT_NOT_READY');
  }
  return platformClient;
}
