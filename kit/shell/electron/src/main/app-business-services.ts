import {
  createNimiLocalAppAIConsumptionClient,
  createNimiLocalAppAgentWorkClient,
  createNimiLocalAppIntegrationClient,
  createNimiLocalAppActivityClient,
  createNimiLocalAppWorldCoreClient,
  createNimiLocalAppAIConfigClient,
  createNimiAppRuntimeStorageClient,
  createNimiLocalAppAssetsClient,
  type NimiLocalAppAIConsumptionClient,
  type NimiLocalAppAssetBody,
  type NimiLocalAppClient,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  NimiElectronLocalAppHostError,
  type NimiElectronLocalAppHost,
  type NimiElectronLocalAppRecord,
} from './local-app-host.js';

/** SDK clients for App-owned Node work running inside the verified App Host. */
export type NimiElectronAppBusinessServices = Pick<NimiLocalAppClient, 'aiConfig' | 'storage' | 'agentWork' | 'integration' | 'activity'> & {
  readonly ai: NimiLocalAppAIConsumptionClient;
  readonly realm: Pick<NimiLocalAppClient['realm'], 'worldCore'>;
};

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-016b
// This adapter reuses the bridge's existing protected Host; it creates no
// transport, session, endpoint, identity, executor or durable workflow state.
export function createAppBusinessServices(host: NimiElectronLocalAppHost) {
  const resources = new Set<() => Promise<void>>();
  let generation = 0;
  let closed = false;
  const check = (expected = generation) => {
    if (closed || expected !== generation) throw new NimiElectronLocalAppHostError('session-invalid', false);
  };
  const request = async (method: keyof NimiElectronLocalAppHost, payload: unknown = {}) => {
    const expected = generation;
    check(expected);
    const result = await (host[method] as (value: NimiElectronLocalAppRecord) => Promise<NimiElectronLocalAppRecord>)
      .call(host, payload as NimiElectronLocalAppRecord);
    check(expected);
    return result;
  };
  const stream = async (
    open: 'textTurnSubscribe' | 'scenarioJobSubscribe' | 'agentWorkSubscribe' | 'activitySubscribe' | 'activityOpenDeliveriesSubscribe',
    next: 'textTurnStreamNext' | 'scenarioJobStreamNext' | 'realtimeStreamNext' | 'activityStreamNext',
    close: 'textTurnStreamClose' | 'scenarioJobStreamClose' | 'realtimeStreamClose' | 'activityStreamClose',
    payload: unknown,
  ) => {
    const expected = generation;
    const { streamId } = await request(open, payload);
    let stopped = false;
    const cancel = async () => {
      if (stopped) return;
      stopped = true;
      resources.delete(cancel);
      await host[close]({ streamId });
    };
    resources.add(cancel);
    return {
      events: {
        async *[Symbol.asyncIterator]() {
          try {
            while (!stopped) {
              check(expected);
              const result = await request(next, { streamId });
              check(expected);
              if (stopped) return;
              if (result.completed === true) {
                // The scoped Host retires ownership at EOF; closing again is not-found.
                stopped = true;
                resources.delete(cancel);
                return;
              }
              yield result.event;
            }
          } finally {
            await cancel();
          }
        },
      },
      cancel,
    };
  };
  // @nimi-authority: rule.nimi.sdks.feature-clients.scenario-execute-call-control
  // The SDK client settles abort and caller deadline itself; the Host receives
  // the signal so the native call is dropped, and invalidation cancels every
  // outstanding call before it can settle for this service generation.
  const execute = async (
    spec: unknown,
    options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } | undefined,
  ) => {
    const expected = generation;
    check(expected);
    const controller = new AbortController();
    const abort = async () => { controller.abort(); };
    const onCallerAbort = () => controller.abort();
    resources.add(abort);
    options?.signal?.addEventListener('abort', onCallerAbort, { once: true });
    if (options?.signal?.aborted) controller.abort();
    try {
      const result = await host.scenarioExecute({
        spec: spec as NimiElectronLocalAppRecord[string],
        ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      }, { signal: controller.signal });
      check(expected);
      return result;
    } catch (error) {
      check(expected);
      throw error;
    } finally {
      options?.signal?.removeEventListener('abort', onCallerAbort);
      resources.delete(abort);
    }
  };
  const ai = createNimiLocalAppAIConsumptionClient({
    text: { streamTurn: (input) => stream('textTurnSubscribe', 'textTurnStreamNext', 'textTurnStreamClose', input) },
    scenario: { execute },
    scenarioJobs: {
      submit: (spec, options) => request('scenarioJobSubmit', { spec, timeoutMs: options?.timeoutMs ?? 0 }),
      get: (jobId) => request('scenarioJobGet', { jobId }),
      subscribe: (jobId) => stream('scenarioJobSubscribe', 'scenarioJobStreamNext', 'scenarioJobStreamClose', { jobId }),
      cancel: (jobId, reason = '') => request('scenarioJobCancel', { jobId, reason }),
    },
    artifacts: {
      read: (artifactId) => request('artifactRead', { artifactId }),
      upload: (input) => request('artifactUpload', input),
    },
    voiceAssets: { list: (input) => request('voiceAssetsList', { pageSize: input?.pageSize ?? 0, pageToken: input?.pageToken ?? '' }) },
  });
  const assets = createNimiLocalAppAssetsClient({
    stat: (relativePath) => request('assetStat', { relativePath }),
    list: (input) => request('assetList', { prefix: input.prefix, cursor: input.cursor ?? '', pageSize: input.pageSize ?? 0 }),
    remove: (relativePath) => request('assetRemove', { relativePath }),
    move: (input) => request('assetMove', { fromRelativePath: input.from, toRelativePath: input.to, overwrite: input.overwrite ?? false }),
    reveal: (relativePath) => request('assetReveal', { relativePath }),
    adoptArtifact: (input) => request('assetAdopt', { ...input, overwrite: input.overwrite ?? false }),
    async write(input) {
      const expected = generation;
      const { streamId } = await request('assetWriteOpen', {
        relativePath: input.relativePath, mediaType: input.mediaType ?? '', overwrite: input.overwrite ?? false,
      });
      let committed = false;
      let aborted = false;
      const abort = async () => {
        if (aborted || committed) return;
        aborted = true;
        await host.assetWriteAbort({ streamId });
      };
      resources.add(abort);
      try {
        for await (const chunk of assetChunks(input.body)) {
          check(expected);
          await request('assetWriteChunk', { streamId, bodyChunk: chunk });
        }
        check(expected);
        const result = await request('assetWriteCommit', { streamId });
        committed = true;
        return result;
      } finally {
        resources.delete(abort);
        if (!committed) await abort().catch(() => undefined);
      }
    },
    async read(input) {
      const expected = generation;
      const opened = await request('assetReadOpen', input);
      let stopped = false;
      const cancel = async () => {
        if (stopped) return;
        stopped = true;
        resources.delete(cancel);
        await host.assetReadClose({ streamId: opened.streamId });
      };
      resources.add(cancel);
      return {
        asset: opened.asset,
        range: opened.range,
        body: {
          async *[Symbol.asyncIterator]() {
            try {
              while (!stopped) {
                check(expected);
                const result = await request('assetReadNext', { streamId: opened.streamId });
                check(expected);
                if (stopped) return;
                if (result.completed === true) {
                  stopped = true;
                  resources.delete(cancel);
                  return;
                }
                yield result.bodyChunk;
              }
            } finally {
              await cancel();
            }
          },
        },
      };
    },
  });
  const services: NimiElectronAppBusinessServices = Object.freeze({
    ai,
    agentWork: createNimiLocalAppAgentWorkClient({
      listReferences: async () => (await request('agentWorkReferenceList')).references,
      start: input => request('agentWorkStart', input),
      get: input => request('agentWorkGet', input),
      status: input => request('agentWorkStatus', input),
      listToolCalls: input => request('agentWorkToolCallsList', input),
      submitToolResult: input => request('agentWorkToolResultSubmit', input),
      cancel: input => request('agentWorkCancel', input),
      subscribe: input => stream('agentWorkSubscribe', 'realtimeStreamNext', 'realtimeStreamClose', input),
    }),
    activity: createNimiLocalAppActivityClient({
      put: input => request('activityPut', input),
      list: input => request('activityList', input),
      subscribe: input => stream('activitySubscribe', 'activityStreamNext', 'activityStreamClose', input),
      markRead: input => request('activityMarkRead', input),
      open: input => request('activityOpen', input),
      openRequests: {
        subscribe: () => stream('activityOpenDeliveriesSubscribe', 'activityStreamNext', 'activityStreamClose', {}),
        complete: input => request('activityOpenDeliveryComplete', input),
      },
    }),
    realm: Object.freeze({ worldCore: createNimiLocalAppWorldCoreClient({
      list: input => request('realmWorldCoreList', input ?? {}),
      create: input => request('realmWorldCoreCreate', input),
      getCreationEligibility: () => request('realmWorldCreationEligibilityGet'),
      get: worldId => request('realmWorldCoreGet', {worldId}),
      replace: (worldId, body) => request('realmWorldCoreReplace', {worldId, body}),
      listCharacters: (worldId, input) => request('realmWorldCharacterList', {worldId, ...input}),
      getCharacter: characterId => request('realmWorldCharacterGet', {characterId}),
      createCharacter: (worldId, body) => request('realmWorldCharacterCreate', {worldId, body}),
      replaceCharacter: (characterId, body) => request('realmWorldCharacterReplace', {characterId, body}),
      listEntities: (worldId, input) => request('realmWorldEntityList', {worldId, ...input}),
      getEntity: entityId => request('realmWorldEntityGet', {entityId}),
      createEntity: (worldId, body) => request('realmWorldEntityCreate', {worldId, body}),
      listRelationships: (worldId, input) => request('realmWorldRelationshipList', {worldId, ...input}),
      getRelationship: relationshipId => request('realmWorldRelationshipGet', {relationshipId}),
    }) }),
    integration: createNimiLocalAppIntegrationClient({
      listCatalog: () => request('integrationListCatalog'),
      listConnections: () => request('integrationListConnections'),
      invoke: input => request('integrationInvoke', input),
      getCall: input => request('integrationGetCall', input),
      listCalls: input => request('integrationListCalls', input),
      cancelCall: input => request('integrationCancelCall', input),
      registerProvider: input => request('integrationRegisterProvider', input),
      unregisterProvider: input => request('integrationUnregisterProvider', input),
      pollProvider: input => request('integrationPollProvider', input),
      completeProvider: input => request('integrationCompleteProvider', input),
      getManagement: () => request('integrationGetManagement'),
      putConnection: input => request('integrationPutConnection', input),
      removeConnection: input => request('integrationRemoveConnection', input),
      setPermission: input => request('integrationSetPermission', input),
    }),
    aiConfig: createNimiLocalAppAIConfigClient({
      get: () => request('aiConfigGet'),
      overwrite: (input) => request('aiConfigOverwrite', input),
      listOptions: (input) => request('aiConfigLocalOptions', input),
    }),
    storage: Object.freeze({
      ...createNimiAppRuntimeStorageClient({
        readJson: (relativePath) => request('storageReadJson', { relativePath }),
        writeJson: (relativePath, value) => request('storageWriteJson', { relativePath, value }),
        removeJson: (relativePath) => request('storageRemoveJson', { relativePath }),
      }),
      assets,
    }),
  });
  const invalidate = () => {
    generation++;
    const pending = [...resources];
    resources.clear();
    void Promise.allSettled(pending.map((cancel) => cancel()));
  };
  return { services, invalidate, close: () => { closed = true; invalidate(); } };
}

async function* assetChunks(body: NimiLocalAppAssetBody): AsyncIterable<Uint8Array> {
  if (body instanceof Blob) {
    const reader = body.stream().getReader();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) return;
        yield* assetChunks(next.value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  }
  const source = body instanceof Uint8Array ? [body] : body;
  for await (const chunk of source) {
    if (!(chunk instanceof Uint8Array)) throw new NimiElectronLocalAppHostError('invalid-input', false);
    for (let offset = 0; offset < chunk.byteLength; offset += 1024 * 1024) {
      yield chunk.subarray(offset, offset + 1024 * 1024);
    }
  }
}
