import { emitRuntimeLog } from '../telemetry/logger';
import type {
  LocalRuntimeAssetFileImportResult,
  LocalRuntimeAssetHealth,
  LocalRuntimeAssetRecord,
  LocalRuntimeDownloadProgressEvent,
  LocalRuntimeDownloadSessionSummary,
  LocalRuntimeImportAssetFilePayload,
  LocalRuntimeImportAssetPayload,
  LocalRuntimeImportBundlePayload,
  LocalRuntimeImportFilePayload,
  LocalRuntimeImportManifestOptions,
  LocalRuntimeInstallPayload,
  LocalRuntimeInstallVerifiedAssetPayload,
  LocalRuntimeRescanBundlePayload,
  LocalRuntimeScaffoldOrphanPayload,
  LocalRuntimeUnregisteredAssetDescriptor,
  LocalRuntimeWriteOptions,
} from './types';
import {
  assertLifecycleWriteAllowed,
  parseAssetHealth,
  parseAssetRecord,
  parseDownloadProgressEvent,
  parseDownloadSessionSummary,
  parseUnregisteredAssetDescriptor,
} from './parsers';
import { invokeLocalRuntimeCommand } from './parsers';
import { asRecord, requireSdkLocal, toAssetKindFilter } from './commands-shared';

export async function importLocalRuntimeAssetFile(
  payload: LocalRuntimeImportFilePayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  assertLifecycleWriteAllowed('local_runtime_assets_import_file', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.importLocalAssetFile({
    filePath: String(payload.filePath || '').trim(),
    assetName: String(payload.assetName || '').trim(),
    kind: toAssetKindFilter(payload.kind),
    engine: String(payload.engine || '').trim(),
    capabilities: [],
    endpoint: String(payload.endpoint || '').trim(),
  });
  return parseAssetRecord(asRecord(response).asset);
}

export async function importLocalRuntimeAssetBundle(
  payload: LocalRuntimeImportBundlePayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  assertLifecycleWriteAllowed('local_runtime_assets_import_bundle', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_assets_import_bundle', {
    payload: {
      directoryPath: String(payload.directoryPath || '').trim(),
      modelName: String(payload.modelName || '').trim() || undefined,
      capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : [],
      engine: String(payload.engine || '').trim() || undefined,
      endpoint: String(payload.endpoint || '').trim() || undefined,
    },
  });
  return parseAssetRecord(result);
}

export async function installLocalRuntimeAsset(
  payload: LocalRuntimeInstallPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  assertLifecycleWriteAllowed('local_runtime_assets_install', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_assets_install', {
    payload: {
      modelId: String(payload.modelId || '').trim(),
      repo: String(payload.repo || '').trim(),
      revision: String(payload.revision || '').trim(),
      capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : [],
      engine: String(payload.engine || '').trim(),
      entry: String(payload.entry || '').trim(),
      files: Array.isArray(payload.files) ? payload.files : [],
      license: String(payload.license || '').trim(),
      hashes: payload.hashes || {},
      endpoint: String(payload.endpoint || '').trim(),
      engineConfig: payload.engineConfig,
    },
  });
  return parseAssetRecord(result);
}

export async function installLocalRuntimeVerifiedAsset(
  payload: LocalRuntimeInstallVerifiedAssetPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  assertLifecycleWriteAllowed('local_runtime_assets_install_verified', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.installVerifiedAsset({
    templateId: String(payload.templateId || '').trim(),
    endpoint: String(payload.endpoint || '').trim(),
  });
  return parseAssetRecord(asRecord(response).asset);
}

export async function listLocalRuntimeDownloadSessions(): Promise<LocalRuntimeDownloadSessionSummary[]> {
  const runtime = requireSdkLocal();
  const response = await runtime.listLocalTransfers({});
  const raw = asRecord(response);
  const items: unknown[] = Array.isArray(raw.transfers) ? raw.transfers : [];
  return items.map((item) => parseDownloadSessionSummary(item));
}

export async function pauseLocalRuntimeDownload(
  installSessionId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeDownloadSessionSummary> {
  assertLifecycleWriteAllowed('local_runtime_downloads_pause', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.pauseLocalTransfer({
    installSessionId: String(installSessionId || '').trim(),
  });
  return parseDownloadSessionSummary(asRecord(response).transfer);
}

export async function resumeLocalRuntimeDownload(
  installSessionId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeDownloadSessionSummary> {
  assertLifecycleWriteAllowed('local_runtime_downloads_resume', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.resumeLocalTransfer({
    installSessionId: String(installSessionId || '').trim(),
  });
  return parseDownloadSessionSummary(asRecord(response).transfer);
}

export async function cancelLocalRuntimeDownload(
  installSessionId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeDownloadSessionSummary> {
  assertLifecycleWriteAllowed('local_runtime_downloads_cancel', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.cancelLocalTransfer({
    installSessionId: String(installSessionId || '').trim(),
  });
  return parseDownloadSessionSummary(asRecord(response).transfer);
}

export async function importLocalRuntimeAsset(
  payload: LocalRuntimeImportAssetPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  assertLifecycleWriteAllowed('local_runtime_assets_import', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.importLocalAsset({
    manifestPath: String(payload.manifestPath || '').trim(),
    endpoint: String(payload.endpoint || '').trim(),
  });
  return parseAssetRecord(asRecord(response).asset);
}

export async function removeLocalRuntimeAsset(
  localAssetId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  assertLifecycleWriteAllowed('local_runtime_assets_remove', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.removeLocalAsset({
    localAssetId: String(localAssetId || '').trim(),
  });
  return parseAssetRecord(asRecord(response).asset);
}

export async function startLocalRuntimeAsset(
  localAssetId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  assertLifecycleWriteAllowed('local_runtime_assets_start', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.startLocalAsset({
    localAssetId: String(localAssetId || '').trim(),
  });
  return parseAssetRecord(asRecord(response).asset);
}

export async function stopLocalRuntimeAsset(
  localAssetId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  assertLifecycleWriteAllowed('local_runtime_assets_stop', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.stopLocalAsset({
    localAssetId: String(localAssetId || '').trim(),
  });
  return parseAssetRecord(asRecord(response).asset);
}

export async function healthLocalRuntimeAssets(localAssetId?: string): Promise<LocalRuntimeAssetHealth[]> {
  const runtime = requireSdkLocal();
  const response = await runtime.checkLocalAssetHealth({
    localAssetId: String(localAssetId || '').trim(),
  });
  const raw = asRecord(response);
  const assets = Array.isArray(raw.assets) ? raw.assets : [];
  return assets.map((item) => parseAssetHealth(item));
}

export async function revealLocalRuntimeAssetInFolder(localAssetId: string): Promise<void> {
  await invokeLocalRuntimeCommand<void>('runtime_local_assets_reveal_in_folder', {
    payload: { localAssetId },
  });
}

export async function revealLocalRuntimeAssetsRootFolder(): Promise<void> {
  await invokeLocalRuntimeCommand<void>('runtime_local_assets_reveal_root_folder');
}

export async function rescanLocalRuntimeAssetBundle(
  payload: LocalRuntimeRescanBundlePayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  assertLifecycleWriteAllowed('local_runtime_assets_rescan_bundle', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_assets_rescan_bundle', {
    payload: {
      localAssetId: String(payload.localAssetId || '').trim(),
    },
  });
  return parseAssetRecord(result);
}

export async function subscribeLocalRuntimeDownloadProgress(
  listener: (event: LocalRuntimeDownloadProgressEvent) => void,
): Promise<() => void> {
  const runtime = requireSdkLocal();
  const controller = new AbortController();
  const stream = await runtime.watchLocalTransfers({}, { signal: controller.signal });
  let disposed = false;
  void (async () => {
    try {
      for await (const item of stream) {
        if (disposed) {
          break;
        }
        listener(parseDownloadProgressEvent(item));
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      emitRuntimeLog({
        level: 'warn',
        area: 'local-ai',
        message: 'action:watchLocalTransfers:failed',
        details: { error: error instanceof Error ? error.message : String(error || '') },
      });
    }
  })();
  return () => {
    disposed = true;
    controller.abort();
  };
}

export async function scaffoldLocalRuntimeOrphanAsset(
  payload: LocalRuntimeScaffoldOrphanPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  assertLifecycleWriteAllowed('local_runtime_assets_scaffold_orphan', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_assets_scaffold_orphan', {
    payload: {
      path: String(payload.path || '').trim(),
      kind: String(payload.kind || '').trim(),
      capabilities: [],
      engine: String(payload.engine || '').trim() || undefined,
      endpoint: String(payload.endpoint || '').trim() || undefined,
    },
  });
  return parseAssetRecord(result);
}

export async function scanLocalRuntimeUnregisteredAssets(): Promise<LocalRuntimeUnregisteredAssetDescriptor[]> {
  const runtime = requireSdkLocal();
  const response = await runtime.scanUnregisteredAssets({});
  const raw = asRecord(response);
  const items: unknown[] = Array.isArray(raw.items) ? raw.items : [];
  return items.map((item) => parseUnregisteredAssetDescriptor(item));
}

export async function importLocalRuntimeAssetFileUnified(
  payload: LocalRuntimeImportAssetFilePayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetFileImportResult> {
  const declaration = payload.declaration;
  const asset = await importLocalRuntimeAssetFile({
    filePath: payload.filePath,
    assetName: payload.assetName,
    kind: declaration.assetKind,
    engine: declaration.engine,
    endpoint: payload.endpoint,
  }, options);
  return { asset };
}

export async function importLocalRuntimeAssetManifest(
  manifestPath: string,
  options?: LocalRuntimeImportManifestOptions,
): Promise<import('./types').LocalRuntimeAssetManifestImportResult> {
  const normalizedPath = String(manifestPath || '').trim();
  if (!normalizedPath) {
    throw new Error('manifestPath is required');
  }
  const asset = await importLocalRuntimeAsset({
    manifestPath: normalizedPath,
    endpoint: String(options?.endpoint || '').trim() || undefined,
  }, options);
  return { asset };
}
