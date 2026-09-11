import {
  createNimiLocalAppAIConsumptionClient,
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
export type NimiElectronAppBusinessServices = Pick<NimiLocalAppClient, 'aiConfig' | 'storage'> & {
  readonly ai: NimiLocalAppAIConsumptionClient;
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
    open: 'textTurnSubscribe' | 'scenarioJobSubscribe',
    next: 'textTurnStreamNext' | 'scenarioJobStreamNext',
    close: 'textTurnStreamClose' | 'scenarioJobStreamClose',
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
              if (stopped || result.completed === true) return;
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
  const ai = createNimiLocalAppAIConsumptionClient({
    text: { streamTurn: (input) => stream('textTurnSubscribe', 'textTurnStreamNext', 'textTurnStreamClose', input) },
    scenario: { execute: (spec) => request('scenarioExecute', { spec }) },
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
    move: (input) => request('assetMove', { from: input.from, to: input.to, overwrite: input.overwrite ?? false }),
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
                if (stopped || result.completed === true) return;
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
