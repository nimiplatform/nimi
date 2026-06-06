import {
  type ApplyProfileRequest,
  type LocalDeviceProfile as GeneratedLocalDeviceProfile,
  type LocalRecommendationFeedDescriptor as GeneratedLocalRecommendationFeedDescriptor,
  type ResolveProfileRequest,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import { createNimiError, ReasonCode } from '../types';
import { toNimiRuntimeProtoStruct } from './runtime-agent-values';
import {
  nimiRuntimeLocalCapabilitiesForAssetKind,
  toNimiRuntimeLocalAssetKindRequestValue,
  toNimiRuntimeLocalAssetStatusRequestValue,
} from './local-asset-vocabulary';
import {
  projectNimiRuntimeLocalRecommendationFeed,
  toNimiRuntimeLocalRecommendationFeedCapabilityRequestValue,
} from './runtime-local-recommendation';
import type { NimiRuntimeLocalProfileEntryOverride } from './runtime-local-profile-manifest';
import {
  projectNimiRuntimeLocalAssetHealth,
  projectNimiRuntimeLocalAssetRecord,
  projectNimiRuntimeLocalCatalogItemDescriptor,
  projectNimiRuntimeLocalCatalogVariantDescriptor,
  projectNimiRuntimeLocalDeviceProfile,
  projectNimiRuntimeLocalEnvironmentDependencyJob,
  projectNimiRuntimeLocalEnvironmentPlan,
  projectNimiRuntimeLocalInstallPlanDescriptor,
  projectNimiRuntimeLocalProfileApplyResult,
  projectNimiRuntimeLocalProfileResolutionPlan,
  projectNimiRuntimeLocalTransferAccepted,
  projectNimiRuntimeLocalTransferProgressEvent,
  projectNimiRuntimeLocalTransferSessionSummary,
  projectNimiRuntimeLocalUnregisteredAssetDescriptor,
  projectNimiRuntimeLocalVerifiedAssetDescriptor,
} from './runtime-local-model-center-projections';
import {
  toGeneratedNimiRuntimeLocalDeviceProfile,
  toGeneratedNimiRuntimeLocalInstallPlan,
  toGeneratedNimiRuntimeLocalProfileDescriptor,
  toGeneratedNimiRuntimeLocalProfileEntryOverride,
  toGeneratedNimiRuntimeLocalProfileResolutionPlan,
} from './runtime-local-model-center-requests';
import type {
  NimiRuntimeLocalAssetRecord,
  NimiRuntimeLocalCatalogSearchInput,
  NimiRuntimeLocalModelCenterClient,
  NimiRuntimeLocalModelCenterClientOptions,
  NimiRuntimeLocalSnapshot,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeLocalWriteOptions,
} from './runtime-local-model-center-types';
import {
  assertNimiRuntimeLocalWriteAllowed,
  dedupeBy,
  normalizeMaxPages,
  normalizePageSize,
  normalizeText,
  projectRequiredLocal,
  requireLocalText,
  stringRecord,
  textList,
  toCanonicalNimiRuntimeLocalAssetLookupKey,
} from './runtime-local-model-center-values';

export {
  assertNimiRuntimeLocalWriteAllowed,
  toCanonicalNimiRuntimeLocalAssetId,
  toCanonicalNimiRuntimeLocalAssetLookupKey,
} from './runtime-local-model-center-values';
export {
  buildNimiRuntimeLocalImageNativeEnvironmentPlanInput,
  isNimiRuntimeLocalEnvironmentDependencyJobActiveState,
  isNimiRuntimeLocalEnvironmentDependencyJobCancelledState,
  isNimiRuntimeLocalEnvironmentDependencyJobFailedState,
  isNimiRuntimeLocalEnvironmentDependencyJobRetryableState,
  isNimiRuntimeLocalEnvironmentDependencyJobTransferringState,
  isNimiRuntimeLocalEnvironmentDependencyNeedsConfirmationState,
  isNimiRuntimeLocalEnvironmentDependencyReadyState,
  isNimiRuntimeLocalEnvironmentDependencyRepairRequiredState,
  isNimiRuntimeLocalEnvironmentDependencyStartableState,
  isNimiRuntimeLocalEnvironmentDependencyUnsupportedState,
  projectNimiRuntimeLocalAssetHealth,
  projectNimiRuntimeLocalAssetRecord,
  projectNimiRuntimeLocalCatalogItemDescriptor,
  projectNimiRuntimeLocalCatalogVariantDescriptor,
  projectNimiRuntimeLocalDeviceProfile,
  projectNimiRuntimeLocalEnvironmentDependencyJob,
  projectNimiRuntimeLocalEnvironmentPlan,
  projectNimiRuntimeLocalEnvironmentPlanDependency,
  projectNimiRuntimeLocalImageNativeConsumerScope,
  projectNimiRuntimeLocalInstallPlanDescriptor,
  projectNimiRuntimeLocalProfileApplyResult,
  projectNimiRuntimeLocalProfileResolutionPlan,
  projectNimiRuntimeLocalTransferProgressEvent,
  projectNimiRuntimeLocalTransferSessionSummary,
  projectNimiRuntimeLocalUnregisteredAssetDescriptor,
  projectNimiRuntimeLocalVerifiedAssetDescriptor,
  resolveNimiRuntimeLocalImageNativeEnvironmentPlan,
} from './runtime-local-model-center-projections';
export * from './runtime-local-model-center-types';

export function createNimiRuntimeLocalModelCenterClient(
  options: NimiRuntimeLocalModelCenterClientOptions,
): NimiRuntimeLocalModelCenterClient {
  const resolveLocal = () => (typeof options.local === 'function' ? options.local() : options.local);
  const defaultCallOptions = options.callOptions;
  const callOptions = (writeOptions?: NimiRuntimeLocalWriteOptions): RuntimeTypedCallOptions | undefined => (
    writeOptions?.callOptions ?? defaultCallOptions
  );
  return {
    async listAssets(input = {}) {
      const local = resolveLocal();
      const assets: NimiRuntimeLocalAssetRecord[] = [];
      let pageToken = '';
      const pageSize = normalizePageSize(input.pageSize);
      const maxPages = normalizeMaxPages(input.maxPages);
      for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
        const response = await local.listLocalAssets({
          statusFilter: toNimiRuntimeLocalAssetStatusRequestValue(input.status),
          kindFilter: toNimiRuntimeLocalAssetKindRequestValue(input.kind),
          engineFilter: normalizeText(input.engine),
          pageSize,
          pageToken,
        }, defaultCallOptions);
        assets.push(...response.assets.map(projectNimiRuntimeLocalAssetRecord));
        pageToken = normalizeText(response.nextPageToken);
        if (!pageToken) {
          break;
        }
      }
      return dedupeBy(assets, (asset) => toCanonicalNimiRuntimeLocalAssetLookupKey(asset.assetId || asset.localAssetId));
    },
    async listVerifiedAssets(input = {}) {
      const local = resolveLocal();
      const assets: NimiRuntimeLocalVerifiedAssetDescriptor[] = [];
      let pageToken = '';
      const pageSize = normalizePageSize(input.pageSize);
      const maxPages = normalizeMaxPages(input.maxPages);
      for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
        const response = await local.listVerifiedAssets({
          kindFilter: toNimiRuntimeLocalAssetKindRequestValue(input.kind),
          engineFilter: normalizeText(input.engine),
          pageSize,
          pageToken,
        }, defaultCallOptions);
        assets.push(...response.assets.map(projectNimiRuntimeLocalVerifiedAssetDescriptor));
        pageToken = normalizeText(response.nextPageToken);
        if (!pageToken) {
          break;
        }
      }
      return dedupeBy(assets, (asset) => asset.templateId || asset.assetId);
    },
    async snapshot(input = {}) {
      const assets = await this.listAssets(input);
      const health = await this.health();
      return { assets, health, generatedAt: new Date().toISOString() };
    },
    async searchCatalog(input = {}) {
      const response = await resolveLocal().searchCatalogModels({
        query: normalizeText(input.query),
        capability: normalizeText(input.capability),
        categoryFilter: '',
        engineFilter: '',
        pageSize: normalizePageSize(input.limit ?? 50),
        pageToken: '',
      }, defaultCallOptions);
      return response.items.map(projectNimiRuntimeLocalCatalogItemDescriptor);
    },
    async listCatalogVariants(repo) {
      const response = await resolveLocal().listCatalogVariants({
        repo: requireLocalText(repo, 'Runtime local catalog repo is required', 'provide_local_catalog_repo'),
      }, defaultCallOptions);
      return response.variants.map(projectNimiRuntimeLocalCatalogVariantDescriptor);
    },
    async resolveInstallPlan(input) {
      const response = await resolveLocal().resolveModelInstallPlan({
        itemId: normalizeText(input.itemId),
        source: normalizeText(input.source),
        templateId: normalizeText(input.templateId),
        modelId: normalizeText(input.modelId),
        repo: normalizeText(input.repo),
        revision: normalizeText(input.revision),
        capabilities: textList(input.capabilities),
        engine: normalizeText(input.engine),
        entry: normalizeText(input.entry),
        files: textList(input.files),
        license: normalizeText(input.license),
        hashes: stringRecord(input.hashes),
        endpoint: normalizeText(input.endpoint),
        engineConfig: input.engineConfig ? toNimiRuntimeProtoStruct(input.engineConfig) : undefined,
      }, defaultCallOptions);
      return projectRequiredLocal(
        response.plan,
        projectNimiRuntimeLocalInstallPlanDescriptor,
        'Runtime local install plan response is missing plan',
        'check_runtime_local_install_plan_response',
      );
    },
    async install(plan, writeOptions) {
      assertNimiRuntimeLocalWriteAllowed('runtime_local_install', writeOptions?.caller);
      const response = await resolveLocal().installModelFromPlan({
        plan: toGeneratedNimiRuntimeLocalInstallPlan(plan),
      }, callOptions(writeOptions));
      return projectRequiredLocal(
        response.asset,
        projectNimiRuntimeLocalAssetRecord,
        'Runtime local install response is missing asset',
        'check_runtime_local_install_response',
      );
    },
    async installVerifiedAsset(input, writeOptions) {
      assertNimiRuntimeLocalWriteAllowed('runtime_local_install_verified_asset', writeOptions?.caller);
      const response = await resolveLocal().installVerifiedAsset({
        templateId: requireLocalText(input.templateId, 'Runtime local verified asset template is required', 'provide_local_asset_template'),
        endpoint: normalizeText(input.endpoint),
      }, callOptions(writeOptions));
      return projectRequiredLocal(
        response.asset,
        projectNimiRuntimeLocalAssetRecord,
        'Runtime local verified asset install response is missing asset',
        'check_runtime_local_verified_asset_response',
      );
    },
    async importAsset(input, writeOptions) {
      assertNimiRuntimeLocalWriteAllowed('runtime_local_import_asset', writeOptions?.caller);
      const response = await resolveLocal().importLocalAsset({
        manifestPath: requireLocalText(input.manifestPath, 'Runtime local asset manifest path is required', 'provide_local_asset_manifest_path'),
        endpoint: normalizeText(input.endpoint),
        engineConfig: input.engineConfig ? toNimiRuntimeProtoStruct(input.engineConfig) : undefined,
      }, callOptions(writeOptions));
      return projectRequiredLocal(
        response.asset,
        projectNimiRuntimeLocalAssetRecord,
        'Runtime local asset import response is missing asset',
        'check_runtime_local_import_response',
      );
    },
    async importAssetManifest(manifestPath, writeOptions) {
      const asset = await this.importAsset({
        manifestPath,
        endpoint: normalizeText(writeOptions?.endpoint),
      }, writeOptions);
      return { asset };
    },
    async importAssetFile(input, writeOptions) {
      const asset = await this.importFile({
        filePath: input.filePath,
        assetName: input.assetName,
        kind: input.declaration.assetKind,
        engine: input.declaration.engine,
        endpoint: input.endpoint,
      }, writeOptions);
      return { asset };
    },
    async importFile(input, writeOptions) {
      assertNimiRuntimeLocalWriteAllowed('runtime_local_import_file', writeOptions?.caller);
      const response = await resolveLocal().importLocalAssetFile({
        filePath: requireLocalText(input.filePath, 'Runtime local asset file path is required', 'provide_local_asset_file_path'),
        assetName: normalizeText(input.assetName),
        kind: toNimiRuntimeLocalAssetKindRequestValue(input.kind),
        capabilities: nimiRuntimeLocalCapabilitiesForAssetKind(input.kind),
        engine: normalizeText(input.engine),
        endpoint: normalizeText(input.endpoint),
      }, callOptions(writeOptions));
      return projectRequiredLocal(
        response.asset,
        projectNimiRuntimeLocalAssetRecord,
        'Runtime local asset file import response is missing asset',
        'check_runtime_local_import_file_response',
      );
    },
    async importBundle(input, writeOptions) {
      assertNimiRuntimeLocalWriteAllowed('runtime_local_import_bundle', writeOptions?.caller);
      const response = await resolveLocal().importLocalAssetBundle({
        directoryPath: requireLocalText(input.directoryPath, 'Runtime local asset bundle directory is required', 'provide_local_asset_bundle_directory'),
        modelName: normalizeText(input.modelName),
        capabilities: textList(input.capabilities),
        engine: normalizeText(input.engine),
        endpoint: normalizeText(input.endpoint),
      }, callOptions(writeOptions));
      return projectRequiredLocal(
        response.transfer,
        projectNimiRuntimeLocalTransferAccepted,
        'Runtime local asset bundle import response is missing transfer',
        'check_runtime_local_import_bundle_response',
      );
    },
    async rescanBundle(input, writeOptions) {
      assertNimiRuntimeLocalWriteAllowed('runtime_local_rescan_bundle', writeOptions?.caller);
      const response = await resolveLocal().rescanLocalAssetBundle({
        localAssetId: requireLocalText(input.localAssetId, 'Runtime local asset id is required', 'provide_local_asset_id'),
      }, callOptions(writeOptions));
      return projectRequiredLocal(
        response.transfer,
        projectNimiRuntimeLocalTransferAccepted,
        'Runtime local asset rescan response is missing transfer',
        'check_runtime_local_rescan_response',
      );
    },
    async remove(localAssetId, writeOptions) {
      assertNimiRuntimeLocalWriteAllowed('runtime_local_remove_asset', writeOptions?.caller);
      const response = await resolveLocal().removeLocalAsset({
        localAssetId: requireLocalText(localAssetId, 'Runtime local asset id is required', 'provide_local_asset_id'),
      }, callOptions(writeOptions));
      return projectRequiredLocal(
        response.asset,
        projectNimiRuntimeLocalAssetRecord,
        'Runtime local asset remove response is missing asset',
        'check_runtime_local_remove_response',
      );
    },
    async start(localAssetId, writeOptions) {
      assertNimiRuntimeLocalWriteAllowed('runtime_local_start_asset', writeOptions?.caller);
      const response = await resolveLocal().startLocalAsset({
        localAssetId: requireLocalText(localAssetId, 'Runtime local asset id is required', 'provide_local_asset_id'),
      }, callOptions(writeOptions));
      return projectRequiredLocal(
        response.asset,
        projectNimiRuntimeLocalAssetRecord,
        'Runtime local asset start response is missing asset',
        'check_runtime_local_start_response',
      );
    },
    async stop(localAssetId, writeOptions) {
      assertNimiRuntimeLocalWriteAllowed('runtime_local_stop_asset', writeOptions?.caller);
      const response = await resolveLocal().stopLocalAsset({
        localAssetId: requireLocalText(localAssetId, 'Runtime local asset id is required', 'provide_local_asset_id'),
      }, callOptions(writeOptions));
      return projectRequiredLocal(
        response.asset,
        projectNimiRuntimeLocalAssetRecord,
        'Runtime local asset stop response is missing asset',
        'check_runtime_local_stop_response',
      );
    },
    async health(localAssetId) {
      const response = await resolveLocal().checkLocalAssetHealth({
        localAssetId: normalizeText(localAssetId),
      }, defaultCallOptions);
      return response.assets.map(projectNimiRuntimeLocalAssetHealth);
    },
    async listTransfers() {
      const response = await resolveLocal().listLocalTransfers({}, defaultCallOptions);
      return response.transfers.map(projectNimiRuntimeLocalTransferSessionSummary);
    },
    async pauseTransfer(installSessionId, writeOptions) {
      assertNimiRuntimeLocalWriteAllowed('runtime_local_pause_transfer', writeOptions?.caller);
      const response = await resolveLocal().pauseLocalTransfer({
        installSessionId: requireLocalText(installSessionId, 'Runtime local transfer id is required', 'provide_local_transfer_id'),
      }, callOptions(writeOptions));
      return projectRequiredLocal(
        response.transfer,
        projectNimiRuntimeLocalTransferSessionSummary,
        'Runtime local transfer pause response is missing transfer',
        'check_runtime_local_pause_response',
      );
    },
    async resumeTransfer(installSessionId, writeOptions) {
      assertNimiRuntimeLocalWriteAllowed('runtime_local_resume_transfer', writeOptions?.caller);
      const response = await resolveLocal().resumeLocalTransfer({
        installSessionId: requireLocalText(installSessionId, 'Runtime local transfer id is required', 'provide_local_transfer_id'),
      }, callOptions(writeOptions));
      return projectRequiredLocal(
        response.transfer,
        projectNimiRuntimeLocalTransferSessionSummary,
        'Runtime local transfer resume response is missing transfer',
        'check_runtime_local_resume_response',
      );
    },
    async cancelTransfer(installSessionId, writeOptions) {
      assertNimiRuntimeLocalWriteAllowed('runtime_local_cancel_transfer', writeOptions?.caller);
      const response = await resolveLocal().cancelLocalTransfer({
        installSessionId: requireLocalText(installSessionId, 'Runtime local transfer id is required', 'provide_local_transfer_id'),
      }, callOptions(writeOptions));
      return projectRequiredLocal(
        response.transfer,
        projectNimiRuntimeLocalTransferSessionSummary,
        'Runtime local transfer cancel response is missing transfer',
        'check_runtime_local_cancel_response',
      );
    },
    async watchTransferProgress(listener, watchOptions = {}) {
      const controller = new AbortController();
      const stream = await resolveLocal().watchLocalTransfers({}, {
        ...defaultCallOptions,
        ...watchOptions.callOptions,
        signal: controller.signal,
      });
      let disposed = false;
      void (async () => {
        try {
          for await (const item of stream) {
            if (disposed) {
              break;
            }
            listener(projectNimiRuntimeLocalTransferProgressEvent(item));
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            watchOptions.onError?.(error);
          }
        }
      })();
      return () => {
        disposed = true;
        controller.abort();
      };
    },
    async collectDeviceProfile(input = {}) {
      const response = await resolveLocal().collectDeviceProfile({
        extraPorts: (input.extraPorts ?? []).map((port) => Math.trunc(Number(port))).filter(Number.isFinite),
      }, defaultCallOptions);
      return projectRequiredLocal(
        response.profile,
        projectNimiRuntimeLocalDeviceProfile,
        'Runtime local device profile response is missing profile',
        'check_runtime_local_device_profile_response',
      );
    },
    async getRecommendationFeed(input = {}) {
      const response = await resolveLocal().getRecommendationFeed({
        capability: toNimiRuntimeLocalRecommendationFeedCapabilityRequestValue(input.capability),
        pageSize: normalizePageSize(input.pageSize ?? 0),
      }, defaultCallOptions);
      return projectRequiredLocal(
        response.feed,
        (feed: GeneratedLocalRecommendationFeedDescriptor) => projectNimiRuntimeLocalRecommendationFeed(
          feed,
          (profile) => projectNimiRuntimeLocalDeviceProfile(profile as GeneratedLocalDeviceProfile),
        ),
        'Runtime local recommendation feed response is missing feed',
        'check_runtime_local_recommendation_feed_response',
      );
    },
    async resolveProfile(input) {
      const request: ResolveProfileRequest = {
        targetId: requireLocalText(input.targetId, 'Runtime local profile target id is required', 'provide_local_profile_target_id'),
        profile: toGeneratedNimiRuntimeLocalProfileDescriptor(input.profile),
        capability: normalizeText(input.capability),
        deviceProfile: input.deviceProfile ? toGeneratedNimiRuntimeLocalDeviceProfile(input.deviceProfile) : undefined,
        entryOverrides: (input.entryOverrides ?? []).map(toGeneratedNimiRuntimeLocalProfileEntryOverride),
      };
      const response = await resolveLocal().resolveProfile(request, defaultCallOptions);
      return projectRequiredLocal(
        response.plan,
        projectNimiRuntimeLocalProfileResolutionPlan,
        'Runtime local profile resolution response is missing plan',
        'check_runtime_local_profile_resolution_response',
      );
    },
    async applyProfile(plan, writeOptions) {
      assertNimiRuntimeLocalWriteAllowed('runtime_local_apply_profile', writeOptions?.caller);
      const request: ApplyProfileRequest = {
        plan: toGeneratedNimiRuntimeLocalProfileResolutionPlan(plan),
      };
      const response = await resolveLocal().applyProfile(request, callOptions(writeOptions));
      const result = projectRequiredLocal(
        response.result,
        projectNimiRuntimeLocalProfileApplyResult,
        'Runtime local profile apply response is missing result',
        'check_runtime_local_profile_apply_response',
      );
      const reasonCode = normalizeText(result.reasonCode || result.executionResult.reasonCode);
      if (reasonCode && reasonCode !== ReasonCode.ACTION_EXECUTED) {
        throw createNimiError({
          message: `Runtime local profile apply failed: ${reasonCode}`,
          reasonCode,
          actionHint: 'check_runtime_local_profile_apply_result',
          source: 'runtime',
        });
      }
      return result;
    },
    async resolveEnvironmentPlan(input) {
      const response = await resolveLocal().resolveLocalEnvironmentPlan({
        packId: requireLocalText(input.packId, 'Runtime local environment pack id is required', 'provide_local_environment_pack_id'),
        consumerScope: normalizeText(input.consumerScope),
        runtimeDataRoot: normalizeText(input.runtimeDataRoot),
        assetId: normalizeText(input.assetId),
        localAssetId: normalizeText(input.localAssetId),
        companionAssetId: normalizeText(input.companionAssetId),
        parentAssetId: normalizeText(input.parentAssetId),
        installLevel: normalizeText(input.installLevel),
      }, defaultCallOptions);
      return projectRequiredLocal(
        response.plan,
        projectNimiRuntimeLocalEnvironmentPlan,
        'Runtime local environment plan response is missing plan',
        'check_runtime_local_environment_plan_response',
      );
    },
    async listEnvironmentDependencyJobs(input = {}) {
      const response = await resolveLocal().listLocalEnvironmentDependencyJobs({
        environmentKey: normalizeText(input.environmentKey),
        state: normalizeText(input.state),
      }, defaultCallOptions);
      return response.jobs.map(projectNimiRuntimeLocalEnvironmentDependencyJob);
    },
    async startEnvironmentDependencyJob(input, writeOptions) {
      assertNimiRuntimeLocalWriteAllowed('runtime_local_environment_dependency_start', writeOptions?.caller);
      const response = await resolveLocal().startLocalEnvironmentDependencyJob({
        environmentKey: requireLocalText(input.environmentKey, 'Runtime local environment key is required', 'provide_local_environment_key'),
        dependencyFamily: requireLocalText(input.dependencyFamily, 'Runtime local dependency family is required', 'provide_local_dependency_family'),
        dependencyId: requireLocalText(input.dependencyId, 'Runtime local dependency id is required', 'provide_local_dependency_id'),
        sourceKind: requireLocalText(input.sourceKind, 'Runtime local dependency source kind is required', 'provide_local_dependency_source_kind'),
        confirmed: Boolean(input.confirmed),
        consumerScope: normalizeText(input.consumerScope),
      }, callOptions(writeOptions));
      return projectRequiredLocal(
        response.job,
        projectNimiRuntimeLocalEnvironmentDependencyJob,
        'Runtime local dependency start response is missing job',
        'check_runtime_local_dependency_start_response',
      );
    },
    async cancelEnvironmentDependencyJob(input, writeOptions) {
      assertNimiRuntimeLocalWriteAllowed('runtime_local_environment_dependency_cancel', writeOptions?.caller);
      const response = await resolveLocal().cancelLocalEnvironmentDependencyJob({
        jobId: requireLocalText(input.jobId, 'Runtime local dependency job id is required', 'provide_local_dependency_job_id'),
      }, callOptions(writeOptions));
      return projectRequiredLocal(
        response.job,
        projectNimiRuntimeLocalEnvironmentDependencyJob,
        'Runtime local dependency cancel response is missing job',
        'check_runtime_local_dependency_cancel_response',
      );
    },
    async retryEnvironmentDependencyJob(input, writeOptions) {
      assertNimiRuntimeLocalWriteAllowed('runtime_local_environment_dependency_retry', writeOptions?.caller);
      const response = await resolveLocal().retryLocalEnvironmentDependencyJob({
        jobId: requireLocalText(input.jobId, 'Runtime local dependency job id is required', 'provide_local_dependency_job_id'),
        confirmed: Boolean(input.confirmed),
      }, callOptions(writeOptions));
      return projectRequiredLocal(
        response.job,
        projectNimiRuntimeLocalEnvironmentDependencyJob,
        'Runtime local dependency retry response is missing job',
        'check_runtime_local_dependency_retry_response',
      );
    },
    async repairEnvironmentDependency(input, writeOptions) {
      assertNimiRuntimeLocalWriteAllowed('runtime_local_environment_dependency_repair', writeOptions?.caller);
      const response = await resolveLocal().repairLocalEnvironmentDependency({
        environmentKey: requireLocalText(input.environmentKey, 'Runtime local environment key is required', 'provide_local_environment_key'),
        dependencyFamily: requireLocalText(input.dependencyFamily, 'Runtime local dependency family is required', 'provide_local_dependency_family'),
        dependencyId: requireLocalText(input.dependencyId, 'Runtime local dependency id is required', 'provide_local_dependency_id'),
        confirmed: Boolean(input.confirmed),
        reasonCode: normalizeText(input.reasonCode),
        consumerScope: normalizeText(input.consumerScope),
      }, callOptions(writeOptions));
      return projectRequiredLocal(
        response.job,
        projectNimiRuntimeLocalEnvironmentDependencyJob,
        'Runtime local dependency repair response is missing job',
        'check_runtime_local_dependency_repair_response',
      );
    },
    async scanUnregisteredAssets() {
      const response = await resolveLocal().scanUnregisteredAssets({}, defaultCallOptions);
      return response.items.map(projectNimiRuntimeLocalUnregisteredAssetDescriptor);
    },
    async scaffoldOrphanAsset(input, writeOptions) {
      assertNimiRuntimeLocalWriteAllowed('runtime_local_scaffold_orphan_asset', writeOptions?.caller);
      const response = await resolveLocal().scaffoldOrphanAsset({
        path: requireLocalText(input.path, 'Runtime local orphan asset path is required', 'provide_local_orphan_asset_path'),
        kind: toNimiRuntimeLocalAssetKindRequestValue(input.kind),
        capabilities: [],
        engine: normalizeText(input.engine),
        endpoint: normalizeText(input.endpoint),
      }, callOptions(writeOptions));
      return projectRequiredLocal(
        response.asset,
        projectNimiRuntimeLocalAssetRecord,
        'Runtime local orphan asset scaffold response is missing asset',
        'check_runtime_local_orphan_asset_response',
      );
    },
  };
}
