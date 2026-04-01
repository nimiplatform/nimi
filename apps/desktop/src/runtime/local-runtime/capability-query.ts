import type { LocalRuntimeAssetRecord } from './types';
import { listLocalRuntimeAssets } from './commands';

export type LocalRuntimeCapability =
  | 'chat'
  | 'image'
  | 'video'
  | 'tts'
  | 'stt'
  | 'embedding';

function supportsCapability(asset: LocalRuntimeAssetRecord, capability: LocalRuntimeCapability): boolean {
  return Array.isArray(asset.capabilities) && asset.capabilities.some((item) => item === capability);
}

export async function queryLocalRuntimeAssetsByCapability(
  capability: LocalRuntimeCapability,
): Promise<LocalRuntimeAssetRecord[]> {
  const assets = await listLocalRuntimeAssets();
  return assets.filter((asset) => asset.status !== 'removed' && supportsCapability(asset, capability));
}
