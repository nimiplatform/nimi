import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeDataChannelTransport, type RuntimeDataChannel } from './remote-data-channel.js';
import { RemoteTransportFrame, RemoteTransportFrameKind as Kind } from '../core-generated/runtime-protobuf/runtime/v1/remote_access.js';
import { GetAppAIConfigResponse, OverwriteAppAIConfigRequest, OverwriteAppAIConfigResponse } from '../core-generated/runtime-protobuf/runtime/v1/capability_configuration.js';
import { CoreClient } from '../core-client/index.js';
import { RuntimeTypedClient } from '../core-generated/runtime-typed-client.js';
import { createNimiLocalAppAIConfigRuntimeClient, createNimiAppAIConfigOwner } from '../core/ai/capability-configuration.js';
import { LocalAppScenarioJobEvent } from '../core-generated/runtime-protobuf/runtime/v1/ai.js';
import { ErrorInfo, ReasonCode } from '../core-generated/runtime-protobuf/runtime/v1/common.js';
import { createRemoteRuntimeAppClients } from './remote-app.js';
import { WriteLocalAppAssetRequest, WriteLocalAppAssetResponse, WriteLocalAppStorageJsonRequest, WriteLocalAppStorageJsonResponse, ReadLocalAppAssetResponse } from '../core-generated/runtime-protobuf/runtime/v1/app.js';
import { ListLocalAppAgentReferencesResponse } from '../core-generated/runtime-protobuf/runtime/v1/agent_service.js';
import { PutAppActivityRequest, PutAppActivityResponse, AppActivityRecord, AppActivityKind, AppActivitySourceKind, OpenAppActivityResponse, AppActivityOpenOutcome, AppActivityOpenReason, SubscribeAppActivityOpenRequestsResponse, CompleteAppActivityOpenRequestRequest, CompleteAppActivityOpenRequestResponse, AppActivityOpenCompletion } from '../core-generated/runtime-protobuf/runtime/v1/app_activity.js';

class Channel implements RuntimeDataChannel {
  readyState = 'open'; bufferedAmount = 0;
  sent: RemoteTransportFrame[] = [];
  receivers = new Set<(bytes: Uint8Array) => void>(); closers = new Set<() => void>();
  onSend?: (frame: RemoteTransportFrame) => void;
  send(bytes: Uint8Array) { const frame = RemoteTransportFrame.fromBinary(bytes); this.sent.push(frame); this.onSend?.(frame); }
  close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; for (const close of this.closers) close(); }
  onMessage(listener: (bytes: Uint8Array) => void) { this.receivers.add(listener); return () => { this.receivers.delete(listener); }; }
  onClose(listener: () => void) { this.closers.add(listener); return () => { this.closers.delete(listener); }; }
  onOpen() { return () => undefined; } onBufferLow() { return () => undefined; }
  receive(frame: Partial<RemoteTransportFrame>) { const data = RemoteTransportFrame.toBinary(RemoteTransportFrame.create(frame)); for (const next of this.receivers) next(data); }
}

test('remote activity publication uses the typed owner RPC and preserves denied publication', async () => {
  const channel = new Channel(), transport = new RuntimeDataChannelTransport(channel, () => true);
  const app = createRemoteRuntimeAppClients(new RuntimeTypedClient(new CoreClient({ transport })), 'nimi.shijing');
  const input = { key: 'rijing:2026-11-10:method', revision: 1, kind: 'activity' as const, attention: false,
    title: 'Saved daily reading', type: 'nimi.shijing.rijing-reading.v1', data: { date: '2026-11-10' }, occurredAt: '2026-11-10T00:00:00Z' };
  const pending = app.activity.put(input), id = await sent(channel);
  assert.equal(channel.sent[0].method, '/nimi.runtime.v1.RuntimeAppActivityService/PutAppActivity');
  const request = PutAppActivityRequest.fromBinary(channel.sent[0].payload);
  assert.equal(request.key, input.key); assert.equal(request.title, input.title);
  assert.deepEqual(JSON.parse(request.dataJson), input.data);
  assert.equal('accountId' in request || 'publisher' in request || 'appId' in request, false);
  const record = AppActivityRecord.create({ activityId: 'act_' + '0'.repeat(25) + '1', key: request.key, revision: '1',
    kind: AppActivityKind.ACTIVITY, title: request.title, activityType: request.activityType, dataJson: request.dataJson,
    source: { kind: AppActivitySourceKind.APP, sourceRef: 'src_' + 'a'.repeat(32), appId: 'nimi.shijing', displayName: 'ShiJing', available: true },
    occurredAt: request.occurredAt, publishedAt: request.occurredAt, updatedAt: request.occurredAt, changeSeq: '1',
    userView: { unread: true, readThroughRevision: '0', needsAttention: false } });
  channel.receive({ kind: Kind.RESPONSE, requestId: id, chunkEnd: true, payload: PutAppActivityResponse.toBinary({ record, changed: true }) });
  assert.equal((await pending).record.source.displayName, 'ShiJing');
  channel.sent.length = 0;
  const denied = assert.rejects(app.activity.put({ ...input, revision: 2 }), { reasonCode: 'APP_SCOPE_FORBIDDEN' });
  const deniedId = await sent(channel);
  channel.receive({ kind: Kind.ERROR, requestId: deniedId, chunkEnd: true, grpcCode: 7, errorInfo: ErrorInfo.create({ reasonCode: ReasonCode.APP_SCOPE_FORBIDDEN }) });
  await denied;
  channel.sent.length = 0;
  const opening = app.activity.open({ activityId: record.activityId });
  const openId = await sent(channel);
  channel.receive({ kind: Kind.STREAM_DATA, requestId: openId, chunkEnd: true, payload: OpenAppActivityResponse.toBinary({ event: { oneofKind: 'result', result: { outcome: AppActivityOpenOutcome.UNAVAILABLE, reason: AppActivityOpenReason.SOURCE_UNAVAILABLE } } }) });
  assert.deepEqual(await opening, { outcome: 'unavailable', reason: 'source-unavailable' });
  transport.close();
});

test('remote activity source confirms only its delivered navigation and stops with its registration', async () => {
  const channel = new Channel(), transport = new RuntimeDataChannelTransport(channel, () => true);
  const app = createRemoteRuntimeAppClients(new RuntimeTypedClient(new CoreClient({ transport })), 'nimi.test');
  const handled: unknown[] = [];
  const registration = app.activity.onOpenRequest(async request => { handled.push(request); return 'opened'; });
  const subscriptionId = await sent(channel);
  assert.equal(channel.sent[0].method, '/nimi.runtime.v1.RuntimeAppActivityService/SubscribeAppActivityOpenRequests');
  const deliveryId = 'aod_' + 'a'.repeat(43), activityId = 'act_' + '0'.repeat(25) + '2';
  channel.receive({ kind: Kind.STREAM_DATA, requestId: subscriptionId, chunkEnd: true,
    payload: SubscribeAppActivityOpenRequestsResponse.toBinary({ deliveryId, activityId, objectRef: 'draft:2', activityType: 'nimi.test.review.v1' }) });
  await until(() => channel.sent.some(frame => frame.method.endsWith('/CompleteAppActivityOpenRequest')));
  const completion = channel.sent.find(frame => frame.method.endsWith('/CompleteAppActivityOpenRequest'))!;
  assert.deepEqual(handled, [{ activityId, objectRef: 'draft:2', type: 'nimi.test.review.v1' }]);
  assert.deepEqual(CompleteAppActivityOpenRequestRequest.fromBinary(completion.payload), { deliveryId, completion: AppActivityOpenCompletion.OPENED });
  channel.receive({ kind: Kind.RESPONSE, requestId: completion.requestId, chunkEnd: true, payload: CompleteAppActivityOpenRequestResponse.toBinary({ accepted: true }) });
  await registration.stop();
  assert.ok(channel.sent.some(frame => frame.kind === Kind.CANCEL && frame.requestId === subscriptionId));
  transport.close();
});

test('a remote activity consumer rejects a native launch event instead of fabricating Host authority', async () => {
  const channel = new Channel(), transport = new RuntimeDataChannelTransport(channel, () => true);
  const app = createRemoteRuntimeAppClients(new RuntimeTypedClient(new CoreClient({ transport })), 'nimi.test');
  const opening = assert.rejects(app.activity.open({ activityId: 'act_' + '0'.repeat(25) + '3' }), { reasonCode: 'SDK_LOCAL_APP_PROJECTION_INVALID' });
  const id = await sent(channel);
  channel.receive({ kind: Kind.STREAM_DATA, requestId: id, chunkEnd: true, payload: OpenAppActivityResponse.toBinary({ event: { oneofKind: 'openRequestId', openRequestId: 'aor_' + 'a'.repeat(43) } }) });
  await opening;
  assert.equal(channel.sent.some(frame => frame.method.includes('ResolveAppActivityOpenLaunch')), false);
  transport.close();
});

for (const bodyKind of ['bytes', 'blob', 'chunks'] as const) test(`incremental remote asset write preserves ${bodyKind} input and the owner response`, async () => {
  const bytes = new TextEncoder().encode('remote 图片 input\n'.repeat(5000));
  const body = bodyKind === 'bytes' ? bytes : bodyKind === 'blob' ? new Blob([bytes])
    : (async function* () { yield bytes.subarray(0, 13); yield bytes.subarray(13, 20000); yield bytes.subarray(20000); })();
  const channel = new Channel(), transport = new RuntimeDataChannelTransport(channel, () => true);
  const app = createRemoteRuntimeAppClients(new RuntimeTypedClient(new CoreClient({ transport })), 'nimi.lab');
  const received = receiveUpload(channel);
  const pending = app.storage.assets.write({ relativePath: 'inputs/sample.txt', body, mediaType: 'text/plain' });
  const id = await sent(channel);
  const frames = await received;
  assert.equal(channel.sent[0].method, '/nimi.runtime.v1.RuntimeAppService/WriteLocalAppAsset');
  assert.ok(channel.sent.length > 1);
  assert.deepEqual(frames[0].frame, { oneofKind: 'metadata', metadata: { relativePath: 'inputs/sample.txt', mediaType: 'text/plain', overwrite: false } });
  const data = frames.slice(1).map(frame => {
    assert.equal(frame.frame.oneofKind, 'bodyChunk');
    if (frame.frame.oneofKind !== 'bodyChunk') throw new Error('Expected a data frame.');
    assert.ok(frame.frame.bodyChunk.byteLength <= 256 * 1024);
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

// This peer stand-in acknowledges bounded method messages. It does not claim
// Runtime admission, durable storage, or real network acceptance.
function receiveUpload(channel: Channel, observe?: (message: WriteLocalAppAssetRequest) => void, keep = true): Promise<WriteLocalAppAssetRequest[]> {
  const completion = Promise.withResolvers<WriteLocalAppAssetRequest[]>();
  const messages: WriteLocalAppAssetRequest[] = []; let pieces: Uint8Array[] = [];
  channel.onSend = frame => {
    if (frame.kind === Kind.CLIENT_STREAM_END) { completion.resolve(messages); return; }
    if (frame.kind !== Kind.CLIENT_STREAM_OPEN && frame.kind !== Kind.CLIENT_STREAM_DATA) return;
    pieces.push(frame.payload);
    if (!frame.chunkEnd) return;
    const message = WriteLocalAppAssetRequest.fromBinary(Buffer.concat(pieces)); pieces = [];
    if (keep) messages.push(message); observe?.(message);
    channel.receive({ kind: Kind.CLIENT_STREAM_CREDIT, requestId: frame.requestId, chunkEnd: true,
      inputCredits: frame.kind === Kind.CLIENT_STREAM_OPEN ? 4 : 1 });
    if (!keep) channel.sent = [];
  };
  return completion.promise;
}

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!check()) { if (Date.now() > deadline) throw new Error('Direct transport progress timed out.'); await new Promise(resolve => setImmediate(resolve)); }
}

test('asset input exceeds 32 MiB without being accumulated before first delivery', { timeout: 10000 }, async () => {
  const channel = new Channel(), transport = new RuntimeDataChannelTransport(channel, () => true);
  const runtime = new RuntimeTypedClient(new CoreClient({ transport }));
  const app = createRemoteRuntimeAppClients(runtime, 'nimi.lab');
  let produced = 0, observed = 0, firstDeliveredAt = 0;
  const received = receiveUpload(channel, message => {
    if (message.frame.oneofKind === 'bodyChunk') { if (!observed) firstDeliveredAt = produced; observed += message.frame.bodyChunk.byteLength; }
  }, false);
  const body = (async function* () { for (let n = 0; n < 140; n++) { produced++; yield new Uint8Array(256 * 1024); } })();
  const pending = app.storage.assets.write({ relativePath: 'large.bin', body });
  await received;
  assert.equal(firstDeliveredAt, 1); assert.equal(produced, 140); assert.equal(observed, 140 * 256 * 1024);
  const end = channel.sent.find(frame => frame.kind === Kind.CLIENT_STREAM_END)!;
  channel.receive({ kind: Kind.RESPONSE, requestId: end.requestId, chunkEnd: true,
    payload: WriteLocalAppAssetResponse.toBinary({ asset: { relativePath: 'large.bin', sizeBytes: String(observed), sha256: 'sha256:' + '0'.repeat(64), createdAt: { seconds: '1', nanos: 0 }, updatedAt: { seconds: '1', nanos: 0 } }, reasonCode: ReasonCode.ACTION_EXECUTED }) });
  assert.equal((await pending).sizeBytes, observed); transport.close();
});

test('owner credits bound input pulls while unrelated calls continue and cancel stops the producer', { timeout: 5000 }, async () => {
  const channel = new Channel(), transport = new RuntimeDataChannelTransport(channel, () => true);
  const runtime = new RuntimeTypedClient(new CoreClient({ transport }));
  let pulled = 0, returned = false;
  const controller = new AbortController();
  const body = (async function* () { try {
    pulled++; yield WriteLocalAppAssetRequest.create({ frame: { oneofKind: 'metadata', metadata: { relativePath: 'bounded.bin', mediaType: '', overwrite: false } } });
    for (;;) { pulled++; yield WriteLocalAppAssetRequest.create({ frame: { oneofKind: 'bodyChunk', bodyChunk: new Uint8Array(10) } }); }
  } finally { returned = true; } })();
  const uploading = runtime.writeLocalAppAsset(body, { signal: controller.signal });
  const rejected = assert.rejects(uploading, { reasonCode: 'SDK_RUNTIME_REQUEST_CANCELLED' });
  const id = await sent(channel); assert.equal(pulled, 1);
  channel.receive({ kind: Kind.CLIENT_STREAM_CREDIT, requestId: id, inputCredits: 4, chunkEnd: true });
  await until(() => channel.sent.filter(frame => frame.kind === Kind.CLIENT_STREAM_DATA && frame.chunkEnd).length === 4);
  assert.equal(pulled, 5);
  const unrelated = runtime.getAppAIConfig({ appId: 'nimi.lab' });
  await until(() => channel.sent.some(frame => frame.requestId !== id && frame.kind === Kind.REQUEST));
  const other = channel.sent.find(frame => frame.requestId !== id && frame.kind === Kind.REQUEST)!;
  channel.receive({ kind: Kind.RESPONSE, requestId: other.requestId, chunkEnd: true, payload: GetAppAIConfigResponse.toBinary(GetAppAIConfigResponse.create()) });
  await unrelated; controller.abort(); await rejected; await until(() => returned);
  assert.equal(pulled, 5); assert.ok(channel.sent.some(frame => frame.kind === Kind.CANCEL && frame.requestId === id)); transport.close();
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

test('oversized method messages and invalid owner credit fail without reading the whole upload', { timeout: 5000 }, async () => {
  const channel = new Channel(), transport = new RuntimeDataChannelTransport(channel, () => true);
  const runtime = new RuntimeTypedClient(new CoreClient({ transport }));
  await assert.rejects(runtime.writeLocalAppAsset((async function* () {
    yield WriteLocalAppAssetRequest.create({ frame: { oneofKind: 'bodyChunk', bodyChunk: new Uint8Array(1024 * 1024 + 8192) } });
  })()), { reasonCode: 'SDK_RUNTIME_REMOTE_PROTOCOL_INVALID' });
  assert.equal(channel.sent.length, 0);
  const body = (async function* () { yield WriteLocalAppAssetRequest.create({ frame: { oneofKind: 'metadata', metadata: { relativePath: 'bounded.bin', mediaType: '', overwrite: false } } }); throw new Error('Must not pull input without valid credit'); })();
  const pending = runtime.writeLocalAppAsset(body); const rejected = assert.rejects(pending, { reasonCode: 'SDK_RUNTIME_REMOTE_PROTOCOL_INVALID' });
  const id = await sent(channel); channel.receive({ kind: Kind.CLIENT_STREAM_CREDIT, requestId: id, inputCredits: 5, chunkEnd: true });
  await rejected; assert.equal(transport.closed, true);
});

test('owner rejection preserves its reason and cancels an unopened body instead of replaying it', { timeout: 5000 }, async () => {
  const channel = new Channel(), transport = new RuntimeDataChannelTransport(channel, () => true);
  const runtime = new RuntimeTypedClient(new CoreClient({ transport }));
  let pulled = false, returned = false;
  const body = (async function* () { try {
    yield WriteLocalAppAssetRequest.create({ frame: { oneofKind: 'metadata', metadata: { relativePath: 'denied.bin', mediaType: '', overwrite: false } } });
    pulled = true; yield WriteLocalAppAssetRequest.create();
  } finally { returned = true; } })();
  const pending = runtime.writeLocalAppAsset(body);
  const rejected = assert.rejects(pending, { reasonCode: 'APP_SCOPE_FORBIDDEN' });
  const id = await sent(channel);
  channel.receive({ kind: Kind.ERROR, requestId: id, chunkEnd: true, grpcCode: 7, errorInfo: ErrorInfo.create({ reasonCode: ReasonCode.APP_SCOPE_FORBIDDEN }) });
  await rejected; await until(() => returned);
  assert.equal(pulled, false); assert.equal(channel.sent.filter(frame => frame.kind === Kind.CLIENT_STREAM_OPEN).length, 1);
  assert.equal(channel.sent.filter(frame => frame.kind === Kind.CANCEL).length, 1); transport.close();
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
