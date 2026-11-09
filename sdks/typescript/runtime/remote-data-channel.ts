import type { CoreTransport } from '../core-client/index.js';
import type { CoreUnaryRequest, CoreStreamRequest, CoreClientStreamRequest } from '../types/index.js';
import { createNimiError } from '../types/index.js';
import { getRuntimeWireCodec, type RuntimeWireCodec } from '../core-generated/runtime-wire-codecs.js';
import { RemoteClientStreamRequest, RemoteTransportFrame, RemoteTransportFrameKind as Kind } from '../core-generated/runtime-protobuf/runtime/v1/remote_access.js';
import { ReasonCode } from '../core-generated/runtime-protobuf/runtime/v1/common.js';

/** A platform adapter carries bytes and events only. It supplies no Runtime
 * identity, permission or native process assertion. */
export interface RuntimeDataChannel {
  readonly readyState: string;
  readonly bufferedAmount: number;
  send(bytes: Uint8Array): void;
  close(): void;
  onMessage(listener: (bytes: Uint8Array) => void): () => void;
  onClose(listener: () => void): () => void;
  onOpen(listener: () => void): () => void;
  onBufferLow(listener: () => void): () => void;
}

const CHUNK_BYTES = 16 * 1024;
const MAX_MESSAGE_BYTES = 33 * 1024 * 1024;
const MAX_CLIENT_STREAM_MESSAGES = 1 + (32 * 1024 * 1024 / CHUNK_BYTES);
type Request = CoreUnaryRequest | CoreStreamRequest | CoreClientStreamRequest;
type Pending = {
  id: number; request: Request; codec: RuntimeWireCodec; stream: boolean; sent: boolean; done: boolean; error?: unknown;
  pieces: Uint8Array[]; size: number; queue: Uint8Array[]; queuedBytes: number; wake?: () => void; cleanup: () => void; stop: AbortController;
};

// @nimi-authority: rule.nimi.runtime.remote-access.direct-transport
export class RuntimeDataChannelTransport implements CoreTransport {
  readonly #channel: RuntimeDataChannel;
  readonly #current: () => boolean;
  readonly #pending = new Map<number, Pending>();
  readonly #dispose: Array<() => void>;
  readonly #closedSignal = new AbortController();
  #nextId = 1;
  #closed = false;
  #sending: Promise<void> = Promise.resolve();

  constructor(channel: RuntimeDataChannel, current: () => boolean) {
    this.#channel = channel; this.#current = current;
    this.#dispose = [channel.onMessage(bytes => this.#receive(bytes)), channel.onClose(() => this.close())];
  }
  get closed(): boolean { return this.#closed; }
  get signal(): AbortSignal { return this.#closedSignal.signal; }
  close(reason: unknown = unavailable()): void {
    if (this.#closed) return;
    this.#closed = true; this.#closedSignal.abort();
    for (const dispose of this.#dispose) dispose();
    for (const pending of [...this.#pending.values()]) { pending.queue = []; pending.queuedBytes = 0; this.#finish(pending, reason); }
    this.#channel.close();
  }

  async unary<Response = unknown, Body = unknown>(request: CoreUnaryRequest<Body>): Promise<Response> {
    const pending = this.#start(request, false);
    try {
      const next = await this.#next(pending);
      if (next.done || !this.#current()) throw unavailable();
      return pending.codec.decodeResponse(next.value) as Response;
    } finally { if (!pending.done) this.#cancel(pending); }
  }

  async *serverStream<Response = unknown, Body = unknown>(request: CoreStreamRequest<Body>): AsyncIterable<Response> {
    const pending = this.#start(request, true);
    try {
      for (;;) {
        const next = await this.#next(pending);
        if (next.done) return;
        if (!this.#current()) throw unavailable();
        yield pending.codec.decodeResponse(next.value) as Response;
      }
    } finally { if (!pending.done) this.#cancel(pending); }
  }

  async clientStream<Response = unknown, Body = unknown>(request: CoreClientStreamRequest<Body>): Promise<Response> {
    const pending = this.#start(request, false, true);
    try {
      const next = await this.#next(pending);
      if (next.done || !this.#current()) throw unavailable();
      return pending.codec.decodeResponse(next.value) as Response;
    } finally { if (!pending.done) this.#cancel(pending); }
  }

  #start(request: Request, stream: boolean, clientStream = false): Pending {
    if (this.#closed || !this.#current() || this.#channel.readyState !== 'open') throw unavailable();
    if (this.#pending.size >= 16 || this.#nextId > 0xffffffff) throw protocolError('Direct call capacity exhausted.');
    if (request.signal?.aborted) throw cancelled();
    if (request.timeoutMs !== undefined && (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 0 || request.timeoutMs > 0x7fffffff)) throw protocolError('Invalid call timeout.');
    let traceId: string | undefined, idempotencyKey: string | undefined;
    for (const [key, value] of Object.entries(request.metadata ?? {})) {
      if (new TextEncoder().encode(value).byteLength > 128) throw protocolError('Direct call metadata is too large.');
      const name = key.toLowerCase();
      if (name === 'traceid' || name === 'x-nimi-trace-id') {
        if (traceId !== undefined && traceId !== value) throw protocolError('Conflicting trace identifiers.');
        traceId = value;
      } else if (name === 'idempotencykey' || name === 'x-nimi-idempotency-key') {
        if (idempotencyKey !== undefined && idempotencyKey !== value) throw protocolError('Conflicting idempotency keys.');
        idempotencyKey = value;
      } else throw protocolError('Caller identity and authorization metadata are not accepted by direct Runtime access.');
    }
    const codec = getRuntimeWireCodec(request.methodId);
    if (codec.kind !== (clientStream ? 'client_stream' : stream ? 'server_stream' : 'unary')) throw protocolError('Unsupported direct call kind.');
    const encoded = clientStream ? undefined : codec.encodeRequest(request.body);
    if (encoded && encoded.byteLength > MAX_MESSAGE_BYTES) throw protocolError('Direct request is too large.');
    const pending: Pending = { id: this.#nextId++, request, codec, stream, sent: false, done: false, pieces: [], size: 0, queue: [], queuedBytes: 0, cleanup: () => undefined, stop: new AbortController() };
    const abort = () => this.#cancel(pending);
    request.signal?.addEventListener('abort', abort, { once: true });
    const timer = request.timeoutMs ? setTimeout(() => this.#cancel(pending, createNimiError({ message: 'Runtime call timed out; its business outcome may need to be queried.', reasonCode: 'SDK_RUNTIME_REQUEST_TIMEOUT', source: 'sdk' })), request.timeoutMs) : undefined;
    pending.cleanup = () => { request.signal?.removeEventListener('abort', abort); if (timer !== undefined) clearTimeout(timer); };
    this.#pending.set(pending.id, pending);
    this.#sending = this.#sending.then(async () => {
      if (pending.done || this.#closed) return;
      const payload = encoded ?? await this.#clientStreamPayload(pending);
      for (let offset = 0;;) {
        if (pending.done || this.#closed) return;
        if (!this.#current()) { this.close(); return; }
        await this.#drain();
        if (pending.done || this.#closed) return;
        if (!this.#current()) { this.close(); return; }
        const end = Math.min(offset + CHUNK_BYTES, payload.byteLength);
        const frame = RemoteTransportFrame.create({ kind: Kind.REQUEST, requestId: pending.id, method: offset === 0 ? request.methodId : '',
          payload: payload.subarray(offset, end), chunkEnd: end === payload.byteLength,
          timeoutMs: offset === 0 ? request.timeoutMs ?? 0 : 0, traceId: offset === 0 ? traceId ?? '' : '', idempotencyKey: offset === 0 ? idempotencyKey ?? '' : '' });
        this.#channel.send(RemoteTransportFrame.toBinary(frame)); pending.sent = true;
        if (end === payload.byteLength) return; offset = end;
      }
    }).catch(reason => this.#finish(pending, reason));
    return pending;
  }

  async #clientStreamPayload(pending: Pending): Promise<Uint8Array> {
    const body = (pending.request as CoreClientStreamRequest).body;
    if (!body || typeof body[Symbol.asyncIterator] !== 'function') throw protocolError('Client-stream input must be async iterable.');
    const iterator = body[Symbol.asyncIterator]();
    const messages: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        if (!this.#current()) { this.close(); throw unavailable(); }
        const next = await clientStreamNext(iterator, pending);
        if (!this.#current()) { this.close(); throw unavailable(); }
        if (next.done) break;
        if (messages.length >= MAX_CLIENT_STREAM_MESSAGES) throw protocolError('Too many client-stream messages.');
        const message = pending.codec.encodeRequest(next.value);
        let lengthBytes = 1;
        for (let length = message.byteLength; length >= 128; length >>>= 7) lengthBytes++;
        size += 1 + lengthBytes + message.byteLength;
        if (size > MAX_MESSAGE_BYTES) throw protocolError('Direct client-stream request is too large.');
        messages.push(message);
      }
    } finally {
      // A producer's return may wait behind its pending next. Do not let it
      // hold the peer's send queue after this call was canceled.
      void Promise.resolve().then(() => iterator.return?.()).catch(() => undefined);
    }
    if (!messages.length) throw protocolError('Empty client-stream request.');
    return RemoteClientStreamRequest.toBinary({ messages });
  }

  async #drain(): Promise<void> {
    if (this.#channel.bufferedAmount <= 1024 * 1024) return;
    await new Promise<void>((resolve, reject) => {
      const check = () => { if (this.#channel.bufferedAmount <= 1024 * 1024) { cleanup(); resolve(); } };
      const abort = () => { cleanup(); reject(unavailable()); };
      const off = this.#channel.onBufferLow(check);
      const cleanup = () => { off(); this.signal.removeEventListener('abort', abort); };
      this.signal.addEventListener('abort', abort, { once: true });
      if (this.#closed) abort(); else check();
    });
  }

  #cancel(pending: Pending, reason: unknown = cancelled()): void {
    if (pending.done) return;
    if (pending.sent && !this.#closed && this.#channel.readyState === 'open') {
      try { this.#channel.send(RemoteTransportFrame.toBinary(RemoteTransportFrame.create({ kind: Kind.CANCEL, requestId: pending.id, chunkEnd: true }))); }
      catch { this.close(); }
    }
    pending.queue = []; pending.queuedBytes = 0; this.#finish(pending, reason);
  }
  #finish(pending: Pending, error?: unknown): void {
    if (pending.done) return;
    pending.done = true; pending.error = error; pending.pieces = []; pending.size = 0; pending.cleanup(); pending.stop.abort();
    this.#pending.delete(pending.id); pending.wake?.();
  }
  async #next(pending: Pending): Promise<IteratorResult<Uint8Array>> {
    for (;;) {
      if (!this.#current()) { this.close(); throw unavailable(); }
      const value = pending.queue.shift();
      if (value) { pending.queuedBytes -= value.byteLength; return { done: false, value }; }
      if (pending.error) throw pending.error;
      if (pending.done) return { done: true, value: undefined };
      await new Promise<void>(resolve => { pending.wake = resolve; }); pending.wake = undefined;
    }
  }
  #receive(bytes: Uint8Array): void {
    if (this.#closed) return;
    if (!this.#current()) { this.close(); return; }
    try {
      if (bytes.byteLength > CHUNK_BYTES + 8192) throw protocolError('Oversized direct frame.');
      const frame = RemoteTransportFrame.fromBinary(bytes, { readUnknownField: 'throw' });
      if (!frame.requestId || frame.requestId >= this.#nextId || frame.method || frame.timeoutMs || frame.traceId || frame.idempotencyKey || frame.payload.byteLength > CHUNK_BYTES) throw protocolError('Invalid direct response.');
      const pending = this.#pending.get(frame.requestId); if (!pending) return;
      if (frame.kind === Kind.ERROR) {
        if (!frame.chunkEnd || frame.payload.byteLength) throw protocolError('Invalid direct error.');
        this.#finish(pending, createNimiError({ message: frame.errorInfo?.message || frame.message || 'Runtime request failed.',
          reasonCode: frame.errorInfo ? ReasonCode[frame.errorInfo.reasonCode] || 'SDK_RUNTIME_REQUEST_FAILED' : 'SDK_RUNTIME_REQUEST_FAILED',
          actionHint: frame.errorInfo?.actionHint || undefined, source: 'runtime', details: { grpcCode: frame.grpcCode } }));
        return;
      }
      if (frame.grpcCode || frame.errorInfo || frame.message) throw protocolError('Unexpected response error fields.');
      if (frame.kind === Kind.STREAM_END) {
        if (!pending.stream || !frame.chunkEnd || frame.payload.byteLength || pending.size) throw protocolError('Incomplete direct stream.');
        this.#finish(pending); return;
      }
      if (frame.kind !== (pending.stream ? Kind.STREAM_DATA : Kind.RESPONSE)) throw protocolError('Unexpected direct frame kind.');
      pending.pieces.push(frame.payload); pending.size += frame.payload.byteLength;
      if (pending.size + pending.queuedBytes > MAX_MESSAGE_BYTES) { this.#cancel(pending, protocolError('Direct response buffer exceeded.')); return; }
      if (!frame.chunkEnd) return;
      const payload = new Uint8Array(pending.size); let offset = 0;
      for (const piece of pending.pieces) { payload.set(piece, offset); offset += piece.byteLength; }
      pending.queue.push(payload); pending.queuedBytes += payload.byteLength; pending.pieces = []; pending.size = 0;
      if (!pending.stream) this.#finish(pending); else pending.wake?.();
    } catch (reason) { this.close(reason); }
  }
}

function clientStreamNext(iterator: AsyncIterator<unknown>, pending: Pending): Promise<IteratorResult<unknown>> {
  return new Promise((resolve, reject) => {
    const cleanup = () => pending.stop.signal.removeEventListener('abort', abort);
    const abort = () => { cleanup(); reject(pending.error ?? cancelled()); };
    if (pending.done) { abort(); return; }
    pending.stop.signal.addEventListener('abort', abort, { once: true });
    void Promise.resolve().then(() => iterator.next()).then(
      result => { cleanup(); if (pending.done) reject(pending.error ?? cancelled()); else resolve(result); },
      error => { cleanup(); reject(error); },
    );
  });
}

function unavailable() { return createNimiError({ message: 'The direct Runtime connection is unavailable. Reconnect before new work; do not replay an unanswered request.', reasonCode: 'SDK_RUNTIME_REMOTE_UNAVAILABLE', source: 'sdk' }); }
function cancelled() { return createNimiError({ message: 'Runtime observation was canceled.', reasonCode: 'SDK_RUNTIME_REQUEST_CANCELLED', source: 'sdk' }); }
function protocolError(message: string) { return createNimiError({ message, reasonCode: 'SDK_RUNTIME_REMOTE_PROTOCOL_INVALID', source: 'sdk' }); }
