import { hasTauriInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeChecked } from './invoke';

function parseOptionalPath(value: unknown): string | null {
  const path = typeof value === 'string' ? value.trim() : '';
  return path || null;
}

export async function pickLocalRuntimeAssetManifestPath(): Promise<string | null> {
  if (!hasTauriInvoke()) return null;
  return invokeChecked('runtime_local_pick_asset_manifest_path', {}, parseOptionalPath);
}

export async function pickLocalRuntimeAssetFile(): Promise<string | null> {
  if (!hasTauriInvoke()) return null;
  return invokeChecked('runtime_local_pick_asset_file', {}, parseOptionalPath);
}

export async function pickLocalRuntimeAssetDirectory(): Promise<string | null> {
  if (!hasTauriInvoke()) return null;
  return invokeChecked('runtime_local_pick_asset_directory', {}, parseOptionalPath);
}

export async function revealLocalRuntimeAssetInFolder(localAssetId: string): Promise<void> {
  await invokeChecked('runtime_local_assets_reveal_in_folder', {
    payload: { localAssetId },
  }, () => undefined);
}

export async function revealLocalRuntimeAssetsRootFolder(): Promise<void> {
  await invokeChecked('runtime_local_assets_reveal_root_folder', {}, () => undefined);
}
