import { mixPcmBlock, summarizePcmBlock, type PcmMixInput, type PcmMixResult, type PcmWaveformInput, type PcmWaveformBlock } from './blocks.js';
import { integer, PCM_BLOCK_FRAMES, PCM_MAX_TRACKS, PcmError } from './types.js';

export type PcmWorkerRequest = { readonly id: number } & (
  | { readonly kind: 'mix'; readonly input: PcmMixInput }
  | { readonly kind: 'waveform'; readonly input: PcmWaveformInput });
export type PcmWorkerReply = { readonly id: number } & (
  | { readonly ok: false; readonly code: string }
  | { readonly ok: true; readonly kind: 'mix'; readonly output: PcmMixResult }
  | { readonly ok: true; readonly kind: 'waveform'; readonly output: PcmWaveformBlock });

/** Call from an App-bundled dedicated Worker message handler. No global handler or Worker is installed implicitly. */
export function executePcmWorkerRequest(request: PcmWorkerRequest): PcmWorkerReply {
  const id = request?.id;
  try {
    if (!integer(id, 1, Number.MAX_SAFE_INTEGER)) throw new PcmError('PCM_WORKER_REQUEST_INVALID');
    if (request.kind === 'mix') return { id, ok: true, kind: 'mix', output: mixPcmBlock(request.input) };
    if (request.kind === 'waveform') return { id, ok: true, kind: 'waveform', output: summarizePcmBlock(request.input) };
    throw new PcmError('PCM_WORKER_REQUEST_INVALID');
  } catch (error) { return { id, ok: false, code: error instanceof PcmError ? error.code : 'PCM_WORKER_REQUEST_INVALID' }; }
}

export function pcmWorkerReplyTransfers(reply: PcmWorkerReply): ArrayBuffer[] {
  if (!reply.ok) return [];
  return reply.kind === 'mix' ? [reply.output.samples.buffer as ArrayBuffer]
    : [reply.output.min.buffer as ArrayBuffer, reply.output.max.buffer as ArrayBuffer];
}

type WorkerPort = Pick<Worker, 'postMessage' | 'addEventListener' | 'removeEventListener' | 'terminate'>;
export interface PcmWorkerClient {
  /** Transfers ownership of the supplied sample buffers; callers must not reuse them. */
  readonly mix: (input: PcmMixInput, signal?: AbortSignal) => Promise<PcmMixResult>;
  readonly waveform: (input: PcmWaveformInput, signal?: AbortSignal) => Promise<PcmWaveformBlock>;
  readonly close: () => void;
}

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-031-canonical-pcm
/** Owns one dedicated Worker. A canceled, failed or timed-out request terminates it; create a fresh client for subsequent work. */
export function createPcmWorkerClient(worker: WorkerPort): PcmWorkerClient {
  let closed = false; let nextId = 0;
  let pending: { id: number; kind: 'mix' | 'waveform'; resolve: (reply: PcmWorkerReply) => void; reject: (error: unknown) => void; cleanup: () => void } | undefined;
  const close = (error: unknown = new PcmError('PCM_WORKER_CLOSED')) => {
    if (closed) return;
    closed = true; worker.removeEventListener('message', onMessage); worker.removeEventListener('error', onError); worker.removeEventListener('messageerror', onError); worker.terminate();
    const request = pending; pending = undefined; request?.cleanup(); request?.reject(error);
  };
  const onError = () => close(new PcmError('PCM_WORKER_FAILED'));
  const onMessage = (event: MessageEvent<PcmWorkerReply>) => {
    const reply = event.data;
    if (!pending || reply?.id !== pending.id) { close(new PcmError('PCM_WORKER_REPLY_INVALID')); return; }
    if (typeof reply.ok !== 'boolean' || (reply.ok && reply.kind !== pending.kind)) { close(new PcmError('PCM_WORKER_REPLY_INVALID')); return; }
    const request = pending; pending = undefined; request.cleanup();
    if (reply.ok) request.resolve(reply); else request.reject(new PcmError(reply.code));
  };
  worker.addEventListener('message', onMessage); worker.addEventListener('error', onError); worker.addEventListener('messageerror', onError);
  const run = (kind: 'mix' | 'waveform', input: PcmMixInput | PcmWaveformInput, signal?: AbortSignal): Promise<PcmWorkerReply> => {
    signal?.throwIfAborted();
    if (closed) throw new PcmError('PCM_WORKER_CLOSED');
    if (pending) throw new PcmError('PCM_WORKER_BUSY');
    const arrays = kind === 'mix' ? (input as PcmMixInput).tracks.map(t => t.samples) : [(input as PcmWaveformInput).samples];
    if (!integer(arrays.length, 1, PCM_MAX_TRACKS) || arrays.some(a => !(a instanceof Float32Array) || !(a.buffer instanceof ArrayBuffer)
      || !integer(a.length, 1, PCM_BLOCK_FRAMES * 2) || a.buffer.byteLength !== a.byteLength)) throw new PcmError('PCM_WORKER_BUFFER_INVALID');
    const transfer = [...new Set(arrays.map(a => a.buffer as ArrayBuffer))];
    return new Promise((resolve, reject) => {
      const abort = () => close(signal?.reason ?? new DOMException('Canceled', 'AbortError'));
      const timer = setTimeout(() => close(new PcmError('PCM_WORKER_TIMEOUT')), 30_000);
      pending = { id: ++nextId, kind, resolve, reject, cleanup: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); } };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      try { worker.postMessage({ id: nextId, kind, input }, transfer); } catch (error) { close(error); }
    });
  };
  return {
    mix: async (input, signal) => {
      const reply = await run('mix', input, signal);
      if (!reply.ok || reply.kind !== 'mix') throw new PcmError('PCM_WORKER_REPLY_INVALID');
      return reply.output;
    },
    waveform: async (input, signal) => {
      const reply = await run('waveform', input, signal);
      if (!reply.ok || reply.kind !== 'waveform') throw new PcmError('PCM_WORKER_REPLY_INVALID');
      return reply.output;
    },
    close: () => close(),
  };
}
