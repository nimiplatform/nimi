import { tauriInvoke } from './tauri-helpers';

export {
  pickLocalRuntimeAssetDirectory,
  pickLocalRuntimeAssetFile,
  pickLocalRuntimeAssetManifestPath,
} from './commands-pickers';
export * from '@nimiplatform/sdk/runtime';

export async function revealLocalRuntimeAssetInFolder(localAssetId: string): Promise<void> {
  await tauriInvoke<void>('runtime_local_assets_reveal_in_folder', {
    payload: { localAssetId },
  });
}

export async function revealLocalRuntimeAssetsRootFolder(): Promise<void> {
  await tauriInvoke<void>('runtime_local_assets_reveal_root_folder', {});
}
