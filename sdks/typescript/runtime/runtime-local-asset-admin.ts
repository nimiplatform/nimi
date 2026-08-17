import {
  type LocalDeviceProfile as GeneratedLocalDeviceProfile,
  type LocalRecommendationFeedDescriptor as GeneratedLocalRecommendationFeedDescriptor,
  type ResolveLocalEnvironmentPlanRequest,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import { toNimiRuntimeProtoStruct } from './runtime-agent-values';
import { toNimiRuntimeLocalAssetKindRequestValue } from './local-asset-vocabulary';
import {
  projectNimiRuntimeLocalRecommendationFeed,
  toNimiRuntimeLocalRecommendationFeedCapabilityRequestValue,
} from './runtime-local-recommendation';
import {
  projectNimiRuntimeLocalCatalogItemDescriptor,
  projectNimiRuntimeLocalCatalogVariantDescriptor,
  projectNimiRuntimeLocalDeviceProfile,
  projectNimiRuntimeLocalEnvironmentDependencyJob,
  projectNimiRuntimeLocalEnvironmentPlan,
  projectNimiRuntimeLocalInstallPlanDescriptor,
  projectNimiRuntimeModelAssetRecord,
  projectNimiRuntimeLocalTransferAccepted,
  projectNimiRuntimeLocalTransferProgressEvent,
  projectNimiRuntimeLocalTransferSessionSummary,
  projectNimiRuntimeLocalVerifiedAssetDescriptor,
} from './runtime-local-asset-admin-projections';
import type {
  NimiRuntimeModelAssetRecord,
  NimiRuntimeLocalCatalogSearchInput,
  NimiRuntimeLocalAssetAdminClient,
  NimiRuntimeLocalAssetAdminClientOptions,
  NimiRuntimeLocalEnvironmentPlanInput,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeLocalWriteOptions,
} from './runtime-local-asset-admin-types';
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
} from './runtime-local-asset-admin-values';

export {
  assertNimiRuntimeLocalWriteAllowed,
} from './runtime-local-asset-admin-values';
export {
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
  projectNimiRuntimeLocalCatalogItemDescriptor,
  projectNimiRuntimeLocalCatalogVariantDescriptor,
  projectNimiRuntimeLocalDeviceProfile,
  projectNimiRuntimeLocalEnvironmentDependencyJob,
  projectNimiRuntimeLocalEnvironmentPlan,
  projectNimiRuntimeLocalEnvironmentPlanDependency,
  projectNimiRuntimeLocalInstallPlanDescriptor,
  projectNimiRuntimeModelAssetRecord,
  projectNimiRuntimeLocalTransferProgressEvent,
  projectNimiRuntimeLocalTransferSessionSummary,
  projectNimiRuntimeLocalVerifiedAssetDescriptor,
} from './runtime-local-asset-admin-projections';
export * from './runtime-local-asset-admin-types';

function toGeneratedNimiRuntimeLocalEnvironmentPlanResolution(
  input: NimiRuntimeLocalEnvironmentPlanInput,
): ResolveLocalEnvironmentPlanRequest {
  return {
    capabilityContract: requireLocalText(input.capabilityContract, 'Runtime local environment capability contract is required', 'provide_local_environment_capability_contract'),
    runtimeDataRoot: normalizeText(input.runtimeDataRoot),
  };
}

// @nimi-authority: definition.nimi.sdks.feature-clients.local-environment-plane
// @nimi-authority: rule.nimi.sdks.feature-clients.r063
// @nimi-authority: rule.nimi.sdks.feature-clients.r064
export function createNimiRuntimeLocalAssetAdminClient(
  options: NimiRuntimeLocalAssetAdminClientOptions,
): NimiRuntimeLocalAssetAdminClient {
  const resolveLocal = () => (typeof options.local === 'function' ? options.local() : options.local);
  const defaultCallOptions = options.callOptions;
  const callOptions = (writeOptions?: NimiRuntimeLocalWriteOptions): RuntimeTypedCallOptions | undefined => (
    writeOptions?.callOptions ?? defaultCallOptions
  );
  return {
    async importModelAsset(input, writeOptions) {
      assertNimiRuntimeLocalWriteAllowed('runtime_model_asset_import', writeOptions?.caller);
      const response = await resolveLocal().importModelAsset({
        sourcePath: requireLocalText(input.sourcePath, 'Runtime ModelAsset source path is required', 'provide_model_asset_source_path'),
        displayName: normalizeText(input.displayName),
      }, callOptions(writeOptions));
      return projectRequiredLocal(
        response.transfer,
        projectNimiRuntimeLocalTransferAccepted,
        'Runtime ModelAsset import response is missing transfer',
        'check_model_asset_import_response',
      );
    },
    async listModelAssets(input = {}) {
      const assets: NimiRuntimeModelAssetRecord[] = [];
      let pageToken = '';
      const pageSize = normalizePageSize(input.pageSize);
      const maxPages = normalizeMaxPages(input.maxPages);
      for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
        const response = await resolveLocal().listModelAssets({ pageSize, pageToken }, defaultCallOptions);
        assets.push(...response.assets.map(projectNimiRuntimeModelAssetRecord));
        pageToken = normalizeText(response.nextPageToken);
        if (!pageToken) break;
      }
      return dedupeBy(assets, (asset) => asset.modelAssetId);
    },
    async getModelAsset(modelAssetId) {
      const response = await resolveLocal().getModelAsset({
        modelAssetId: requireLocalText(modelAssetId, 'Runtime ModelAsset id is required', 'provide_model_asset_id'),
      }, defaultCallOptions);
      return projectRequiredLocal(
        response.asset,
        projectNimiRuntimeModelAssetRecord,
        'Runtime GetModelAsset response is missing asset',
        'check_get_model_asset_response',
      );
    },
    async inspectModelAssetRemoval(modelAssetId) {
      const response = await resolveLocal().removeModelAsset({
        modelAssetId: requireLocalText(modelAssetId, 'Runtime ModelAsset id is required', 'provide_model_asset_id'),
        force: false,
      }, defaultCallOptions);
      return {
        asset: projectRequiredLocal(response.asset, projectNimiRuntimeModelAssetRecord, 'Runtime ModelAsset removal inspection is missing asset', 'check_model_asset_removal_inspection'),
        referencingLoadoutIds: textList(response.referencingLoadoutIds),
        confirmationRequired: Boolean(response.confirmationRequired),
      };
    },
    async removeModelAsset(modelAssetId, writeOptions) {
      assertNimiRuntimeLocalWriteAllowed('runtime_model_asset_remove', writeOptions?.caller);
      const response = await resolveLocal().removeModelAsset({
        modelAssetId: requireLocalText(modelAssetId, 'Runtime ModelAsset id is required', 'provide_model_asset_id'),
        force: true,
      }, callOptions(writeOptions));
      return {
        asset: projectRequiredLocal(response.asset, projectNimiRuntimeModelAssetRecord, 'Runtime RemoveModelAsset response is missing asset', 'check_remove_model_asset_response'),
        referencingLoadoutIds: textList(response.referencingLoadoutIds),
        confirmationRequired: Boolean(response.confirmationRequired),
        cleanupPending: Boolean(response.cleanupPending),
      };
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
    async install(planId, writeOptions) {
      assertNimiRuntimeLocalWriteAllowed('runtime_local_install', writeOptions?.caller);
      const response = await resolveLocal().installModelFromPlan({
        planId: requireLocalText(planId, 'Runtime local install plan id is required', 'provide_install_plan_id'),
      }, callOptions(writeOptions));
      return projectRequiredLocal(
        response.modelAsset,
        projectNimiRuntimeModelAssetRecord,
        'Runtime local install response is missing ModelAsset',
        'check_runtime_local_install_response',
      );
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
    async resolveEnvironmentPlan(input) {
      const response = await resolveLocal().resolveLocalEnvironmentPlan(
        toGeneratedNimiRuntimeLocalEnvironmentPlanResolution(input),
        defaultCallOptions,
      );
      return projectRequiredLocal(
        response.plan,
        projectNimiRuntimeLocalEnvironmentPlan,
        'Runtime local environment plan response is missing plan',
        'check_runtime_local_environment_plan_response',
      );
    },
    async applyEnvironmentPlan(input, writeOptions) {
      assertNimiRuntimeLocalWriteAllowed('runtime_local_environment_plan_apply', writeOptions?.caller);
      const response = await resolveLocal().applyLocalEnvironmentPlan({
        resolution: toGeneratedNimiRuntimeLocalEnvironmentPlanResolution(input.resolution),
        expectedPlanId: requireLocalText(
          input.expectedPlanId,
          'Runtime local environment expected plan id is required',
          'refresh_local_environment_plan',
        ),
        confirmed: Boolean(input.confirmed),
      }, callOptions(writeOptions));
      return {
        plan: projectRequiredLocal(
          response.plan,
          projectNimiRuntimeLocalEnvironmentPlan,
          'Runtime local environment plan apply response is missing plan',
          'check_runtime_local_environment_plan_apply_response',
        ),
        jobs: response.jobs.map(projectNimiRuntimeLocalEnvironmentDependencyJob),
      };
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
        consumerScope: requireLocalText(input.consumerScope, 'Runtime local dependency consumer scope is required', 'provide_local_dependency_consumer_scope'),
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
        consumerScope: requireLocalText(input.consumerScope, 'Runtime local dependency consumer scope is required', 'provide_local_dependency_consumer_scope'),
      }, callOptions(writeOptions));
      return projectRequiredLocal(
        response.job,
        projectNimiRuntimeLocalEnvironmentDependencyJob,
        'Runtime local dependency repair response is missing job',
        'check_runtime_local_dependency_repair_response',
      );
    },
  };
}
