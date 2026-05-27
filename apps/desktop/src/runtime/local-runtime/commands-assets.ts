import {
  localRuntimeCapabilitiesForAssetKind,
  toLocalRuntimeEngineRuntimeModeRequestValue,
  toProtoStruct,
} from '@nimiplatform/sdk/runtime';
import { tauriInvoke } from '../llm-adapter/tauri-bridge';
import { emitRuntimeLog } from '../telemetry/logger';
import type {
  LocalRuntimeAssetFileImportResult,
  LocalRuntimeAssetHealth,
  LocalRuntimeAssetRecord,
  LocalRuntimeDownloadProgressEvent,
  LocalRuntimeDownloadSessionSummary,
  LocalRuntimeTransferAccepted,
  LocalRuntimeEnvironmentActivationGate,
  LocalRuntimeEnvironmentActivationGatePayload,
  LocalRuntimeEnvironmentDependencyJobCancelPayload,
  LocalRuntimeEnvironmentDependencyJob,
  LocalRuntimeEnvironmentDependencyJobsPayload,
  LocalRuntimeEnvironmentDependencyJobRetryPayload,
  LocalRuntimeEnvironmentDependencyJobStartPayload,
  LocalRuntimeEnvironmentDependencyRepairPayload,
  LocalRuntimeEnvironmentPlan,
  LocalRuntimeEnvironmentPlanPayload,
  LocalRuntimeEnvironmentSelectedSourceRecord,
  LocalRuntimeEnvironmentSelectedSourcesPayload,
  LocalRuntimeImportAssetFilePayload,
  LocalRuntimeImportAssetPayload,
  LocalRuntimeImportBundlePayload,
  LocalRuntimeImportFilePayload,
  LocalRuntimeImportManifestOptions,
  LocalRuntimeInstallPlanDescriptor,
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
  parseTransferAccepted,
  parseLocalRuntimeEnvironmentActivationGate,
  parseLocalRuntimeEnvironmentDependencyJob,
  parseLocalRuntimeEnvironmentPlan,
  parseLocalRuntimeEnvironmentSelectedSourceRecord,
  parseUnregisteredAssetDescriptor,
} from './parsers';
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
    capabilities: localRuntimeCapabilitiesForAssetKind(payload.kind),
    engine: String(payload.engine || '').trim(),
    endpoint: String(payload.endpoint || '').trim(),
  });
  return parseAssetRecord(asRecord(response).asset);
}

export async function importLocalRuntimeAssetBundle(
  payload: LocalRuntimeImportBundlePayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeTransferAccepted> {
  assertLifecycleWriteAllowed('local_runtime_assets_import_bundle', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.importLocalAssetBundle({
    directoryPath: String(payload.directoryPath || '').trim(),
    modelName: String(payload.modelName || '').trim(),
    capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : [],
    engine: String(payload.engine || '').trim(),
    endpoint: String(payload.endpoint || '').trim(),
  });
  return parseTransferAccepted(asRecord(response).transfer);
}

export async function installLocalRuntimeAsset(
  plan: LocalRuntimeInstallPlanDescriptor,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  assertLifecycleWriteAllowed('local_runtime_assets_install', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.installModelFromPlan({
    plan: {
      planId: String(plan.planId || '').trim(),
      itemId: String(plan.itemId || '').trim(),
      source: String(plan.source || '').trim(),
      templateId: String(plan.templateId || '').trim(),
      modelId: String(plan.modelId || '').trim(),
      repo: String(plan.repo || '').trim(),
      revision: String(plan.revision || '').trim(),
      capabilities: Array.isArray(plan.capabilities) ? plan.capabilities : [],
      engine: String(plan.engine || '').trim(),
      engineRuntimeMode: toLocalRuntimeEngineRuntimeModeRequestValue(plan.engineRuntimeMode),
      installKind: String(plan.installKind || '').trim(),
      installAvailable: Boolean(plan.installAvailable),
      endpoint: String(plan.endpoint || '').trim(),
      entry: String(plan.entry || '').trim(),
      files: Array.isArray(plan.files) ? plan.files : [],
      license: String(plan.license || '').trim(),
      hashes: plan.hashes || {},
      warnings: Array.isArray(plan.warnings) ? plan.warnings : [],
      reasonCode: String(plan.reasonCode || '').trim(),
      engineConfig: toProtoStruct(plan.engineConfig),
    },
  });
  return parseAssetRecord(asRecord(response).asset);
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

export async function resolveLocalRuntimeEnvironmentPlan(
  payload: LocalRuntimeEnvironmentPlanPayload,
): Promise<LocalRuntimeEnvironmentPlan> {
  const runtime = requireSdkLocal();
  const response = await runtime.resolveLocalEnvironmentPlan({
    packId: String(payload.packId || '').trim(),
    consumerScope: String(payload.consumerScope || '').trim(),
    runtimeDataRoot: String(payload.runtimeDataRoot || '').trim(),
    assetId: String(payload.assetId || '').trim(),
    localAssetId: String(payload.localAssetId || '').trim(),
    companionAssetId: String(payload.companionAssetId || '').trim(),
    parentAssetId: String(payload.parentAssetId || '').trim(),
    installLevel: String(payload.installLevel || '').trim(),
  });
  return parseLocalRuntimeEnvironmentPlan(asRecord(response).plan);
}

export async function listLocalRuntimeEnvironmentSelectedSources(
  payload?: LocalRuntimeEnvironmentSelectedSourcesPayload,
): Promise<LocalRuntimeEnvironmentSelectedSourceRecord[]> {
  const runtime = requireSdkLocal();
  const response = await runtime.listLocalEnvironmentSelectedSources({
    dependencyFamily: String(payload?.dependencyFamily || '').trim(),
    consumerScope: String(payload?.consumerScope || '').trim(),
  });
  const sources = asRecord(response).sources;
  return Array.isArray(sources)
    ? sources.map((item) => parseLocalRuntimeEnvironmentSelectedSourceRecord(item))
    : [];
}

export async function listLocalRuntimeEnvironmentDependencyJobs(
  payload?: LocalRuntimeEnvironmentDependencyJobsPayload,
): Promise<LocalRuntimeEnvironmentDependencyJob[]> {
  const runtime = requireSdkLocal();
  const response = await runtime.listLocalEnvironmentDependencyJobs({
    environmentKey: String(payload?.environmentKey || '').trim(),
    state: String(payload?.state || '').trim(),
  });
  const jobs = asRecord(response).jobs;
  return Array.isArray(jobs)
    ? jobs.map((item) => parseLocalRuntimeEnvironmentDependencyJob(item))
    : [];
}

export async function resolveLocalRuntimeEnvironmentActivationGate(
  payload: LocalRuntimeEnvironmentActivationGatePayload,
): Promise<LocalRuntimeEnvironmentActivationGate> {
  const runtime = requireSdkLocal();
  const response = await runtime.resolveLocalEnvironmentActivationGate({
    consumerId: String(payload.consumerId || '').trim(),
    packId: String(payload.packId || '').trim(),
    runtimeDataRoot: String(payload.runtimeDataRoot || '').trim(),
    assetId: String(payload.assetId || '').trim(),
    localAssetId: String(payload.localAssetId || '').trim(),
    companionAssetId: String(payload.companionAssetId || '').trim(),
    parentAssetId: String(payload.parentAssetId || '').trim(),
  });
  return parseLocalRuntimeEnvironmentActivationGate(asRecord(response).gate);
}

export async function startLocalRuntimeEnvironmentDependencyJob(
  payload: LocalRuntimeEnvironmentDependencyJobStartPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeEnvironmentDependencyJob> {
  assertLifecycleWriteAllowed('local_runtime_environment_dependency_job_start', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.startLocalEnvironmentDependencyJob({
    environmentKey: String(payload.environmentKey || '').trim(),
    dependencyFamily: String(payload.dependencyFamily || '').trim(),
    dependencyId: String(payload.dependencyId || '').trim(),
    sourceKind: String(payload.sourceKind || '').trim(),
    confirmed: Boolean(payload.confirmed),
  });
  return parseLocalRuntimeEnvironmentDependencyJob(asRecord(response).job);
}

export async function cancelLocalRuntimeEnvironmentDependencyJob(
  payload: LocalRuntimeEnvironmentDependencyJobCancelPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeEnvironmentDependencyJob> {
  assertLifecycleWriteAllowed('local_runtime_environment_dependency_job_cancel', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.cancelLocalEnvironmentDependencyJob({
    jobId: String(payload.jobId || '').trim(),
  });
  return parseLocalRuntimeEnvironmentDependencyJob(asRecord(response).job);
}

export async function retryLocalRuntimeEnvironmentDependencyJob(
  payload: LocalRuntimeEnvironmentDependencyJobRetryPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeEnvironmentDependencyJob> {
  assertLifecycleWriteAllowed('local_runtime_environment_dependency_job_retry', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.retryLocalEnvironmentDependencyJob({
    jobId: String(payload.jobId || '').trim(),
    confirmed: Boolean(payload.confirmed),
  });
  return parseLocalRuntimeEnvironmentDependencyJob(asRecord(response).job);
}

export async function repairLocalRuntimeEnvironmentDependency(
  payload: LocalRuntimeEnvironmentDependencyRepairPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeEnvironmentDependencyJob> {
  assertLifecycleWriteAllowed('local_runtime_environment_dependency_repair', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.repairLocalEnvironmentDependency({
    environmentKey: String(payload.environmentKey || '').trim(),
    dependencyFamily: String(payload.dependencyFamily || '').trim(),
    dependencyId: String(payload.dependencyId || '').trim(),
    confirmed: Boolean(payload.confirmed),
    reasonCode: String(payload.reasonCode || '').trim(),
  });
  return parseLocalRuntimeEnvironmentDependencyJob(asRecord(response).job);
}

export async function revealLocalRuntimeAssetInFolder(localAssetId: string): Promise<void> {
  await tauriInvoke<void>('runtime_local_assets_reveal_in_folder', {
    payload: { localAssetId },
  });
}

export async function revealLocalRuntimeAssetsRootFolder(): Promise<void> {
  await tauriInvoke<void>('runtime_local_assets_reveal_root_folder', {});
}

export async function rescanLocalRuntimeAssetBundle(
  payload: LocalRuntimeRescanBundlePayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeTransferAccepted> {
  assertLifecycleWriteAllowed('local_runtime_assets_rescan_bundle', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.rescanLocalAssetBundle({
    localAssetId: String(payload.localAssetId || '').trim(),
  });
  return parseTransferAccepted(asRecord(response).transfer);
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
  const runtime = requireSdkLocal();
  const response = await runtime.scaffoldOrphanAsset({
    path: String(payload.path || '').trim(),
    kind: toAssetKindFilter(payload.kind),
    capabilities: [],
    engine: String(payload.engine || '').trim(),
    endpoint: String(payload.endpoint || '').trim(),
  });
  return parseAssetRecord(asRecord(response).asset);
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
