import type { AgentDataBundle } from '../driver/types.js';
import type { EmbodimentProjectionApi, ProjectionBounds } from './embodiment-projection-api.js';
import type { ActivityOrEventHandler, ContinuousHandler } from './handler-types.js';
import { assertSandboxSourcePolicy } from './handler-sandbox-policy.js';

type SandboxHandlerKind = 'activity-event' | 'continuous';

type WorkerRequest =
  | {
      type: 'load';
      requestId: string;
      source: string;
      handlerKind: SandboxHandlerKind;
    }
  | {
      type: 'execute';
      requestId: string;
      ctx: AgentDataBundle;
      snapshot: SandboxProjectionSnapshot;
    }
  | {
      type: 'update';
      requestId: string;
      ctx: AgentDataBundle;
      snapshot: SandboxProjectionSnapshot;
    }
  | {
      type: 'abort';
      requestId: string;
    }
  | {
      type: 'projection-result';
      requestId: string;
      callId: string;
      ok: boolean;
      value?: unknown;
      error?: string;
    };

type WorkerResponse =
  | {
      type: 'ready';
      requestId: string;
      meta?: unknown;
      fps?: number;
    }
  | {
      type: 'done';
      requestId: string;
    }
  | {
      type: 'error';
      requestId: string;
      error: string;
    }
  | {
      type: 'projection-call';
      requestId: string;
      callId: string;
      method: ProjectionRpcMethod;
      args: unknown[];
    };

type SandboxProjectionSnapshot = {
  surfaceBounds: ProjectionBounds;
};

type ProjectionRpcMethod =
  | 'triggerMotion'
  | 'stopMotion'
  | 'setSignal'
  | 'addSignal'
  | 'setExpression'
  | 'clearExpression'
  | 'setPose'
  | 'clearPose'
  | 'runDefaultActivity';

type SandboxWorker = Pick<Worker, 'postMessage' | 'terminate' | 'addEventListener' | 'removeEventListener'>;

export type SandboxWorkerFactory = () => SandboxWorker;

type PendingRequest = {
  resolve(value: WorkerResponse): void;
  reject(error: Error): void;
  timerId: ReturnType<typeof globalThis.setTimeout>;
  signal?: AbortSignal;
  abortListener?: () => void;
};

const EXECUTE_TIMEOUT_MS = 5000;
const UPDATE_TIMEOUT_MS = 1000;
const LOAD_TIMEOUT_MS = 2000;

function makeRequestId(): string {
  return `nas-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function defaultWorkerFactory(): SandboxWorker {
  return new Worker(new URL('./handler-sandbox-worker.ts', import.meta.url), {
    type: 'module',
    name: 'nimi-nas-handler-sandbox',
  });
}

function messageData(event: MessageEvent<WorkerResponse>): WorkerResponse {
  return event.data;
}

function errorFromUnknown(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function callProjection(
  projection: EmbodimentProjectionApi,
  method: ProjectionRpcMethod,
  args: unknown[],
  ctx: AgentDataBundle,
  signal: AbortSignal | undefined,
): Promise<unknown> | unknown {
  switch (method) {
    case 'triggerMotion':
      return projection.triggerMotion(String(args[0] ?? ''), typeof args[1] === 'object' && args[1] !== null ? args[1] : undefined);
    case 'stopMotion':
      return projection.stopMotion();
    case 'setSignal':
      return projection.setSignal(String(args[0] ?? ''), Number(args[1] ?? 0), args[2] === undefined ? undefined : Number(args[2]));
    case 'addSignal':
      return projection.addSignal(String(args[0] ?? ''), Number(args[1] ?? 0));
    case 'setExpression':
      return projection.setExpression(String(args[0] ?? ''));
    case 'clearExpression':
      return projection.clearExpression();
    case 'setPose':
      return projection.setPose(String(args[0] ?? ''), Boolean(args[1]));
    case 'clearPose':
      return projection.clearPose();
    case 'runDefaultActivity': {
      if (typeof projection.runDefaultActivity !== 'function') {
        throw new Error('projection.runDefaultActivity is not available');
      }
      return projection.runDefaultActivity(String(args[0] ?? ''), {
        bundle: ctx,
        signal: signal ?? new AbortController().signal,
      });
    }
    default:
      throw new Error(`unsupported projection method: ${method}`);
  }
}

class NasWorkerSandbox {
  private worker: SandboxWorker | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly onMessage = (event: Event) => {
    const data = messageData(event as MessageEvent<WorkerResponse>);
    if (data.type === 'projection-call') {
      void this.handleProjectionCall(data);
      return;
    }
    const pending = this.pending.get(data.requestId);
    if (!pending) return;
    this.finishPending(data.requestId, pending);
    if (data.type === 'error') {
      pending.reject(new Error(data.error));
      return;
    }
    pending.resolve(data);
  };

  constructor(
    private readonly source: string,
    private readonly sourcePath: string,
    private readonly handlerKind: SandboxHandlerKind,
    private readonly createWorker: SandboxWorkerFactory,
  ) {}

  async load(): Promise<WorkerResponse & { type: 'ready' }> {
    assertSandboxSourcePolicy(this.source, { sourcePath: this.sourcePath });
    this.ensureWorker();
    const response = await this.request({
      type: 'load',
      requestId: makeRequestId(),
      source: this.source,
      handlerKind: this.handlerKind,
    }, LOAD_TIMEOUT_MS);
    if (response.type !== 'ready') {
      throw new Error(`NAS sandbox did not load handler ${this.sourcePath}`);
    }
    return response;
  }

  async execute(ctx: AgentDataBundle, projection: EmbodimentProjectionApi, signal: AbortSignal): Promise<void> {
    await this.run('execute', ctx, projection, signal, EXECUTE_TIMEOUT_MS);
  }

  async update(ctx: AgentDataBundle, projection: EmbodimentProjectionApi): Promise<void> {
    await this.run('update', ctx, projection, undefined, UPDATE_TIMEOUT_MS);
  }

  dispose(): void {
    if (this.worker) {
      this.worker.removeEventListener('message', this.onMessage);
      this.worker.terminate();
      this.worker = null;
    }
    for (const [requestId, pending] of this.pending) {
      this.finishPending(requestId, pending);
      pending.reject(new Error(`NAS sandbox terminated for ${this.sourcePath}`));
    }
  }

  private async run(
    type: 'execute' | 'update',
    ctx: AgentDataBundle,
    projection: EmbodimentProjectionApi,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<void> {
    this.ensureWorker();
    const requestId = makeRequestId();
    const response = await this.request({
      type,
      requestId,
      ctx,
      snapshot: {
        surfaceBounds: projection.getSurfaceBounds(),
      },
    }, timeoutMs, signal, projection, ctx);
    if (response.type !== 'done') {
      throw new Error(`NAS sandbox ${type} failed for ${this.sourcePath}`);
    }
  }

  private ensureWorker(): void {
    if (this.worker) return;
    this.worker = this.createWorker();
    this.worker.addEventListener('message', this.onMessage);
  }

  private request(
    message: WorkerRequest,
    timeoutMs: number,
    signal?: AbortSignal,
    projection?: EmbodimentProjectionApi,
    ctx?: AgentDataBundle,
  ): Promise<WorkerResponse> {
    this.ensureWorker();
    if (signal?.aborted) {
      return Promise.reject(new Error(`NAS sandbox request aborted for ${this.sourcePath}`));
    }
    const requestId = message.requestId;
    return new Promise((resolve, reject) => {
      const timerId = globalThis.setTimeout(() => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.finishPending(requestId, pending);
        this.restartWorker();
        reject(new Error(`NAS sandbox request timed out for ${this.sourcePath}`));
      }, timeoutMs);
      const abortListener = signal
        ? () => {
            this.worker?.postMessage({ type: 'abort', requestId } satisfies WorkerRequest);
          }
        : undefined;
      if (signal && abortListener) {
        signal.addEventListener('abort', abortListener, { once: true });
      }
      this.pending.set(requestId, {
        resolve,
        reject,
        timerId,
        signal,
        abortListener,
      });
      if (projection && ctx) {
        activeProjectionContexts.set(requestId, { projection, ctx, signal });
      }
      this.worker?.postMessage(message);
    });
  }

  private finishPending(requestId: string, pending: PendingRequest): void {
    globalThis.clearTimeout(pending.timerId);
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener('abort', pending.abortListener);
    }
    this.pending.delete(requestId);
    activeProjectionContexts.delete(requestId);
  }

  private restartWorker(): void {
    if (this.worker) {
      this.worker.removeEventListener('message', this.onMessage);
      this.worker.terminate();
      this.worker = null;
    }
    for (const [requestId, pending] of this.pending) {
      this.finishPending(requestId, pending);
      pending.reject(new Error(`NAS sandbox worker restarted for ${this.sourcePath}`));
    }
  }

  private async handleProjectionCall(message: Extract<WorkerResponse, { type: 'projection-call' }>): Promise<void> {
    const context = activeProjectionContexts.get(message.requestId);
    if (!context) {
      this.worker?.postMessage({
        type: 'projection-result',
        requestId: message.requestId,
        callId: message.callId,
        ok: false,
        error: 'projection call has no active request context',
      } satisfies WorkerRequest);
      return;
    }
    try {
      const value = await callProjection(context.projection, message.method, message.args, context.ctx, context.signal);
      this.worker?.postMessage({
        type: 'projection-result',
        requestId: message.requestId,
        callId: message.callId,
        ok: true,
        value,
      } satisfies WorkerRequest);
    } catch (err) {
      this.worker?.postMessage({
        type: 'projection-result',
        requestId: message.requestId,
        callId: message.callId,
        ok: false,
        error: errorFromUnknown(err).message,
      } satisfies WorkerRequest);
    }
  }
}

const activeProjectionContexts = new Map<string, {
  projection: EmbodimentProjectionApi;
  ctx: AgentDataBundle;
  signal?: AbortSignal;
}>();

export async function createSandboxedActivityOrEventHandler(
  source: string,
  sourcePath: string,
  createWorker: SandboxWorkerFactory = defaultWorkerFactory,
): Promise<ActivityOrEventHandler & { dispose(): void }> {
  const sandbox = new NasWorkerSandbox(source, sourcePath, 'activity-event', createWorker);
  await sandbox.load();
  return {
    async execute(ctx, projection, options) {
      await sandbox.execute(ctx, projection, options.signal);
    },
    dispose() {
      sandbox.dispose();
    },
  };
}

export async function createSandboxedContinuousHandler(
  source: string,
  sourcePath: string,
  createWorker: SandboxWorkerFactory = defaultWorkerFactory,
): Promise<(ContinuousHandler & { dispose(): void }) & { fps: number }> {
  const sandbox = new NasWorkerSandbox(source, sourcePath, 'continuous', createWorker);
  const loaded = await sandbox.load();
  return {
    fps: typeof loaded.fps === 'number' && loaded.fps > 0 ? loaded.fps : 60,
    async update(ctx, projection) {
      await sandbox.update(ctx, projection);
    },
    dispose() {
      sandbox.dispose();
    },
  };
}
