// Dedicated Electron utilityProcess engine host for Nimi Harness (Fork A / Gate 7).
// Isolates openHarness, pi-durable@1.6.0 (SQLite WAL+FULL), SecureWorkspaceExecutionEnv,
// HarnessBodySymbiosisClient, and serveSessions off the Electron main UI thread.
// @nimi-authority: rule.nimi.harness.assistant.security-gates
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  NimiElectronLocalAppHostError,
  type NimiElectronAppBusinessServices,
} from '@nimiplatform/kit/shell/electron/main';
import { openDurableFullStorage } from './durable-sqlite.js';
import { HarnessBodySymbiosisClient } from './body-symbiosis.js';
import { HarnessSubmissionError, openHarness } from './harness.js';
import { serveSessions } from './session-provider.js';

export type EngineWorkerRequest =
  | { id: string; kind: 'verify-sqlite-durability'; dbPath: string }
  | { id: string; kind: 'hash-file'; filePath: string }
  | { id: string; kind: 'ping' };

export type EngineWorkerResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string };

export interface SerializedRpcError {
  readonly message: string;
  readonly name?: string;
  readonly hostReasonCode?: string;
  readonly hostRetryable?: boolean;
  readonly harnessSubmissionCode?: 'HARNESS_REQUEST_CONFLICT' | 'HARNESS_SESSION_BUSY' | 'HARNESS_MODEL_CHANGED';
  readonly code?: string;
  readonly reasonCode?: string;
  readonly actionHint?: string;
  readonly traceId?: string;
  readonly retryable?: boolean;
}

export type MainToWorkerMessage =
  | { type: 'utility-request'; payload: EngineWorkerRequest }
  | {
    type: 'session-ready';
    generation: number;
    dataRoot: string;
    requireSymbiosis: boolean;
    allowInsecureTestFallback?: boolean;
    pendingDeepLinkWorkSessionRef?: string;
  }
  | { type: 'session-invalidated'; generation: number }
  | { type: 'engine-call'; id: string; method: string; args: unknown[] }
  | { type: 'shutdown'; id: string }
  | { type: 'runtime-response'; id: string; ok: true; result: unknown }
  | { type: 'runtime-response'; id: string; ok: false; error: SerializedRpcError }
  | { type: 'runtime-stream-chunk'; streamId: string; value: unknown }
  | { type: 'runtime-stream-end'; streamId: string }
  | { type: 'runtime-stream-error'; streamId: string; error: SerializedRpcError };

export type WorkerToMainMessage =
  | { type: 'utility-response'; payload: EngineWorkerResponse }
  | { type: 'engine-response'; id: string; ok: true; result: unknown }
  | { type: 'engine-response'; id: string; ok: false; error: SerializedRpcError }
  | { type: 'shutdown-ack'; id: string }
  | { type: 'view-changed' }
  | { type: 'focus-session'; workSessionRef: string }
  | { type: 'lease-lost'; reason: string }
  | { type: 'worker-log'; text: string }
  | { type: 'runtime-call'; id: string; generation: number; path: string; args: unknown[] }
  | { type: 'runtime-stream-open'; streamId: string; generation: number; path: string; args: unknown[] }
  | { type: 'runtime-stream-close'; streamId: string };

export function serializeRpcError(error: unknown): SerializedRpcError {
  if (error instanceof NimiElectronLocalAppHostError) {
    return {
      message: error.message,
      name: error.name,
      hostReasonCode: error.reasonCode,
      hostRetryable: error.retryable,
    };
  }
  if (error instanceof HarnessSubmissionError) {
    return {
      message: error.message,
      name: error.name,
      harnessSubmissionCode: error.code,
    };
  }
  if (error instanceof Error) {
    const rec = error as unknown as Record<string, unknown>;
    return {
      message: error.message,
      name: error.name,
      ...(typeof rec.code === 'string' ? { code: rec.code } : {}),
      ...(typeof rec.reasonCode === 'string' ? { reasonCode: rec.reasonCode } : {}),
      ...(typeof rec.actionHint === 'string' ? { actionHint: rec.actionHint } : {}),
      ...(typeof rec.traceId === 'string' ? { traceId: rec.traceId } : {}),
      ...(typeof rec.retryable === 'boolean' ? { retryable: rec.retryable } : {}),
    };
  }
  return { message: String(error) };
}

export function deserializeRpcError(serialized: SerializedRpcError): Error {
  if (serialized.hostReasonCode) {
    return new NimiElectronLocalAppHostError(
      serialized.hostReasonCode as ConstructorParameters<typeof NimiElectronLocalAppHostError>[0],
      Boolean(serialized.hostRetryable),
    );
  }
  if (serialized.harnessSubmissionCode) {
    return new HarnessSubmissionError(serialized.harnessSubmissionCode, serialized.message);
  }
  const err = new Error(serialized.message);
  if (serialized.name) err.name = serialized.name;
  const rec = err as unknown as Record<string, unknown>;
  if (serialized.code !== undefined) rec.code = serialized.code;
  if (serialized.reasonCode !== undefined) rec.reasonCode = serialized.reasonCode;
  if (serialized.actionHint !== undefined) rec.actionHint = serialized.actionHint;
  if (serialized.traceId !== undefined) rec.traceId = serialized.traceId;
  if (serialized.retryable !== undefined) rec.retryable = serialized.retryable;
  return err;
}

export async function handleEngineWorkerRequest(req: EngineWorkerRequest): Promise<EngineWorkerResponse> {
  try {
    if (req.kind === 'ping') {
      return { id: req.id, ok: true, result: { pong: true, pid: process.pid } };
    }
    if (req.kind === 'verify-sqlite-durability') {
      const opened = await openDurableFullStorage(req.dbPath);
      const { journalMode, synchronous } = opened;
      await opened.db.close();
      return { id: req.id, ok: true, result: { journalMode, synchronous } };
    }
    if (req.kind === 'hash-file') {
      const bytes = await readFile(req.filePath);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      return { id: req.id, ok: true, result: { sha256, bytes: bytes.byteLength } };
    }
    return { id: (req as { id: string }).id, ok: false, error: 'Unsupported worker command.' };
  } catch (error) {
    return { id: req.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface WorkerPortLike {
  on(event: 'message', listener: (ev: { data: unknown } | unknown) => void): void;
  postMessage(message: unknown): void;
}

export interface UtilityProcessLike {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
  kill(): boolean;
}

type AsyncQueueItem =
  | { kind: 'chunk'; value: unknown }
  | { kind: 'end' }
  | { kind: 'error'; error: Error };

class RpcStreamQueue {
  private readonly items: AsyncQueueItem[] = [];
  private readonly waiters: Array<(item: AsyncQueueItem) => void> = [];
  private closed = false;

  push(item: AsyncQueueItem): void {
    if (this.closed) return;
    if (item.kind === 'end' || item.kind === 'error') {
      this.closed = true;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
      return;
    }
    this.items.push(item);
  }

  next(): Promise<AsyncQueueItem> {
    if (this.items.length > 0) {
      return Promise.resolve(this.items.shift()!);
    }
    if (this.closed) {
      return Promise.resolve({ kind: 'end' });
    }
    return new Promise<AsyncQueueItem>(resolve => {
      this.waiters.push(resolve);
    });
  }
}

const ALLOWED_ENGINE_METHODS = new Set<string>([
  'snapshot',
  'importHome',
  'importMaterial',
  'listFiles',
  'previewFile',
  'revealFile',
  'revealWorkspace',
  'setWorkspace',
  'create',
  'select',
  'selectByWorkSessionRef',
  'rename',
  'deleteSession',
  'pinSession',
  'setPermissionMode',
  'setReasoningEffort',
  'exportMarkdown',
  'listIntegrations',
  'withdraw',
  'setInstructions',
  'submit',
  'decide',
  'listSnapshots',
  'restoreSnapshot',
  'reviewModel',
  'stop',
  'resume',
]);

async function collectAssetBodyBytes(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  if (body instanceof Blob) {
    return new Uint8Array(await body.arrayBuffer());
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/**
 * Attaches the full Harness engine lifecycle (openHarness, pi-durable SQLite,
 * SecureWorkspaceExecutionEnv, HarnessBodySymbiosisClient, serveSessions) onto
 * an Electron utilityProcess parentPort (or an in-memory test port).
 */
export function attachHarnessEngineWorker(port: WorkerPortLike): { dispose(): Promise<void> } {
  const send = (msg: WorkerToMainMessage) => port.postMessage(msg);
  const pendingRuntimeCalls = new Map<string, { resolve: (val: unknown) => void; reject: (err: Error) => void }>();
  const activeRuntimeStreams = new Map<string, RpcStreamQueue>();

  let currentGeneration = 0;
  let currentDataRoot = '';
  let currentRequireSymbiosis = true;
  let currentAllowInsecureTestFallback = false;
  let account = new AbortController();
  let harnessPromise: ReturnType<typeof openHarness> | undefined;
  let symbiosis: HarnessBodySymbiosisClient | undefined;
  let retiring = Promise.resolve();
  let viewDebounceTimer: ReturnType<typeof setTimeout> | undefined;

  const log = (text: string) => send({ type: 'worker-log', text });

  const runtimeCall = <T = unknown>(generation: number, path: string, args: unknown[]): Promise<T> => {
    if (generation !== currentGeneration) {
      return Promise.reject(new NimiElectronLocalAppHostError('session-invalid', false));
    }
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      pendingRuntimeCalls.set(id, { resolve: v => resolve(v as T), reject });
      send({ type: 'runtime-call', id, generation, path, args });
    });
  };

  const runtimeStream = <T = unknown>(
    generation: number,
    path: string,
    args: unknown[],
    signal?: AbortSignal,
  ): AsyncIterable<T> => {
    const streamId = randomUUID();
    const queue = new RpcStreamQueue();
    activeRuntimeStreams.set(streamId, queue);
    const closeRemote = () => {
      if (activeRuntimeStreams.delete(streamId)) {
        queue.push({ kind: 'end' });
        send({ type: 'runtime-stream-close', streamId });
      }
    };
    const onAbort = () => closeRemote();
    if (signal?.aborted || generation !== currentGeneration) {
      closeRemote();
    } else {
      signal?.addEventListener('abort', onAbort, { once: true });
      send({ type: 'runtime-stream-open', streamId, generation, path, args });
    }
    return {
      async *[Symbol.asyncIterator]() {
        try {
          for (;;) {
            if (signal?.aborted) return;
            const item = await queue.next();
            if (item.kind === 'end') return;
            if (item.kind === 'error') throw item.error;
            yield item.value as T;
          }
        } finally {
          signal?.removeEventListener('abort', onAbort);
          closeRemote();
        }
      },
    };
  };

  const createBusinessServicesProxy = (generation: number): NimiElectronAppBusinessServices => {
    const STREAM_AGENT_METHODS = new Set([
      'subscribeBodyOutbox',
      'streamLocalAgentBodyStep',
      'watchSessionOverview',
      'subscribeBrainSessionEvents',
    ]);
    const agentSession = new Proxy({} as NimiElectronAppBusinessServices['agentSession'], {
      get(_target, prop: string) {
        if (STREAM_AGENT_METHODS.has(prop)) {
          return (body: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }) =>
            runtimeStream(generation, `agentSession.${prop}`, [body, options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : undefined], options?.signal);
        }
        return (body: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }) => {
          if (options?.signal?.aborted) {
            return Promise.reject(new Error('AgentSessionService request aborted.'));
          }
          return runtimeCall(generation, `agentSession.${prop}`, [body, options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : undefined]);
        };
      },
    });

    const storageAssets = {
      stat: (relativePath: string) => runtimeCall(generation, 'storage.assets.stat', [relativePath]),
      list: (input: unknown) => runtimeCall(generation, 'storage.assets.list', [input]),
      remove: (relativePath: string) => runtimeCall(generation, 'storage.assets.remove', [relativePath]),
      move: (input: unknown) => runtimeCall(generation, 'storage.assets.move', [input]),
      reveal: (relativePath: string) => runtimeCall(generation, 'storage.assets.reveal', [relativePath]),
      adoptArtifact: (input: unknown) => runtimeCall(generation, 'storage.assets.adoptArtifact', [input]),
      write: async (input: { relativePath: string; mediaType?: string; overwrite?: boolean; body: unknown }) => {
        const bytes = await collectAssetBodyBytes(input.body);
        return runtimeCall(generation, 'storage.assets.write', [{
          relativePath: input.relativePath,
          ...(input.mediaType !== undefined ? { mediaType: input.mediaType } : {}),
          ...(input.overwrite !== undefined ? { overwrite: input.overwrite } : {}),
          bytes,
        }]);
      },
      read: async (input: unknown) => {
        const result = await runtimeCall<{ asset: unknown; range: unknown; bytes: Uint8Array }>(generation, 'storage.assets.read', [input]);
        return {
          asset: result.asset,
          range: result.range,
          body: {
            async *[Symbol.asyncIterator]() {
              if (result.bytes && result.bytes.byteLength > 0) {
                yield result.bytes;
              }
            },
          },
        };
      },
    };

    const makeUnaryProxy = (prefix: string) => new Proxy({} as Record<string, unknown>, {
      get(_target, prop: string) {
        return (...args: unknown[]) => runtimeCall(generation, `${prefix}.${prop}`, args);
      },
    });

    const ai = {
      text: {
        streamTurn: async (input: unknown) => {
          const iterable = runtimeStream(generation, 'ai.text.streamTurn', [input]);
          return { events: iterable, cancel: async () => {} };
        },
      },
      scenario: {
        execute: (spec: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }) => {
          if (options?.signal?.aborted) return Promise.reject(new Error('Scenario execution aborted.'));
          return runtimeCall(generation, 'ai.scenario.execute', [spec, options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : undefined]);
        },
      },
      scenarioJobs: {
        submit: (spec: unknown, options?: unknown) => runtimeCall(generation, 'ai.scenarioJobs.submit', [spec, options]),
        get: (jobId: string, clientSubmissionId?: string) => runtimeCall(generation, 'ai.scenarioJobs.get', [jobId, clientSubmissionId]),
        subscribe: async (jobId: string) => {
          const iterable = runtimeStream(generation, 'ai.scenarioJobs.subscribe', [jobId]);
          return { events: iterable, cancel: async () => {} };
        },
        cancel: (jobId: string, reason?: string) => runtimeCall(generation, 'ai.scenarioJobs.cancel', [jobId, reason]),
      },
      artifacts: makeUnaryProxy('ai.artifacts'),
      voiceAssets: makeUnaryProxy('ai.voiceAssets'),
    };

    const storage = {
      readJson: (relativePath: string) => runtimeCall(generation, 'storage.readJson', [relativePath]),
      writeJson: (relativePath: string, value: unknown) => runtimeCall(generation, 'storage.writeJson', [relativePath, value]),
      removeJson: (relativePath: string) => runtimeCall(generation, 'storage.removeJson', [relativePath]),
      assets: storageAssets,
    };

    return {
      ai,
      agentSession,
      storage,
      aiConfig: makeUnaryProxy('aiConfig'),
      integration: makeUnaryProxy('integration'),
      activity: makeUnaryProxy('activity'),
      agentWork: makeUnaryProxy('agentWork'),
      realm: { worldCore: makeUnaryProxy('realm.worldCore') },
    } as unknown as NimiElectronAppBusinessServices;
  };

  let currentServices: NimiElectronAppBusinessServices | undefined;

  const notifyViewChanged = () => {
    if (account.signal.aborted) return;
    if (viewDebounceTimer) return;
    viewDebounceTimer = setTimeout(() => {
      viewDebounceTimer = undefined;
      if (!account.signal.aborted) {
        send({ type: 'view-changed' });
      }
    }, 60);
    viewDebounceTimer.unref?.();
  };

  function getHarness(): ReturnType<typeof openHarness> {
    if (harnessPromise) return harnessPromise;
    if (!currentServices || !currentDataRoot) {
      return Promise.reject(new NimiElectronLocalAppHostError('session-invalid', true));
    }
    const signal = account.signal;
    const services = currentServices;
    const dataRoot = currentDataRoot;
    const requireSymbiosis = currentRequireSymbiosis;
    const allowInsecureTestFallback = currentAllowInsecureTestFallback;
    const pending = retiring.then(() => {
      signal.throwIfAborted();
      return openHarness(services, signal, notifyViewChanged, {
        dataRoot,
        symbiosis,
        requireSymbiosis,
        allowInsecureTestFallback,
      });
    });
    harnessPromise = pending;
    void pending.catch(() => {
      if (harnessPromise === pending) harnessPromise = undefined;
    });
    return pending;
  }

  async function resolvePersistentDeviceId(storage: NimiElectronAppBusinessServices['storage'], signal: AbortSignal): Promise<string> {
    try {
      const existing = (await storage.readJson('harness-device-id.json')).value;
      if (typeof existing === 'string' && /^[A-Za-z0-9._-]{8,128}$/.test(existing)) {
        return existing;
      }
    } catch {
      // Missing device id; allocate durably under account storage.
    }
    signal.throwIfAborted();
    const created = `pc-${randomUUID()}`;
    await storage.writeJson('harness-device-id.json', created).catch(() => {});
    return created;
  }

  async function closeActiveSession(): Promise<void> {
    if (viewDebounceTimer) {
      clearTimeout(viewDebounceTimer);
      viewDebounceTimer = undefined;
    }
    // Bump generation FIRST so any teardown RPC (e.g. unregisterBodyCarrier) cannot hang on a dead/invalidated bridge.
    currentGeneration += 1;
    account.abort();
    account = new AbortController();
    for (const entry of pendingRuntimeCalls.values()) {
      entry.reject(new NimiElectronLocalAppHostError('session-invalid', false));
    }
    pendingRuntimeCalls.clear();
    for (const [streamId, queue] of activeRuntimeStreams.entries()) {
      queue.push({ kind: 'end' });
      activeRuntimeStreams.delete(streamId);
    }
    const prevHarness = harnessPromise;
    const prevSymbiosis = symbiosis;
    harnessPromise = undefined;
    symbiosis = undefined;
    currentServices = undefined;
    const closing = retiring.then(async () => {
      await prevSymbiosis?.stop().catch(() => undefined);
      const opened = await prevHarness?.catch(() => undefined);
      await opened?.close().catch(() => undefined);
    });
    retiring = closing;
    await closing;
  }

  async function startSession(msg: Extract<MainToWorkerMessage, { type: 'session-ready' }>): Promise<void> {
    await closeActiveSession();
    currentGeneration = msg.generation;
    currentDataRoot = msg.dataRoot;
    currentRequireSymbiosis = msg.requireSymbiosis;
    currentAllowInsecureTestFallback = Boolean(msg.allowInsecureTestFallback);
    const services = createBusinessServicesProxy(msg.generation);
    currentServices = services;
    const signal = account.signal;

    // 1. Start integration session provider inside worker.
    void serveSessions(services.integration, getHarness, signal).catch(error => {
      if (!signal.aborted) {
        log(`[nimi-harness-integration] ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    // 2. Start Brain-Body Symbiosis coordinator inside worker.
    void (async () => {
      try {
        if (signal.aborted) return;
        const deviceId = await resolvePersistentDeviceId(services.storage, signal);
        signal.throwIfAborted();
        const client = new HarnessBodySymbiosisClient({
          deviceId,
          client: services.agentSession,
          handlers: {
            onPurgeSession: async (workSessionRef) => {
              await (await getHarness()).handleBodyPurgeSession(workSessionRef);
              notifyViewChanged();
            },
            onPurgeAgent: async (agentBinding) => {
              await (await getHarness()).handleBodyPurgeAgent(agentBinding);
              notifyViewChanged();
            },
            onInvalidateMemory: async (workSessionRef) => {
              await (await getHarness()).handleBodyInvalidateMemory(workSessionRef);
              notifyViewChanged();
            },
            onNewIntent: async (env) => {
              await (await getHarness()).handleBodyNewIntent(env);
              notifyViewChanged();
            },
            onReconcileAfterTombstones: async () => (await getHarness()).listBodyProjectionsForReconcile(),
            onLeaseLost: (reason) => {
              log(`[nimi-harness-symbiosis] lease lost: ${reason}`);
              send({ type: 'lease-lost', reason });
              notifyViewChanged();
            },
          },
        });
        symbiosis = client;
        if (harnessPromise) {
          const active = await harnessPromise.catch(() => undefined);
          if (active) await active.attachSymbiosis(client);
        }
        await client.start(signal);
        if (msg.pendingDeepLinkWorkSessionRef && !signal.aborted) {
          const ref = msg.pendingDeepLinkWorkSessionRef;
          const selected = await (await getHarness()).selectByWorkSessionRef(ref).catch(() => false);
          if (selected) {
            send({ type: 'focus-session', workSessionRef: ref });
            notifyViewChanged();
          }
        }
      } catch (error) {
        if (!signal.aborted) {
          log(`[nimi-harness-symbiosis] ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    })();
  }

  const onMessage = (rawEvent: { data: unknown } | unknown) => {
    const msg = (rawEvent && typeof rawEvent === 'object' && 'data' in rawEvent
      ? (rawEvent as { data: unknown }).data
      : rawEvent) as MainToWorkerMessage | EngineWorkerRequest | undefined;
    if (!msg || typeof msg !== 'object') return;

    // Backward-compatible direct EngineWorkerRequest format (id + kind).
    if ('kind' in msg && typeof msg.kind === 'string' && 'id' in msg) {
      void handleEngineWorkerRequest(msg as EngineWorkerRequest).then(res => port.postMessage(res));
      return;
    }

    const typed = msg as MainToWorkerMessage;
    switch (typed.type) {
      case 'utility-request':
        void handleEngineWorkerRequest(typed.payload).then(payload => send({ type: 'utility-response', payload }));
        break;
      case 'session-ready':
        void startSession(typed);
        break;
      case 'session-invalidated':
        currentGeneration = typed.generation;
        void closeActiveSession();
        break;
      case 'shutdown':
        void closeActiveSession().finally(() => send({ type: 'shutdown-ack', id: typed.id }));
        break;
      case 'engine-call':
        void (async () => {
          try {
            if (!ALLOWED_ENGINE_METHODS.has(typed.method)) {
              throw new Error(`Unsupported Harness engine method: ${typed.method}`);
            }
            const h = await getHarness();
            const fn = (h as unknown as Record<string, (...a: unknown[]) => unknown>)[typed.method];
            if (typeof fn !== 'function') {
              throw new Error(`Harness engine method unavailable: ${typed.method}`);
            }
            const result = await fn.apply(h, typed.args ?? []);
            send({ type: 'engine-response', id: typed.id, ok: true, result });
          } catch (error) {
            send({ type: 'engine-response', id: typed.id, ok: false, error: serializeRpcError(error) });
          }
        })();
        break;
      case 'runtime-response': {
        const entry = pendingRuntimeCalls.get(typed.id);
        if (!entry) return;
        pendingRuntimeCalls.delete(typed.id);
        if (typed.ok) entry.resolve(typed.result);
        else entry.reject(deserializeRpcError(typed.error));
        break;
      }
      case 'runtime-stream-chunk': {
        activeRuntimeStreams.get(typed.streamId)?.push({ kind: 'chunk', value: typed.value });
        break;
      }
      case 'runtime-stream-end': {
        const queue = activeRuntimeStreams.get(typed.streamId);
        activeRuntimeStreams.delete(typed.streamId);
        queue?.push({ kind: 'end' });
        break;
      }
      case 'runtime-stream-error': {
        const queue = activeRuntimeStreams.get(typed.streamId);
        activeRuntimeStreams.delete(typed.streamId);
        queue?.push({ kind: 'error', error: deserializeRpcError(typed.error) });
        break;
      }
    }
  };

  port.on('message', onMessage);
  return { dispose: closeActiveSession };
}

function resolveDottedMethod(root: unknown, dottedPath: string): { owner: unknown; fn: (...args: unknown[]) => unknown } {
  const parts = dottedPath.split('.');
  let current: unknown = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current || typeof current !== 'object') {
      throw new Error(`Runtime service path unavailable: ${dottedPath}`);
    }
    current = (current as Record<string, unknown>)[parts[i]!];
  }
  const fnName = parts[parts.length - 1]!;
  const fn = current && typeof current === 'object' ? (current as Record<string, unknown>)[fnName] : undefined;
  if (typeof fn !== 'function') {
    throw new Error(`Runtime service method unavailable: ${dottedPath}`);
  }
  return { owner: current, fn: fn as (...args: unknown[]) => unknown };
}

export interface HarnessEngineWorkerClientOptions {
  readonly onViewChanged?: () => void;
  readonly onFocusSession?: (workSessionRef: string) => void;
  readonly onLeaseLost?: (reason: string) => void;
  readonly onCrash?: (exitCode: number) => void;
  readonly onLog?: (text: string) => void;
}

/**
 * Main-process supervisor and typed RPC client for the dedicated Harness engine
 * utilityProcess. Proxies Nimi Runtime business services into the worker, routes
 * all Harness IPC commands off the main thread, and handles worker crashes fail-closed.
 */
export class HarnessEngineWorkerClient {
  private readonly pendingUtility = new Map<string, { resolve: (val: unknown) => void; reject: (err: Error) => void }>();
  private readonly pendingEngine = new Map<string, { resolve: (val: unknown) => void; reject: (err: Error) => void }>();
  private readonly pendingShutdown = new Map<string, () => void>();
  private readonly activeStreams = new Map<string, { cancel: () => Promise<void> }>();
  private currentGeneration = 0;
  private activeServices: NimiElectronAppBusinessServices | undefined;
  private crashedExitCode: number | undefined;
  private disposed = false;

  constructor(
    private readonly proc: UtilityProcessLike,
    private readonly options: HarnessEngineWorkerClientOptions = {},
  ) {
    proc.on('message', raw => {
      this.handleWorkerMessage(raw);
    });
    proc.on('exit', code => {
      this.disposed = true;
      this.crashedExitCode = code;
      const err = new Error(`Nimi Harness engine process exited unexpectedly (code=${code}).`);
      this.rejectAllPending(err);
      this.cancelAllStreams();
      this.options.onCrash?.(code);
      this.options.onViewChanged?.();
    });
  }

  private rejectAllPending(err: Error): void {
    for (const entry of this.pendingUtility.values()) entry.reject(err);
    this.pendingUtility.clear();
    for (const entry of this.pendingEngine.values()) entry.reject(err);
    this.pendingEngine.clear();
    for (const done of this.pendingShutdown.values()) done();
    this.pendingShutdown.clear();
  }

  private cancelAllStreams(): void {
    for (const [streamId, handle] of this.activeStreams.entries()) {
      this.activeStreams.delete(streamId);
      void handle.cancel().catch(() => {});
    }
  }

  private assertAlive(): void {
    if (this.disposed) {
      throw new Error(
        this.crashedExitCode !== undefined
          ? `Nimi Harness engine process exited unexpectedly (code=${this.crashedExitCode}). Restart Nimi Harness to continue.`
          : 'Nimi Harness engine process is closed.',
      );
    }
  }

  private handleWorkerMessage(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    // Backward-compatible direct EngineWorkerResponse (id + ok).
    if ('ok' in raw && 'id' in raw && !('type' in raw)) {
      const res = raw as EngineWorkerResponse;
      const entry = this.pendingUtility.get(res.id);
      if (!entry) return;
      this.pendingUtility.delete(res.id);
      if (res.ok) entry.resolve(res.result);
      else entry.reject(new Error(res.error));
      return;
    }

    const msg = raw as WorkerToMainMessage;
    switch (msg.type) {
      case 'utility-response': {
        const entry = this.pendingUtility.get(msg.payload.id);
        if (!entry) return;
        this.pendingUtility.delete(msg.payload.id);
        if (msg.payload.ok) entry.resolve(msg.payload.result);
        else entry.reject(new Error(msg.payload.error));
        break;
      }
      case 'engine-response': {
        const entry = this.pendingEngine.get(msg.id);
        if (!entry) return;
        this.pendingEngine.delete(msg.id);
        if (msg.ok) entry.resolve(msg.result);
        else entry.reject(deserializeRpcError(msg.error));
        break;
      }
      case 'shutdown-ack': {
        const done = this.pendingShutdown.get(msg.id);
        if (done) {
          this.pendingShutdown.delete(msg.id);
          done();
        }
        break;
      }
      case 'view-changed':
        this.options.onViewChanged?.();
        break;
      case 'focus-session':
        this.options.onFocusSession?.(msg.workSessionRef);
        break;
      case 'lease-lost':
        this.options.onLeaseLost?.(msg.reason);
        break;
      case 'worker-log':
        this.options.onLog?.(msg.text);
        break;
      case 'runtime-call':
        void this.handleRuntimeCall(msg);
        break;
      case 'runtime-stream-open':
        void this.handleRuntimeStreamOpen(msg);
        break;
      case 'runtime-stream-close': {
        const handle = this.activeStreams.get(msg.streamId);
        if (handle) {
          this.activeStreams.delete(msg.streamId);
          void handle.cancel().catch(() => {});
        }
        break;
      }
    }
  }

  private async handleRuntimeCall(msg: Extract<WorkerToMainMessage, { type: 'runtime-call' }>): Promise<void> {
    try {
      const services = this.activeServices;
      if (!services || msg.generation !== this.currentGeneration) {
        throw new NimiElectronLocalAppHostError('session-invalid', false);
      }
      let result: unknown;
      if (msg.path === 'storage.assets.write') {
        const input = msg.args[0] as { relativePath: string; mediaType?: string; overwrite?: boolean; bytes: Uint8Array };
        result = await services.storage.assets.write({
          relativePath: input.relativePath,
          ...(input.mediaType !== undefined ? { mediaType: input.mediaType } : {}),
          ...(input.overwrite !== undefined ? { overwrite: input.overwrite } : {}),
          body: input.bytes,
        });
      } else if (msg.path === 'storage.assets.read') {
        const opened = await services.storage.assets.read(msg.args[0] as Parameters<typeof services.storage.assets.read>[0]);
        const bytes = await collectAssetBodyBytes(opened.body);
        result = { asset: opened.asset, range: opened.range, bytes };
      } else {
        const { owner, fn } = resolveDottedMethod(services, msg.path);
        result = await fn.apply(owner, msg.args);
      }
      if (!this.disposed) {
        this.proc.postMessage({ type: 'runtime-response', id: msg.id, ok: true, result } satisfies MainToWorkerMessage);
      }
    } catch (error) {
      if (!this.disposed) {
        this.proc.postMessage({
          type: 'runtime-response',
          id: msg.id,
          ok: false,
          error: serializeRpcError(error),
        } satisfies MainToWorkerMessage);
      }
    }
  }

  private async handleRuntimeStreamOpen(msg: Extract<WorkerToMainMessage, { type: 'runtime-stream-open' }>): Promise<void> {
    const controller = new AbortController();
    let cancelFn: (() => Promise<void>) | undefined;
    let closed = false;
    const cancel = async () => {
      if (closed) return;
      closed = true;
      controller.abort();
      if (cancelFn) await cancelFn().catch(() => {});
    };
    this.activeStreams.set(msg.streamId, { cancel });
    try {
      const services = this.activeServices;
      if (!services || msg.generation !== this.currentGeneration) {
        throw new NimiElectronLocalAppHostError('session-invalid', false);
      }
      const { owner, fn } = resolveDottedMethod(services, msg.path);
      const callArgs = [...msg.args];
      if (msg.path.startsWith('agentSession.')) {
        const existingOpts = (callArgs[1] && typeof callArgs[1] === 'object' ? callArgs[1] : {}) as Record<string, unknown>;
        callArgs[1] = { ...existingOpts, signal: controller.signal };
      }
      const streamObj = await fn.apply(owner, callArgs) as AsyncIterable<unknown> | { events: AsyncIterable<unknown>; cancel?: () => Promise<void> };
      const iterable: AsyncIterable<unknown> = (streamObj && typeof streamObj === 'object' && 'events' in streamObj)
        ? streamObj.events
        : (streamObj as AsyncIterable<unknown>);
      if (streamObj && typeof streamObj === 'object' && 'cancel' in streamObj && typeof streamObj.cancel === 'function') {
        cancelFn = streamObj.cancel;
      }
      for await (const chunk of iterable) {
        if (closed || this.disposed || msg.generation !== this.currentGeneration) break;
        this.proc.postMessage({ type: 'runtime-stream-chunk', streamId: msg.streamId, value: chunk } satisfies MainToWorkerMessage);
      }
      if (!this.disposed) {
        this.proc.postMessage({ type: 'runtime-stream-end', streamId: msg.streamId } satisfies MainToWorkerMessage);
      }
    } catch (error) {
      if (!closed && !this.disposed) {
        this.proc.postMessage({
          type: 'runtime-stream-error',
          streamId: msg.streamId,
          error: serializeRpcError(error),
        } satisfies MainToWorkerMessage);
      }
    } finally {
      this.activeStreams.delete(msg.streamId);
      await cancel();
    }
  }

  activateSession(
    services: NimiElectronAppBusinessServices,
    options: {
      readonly dataRoot: string;
      readonly requireSymbiosis: boolean;
      readonly allowInsecureTestFallback?: boolean;
      readonly pendingDeepLinkWorkSessionRef?: string;
    },
  ): void {
    this.assertAlive();
    this.cancelAllStreams();
    this.currentGeneration += 1;
    this.activeServices = services;
    this.proc.postMessage({
      type: 'session-ready',
      generation: this.currentGeneration,
      dataRoot: options.dataRoot,
      requireSymbiosis: options.requireSymbiosis,
      ...(options.allowInsecureTestFallback !== undefined ? { allowInsecureTestFallback: options.allowInsecureTestFallback } : {}),
      ...(options.pendingDeepLinkWorkSessionRef ? { pendingDeepLinkWorkSessionRef: options.pendingDeepLinkWorkSessionRef } : {}),
    } satisfies MainToWorkerMessage);
  }

  invalidateSession(): void {
    this.cancelAllStreams();
    this.currentGeneration += 1;
    this.activeServices = undefined;
    if (!this.disposed) {
      this.proc.postMessage({ type: 'session-invalidated', generation: this.currentGeneration } satisfies MainToWorkerMessage);
    }
  }

  callEngine<T = unknown>(method: string, args: unknown[] = [], timeoutMs = 120_000): Promise<T> {
    try {
      this.assertAlive();
    } catch (error) {
      return Promise.reject(error);
    }
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingEngine.delete(id)) {
          reject(new Error(`Harness engine call "${method}" timed out.`));
        }
      }, timeoutMs);
      timer.unref?.();
      this.pendingEngine.set(id, {
        resolve: val => { clearTimeout(timer); resolve(val as T); },
        reject: err => { clearTimeout(timer); reject(err); },
      });
      this.proc.postMessage({ type: 'engine-call', id, method, args } satisfies MainToWorkerMessage);
    });
  }

  request<T>(payload: Omit<EngineWorkerRequest, 'id'>, timeoutMs = 15_000): Promise<T> {
    try {
      this.assertAlive();
    } catch (error) {
      return Promise.reject(error);
    }
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingUtility.delete(id)) {
          reject(new Error(`Engine utilityProcess request "${payload.kind}" timed out.`));
        }
      }, timeoutMs);
      timer.unref?.();
      this.pendingUtility.set(id, {
        resolve: val => { clearTimeout(timer); resolve(val as T); },
        reject: err => { clearTimeout(timer); reject(err); },
      });
      this.proc.postMessage({ type: 'utility-request', payload: { ...payload, id } as EngineWorkerRequest } satisfies MainToWorkerMessage);
    });
  }

  async shutdown(timeoutMs = 5_000): Promise<void> {
    this.cancelAllStreams();
    this.activeServices = undefined;
    if (this.disposed) return;
    const id = randomUUID();
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        this.pendingShutdown.delete(id);
        resolve();
      }, timeoutMs);
      timer.unref?.();
      this.pendingShutdown.set(id, () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        this.proc.postMessage({ type: 'shutdown', id } satisfies MainToWorkerMessage);
      } catch {
        clearTimeout(timer);
        this.pendingShutdown.delete(id);
        resolve();
      }
    });
    this.close();
  }

  close(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelAllStreams();
    this.rejectAllPending(new Error('Engine utilityProcess closed.'));
    try { this.proc.kill(); } catch { /* already terminated */ }
  }
}

/** Backward-compatible alias for utility-only callers. */
export const EngineWorkerHostClient = HarnessEngineWorkerClient;

// When spawned inside Electron utilityProcess, automatically attach the full Harness engine host.
const parentPort = (process as unknown as {
  parentPort?: WorkerPortLike;
}).parentPort;

if (parentPort) {
  attachHarnessEngineWorker(parentPort);
}
