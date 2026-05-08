import type { Realm } from './realm/client.js';

export type PlatformWorldGovernanceDomain = {
  publishWorldPackage: (input: unknown) => Promise<unknown>;
  listWorldReleases: (worldId: string) => Promise<unknown>;
  getWorldRelease: (worldId: string, releaseId: string) => Promise<unknown>;
  rollbackWorldRelease: (worldId: string, releaseId: string, input: unknown) => Promise<unknown>;
  listOfficialFactoryBatchRuns: () => Promise<unknown>;
  createOfficialFactoryBatchRun: (input: unknown) => Promise<unknown>;
  getOfficialFactoryBatchRun: (runId: string) => Promise<unknown>;
  retryOfficialFactoryBatchRun: (runId: string, input: unknown) => Promise<unknown>;
  reportOfficialFactoryBatchItemFailure: (runId: string, itemId: string, input: unknown) => Promise<unknown>;
  listWorldTitleLineage: (worldId: string) => Promise<unknown>;
};

export function createPlatformWorldGovernanceDomain(realm: Realm): PlatformWorldGovernanceDomain {
  return {
    publishWorldPackage: (input) => realm.unsafeRaw.request({
      method: 'POST',
      path: '/api/admin/worlds/packages/publish',
      body: input,
    }),
    listWorldReleases: (worldId) => realm.unsafeRaw.request({
      method: 'GET',
      path: '/api/admin/worlds/{worldId}/releases',
      pathParams: { worldId },
    }),
    getWorldRelease: (worldId, releaseId) => realm.unsafeRaw.request({
      method: 'GET',
      path: '/api/admin/worlds/{worldId}/releases/{releaseId}',
      pathParams: { worldId, releaseId },
    }),
    rollbackWorldRelease: (worldId, releaseId, input) => realm.unsafeRaw.request({
      method: 'POST',
      path: '/api/admin/worlds/{worldId}/releases/{releaseId}/rollback',
      pathParams: { worldId, releaseId },
      body: input,
    }),
    listOfficialFactoryBatchRuns: () => realm.unsafeRaw.request({
      method: 'GET',
      path: '/api/admin/worlds/operations/batch-runs',
    }),
    createOfficialFactoryBatchRun: (input) => realm.unsafeRaw.request({
      method: 'POST',
      path: '/api/admin/worlds/operations/batch-runs',
      body: input,
    }),
    getOfficialFactoryBatchRun: (runId) => realm.unsafeRaw.request({
      method: 'GET',
      path: '/api/admin/worlds/operations/batch-runs/{runId}',
      pathParams: { runId },
    }),
    retryOfficialFactoryBatchRun: (runId, input) => realm.unsafeRaw.request({
      method: 'POST',
      path: '/api/admin/worlds/operations/batch-runs/{runId}/retry',
      pathParams: { runId },
      body: input,
    }),
    reportOfficialFactoryBatchItemFailure: (runId, itemId, input) => realm.unsafeRaw.request({
      method: 'POST',
      path: '/api/admin/worlds/operations/batch-runs/{runId}/items/{itemId}/fail',
      pathParams: { runId, itemId },
      body: input,
    }),
    listWorldTitleLineage: (worldId) => realm.unsafeRaw.request({
      method: 'GET',
      path: '/api/admin/worlds/{worldId}/title-lineage',
      pathParams: { worldId },
    }),
  };
}
