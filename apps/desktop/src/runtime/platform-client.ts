import type { Realm, Runtime } from '@nimiplatform/sdk';

const DEFAULT_APP_ID = 'nimi.desktop';

export type PlatformClient = {
  runtime: Runtime;
  realm: Realm;
};

let platformClient: PlatformClient | null = null;
let sdkModulePromise: Promise<typeof import('@nimiplatform/sdk')> | null = null;

async function loadSdkModule(): Promise<typeof import('@nimiplatform/sdk')> {
  if (!sdkModulePromise) {
    sdkModulePromise = import('@nimiplatform/sdk');
  }
  return sdkModulePromise;
}

export type PlatformClientRuntimeDefaults = {
  realmBaseUrl: string;
  accessToken?: string;
};

export async function initializePlatformClient(input: PlatformClientRuntimeDefaults): Promise<PlatformClient> {
  const sdk = await loadSdkModule();
  const runtime = new sdk.Runtime({
    appId: DEFAULT_APP_ID,
    transport: {
      type: 'tauri-ipc',
      commandNamespace: 'runtime_bridge',
      eventNamespace: 'runtime_bridge',
    },
  });
  const tokenValue = String(input.accessToken || '').trim();
  const realm = new sdk.Realm({
    baseUrl: String(input.realmBaseUrl || '').trim(),
    auth: {
      accessToken: tokenValue || sdk.Realm.NO_AUTH,
    },
  });
  const client: PlatformClient = {
    runtime,
    realm,
  };
  platformClient = client;
  return client;
}

export function getPlatformClient(): PlatformClient {
  if (!platformClient) {
    throw new Error('PLATFORM_CLIENT_NOT_READY');
  }
  return platformClient;
}
