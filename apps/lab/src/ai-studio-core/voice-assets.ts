import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';

type ListedVoice = Awaited<ReturnType<NimiLocalAppClient['ai']['voiceAssets']['list']>>['assets'][number];

export async function listLabVoiceAssets(client: Pick<NimiLocalAppClient['ai']['voiceAssets'], 'list'>) {
  const assets: Pick<ListedVoice, 'voiceAssetId' | 'creationSource' | 'status'>[] = [];
  const cursors = new Set<string>();
  let pageToken = '';
  do {
    if (cursors.has(pageToken)) throw new Error('VOICE_ASSET_CATALOG_CURSOR_REPEATED');
    cursors.add(pageToken);
    const page = await client.list({ pageSize: 100, pageToken });
    assets.push(...page.assets.map(({ voiceAssetId, creationSource, status }) => ({ voiceAssetId, creationSource, status })));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return assets;
}
