import {
  createNimiAgentRealtimeRuntimeClient,
  createNimiAiRealtimeRuntimeClient,
  createNimiLocalAppAIConsumptionRuntimeClient,
  createNimiLocalAppAgentConfigureRuntimeShell,
  createNimiLocalAppAgentReferencesRuntimeClient,
  createNimiLocalAppConversationRuntimeClient,
  createNimiLocalAppEmbodimentRuntimeClient,
  createNimiLocalAppVoiceAssetsRuntimeClient,
  createNimiRealmChatRuntimeClient,
  createNimiRealmRealtimeRuntimeClient,
  createNimiLocalAppAIConfigRuntimeClient,
  createNimiHostRuntimeTypedClient,
  AccountReasonCode,
  FinishReason,
  LocalAppSessionState,
  RuntimeReasonCode as ReasonCode,
  getRuntimeWireCodec,
  type LocalAppAssetRecord,
  type OpenLocalAppSessionResponse,
  type ReadLocalAppAssetResponse,
  type WriteLocalAppAssetRequest,
  type WriteLocalAppAssetResponse,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  NimiElectronDesktopControlHostError,
  type NimiElectronDesktopControlHost,
} from './desktop-control-host.js';
import {
  NimiElectronLocalAppHostError,
  type NimiElectronLocalAppHost,
  type NimiElectronLocalAppRecord,
} from './local-app-host.js';
import type { RuntimeGrpcBridgeStream } from './types.js';

type FormalAppProfile = 'desktop' | 'avatar';
type RuntimeCallOptions = Readonly<{ signal?: AbortSignal; timeoutMs?: number }>;
type PullStream = Readonly<{
  iterator: AsyncIterator<unknown>;
  cancel: () => Promise<void>;
}>;
type FormalAssetRead = Readonly<{
  iterator: AsyncIterator<ReadLocalAppAssetResponse>;
  cancel: () => void;
}>;
type FormalAssetWrite = {
  readonly relativePath: string;
  readonly mediaType: string;
  readonly overwrite: boolean;
  readonly chunks: Uint8Array[];
  totalBytes: number;
};

// Host-only composition: renderer code receives the same local-app standard
// commands as every ordinary App. The profile transport never becomes a
// renderer Runtime proxy or a second product client.
export function createNimiElectronFormalAppLocalHost(input: {
  readonly appId: 'nimi.desktop' | 'nimi.avatar';
  readonly profile: FormalAppProfile;
  readonly control: NimiElectronDesktopControlHost;
  readonly revealInOs?: (path: string) => Promise<void> | void;
}): NimiElectronLocalAppHost {
  const runtime = createNimiHostRuntimeTypedClient(profileTransport(input.control, input.profile));
  const agents = createNimiLocalAppAgentReferencesRuntimeClient(runtime);
  const conversation = createNimiLocalAppConversationRuntimeClient(runtime);
  const embodiment = createNimiLocalAppEmbodimentRuntimeClient(runtime);
  const agentRealtime = createNimiAgentRealtimeRuntimeClient(runtime);
  const aiRealtime = createNimiAiRealtimeRuntimeClient(runtime);
  const realmChat = createNimiRealmChatRuntimeClient(runtime);
  const realmRealtime = createNimiRealmRealtimeRuntimeClient(runtime);
  const configure = createNimiLocalAppAgentConfigureRuntimeShell(runtime);
  const voiceAssets = createNimiLocalAppVoiceAssetsRuntimeClient(runtime);
  const ai = createNimiLocalAppAIConsumptionRuntimeClient(runtime);
  const aiConfig = createNimiLocalAppAIConfigRuntimeClient({ appId: input.appId, runtime });
  const pullStreams = new Map<string, PullStream>();
  const assetReads = new Map<string, FormalAssetRead>();
  const assetWrites = new Map<string, FormalAssetWrite>();
  let streamSequence = 0;
  let assetSequence = 0;
  const openFormalSession = (): Promise<NimiElectronLocalAppRecord> =>
    runtime.openLocalAppSession({}).then(projectFormalSession);

  const openPullStream = (source: AsyncIterable<unknown> & { readonly cancel: () => Promise<void> }) => {
    const streamId = `formal-app-stream-${++streamSequence}`;
    pullStreams.set(streamId, { iterator: source[Symbol.asyncIterator](), cancel: source.cancel });
    return { streamId };
  };
  const nextPullStream = async (record: NimiElectronLocalAppRecord): Promise<NimiElectronLocalAppRecord> => {
    const streamId = requiredText(record.streamId);
    const stream = pullStreams.get(streamId);
    if (!stream) throw new NimiElectronLocalAppHostError('not-found', false);
    const next = await stream.iterator.next();
    if (next.done) {
      pullStreams.delete(streamId);
      return { completed: true };
    }
    return { completed: false, event: jsonProjection(next.value) };
  };
  const closePullStream = async (record: NimiElectronLocalAppRecord) => {
    const streamId = requiredText(record.streamId);
    const stream = pullStreams.get(streamId);
    pullStreams.delete(streamId);
    await stream?.cancel();
    return { closed: Boolean(stream) };
  };

  const implemented: NimiElectronLocalAppHost = {
    async sessionStatus() {
      return openFormalSession();
    },
    async renewTechnicalSession() {
      return projectFormalSession(await runtime.renewLocalAppSession({}));
    },
    aiConfigGet: () => aiConfig.get() as Promise<NimiElectronLocalAppRecord>,
    aiConfigOverwrite: (record) => aiConfig.overwrite(record as never) as Promise<NimiElectronLocalAppRecord>,
    aiConfigLocalOptions: (record) => aiConfig.listOptions(record as never) as Promise<NimiElectronLocalAppRecord>,
    async textGenerateCandidate(record) {
      const response = await runtime.generateLocalAppTextCandidate(record as never);
      return {
        text: response.text,
        finishReason: finishReason(response.finishReason),
        traceId: response.traceId,
      };
    },
    textTurnSubscribe: async (record) => openPullStream(await ai.text.streamTurn(record as never)),
    textTurnStreamNext: nextPullStream,
    textTurnStreamClose: closePullStream,
    scenarioExecute: (record) => ai.scenario.execute(record.spec as never) as Promise<NimiElectronLocalAppRecord>,
    scenarioJobSubmit: (record) => ai.scenarioJobs.submit(
      record.spec as never,
      { timeoutMs: Number(record.timeoutMs ?? 0) },
    ) as Promise<NimiElectronLocalAppRecord>,
    scenarioJobGet: (record) => ai.scenarioJobs.get(requiredText(record.jobId)) as Promise<NimiElectronLocalAppRecord>,
    scenarioJobSubscribe: async (record) => openPullStream(await ai.scenarioJobs.subscribe(requiredText(record.jobId))),
    scenarioJobStreamNext: nextPullStream,
    scenarioJobStreamClose: closePullStream,
    scenarioJobCancel: (record) => ai.scenarioJobs.cancel(
      requiredText(record.jobId),
      typeof record.reason === 'string' ? record.reason : '',
    ) as Promise<NimiElectronLocalAppRecord>,
    artifactRead: async (record) => {
      const result = await ai.artifacts.read(requiredText(record.artifactId));
      return { ...result, bytes: Array.from(result.bytes) };
    },
    artifactUpload: (record) => ai.artifacts.upload({
      bytes: Uint8Array.from(record.bytes as readonly number[]),
      mimeType: requiredText(record.mimeType) as never,
    }) as Promise<NimiElectronLocalAppRecord>,
    voiceAssetsList: (record) => voiceAssets.list(record as never) as Promise<NimiElectronLocalAppRecord>,
    async storageReadJson(record) {
      const response = await runtime.readLocalAppStorageJson({ relativePath: requiredText(record.relativePath) });
      return storageDocument(response.jsonValue, response.sizeBytes);
    },
    async storageWriteJson(record) {
      const response = await runtime.writeLocalAppStorageJson({
        relativePath: requiredText(record.relativePath),
        jsonValue: new TextEncoder().encode(JSON.stringify(record.value)),
      });
      return storageDocument(response.jsonValue, response.sizeBytes);
    },
    async storageRemoveJson(record) {
      const response = await runtime.removeLocalAppStorageJson({ relativePath: requiredText(record.relativePath) });
      return { removed: response.removed };
    },
    async assetStat(record) {
      const response = await runtime.statLocalAppAsset({ relativePath: requiredText(record.relativePath) });
      return projectFormalAsset(requiredAsset(response.asset));
    },
    async assetList(record) {
      const response = await runtime.listLocalAppAssets({
        prefix: typeof record.prefix === 'string' ? record.prefix : '',
        cursor: typeof record.cursor === 'string' ? record.cursor : '',
        pageSize: Number(record.pageSize ?? 0),
      });
      return {
        assets: response.assets.map(projectFormalAsset),
        nextCursor: response.nextCursor,
      };
    },
    async assetWriteOpen(record) {
      const streamId = `formal-app-asset-write-${++assetSequence}`;
      assetWrites.set(streamId, {
        relativePath: requiredText(record.relativePath),
        mediaType: typeof record.mediaType === 'string' ? record.mediaType : '',
        overwrite: record.overwrite === true,
        chunks: [],
        totalBytes: 0,
      });
      return { streamId };
    },
    async assetWriteChunk(record) {
      const streamId = requiredText(record.streamId);
      const stream = assetWrites.get(streamId);
      if (!stream || !(record.bodyChunk instanceof Uint8Array)) {
        throw new NimiElectronLocalAppHostError('not-found', false);
      }
      const chunk = Uint8Array.from(record.bodyChunk);
      stream.totalBytes += chunk.byteLength;
      if (!Number.isSafeInteger(stream.totalBytes) || stream.totalBytes > 64 * 1024 * 1024) {
        assetWrites.delete(streamId);
        throw new NimiElectronLocalAppHostError('resource-exhausted', false);
      }
      stream.chunks.push(chunk);
      return { accepted: true };
    },
    async assetWriteCommit(record) {
      const streamId = requiredText(record.streamId);
      const stream = assetWrites.get(streamId);
      assetWrites.delete(streamId);
      if (!stream || stream.chunks.length === 0) {
        throw new NimiElectronLocalAppHostError('not-found', false);
      }
      const frames: WriteLocalAppAssetRequest[] = [
        {
          frame: {
            oneofKind: 'metadata',
            metadata: {
              relativePath: stream.relativePath,
              mediaType: stream.mediaType,
              overwrite: stream.overwrite,
            },
          },
        },
        ...stream.chunks.map((bodyChunk) => ({
          frame: { oneofKind: 'bodyChunk' as const, bodyChunk },
        })),
      ];
      const response = await writeFormalAsset(input.control, input.profile, frames);
      return projectFormalAsset(requiredAsset(response.asset));
    },
    async assetWriteAbort(record) {
      return { closed: assetWrites.delete(requiredText(record.streamId)) };
    },
    async assetReadOpen(record) {
      const controller = new AbortController();
      const source = runtime.readLocalAppAsset({
        relativePath: requiredText(record.relativePath),
        ...(record.offset === undefined ? {} : { offset: String(record.offset) }),
        ...(record.length === undefined ? {} : { length: String(record.length) }),
      }, { signal: controller.signal });
      const iterator = source[Symbol.asyncIterator]();
      const first = await iterator.next();
      if (first.done || first.value.frame.oneofKind !== 'metadata') {
        controller.abort();
        throw new NimiElectronLocalAppHostError('contract-invalid', false);
      }
      const metadata = first.value.frame.metadata;
      const asset = projectFormalAsset(requiredAsset(metadata.asset));
      const range = metadata.range;
      if (!range) {
        controller.abort();
        throw new NimiElectronLocalAppHostError('contract-invalid', false);
      }
      const streamId = `formal-app-asset-read-${++assetSequence}`;
      assetReads.set(streamId, { iterator, cancel: () => controller.abort() });
      return {
        streamId,
        asset,
        range: {
          offset: safeFormalInteger(range.offset),
          length: safeFormalInteger(range.length),
          totalSize: safeFormalInteger(range.totalSize),
        },
      };
    },
    async assetReadNext(record) {
      const streamId = requiredText(record.streamId);
      const stream = assetReads.get(streamId);
      if (!stream) throw new NimiElectronLocalAppHostError('not-found', false);
      const next = await stream.iterator.next();
      if (next.done) {
        assetReads.delete(streamId);
        return { completed: true };
      }
      if (next.value.frame.oneofKind !== 'bodyChunk' || next.value.frame.bodyChunk.byteLength === 0) {
        assetReads.delete(streamId);
        stream.cancel();
        throw new NimiElectronLocalAppHostError('contract-invalid', false);
      }
      return { completed: false, bodyChunk: Uint8Array.from(next.value.frame.bodyChunk) };
    },
    async assetReadClose(record) {
      const streamId = requiredText(record.streamId);
      const stream = assetReads.get(streamId);
      assetReads.delete(streamId);
      stream?.cancel();
      return { closed: Boolean(stream) };
    },
    async assetRemove(record) {
      const response = await runtime.removeLocalAppAsset({ relativePath: requiredText(record.relativePath) });
      return { removed: response.removed };
    },
    async assetMove(record) {
      const response = await runtime.moveLocalAppAsset({
        fromRelativePath: requiredText(record.fromRelativePath),
        toRelativePath: requiredText(record.toRelativePath),
        overwrite: record.overwrite === true,
      });
      return projectFormalAsset(requiredAsset(response.asset));
    },
    async assetReveal(record) {
      if (!input.revealInOs) throw new NimiElectronLocalAppHostError('capability-unavailable', false);
      const response = await runtime.revealLocalAppAsset({ relativePath: requiredText(record.relativePath) });
      requiredAsset(response.asset);
      const absolutePath = requiredText(response.absolutePath);
      await input.revealInOs(absolutePath);
      return { revealed: true };
    },
    async assetAdopt(record) {
      const response = await runtime.adoptLocalAppArtifact({
        artifactId: requiredText(record.artifactId),
        relativePath: requiredText(record.relativePath),
        overwrite: record.overwrite === true,
      });
      return projectFormalAsset(requiredAsset(response.asset));
    },
    realmWorldCoreList: async (record) => {
      const query: Record<string, NimiElectronLocalAppRecord[string]> = {};
      if (record.take !== undefined) query.take = record.take;
      if (record.visibility !== undefined) query.visibility = record.visibility;
      const value = await invokeFormalRealm(runtime, 'WorldCoreController_listWorldCores', {
        path: {}, query,
      });
      if (!Array.isArray(value)) throw new NimiElectronLocalAppHostError('contract-invalid', false);
      return value as readonly NimiElectronLocalAppRecord[];
    },
    realmWorldCoreCreate: (record) => invokeFormalRealm(
      runtime,
      'WorldCoreController_createWorldCore',
      { path: {}, query: {}, body: record },
    ) as Promise<NimiElectronLocalAppRecord>,
    realmPersonaCharacterListOwned: async (record) => {
      const query: Record<string, NimiElectronLocalAppRecord[string]> = { scope: 'owned' };
      for (const field of ['worldId', 'visibility', 'afterId', 'take'] as const) {
        if (record[field] !== undefined) query[field] = record[field];
      }
      const value = await invokeFormalRealm(runtime, 'WorldCoreController_listPersonaCharacters', {
        path: {}, query,
      });
      if (!Array.isArray(value)) throw new NimiElectronLocalAppHostError('contract-invalid', false);
      return value as readonly NimiElectronLocalAppRecord[];
    },
    realmPersonaCharacterGetOwned: (record) => invokeFormalRealm(
      runtime,
      'WorldCoreController_getPersonaCharacter',
      { path: { personaCharacterId: requiredText(record.personaCharacterId) }, query: {} },
    ) as Promise<NimiElectronLocalAppRecord>,
    realmPersonaCharacterCreate: (record) => invokeFormalRealm(
      runtime,
      'WorldCoreController_createPersonaCharacter',
      { path: {}, query: {}, body: record },
    ) as Promise<NimiElectronLocalAppRecord>,
    realmPersonaCharacterReplace: (record) => invokeFormalRealm(
      runtime,
      'WorldCoreController_replacePersonaCharacter',
      {
        path: { personaCharacterId: requiredText(record.personaCharacterId) },
        query: {},
        body: record.body as NimiElectronLocalAppRecord,
      },
    ) as Promise<NimiElectronLocalAppRecord>,
    realmPersonaCharacterDelete: (record) => invokeFormalRealm(
      runtime,
      'WorldCoreController_deletePersonaCharacter',
      { path: { personaCharacterId: requiredText(record.personaCharacterId) }, query: {} },
    ) as Promise<NimiElectronLocalAppRecord>,
    realmChatList: (record) => realmChat.list(record as never) as Promise<NimiElectronLocalAppRecord>,
    realmRealtimeOpen: () => realmRealtime.open() as Promise<NimiElectronLocalAppRecord>,
    realmRealtimeSubscribe: async (record) => openPullStream(await realmRealtime.subscribe(record as never)),
    realmRealtimeAck: (record) => realmRealtime.ack(record as never) as Promise<NimiElectronLocalAppRecord>,
    realmRealtimeSubscriptionClose: (record) => realmRealtime.closeSubscription(record as never) as Promise<NimiElectronLocalAppRecord>,
    realmRealtimeChannelClose: (record) => realmRealtime.closeChannel(record as never) as Promise<NimiElectronLocalAppRecord>,
    agentReferenceList: () => agents.listReferences() as Promise<readonly NimiElectronLocalAppRecord[]>,
    conversationOpen: (record) => conversation.open(record as never) as Promise<NimiElectronLocalAppRecord>,
    conversationSendTurn: (record) => conversation.send(record as never) as Promise<NimiElectronLocalAppRecord>,
    conversationAttachmentUpload: (record) => conversation.uploadAttachment(record as never) as Promise<NimiElectronLocalAppRecord>,
    conversationArtifactRead: async (record) => {
      const result = await conversation.readArtifact(record as never);
      return { ...result, bytes: Array.from(result.bytes) };
    },
    conversationVoiceTranscribe: (record) => conversation.transcribeVoice(record as never) as Promise<NimiElectronLocalAppRecord>,
    conversationVoiceRender: (record) => conversation.renderVoice(record as never) as Promise<NimiElectronLocalAppRecord>,
    conversationInterruptTurn: (record) => conversation.interruptTurn(record as never) as Promise<NimiElectronLocalAppRecord>,
    conversationSubscribe: async (record) => openPullStream(await conversation.subscribe(record as never)),
    conversationStreamNext: nextPullStream,
    conversationStreamClose: closePullStream,
    conversationSnapshot: (record) => conversation.snapshot(record as never) as Promise<NimiElectronLocalAppRecord>,
    embodimentSnapshot: (record) => embodiment.snapshot(record as never) as Promise<NimiElectronLocalAppRecord>,
    embodimentSubscribe: async (record) => openPullStream(await embodiment.subscribe(record as never)),
    aiRealtimeOpen: (record) => aiRealtime.open(record as never) as Promise<NimiElectronLocalAppRecord>,
    aiRealtimeAppendInput: (record) => aiRealtime.appendInput(record as never) as Promise<NimiElectronLocalAppRecord>,
    aiRealtimeSubmitOwnerControl: (record) => aiRealtime.submitOwnerControl(record as never) as Promise<NimiElectronLocalAppRecord>,
    aiRealtimeSubscribe: async (record) => openPullStream(await aiRealtime.subscribe(record as never)),
    aiRealtimeInterruptOutput: (record) => aiRealtime.interruptOutput(record as never) as Promise<NimiElectronLocalAppRecord>,
    aiRealtimeClose: (record) => aiRealtime.close(record as never) as Promise<NimiElectronLocalAppRecord>,
    agentRealtimeOpen: (record) => agentRealtime.open(record as never) as Promise<NimiElectronLocalAppRecord>,
    agentRealtimeAppendInput: (record) => agentRealtime.appendInput(record as never) as Promise<NimiElectronLocalAppRecord>,
    agentRealtimeSubscribe: async (record) => openPullStream(await agentRealtime.subscribe(record as never)),
    agentRealtimeStatus: (record) => agentRealtime.status(record as never) as Promise<NimiElectronLocalAppRecord>,
    agentRealtimeInterruptOutput: (record) => agentRealtime.interruptOutput(record as never) as Promise<NimiElectronLocalAppRecord>,
    agentRealtimeClose: (record) => agentRealtime.close(record as never) as Promise<NimiElectronLocalAppRecord>,
    realtimeStreamNext: nextPullStream,
    realtimeStreamClose: closePullStream,
    sharedAgentAIConfigGet: () => configure.sharedAIConfig.get() as Promise<NimiElectronLocalAppRecord>,
    sharedAgentAIConfigOverwrite: (record) => configure.sharedAIConfig.overwrite(record as never) as Promise<NimiElectronLocalAppRecord>,
    sharedAgentAIConfigLocalOptions: (record) => configure.sharedAIConfig.listOptions(record as never) as Promise<NimiElectronLocalAppRecord>,
    agentManagerSnapshot: (record) => configure.manager.snapshot(record as never) as Promise<NimiElectronLocalAppRecord>,
    agentAutonomySnapshot: (record) => configure.autonomy.snapshot(record as never) as Promise<NimiElectronLocalAppRecord>,
    agentUpdateAutonomy: (record) => configure.autonomy.update(record as never) as Promise<NimiElectronLocalAppRecord>,
    agentPresentationSnapshot: (record) => configure.presentation.snapshot(record as never) as Promise<NimiElectronLocalAppRecord>,
    agentPresentationReadAsset: (record) => configure.presentation.readAsset(record as never) as unknown as Promise<NimiElectronLocalAppRecord>,
    agentCommitPresentation: (record) => configure.presentation.commit(record as never) as Promise<NimiElectronLocalAppRecord>,
    agentMemoryInspect: (record) => configure.memory.inspect(record as never) as Promise<NimiElectronLocalAppRecord>,
    agentMemoryCorrect: (record) => configure.memory.correct(record as never) as Promise<NimiElectronLocalAppRecord>,
    agentMemoryForget: (record) => configure.memory.forget(record as never) as Promise<NimiElectronLocalAppRecord>,
    agentMemorySwitch: (record) => configure.memory.setEnabled(record as never) as Promise<NimiElectronLocalAppRecord>,
    agentMemoryDelete: (record) => configure.memory.deleteAll(record as never) as Promise<NimiElectronLocalAppRecord>,
  };

  return wrapFormalHost(implemented);
}

function wrapFormalHost(
  host: NimiElectronLocalAppHost,
): NimiElectronLocalAppHost {
  return Object.freeze(Object.fromEntries(
    Object.entries(host).map(([name, operation]) => [
      name,
      (...args: unknown[]) => formalCall(async () => {
        return Promise.resolve(Reflect.apply(operation, host, args));
      }),
    ]),
  )) as NimiElectronLocalAppHost;
}

function profileTransport(
  control: NimiElectronDesktopControlHost,
  profile: FormalAppProfile,
): Parameters<typeof createNimiHostRuntimeTypedClient>[0] {
  const unary = profile === 'avatar'
    ? (request: Parameters<NimiElectronDesktopControlHost['bundledAvatarUnary']>[0]) => control.bundledAvatarUnary(request)
    : (request: Parameters<NimiElectronDesktopControlHost['accountProductUnary']>[0]) => control.accountProductUnary(request);
  const serverStream = profile === 'avatar'
    ? (request: Parameters<NimiElectronDesktopControlHost['bundledAvatarServerStream']>[0]) => control.bundledAvatarServerStream(request)
    : (request: Parameters<NimiElectronDesktopControlHost['accountProductServerStream']>[0]) => control.accountProductServerStream(request);
  return {
    async unary(request) {
      const codec = getRuntimeWireCodec(request.methodId);
      const response = await unary({
        methodId: request.methodId,
        requestBytes: codec.encodeRequest(request.body),
        timeoutMs: request.timeoutMs,
        signal: request.signal,
      });
      return codec.decodeResponse(response) as never;
    },
    serverStream(request) {
      const codec = getRuntimeWireCodec(request.methodId);
      const stream = serverStream({
        methodId: request.methodId,
        requestBytes: codec.encodeRequest(request.body),
        timeoutMs: request.timeoutMs,
      });
      return decodeServerStream(stream, codec.decodeResponse, request.signal) as never;
    },
  };
}

async function* decodeServerStream(
  stream: RuntimeGrpcBridgeStream,
  decode: (bytes: Uint8Array) => unknown,
  signal?: AbortSignal,
): AsyncIterable<unknown> {
  const queue: Array<{ value?: Uint8Array; error?: unknown; done?: true }> = [];
  let wake: (() => void) | undefined;
  const push = (entry: { value?: Uint8Array; error?: unknown; done?: true }) => {
    queue.push(entry);
    wake?.();
    wake = undefined;
  };
  stream.start({
    onData: (value) => push({ value }),
    onError: (error) => push({ error }),
    onEnd: () => push({ done: true }),
  });
  const abort = () => stream.cancel();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (queue.length === 0) await new Promise<void>((resolve) => { wake = resolve; });
      const next = queue.shift();
      if (!next) continue;
      if (next.error) throw next.error;
      if (next.done) return;
      if (next.value) yield decode(next.value);
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    stream.cancel();
  }
}

async function writeFormalAsset(
  control: NimiElectronDesktopControlHost,
  profile: FormalAppProfile,
  frames: readonly WriteLocalAppAssetRequest[],
): Promise<WriteLocalAppAssetResponse> {
  const methodId = '/nimi.runtime.v1.RuntimeAppService/WriteLocalAppAsset';
  const codec = getRuntimeWireCodec(methodId);
  const requestFrames = frames.map((frame) => codec.encodeRequest(frame));
  const response = profile === 'avatar'
    ? await control.bundledAvatarClientStream({ methodId, requestFrames, timeoutMs: 120_000 })
    : await control.accountProductClientStream({ methodId, requestFrames, timeoutMs: 120_000 });
  return codec.decodeResponse(response) as WriteLocalAppAssetResponse;
}

function requiredAsset(value: LocalAppAssetRecord | undefined): LocalAppAssetRecord {
  if (!value) throw new NimiElectronLocalAppHostError('contract-invalid', false);
  return value;
}

function projectFormalAsset(asset: LocalAppAssetRecord): NimiElectronLocalAppRecord {
  return {
    relativePath: asset.relativePath,
    mediaType: asset.mediaType || null,
    sizeBytes: safeFormalInteger(asset.sizeBytes),
    sha256: asset.sha256,
    createdAt: formalTimestamp(asset.createdAt),
    updatedAt: formalTimestamp(asset.updatedAt),
  };
}

function safeFormalInteger(value: unknown): number {
  const number = typeof value === 'string' && /^(0|[1-9][0-9]*)$/u.test(value)
    ? Number(value)
    : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0) {
    throw new NimiElectronLocalAppHostError('contract-invalid', false);
  }
  return number;
}

function formalTimestamp(
  value: { readonly seconds: string; readonly nanos: number } | undefined,
): string {
  if (!value || !/^-?(0|[1-9][0-9]*)$/u.test(value.seconds)
    || !Number.isInteger(value.nanos) || value.nanos < 0 || value.nanos >= 1_000_000_000) {
    throw new NimiElectronLocalAppHostError('contract-invalid', false);
  }
  const milliseconds = Number(BigInt(value.seconds) * 1_000n + BigInt(Math.floor(value.nanos / 1_000_000)));
  if (!Number.isSafeInteger(milliseconds)) {
    throw new NimiElectronLocalAppHostError('contract-invalid', false);
  }
  const projected = new Date(milliseconds);
  if (!Number.isFinite(projected.valueOf())) {
    throw new NimiElectronLocalAppHostError('contract-invalid', false);
  }
  return projected.toISOString();
}

async function invokeFormalRealm(
  runtime: Pick<ReturnType<typeof createNimiHostRuntimeTypedClient>, 'invokeRealmUnary'>,
  methodId: string,
  request: NimiElectronLocalAppRecord,
): Promise<NimiElectronLocalAppRecord[string] | readonly NimiElectronLocalAppRecord[]> {
  const response = await runtime.invokeRealmUnary({
    methodId,
    realmBaseUrl: '',
    requestJson: JSON.stringify(request),
    timeoutMs: 30_000,
  });
  if (!response.accepted) {
    throw new NimiElectronLocalAppHostError(
      formalRealmReason(response.reasonCode, response.accountReasonCode),
      response.reasonCode === ReasonCode.REALM_UNAVAILABLE
        || response.reasonCode === ReasonCode.REALM_RATE_LIMITED
        || response.reasonCode === ReasonCode.REALM_OPERATION_FAILED,
    );
  }
  if (response.reasonCode !== ReasonCode.ACTION_EXECUTED
    || response.accountReasonCode !== AccountReasonCode.ACTION_EXECUTED
    || response.productionInert
    || response.httpStatus < 200
    || response.httpStatus >= 300
    || response.errorMessage) {
    throw new NimiElectronLocalAppHostError('contract-invalid', false);
  }
  try {
    return jsonProjection(JSON.parse(response.responseJson || '{}')) as
      NimiElectronLocalAppRecord[string] | readonly NimiElectronLocalAppRecord[];
  } catch (error) {
    if (error instanceof NimiElectronLocalAppHostError) throw error;
    throw new NimiElectronLocalAppHostError('contract-invalid', false);
  }
}

function formalRealmReason(reason: ReasonCode, accountReason: AccountReasonCode): string {
  if (reason === ReasonCode.LOCAL_APP_OPERATION_UNAVAILABLE
    || reason === ReasonCode.LOCAL_APP_OPERATION_UNSUPPORTED) return 'capability-unavailable';
  if (reason === ReasonCode.PROTOCOL_ENVELOPE_INVALID
    || reason === ReasonCode.REALM_REQUEST_REJECTED) return 'invalid-input';
  if (reason === ReasonCode.APP_MESSAGE_PAYLOAD_TOO_LARGE) return 'request-too-large';
  if (reason === ReasonCode.AUTH_TOKEN_INVALID
    || reason === ReasonCode.LOCAL_APP_PROCESS_MISMATCH
    || reason === ReasonCode.LOCAL_APP_SESSION_REVOKED
    || reason === ReasonCode.LOCAL_APP_ACCOUNT_CHANGED
    || reason === ReasonCode.LOCAL_APP_SNAPSHOT_UNAVAILABLE) return 'session-invalid';
  if (reason === ReasonCode.PRINCIPAL_UNAUTHORIZED
    || reason === ReasonCode.APP_SCOPE_FORBIDDEN
    || reason === ReasonCode.LOCAL_APP_ACCESS_DENIED) return 'access-denied';
  if (reason === ReasonCode.LOCAL_APP_OWNER_UNAVAILABLE) return 'owner-authority-missing';
  if (reason === ReasonCode.REALM_NOT_FOUND) return 'not-found';
  if (reason === ReasonCode.REALM_CONFLICT) return 'content-conflict';
  if (reason === ReasonCode.REALM_RATE_LIMITED) return 'rate-limited';
  if (reason === ReasonCode.REALM_CONTRACT_INVALID) {
    return accountReason === AccountReasonCode.BROKER_RESPONSE_TOO_LARGE
      ? 'response-too-large'
      : 'contract-invalid';
  }
  if (reason === ReasonCode.REALM_UNAVAILABLE) return 'realm-unavailable';
  if (reason === ReasonCode.REALM_OPERATION_FAILED) return 'upstream-failed';
  return 'runtime-service-untrusted';
}

async function formalCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof NimiElectronLocalAppHostError) throw error;
    if (error instanceof NimiElectronDesktopControlHostError) {
      throw new NimiElectronLocalAppHostError(error.reasonCode, error.retryable, error.reasonMetadata);
    }
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    const reasonCode = typeof record.reasonCode === 'string' ? record.reasonCode : 'runtime-service-untrusted';
    const retryable = typeof record.retryable === 'boolean' ? record.retryable : false;
    const message = typeof record.message === 'string' ? record.message : '';
    const projectionMatch = reasonCode === 'SDK_LOCAL_APP_PROJECTION_INVALID'
      ? /^Host-injected local-app carrier returned an invalid ([A-Za-z0-9 ._-]{1,120}) projection\.$/u.exec(message)
      : null;
    throw new NimiElectronLocalAppHostError(
      reasonCode,
      retryable,
      projectionMatch ? { projection: projectionMatch[1] } : {},
    );
  }
}

function projectFormalSession(response: OpenLocalAppSessionResponse): NimiElectronLocalAppRecord {
  if (response.state !== LocalAppSessionState.READY || response.reasonCode !== ReasonCode.ACTION_EXECUTED) {
    throw new NimiElectronLocalAppHostError('contract-invalid', false);
  }
  if (response.currentUser && response.currentUserReasonCode === ReasonCode.ACTION_EXECUTED) {
    return {
      state: 'ready',
      reasonCode: 'action-executed',
      retryable: false,
      currentUser: {
        state: 'ready',
        value: {
          handle: requiredText(response.currentUser.handle),
          displayName: requiredText(response.currentUser.displayName),
          avatarUrl: response.currentUser.avatarUrl ?? null,
        },
        reasonCode: 'action-executed',
        retryable: false,
      },
    };
  }
  if (!response.currentUser
    && response.currentUserReasonCode === ReasonCode.CURRENT_USER_DISPLAY_UNAVAILABLE) {
    return {
      state: 'ready',
      reasonCode: 'action-executed',
      retryable: false,
      currentUser: {
        state: 'unavailable',
        value: null,
        reasonCode: 'current-user-display-unavailable',
        retryable: true,
      },
    };
  }
  throw new NimiElectronLocalAppHostError('contract-invalid', false);
}

function storageDocument(bytes: Uint8Array, size: string): NimiElectronLocalAppRecord {
  return {
    value: JSON.parse(new TextDecoder().decode(bytes)) as NimiElectronLocalAppRecord[string],
    sizeBytes: Number(size),
  };
}

function finishReason(value: FinishReason): 'stop' | 'length' | 'content-filter' {
  if (value === FinishReason.STOP) return 'stop';
  if (value === FinishReason.LENGTH) return 'length';
  if (value === FinishReason.CONTENT_FILTER) return 'content-filter';
  throw new NimiElectronLocalAppHostError('contract-invalid', false);
}

function requiredText(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new NimiElectronLocalAppHostError('invalid-input', false);
  return normalized;
}

function jsonProjection(value: unknown): NimiElectronLocalAppRecord[string] {
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(jsonProjection);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, jsonProjection(entry)]),
    );
  }
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  throw new NimiElectronLocalAppHostError('contract-invalid', false);
}
