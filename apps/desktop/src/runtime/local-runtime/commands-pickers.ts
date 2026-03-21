import { hasTauriInvoke, tauriInvoke } from '../llm-adapter/tauri-bridge';

export async function pickLocalRuntimeManifestPath(): Promise<string | null> {
  if (!hasTauriInvoke()) return null;
  const result = await tauriInvoke<string | null>('runtime_local_pick_manifest_path', {});
  return result || null;
}

export async function pickLocalRuntimeArtifactManifestPath(): Promise<string | null> {
  if (!hasTauriInvoke()) return null;
  const result = await tauriInvoke<string | null>('runtime_local_pick_artifact_manifest_path', {});
  return result || null;
}

export async function pickLocalRuntimeAssetManifestPath(): Promise<string | null> {
  if (!hasTauriInvoke()) return null;
  const result = await tauriInvoke<string | null>('runtime_local_pick_asset_manifest_path', {});
  return result || null;
}

export async function pickLocalRuntimeModelFile(): Promise<string | null> {
  if (!hasTauriInvoke()) return null;
  const result = await tauriInvoke<string | null>('runtime_local_pick_model_file', {});
  return result || null;
}
