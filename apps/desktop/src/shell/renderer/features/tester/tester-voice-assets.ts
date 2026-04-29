import { getPlatformClient } from '@nimiplatform/sdk';
import { createModRuntimeClient } from '@nimiplatform/sdk/mod';
import { asString } from './tester-utils.js';

const TESTER_RUNTIME_APP_ID = 'nimi.desktop';
const TESTER_ACCOUNT_CALLER = {
  appId: TESTER_RUNTIME_APP_ID,
  appInstanceId: 'nimi.desktop.local-first-party',
  deviceId: 'desktop-shell',
  mode: 2,
  scopes: [],
};

type ModRuntimeClient = ReturnType<typeof createModRuntimeClient>;
type ListVoiceAssetsRequest = Parameters<ModRuntimeClient['voice']['listAssets']>[0];
type ListVoiceAssetsResponse = Awaited<ReturnType<ModRuntimeClient['voice']['listAssets']>>;

export type TesterVoiceAsset = ListVoiceAssetsResponse['assets'][number];

export async function resolveTesterVoiceAssetScope(): Promise<{ appId: string; subjectUserId: string }> {
  const status = await getPlatformClient().runtime.account.getAccountSessionStatus({
    caller: TESTER_ACCOUNT_CALLER,
  });
  return {
    appId: TESTER_RUNTIME_APP_ID,
    subjectUserId: asString(status.accountProjection?.accountId),
  };
}

export async function listTesterVoiceAssets(
  client: ModRuntimeClient,
  request: Omit<ListVoiceAssetsRequest, 'appId' | 'subjectUserId'>,
): Promise<ListVoiceAssetsResponse> {
  const scope = await resolveTesterVoiceAssetScope();
  if (!scope.subjectUserId) {
    return { assets: [], nextPageToken: '' };
  }
  return client.voice.listAssets({
    ...request,
    appId: scope.appId,
    subjectUserId: scope.subjectUserId,
  });
}
