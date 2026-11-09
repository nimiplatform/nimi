import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeDataChannelTransport, type RuntimeDataChannel } from './remote-data-channel.js';
import { RemoteClientStreamRequest, RemoteTransportFrame, RemoteTransportFrameKind as Kind } from '../core-generated/runtime-protobuf/runtime/v1/remote_access.js';
import { GetAppAIConfigResponse, OverwriteAppAIConfigRequest, OverwriteAppAIConfigResponse } from '../core-generated/runtime-protobuf/runtime/v1/capability_configuration.js';
import { CoreClient } from '../core-client/index.js';
import { RuntimeTypedClient } from '../core-generated/runtime-typed-client.js';
import { createNimiLocalAppAIConfigRuntimeClient, createNimiAppAIConfigOwner } from '../core/ai/capability-configuration.js';
import { LocalAppScenarioJobEvent } from '../core-generated/runtime-protobuf/runtime/v1/ai.js';
import { ErrorInfo, ReasonCode } from '../core-generated/runtime-protobuf/runtime/v1/common.js';
import { createRemoteRuntimeAppClients } from './remote-app.js';
import { WriteLocalAppAssetRequest, WriteLocalAppAssetResponse, WriteLocalAppStorageJsonRequest, WriteLocalAppStorageJsonResponse, ReadLocalAppAssetResponse } from '../core-generated/runtime-protobuf/runtime/v1/app.js';
import { ListLocalAppAgentReferencesResponse } from '../core-generated/runtime-protobuf/runtime/v1/agent_service.js';

class Channel implements RuntimeDataChannel {
  readyState = 'open'; bufferedAmount = 0;
  sent: RemoteTransportFrame[] = [];
  receivers = new Set<(bytes: Uint8Array) => void>(); closers = new Set<() => void>();
  send(bytes: Uint8Array) { this.sent.push(RemoteTransportFrame.fromBinary(bytes)); }
  close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; for (const close of this.closers) close(); }
  onMessage(listener: (bytes: Uint8Array) => void) { this.receivers.add(listener); return () => { this.receivers.delete(listener); }; }
  onClose(listener: () => void) { this.closers.add(listener); return () => { this.closers.delete(listener); }; }
  onOpen() { return () => undefined; } onBufferLow() { return () => undefined; }
  receive(frame: Partial<RemoteTransportFrame>) { const data = RemoteTransportFrame.toBinary(RemoteTransportFrame.create(frame)); for (const next of this.receivers) next(data); }
}

for (const bodyKind of ['bytes', 'blob', 'chunks'] as const) test(`finite remote asset write preserves ${bodyKind} input and the owner response`, async () => {
  const bytes = new TextEncoder().encode('remote 图片 input\n'.repeat(5000));
  const body = bodyKind === 'bytes' ? bytes : bodyKind === 'blob' ? new Blob([bytes])
    : (async function* () { yield bytes.subarray(0, 13); yield bytes.subarray(13, 20000); yield bytes.subarray(20000); })();
  const channel = new Channel(), transport = new RuntimeDataChannelTransport(channel, () => true);
  const app = createRemoteRuntimeAppClients(new RuntimeTypedClient(new CoreClient({ transport })), 'nimi.lab');
  const pending = app.storage.assets.write({ relativePath: 'inputs/sample.txt', body, mediaType: 'text/plain' });
  const id = await sent(channel);
  const deadline = Date.now() + 5000;
  while (!channel.sent.some(frame => frame.requestId === id && frame.chunkEnd)) {
    if (Date.now() > deadline) throw new Error('Asset envelope was not completed.');
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(channel.sent[0].method, '/nimi.runtime.v1.RuntimeAppService/WriteLocalAppAsset');
  assert.ok(channel.sent.length > 1);
  const batch = RemoteClientStreamRequest.fromBinary(Buffer.concat(channel.sent.map(frame => frame.payload)));
  const frames = batch.messages.map(message => WriteLocalAppAssetRequest.fromBinary(message));
  assert.deepEqual(frames[0].frame, { oneofKind: 'metadata', metadata: { relativePath: 'inputs/sample.txt', mediaType: 'text/plain', overwrite: false } });
  const data = frames.slice(1).map(frame => {
    assert.equal(frame.frame.oneofKind, 'bodyChunk');
    if (frame.frame.oneofKind !== 'bodyChunk') throw new Error('Expected a data frame.');
    assert.ok(frame.frame.bodyChunk.byteLength <= 16 * 1024);
    return frame.frame.bodyChunk;
  });
  assert.deepEqual(Buffer.concat(data), Buffer.from(bytes));
  channel.receive({ kind: Kind.RESPONSE, requestId: id, chunkEnd: true,
    payload: WriteLocalAppAssetResponse.toBinary({ asset: { relativePath: 'inputs/sample.txt', mediaType: 'text/plain',
      sizeBytes: String(bytes.byteLength), sha256: 'sha256:' + '0'.repeat(64), createdAt: { seconds: '1', nanos: 0 }, updatedAt: { seconds: '1', nanos: 0 } }, reasonCode: ReasonCode.ACTION_EXECUTED }) });
  const saved = await pending;
  assert.equal(saved.sizeBytes, bytes.byteLength); assert.equal(saved.relativePath, 'inputs/sample.txt');
  transport.close();
});

test('canceling a pending input producer releases the send queue without replay or waiting for return', { timeout: 5000 }, async () => {
  const started = Promise.withResolvers<void>();
  const never = new Promise<IteratorResult<WriteLocalAppAssetRequest>>(() => undefined);
  let returned = false;
  const body: AsyncIterable<WriteLocalAppAssetRequest> = { [Symbol.asyncIterator]() { return {
    next() { started.resolve(); return never; },
    return() { returned = true; return never; },
  }; } };
  const channel = new Channel(), transport = new RuntimeDataChannelTransport(channel, () => true);
  const runtime = new RuntimeTypedClient(new CoreClient({ transport }));
  const controller = new AbortController();
  const pending = runtime.writeLocalAppAsset(body, { signal: controller.signal });
  await started.promise; controller.abort();
  await assert.rejects(pending, { reasonCode: 'SDK_RUNTIME_REQUEST_CANCELLED' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(returned, true); assert.equal(channel.sent.length, 0);
  const read = runtime.getAppAIConfig({});
  const id = await sent(channel);
  channel.receive({ kind: Kind.RESPONSE, requestId: id, chunkEnd: true, payload: GetAppAIConfigResponse.toBinary(GetAppAIConfigResponse.create({ revision: 'after-cancel' })) });
  assert.equal((await read).revision, 'after-cancel');
  transport.close();
});

test('finite remote uploads reject excess content and message counts before dispatch', async () => {
  const channel = new Channel(), transport = new RuntimeDataChannelTransport(channel, () => true);
  const runtime = new RuntimeTypedClient(new CoreClient({ transport }));
  const app = createRemoteRuntimeAppClients(runtime, 'nimi.lab');
  await assert.rejects(app.storage.assets.write({ relativePath: 'too-large.bin', body: new Uint8Array(32 * 1024 * 1024 + 1) }),
    { reasonCode: 'SDK_RUNTIME_REMOTE_PROTOCOL_INVALID' });
  await assert.rejects(runtime.writeLocalAppAsset((async function* () {
    for (let index = 0; index < 2050; index++) yield WriteLocalAppAssetRequest.create();
  })()), { reasonCode: 'SDK_RUNTIME_REMOTE_PROTOCOL_INVALID' });
  assert.equal(channel.sent.length, 0);
  transport.close();
});

test('remote App storage and Agent clients reuse real protobuf projection and omit caller identity', async () => {
  const channel = new Channel(), transport = new RuntimeDataChannelTransport(channel, () => true);
  const app = createRemoteRuntimeAppClients(new RuntimeTypedClient(new CoreClient({ transport })), 'nimi.lab');
  const write = app.storage.writeJson('run.json', { text: '中文结果' });
  const id = await sent(channel), request = channel.sent[0];
  assert.equal(request.method, '/nimi.runtime.v1.RuntimeAppService/WriteLocalAppStorageJson');
  const decoded = WriteLocalAppStorageJsonRequest.fromBinary(request.payload);
  assert.equal(decoded.relativePath, 'run.json');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(decoded.jsonValue)), { text: '中文结果' });
  channel.receive({ kind: Kind.RESPONSE, requestId: id, chunkEnd: true,
    payload: WriteLocalAppStorageJsonResponse.toBinary({ jsonValue: decoded.jsonValue, sizeBytes: String(decoded.jsonValue.byteLength), reasonCode: ReasonCode.ACTION_EXECUTED }) });
  assert.deepEqual((await write).value, { text: '中文结果' });
  channel.sent.length = 0;
  const references = app.agents.listReferences();
  const referenceId = await sent(channel);
  assert.equal(channel.sent[0].payload.byteLength, 0);
  channel.receive({ kind: Kind.RESPONSE, requestId: referenceId, chunkEnd: true,
    payload: ListLocalAppAgentReferencesResponse.toBinary({ references: [{ agentHandle: 'agent_ref_' + 'A'.repeat(43),
      agentBinding: 'agent_binding_' + 'A'.repeat(43), activityAgentRef: 'agr_test', displayName: 'Reference Agent' }] }) });
  assert.equal((await references)[0].displayName, 'Reference Agent');
  await assert.rejects(app.storage.assets.reveal('result.txt'), { reasonCode: 'SDK_RUNTIME_REMOTE_OPERATION_UNSUPPORTED' });
  assert.equal('management' in app, false);
  transport.close();
});

test('closing an unread remote asset body cancels its real direct request', async () => {
  const channel = new Channel(), transport = new RuntimeDataChannelTransport(channel, () => true);
  const app = createRemoteRuntimeAppClients(new RuntimeTypedClient(new CoreClient({ transport })), 'nimi.lab');
  const read = app.storage.assets.read({ relativePath: 'result.txt' });
  const id = await sent(channel);
  channel.receive({ kind: Kind.STREAM_DATA, requestId: id, chunkEnd: true,
    payload: ReadLocalAppAssetResponse.toBinary({ frame: { oneofKind: 'metadata', metadata: {
      asset: { relativePath: 'result.txt', mediaType: 'text/plain', sizeBytes: '3', sha256: 'sha256:' + '0'.repeat(64),
        createdAt: { seconds: '1', nanos: 0 }, updatedAt: { seconds: '1', nanos: 0 } }, range: { offset: '0', length: '3', totalSize: '3' },
    } } }) });
  const result = await read;
  await result.body[Symbol.asyncIterator]().return?.();
  assert.equal(channel.sent.filter(frame => frame.kind === Kind.CANCEL && frame.requestId === id).length, 1);
  transport.close();
});
const readMethod = '/nimi.runtime.v1.RuntimeAiService/GetAppAIConfig';
async function sent(channel: Channel) {
  const deadline = Date.now() + 5000;
  while (!channel.sent.length) {
    if (Date.now() > deadline) throw new Error('The SDK did not send the expected direct request.');
    await new Promise(resolve => setImmediate(resolve));
  }
  return channel.sent[0].requestId;
}

test('the public self AIConfig writer carries its idempotency key without caller authority', async () => {
  const channel = new Channel(), transport = new RuntimeDataChannelTransport(channel, () => true);
  const runtime = new RuntimeTypedClient(new CoreClient({ transport }));
  const aiConfig = createNimiLocalAppAIConfigRuntimeClient({ appId: 'publisher.editor', runtime });
  const pending = aiConfig.overwrite({ expectedRevision: '0', capabilities: [] }, { timeoutMs: 0 });
  const id = await sent(channel), request = channel.sent[0];
  assert.match(request.idempotencyKey, /^app-ai-config-/);
  assert.equal(request.timeoutMs, 0);
  assert.equal(OverwriteAppAIConfigRequest.fromBinary(request.payload).config?.owner, undefined);
  channel.receive({ kind: Kind.RESPONSE, requestId: id, chunkEnd: true,
    payload: OverwriteAppAIConfigResponse.toBinary(OverwriteAppAIConfigResponse.create({ committed: true, revision: '1',
      config: { owner: createNimiAppAIConfigOwner('publisher.editor'), capabilities: [] } })) });
  assert.equal((await pending).outcome, 'committed');
  await assert.rejects(transport.unary({ methodId: readMethod, body: {}, metadata: { idempotencyKey: 'one', 'x-nimi-idempotency-key': 'two' } }), { reasonCode: 'SDK_RUNTIME_REMOTE_PROTOCOL_INVALID' });
  transport.close();
});

test('direct transport decodes a fragmented owner response without carrying caller credentials', async () => {
  const channel = new Channel(), transport = new RuntimeDataChannelTransport(channel, () => true);
  const promise = transport.unary<{ revision: string }>({ methodId: readMethod, body: {} });
  const id = await sent(channel);
  const bytes = GetAppAIConfigResponse.toBinary(GetAppAIConfigResponse.create({ revision: '7' }));
  channel.receive({ kind: Kind.RESPONSE, requestId: id, payload: bytes.subarray(0, 1) });
  channel.receive({ kind: Kind.RESPONSE, requestId: id, payload: bytes.subarray(1), chunkEnd: true });
  assert.equal((await promise).revision, '7');
  await assert.rejects(transport.unary({ methodId: readMethod, body: {}, metadata: { authorization: 'not-admitted' } }), { reasonCode: 'SDK_RUNTIME_REMOTE_PROTOCOL_INVALID' });
  assert.equal(channel.sent.length, 1); transport.close();
});

test('switching users rejects a late response and does not send or replay another request', async () => {
  let active = true;
  const channel = new Channel(), transport = new RuntimeDataChannelTransport(channel, () => active);
  const promise = transport.unary({ methodId: readMethod, body: {} });
  const id = await sent(channel); active = false;
  channel.receive({ kind: Kind.RESPONSE, requestId: id, chunkEnd: true });
  await assert.rejects(promise, { reasonCode: 'SDK_RUNTIME_REMOTE_UNAVAILABLE' });
  assert.equal(channel.sent.length, 1); assert.equal(channel.readyState, 'closed');
});

test('ending a stream cancels only that observation without canceling the durable job', async () => {
  const channel = new Channel(), transport = new RuntimeDataChannelTransport(channel, () => true);
  const source = transport.serverStream({ methodId: '/nimi.runtime.v1.RuntimeAiService/SubscribeLocalAppScenarioJobEvents', body: { jobId: 'existing-job' } })[Symbol.asyncIterator]();
  const next = source.next(), id = await sent(channel);
  channel.receive({ kind: Kind.STREAM_DATA, requestId: id, payload: LocalAppScenarioJobEvent.toBinary(LocalAppScenarioJobEvent.create({ sequence: '1' })), chunkEnd: true });
  assert.equal((await next).done, false);
  await source.return?.();
  assert.equal(channel.sent.at(-1)?.kind, Kind.CANCEL);
  assert.equal(channel.sent.filter(frame => frame.method.includes('CancelLocalAppScenarioJob')).length, 0);
  transport.close();
});

test('a stream drains received events before preserving the owner failure', async () => {
  const channel = new Channel(), transport = new RuntimeDataChannelTransport(channel, () => true);
  const source = transport.serverStream({ methodId: '/nimi.runtime.v1.RuntimeAiService/SubscribeLocalAppScenarioJobEvents', body: { jobId: 'existing-job' } })[Symbol.asyncIterator]();
  const first = source.next(), id = await sent(channel);
  channel.receive({ kind: Kind.STREAM_DATA, requestId: id, payload: LocalAppScenarioJobEvent.toBinary(LocalAppScenarioJobEvent.create({ sequence: '1' })), chunkEnd: true });
  channel.receive({ kind: Kind.ERROR, requestId: id, chunkEnd: true, grpcCode: 7, message: 'The owner denied access.',
    errorInfo: ErrorInfo.create({ reasonCode: ReasonCode.APP_SCOPE_FORBIDDEN }) });
  assert.equal((await first).done, false);
  await assert.rejects(source.next(), { reasonCode: 'APP_SCOPE_FORBIDDEN' });
  assert.equal(channel.sent.filter(frame => frame.kind === Kind.REQUEST).length, 1);
  transport.close();
});

test('a completed unary result survives later connection loss while unfinished calls fail without replay', async () => {
  const channel = new Channel(), transport = new RuntimeDataChannelTransport(channel, () => true);
  const complete = transport.unary<{ revision: string }>({ methodId: readMethod, body: {} });
  const id = await sent(channel);
  channel.receive({ kind: Kind.RESPONSE, requestId: id, payload: GetAppAIConfigResponse.toBinary(GetAppAIConfigResponse.create({ revision: '3' })), chunkEnd: true });
  const pending = transport.unary({ methodId: readMethod, body: {} });
  channel.close();
  assert.equal((await complete).revision, '3');
  await assert.rejects(pending, { reasonCode: 'SDK_RUNTIME_REMOTE_UNAVAILABLE' });
  assert.equal(channel.sent.filter(frame => frame.requestId === 1 && frame.method).length, 1);
});
