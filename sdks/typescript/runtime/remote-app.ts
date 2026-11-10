import { FinishReason, type RuntimeTypedClient } from '../core-generated/runtime-typed-client.js';
import type { LocalAppAssetRecord, WriteLocalAppAssetRequest } from '../core-generated/runtime-protobuf/runtime/v1/app.js';
import { createNimiError } from '../types/index.js';
import { createTextCandidateClient } from '../core/app/local-app-text-candidate.js';
import { createNimiLocalAppAIConsumptionRuntimeClient } from '../core/app/local-app-runtime-platform-ai.js';
import { createNimiLocalAppAIConfigRuntimeClient } from '../core/ai/capability-configuration.js';
import { createNimiAppRuntimeStorageClient } from '../core/app/local-app-runtime-platform-protected-operations.js';
import { createNimiLocalAppAssetsClient, type NimiLocalAppAssetsClient } from '../core/app/local-app-runtime-platform-assets.js';
import { createNimiLocalAppActivityClient, createNimiLocalAppActivityRuntimeShell } from '../core/app/local-app-runtime-platform-activity.js';
import { isNimiLocalAppByteView } from '../core/app/local-app-bytes.js';
import { createNimiLocalAppAgentReferencesRuntimeClient } from '../core/app/local-app-runtime-platform-agent-references.js';
import { createNimiLocalAppAgentIntroductionRuntimeClient } from '../core/app/local-app-agent-introduction.js';
import { createNimiLocalAppConversationRuntimeClient } from '../core/app/local-app-runtime-platform-direct-conversation.js';
import { createNimiLocalAppEmbodimentRuntimeClient } from '../core/app/local-app-runtime-platform-embodiment.js';
import { createNimiLocalAppAgentConfigureClient, createNimiLocalAppAgentConfigureRuntimeShell } from '../core/app/local-app-runtime-platform-configure.js';
import { createRemoteAppRealmClients } from './remote-realm.js';

// @nimi-authority: rule.nimi.sdks.client-core.remote-runtime-carrier
// These are the same operation clients used by native Apps. The direct carrier
// supplies the verified peer; no Native Host, process or session proof is made up.
export function createRemoteRuntimeAppClients(runtime: RuntimeTypedClient, appId: string) {
  const ai = createNimiLocalAppAIConsumptionRuntimeClient(runtime);
  const candidate = createTextCandidateClient({ generateCandidate: async input => {
    const result = await runtime.generateLocalAppTextCandidate({ ...input, messages: input.messages.map(message => ({ ...message, parts: [], turnItems: [] })) });
    return { text: result.text, traceId: result.traceId,
      finishReason: result.finishReason === FinishReason.STOP ? 'stop'
        : result.finishReason === FinishReason.LENGTH ? 'length'
          : result.finishReason === FinishReason.CONTENT_FILTER ? 'content-filter' : 'invalid' };
  } });
  return Object.freeze({
    ai: Object.freeze({ ...ai, text: Object.freeze({ ...ai.text, ...candidate }) }),
    aiConfig: createNimiLocalAppAIConfigRuntimeClient({ appId, runtime }),
    storage: createRemoteRuntimeStorage(runtime),
    agents: Object.freeze({ ...createNimiLocalAppAgentReferencesRuntimeClient(runtime), ...createNimiLocalAppAgentIntroductionRuntimeClient(runtime) }),
    conversation: createNimiLocalAppConversationRuntimeClient(runtime),
    embodiment: createNimiLocalAppEmbodimentRuntimeClient(runtime),
    activity: createRemoteActivity(runtime),
    realm: createRemoteAppRealmClients(runtime),
    agentConfigure: createNimiLocalAppAgentConfigureClient(createNimiLocalAppAgentConfigureRuntimeShell(runtime)),
  });
}

function createRemoteRuntimeStorage(runtime: RuntimeTypedClient) {
  const document = (result: { jsonValue: Uint8Array; sizeBytes: string }) => {
    try { return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.jsonValue)), sizeBytes: Number(result.sizeBytes) }; }
    catch { throw invalidStorage(); }
  };
  return Object.freeze({
    ...createNimiAppRuntimeStorageClient({
      readJson: async relativePath => document(await runtime.readLocalAppStorageJson({ relativePath })),
      writeJson: async (relativePath, value) => document(await runtime.writeLocalAppStorageJson({ relativePath, jsonValue: new TextEncoder().encode(JSON.stringify(value)) })),
      removeJson: async relativePath => ({ removed: (await runtime.removeLocalAppStorageJson({ relativePath })).removed }),
    }),
    assets: createNimiLocalAppAssetsClient({
      stat: async relativePath => asset((await runtime.statLocalAppAsset({ relativePath })).asset),
      list: async input => {
        const result = await runtime.listLocalAppAssets({ prefix: input.prefix, cursor: input.cursor ?? '', pageSize: input.pageSize ?? 100 });
        return { assets: result.assets.map(asset), nextCursor: result.nextCursor };
      },
      write: async input => asset((await runtime.writeLocalAppAsset(remoteAssetFrames(input))).asset),
      reveal: async () => { throw unsupported('Opening the PC filesystem requires a native Host.'); },
      remove: async relativePath => ({ removed: (await runtime.removeLocalAppAsset({ relativePath })).removed }),
      move: async input => asset((await runtime.moveLocalAppAsset({ fromRelativePath: input.from, toRelativePath: input.to, overwrite: input.overwrite ?? false })).asset),
      adoptArtifact: async input => asset((await runtime.adoptLocalAppArtifact({ ...input, overwrite: input.overwrite ?? false })).asset),
      read: async input => {
        const abort = new AbortController();
        const source = runtime.readLocalAppAsset({ relativePath: input.relativePath,
          ...(input.offset === undefined ? {} : { offset: String(input.offset) }),
          ...(input.length === undefined ? {} : { length: String(input.length) }),
        }, { signal: abort.signal });
        const iterator = source[Symbol.asyncIterator]();
        const close = async () => { abort.abort(); await iterator.return?.(); };
        try {
          const first = await iterator.next();
          if (first.done || first.value.frame.oneofKind !== 'metadata') throw invalidStorage();
          const metadata = first.value.frame.metadata;
          if (!metadata.range) throw invalidStorage();
          const metadataAsset = asset(metadata.asset);
          return { asset: metadataAsset,
            range: { offset: Number(metadata.range.offset), length: Number(metadata.range.length), totalSize: Number(metadata.range.totalSize) },
            body: { [Symbol.asyncIterator]() { return {
              async next(): Promise<IteratorResult<Uint8Array>> {
                try {
                  const next = await iterator.next();
                  if (next.done) { await close(); return { done: true, value: undefined }; }
                  if (next.value.frame.oneofKind !== 'bodyChunk') throw invalidStorage();
                  return { done: false, value: next.value.frame.bodyChunk };
                } catch (error) { await close(); throw error; }
              },
              async return(): Promise<IteratorResult<Uint8Array>> { await close(); return { done: true, value: undefined }; },
            }; } },
          };
        } catch (error) { await close(); throw error; }
      },
    }),
  });
}

async function* remoteAssetFrames(input: Parameters<NimiLocalAppAssetsClient['write']>[0]): AsyncIterable<WriteLocalAppAssetRequest> {
  const target = { relativePath: input.relativePath, mediaType: input.mediaType ?? '' };
  yield { frame: input.expectedSha256 === undefined
    ? { oneofKind: 'metadata', metadata: { ...target, overwrite: input.overwrite ?? false } }
    : { oneofKind: 'replaceMetadata', replaceMetadata: { ...target, expectedSha256: input.expectedSha256 } } };
  const body = input.body;
  const source = body instanceof Uint8Array
    ? (async function* () { if (body.byteLength) yield body; })()
    : typeof Blob !== 'undefined' && body instanceof Blob ? blobChunks(body) : body as AsyncIterable<Uint8Array>;
  let filled = 0, buffer = new Uint8Array(256 * 1024);
  for await (const chunk of source) {
    if (!isNimiLocalAppByteView(chunk) || !chunk.byteLength) throw createNimiError({
      message: 'Asset upload chunks must be non-empty byte arrays.', reasonCode: 'SDK_LOCAL_APP_INPUT_INVALID', source: 'sdk' });
    for (let offset = 0; offset < chunk.byteLength;) {
      const length = Math.min(buffer.byteLength - filled, chunk.byteLength - offset);
      buffer.set(chunk.subarray(offset, offset + length), filled); filled += length; offset += length;
      if (filled === buffer.byteLength) {
        yield { frame: { oneofKind: 'bodyChunk', bodyChunk: buffer } };
        buffer = new Uint8Array(256 * 1024); filled = 0;
      }
    }
  }
  if (filled) yield { frame: { oneofKind: 'bodyChunk', bodyChunk: buffer.subarray(0, filled) } };
}

async function* blobChunks(blob: Blob): AsyncIterable<Uint8Array> {
  const reader = blob.stream().getReader();
  try {
    for (;;) { const next = await reader.read(); if (next.done) return; yield next.value; }
  } finally { await reader.cancel(); reader.releaseLock(); }
}

function asset(value: LocalAppAssetRecord | undefined) {
  if (!value) throw invalidStorage();
  const timestamp = (value: LocalAppAssetRecord['createdAt']) => {
    if (!value || !/^-?(0|[1-9][0-9]*)$/.test(value.seconds) || !Number.isInteger(value.nanos) || value.nanos < 0 || value.nanos >= 1_000_000_000) throw invalidStorage();
    const milliseconds = Number(BigInt(value.seconds) * 1000n + BigInt(Math.floor(value.nanos / 1_000_000)));
    if (!Number.isSafeInteger(milliseconds) || !Number.isFinite(new Date(milliseconds).getTime())) throw invalidStorage();
    return new Date(milliseconds).toISOString();
  };
  return { relativePath: value.relativePath, ...(value.mediaType ? { mediaType: value.mediaType } : {}), sizeBytes: Number(value.sizeBytes),
    sha256: value.sha256, createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt) };
}
function invalidStorage() { return createNimiError({ message: 'Runtime returned an invalid App storage projection.', reasonCode: 'SDK_LOCAL_APP_PROJECTION_INVALID', source: 'sdk' }); }
function unsupported(message: string) { return createNimiError({ message, reasonCode: 'SDK_RUNTIME_REMOTE_OPERATION_UNSUPPORTED', source: 'sdk' }); }

function createRemoteActivity(runtime: RuntimeTypedClient) {
  const shell = createNimiLocalAppActivityRuntimeShell(runtime, undefined);
  return createNimiLocalAppActivityClient(shell);
}
