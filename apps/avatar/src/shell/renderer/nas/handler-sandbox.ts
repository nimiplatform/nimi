import type { AgentDataBundle } from '../driver/types.js';
import type { BackendProjection } from '../carrier/backend-branch.js';
import type { ActivityOrEventHandler, ContinuousHandler, NasHandlerExtension } from './handler-types.js';
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
      extension?: SandboxWorkerExtension;
    }
  | {
      type: 'update';
      requestId: string;
      ctx: AgentDataBundle;
      snapshot: SandboxProjectionSnapshot;
      extension?: SandboxWorkerExtension;
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
  surfaceBounds: { x: number; y: number; width: number; height: number };
};

type SandboxWorkerExtension = {
  live2d?: true;
};

type ProjectionRpcMethod =
  | 'triggerMotion'
  | 'stopMotion'
  | 'setSignal'
  | 'addSignal'
  | 'setExpression'
  | 'clearExpression'
  | 'setPose'
  | 'clearPose';

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

function stringArg(args: unknown[], index: number, label: string): string {
  const value = args[index];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`NAS projection ${label} requires a non-empty string`);
  }
  return value;
}

function finiteNumberArg(args: unknown[], index: number, label: string): number {
  const value = args[index];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`NAS projection ${label} requires a finite number`);
  }
  return value;
}

function optionalBooleanArg(args: unknown[], index: number): boolean | undefined {
  return typeof args[index] === 'boolean' ? args[index] : undefined;
}

function motionOptionsArg(args: unknown[], index: number): { loop?: boolean; fadeIn?: number } {
  const value = args[index];
  if (!value || typeof value !== 'object') {
    return {};
  }
  const options = value as { loop?: unknown; fadeIn?: unknown };
  return {
    loop: typeof options.loop === 'boolean' ? options.loop : undefined,
    fadeIn: typeof options.fadeIn === 'number' && Number.isFinite(options.fadeIn) ? options.fadeIn : undefined,
  };
}

function setBackendSignal(context: ActiveProjectionContext, signalId: string, value: number): void {
  if (!context.extension?.live2d) {
    throw new Error('NAS projection setSignal requires an admitted Live2D backend signal surface');
  }
  context.extension.live2d.setParameter(signalId, value);
}

function callProjection(
  context: ActiveProjectionContext,
  method: ProjectionRpcMethod,
  args: unknown[],
): Promise<unknown> | unknown {
  const { projection } = context;
  switch (method) {
    case 'triggerMotion': {
      const opts = motionOptionsArg(args, 1);
      return projection.applyMotion({
        routeId: stringArg(args, 0, 'triggerMotion.motionId'),
        loop: opts.loop,
        fade: opts.fadeIn,
      });
    }
    case 'stopMotion':
      return projection.reset();
    case 'setSignal':
      return setBackendSignal(
        context,
        stringArg(args, 0, 'setSignal.signalId'),
        finiteNumberArg(args, 1, 'setSignal.value'),
      );
    case 'addSignal':
      return setBackendSignal(
        context,
        stringArg(args, 0, 'addSignal.signalId'),
        finiteNumberArg(args, 2, 'addSignal.computedValue'),
      );
    case 'setExpression':
      return projection.applyExpression({ name: stringArg(args, 0, 'setExpression.expressionId') });
    case 'clearExpression':
      return projection.reset();
    case 'setPose':
      return projection.applyMotion({
        routeId: stringArg(args, 0, 'setPose.poseId'),
        loop: optionalBooleanArg(args, 1),
      });
    case 'clearPose':
      return projection.reset();
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

  async execute(
    ctx: AgentDataBundle,
    projection: BackendProjection,
    signal: AbortSignal,
    extension?: NasHandlerExtension,
  ): Promise<void> {
    await this.run('execute', ctx, projection, signal, EXECUTE_TIMEOUT_MS, extension);
  }

  async update(ctx: AgentDataBundle, projection: BackendProjection, extension?: NasHandlerExtension): Promise<void> {
    await this.run('update', ctx, projection, undefined, UPDATE_TIMEOUT_MS, extension);
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
    projection: BackendProjection,
    signal: AbortSignal | undefined,
    timeoutMs: number,
    extension?: NasHandlerExtension,
  ): Promise<void> {
    this.ensureWorker();
    const requestId = makeRequestId();
    const response = await this.request({
      type,
      requestId,
      ctx,
      snapshot: {
        surfaceBounds: {
          x: ctx.app.window.x,
          y: ctx.app.window.y,
          width: ctx.app.window.width,
          height: ctx.app.window.height,
        },
      },
      ...(extension?.live2d ? { extension: { live2d: true } satisfies SandboxWorkerExtension } : {}),
    }, timeoutMs, signal, projection, ctx, extension);
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
    projection?: BackendProjection,
    ctx?: AgentDataBundle,
    extension?: NasHandlerExtension,
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
        activeProjectionContexts.set(requestId, { projection, ctx, signal, extension });
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
      const value = await callProjection(context, message.method, message.args);
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

type ActiveProjectionContext = {
  projection: BackendProjection;
  ctx: AgentDataBundle;
  signal?: AbortSignal;
  extension?: NasHandlerExtension;
};

const activeProjectionContexts = new Map<string, ActiveProjectionContext>();

export async function createSandboxedActivityOrEventHandler(
  source: string,
  sourcePath: string,
  createWorker: SandboxWorkerFactory = defaultWorkerFactory,
): Promise<ActivityOrEventHandler & { dispose(): void }> {
  const sandbox = new NasWorkerSandbox(source, sourcePath, 'activity-event', createWorker);
  const loaded = await sandbox.load();
  const loadedMeta = loaded.meta && typeof loaded.meta === 'object'
    ? loaded.meta as { meta?: unknown; requires?: unknown }
    : {};
  return {
    meta: loadedMeta.meta as never,
    async execute(ctx, projection, options) {
      await sandbox.execute(ctx, projection, options.signal, options.extension);
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
  const loadedMeta = loaded.meta && typeof loaded.meta === 'object'
    ? loaded.meta as { meta?: unknown; requires?: unknown }
    : {};
  return {
    meta: loadedMeta.meta as never,
    fps: typeof loaded.fps === 'number' && loaded.fps > 0 ? loaded.fps : 60,
    async update(ctx, projection, options) {
      await sandbox.update(ctx, projection, options?.extension);
    },
    dispose() {
      sandbox.dispose();
    },
  };
}
