import { localRuntime } from '@runtime/local-runtime';
import type {
  LocalRuntimeAssetRecord,
  LocalRuntimeImportAssetPayload,
  LocalRuntimeImportFilePayload,
} from '@runtime/local-runtime';

export type LocalRuntimeLifecycleCaller = 'core' | 'builtin' | 'injected' | 'sideload' | string;

type LocalRuntimeWriteOptions = {
  caller?: LocalRuntimeLifecycleCaller;
};

export async function pickLocalRuntimeAssetManifestPath(): Promise<string | null> {
  return localRuntime.pickAssetManifestPath();
}

export async function pickLocalRuntimeAssetFile(): Promise<string | null> {
  return localRuntime.pickAssetFile();
}

export async function importLocalRuntimeAsset(
  payload: LocalRuntimeImportAssetPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  return localRuntime.importAsset(payload, options) as Promise<LocalRuntimeAssetRecord>;
}

export async function importLocalRuntimeAssetFile(
  payload: LocalRuntimeImportFilePayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  return localRuntime.importFile(payload, options) as Promise<LocalRuntimeAssetRecord>;
}

export async function removeLocalRuntimeAsset(
  localAssetId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  return localRuntime.remove(localAssetId, options) as Promise<LocalRuntimeAssetRecord>;
}

export async function startLocalRuntimeAsset(
  localAssetId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  return localRuntime.start(localAssetId, options) as Promise<LocalRuntimeAssetRecord>;
}

export async function stopLocalRuntimeAsset(
  localAssetId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  return localRuntime.stop(localAssetId, options) as Promise<LocalRuntimeAssetRecord>;
}
