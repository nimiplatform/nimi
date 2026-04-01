import { hasTauriInvoke, tauriInvoke } from '../llm-adapter/tauri-bridge';

export async function pickLocalRuntimeAssetManifestPath(): Promise<string | null> {
  if (!hasTauriInvoke()) return null;
  const result = await tauriInvoke<string | null>('runtime_local_pick_asset_manifest_path', {});
  return result || null;
}

export async function pickLocalRuntimeAssetFile(): Promise<string | null> {
  if (!hasTauriInvoke()) return null;
  const result = await tauriInvoke<string | null>('runtime_local_pick_asset_file', {});
  return result || null;
}
