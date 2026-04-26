import type { AgentDataBundle } from '../driver/types.js';
import type { PlayMotionOptions, ProjectionBounds } from './embodiment-projection-api.js';
import { validateSandboxSourcePolicy } from './handler-sandbox-policy.js';

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

type SandboxProjectionSnapshot = {
  surfaceBounds: ProjectionBounds;
};

type ActivityEventModule = {
  meta?: unknown;
  execute(ctx: AgentDataBundle, projection: WorkerProjectionApi, options: { signal: AbortSignal }): Promise<void> | void;
};

type ContinuousModule = {
  meta?: unknown;
  fps?: number;
  update(ctx: AgentDataBundle, projection: WorkerProjectionApi): Promise<void> | void;
};

type WorkerProjectionApi = {
  triggerMotion(motionId: string, opts?: PlayMotionOptions): Promise<void>;
  stopMotion(): void;
  setSignal(signalId: string, value: number, weight?: number): void;
  getSignal(signalId: string): number;
  addSignal(signalId: string, delta: number): void;
  setExpression(expressionId: string): Promise<void>;
  clearExpression(): void;
  setPose(poseId: string, loop?: boolean): void;
  clearPose(): void;
  wait(ms: number): Promise<void>;
  getSurfaceBounds(): ProjectionBounds;
  runDefaultActivity?(activityId: string): Promise<void>;
};

const disabledGlobals = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'importScripts',
] as const;

let loadedHandler: ActivityEventModule | ContinuousModule | null = null;
let loadedKind: SandboxHandlerKind | null = null;
const abortControllers = new Map<string, AbortController>();
const projectionCalls = new Map<string, {
  resolve(value: unknown): void;
  reject(error: Error): void;
}>();

function post(message: WorkerResponse): void {
  globalThis.postMessage(message);
}

function lockDownAmbientGlobals(): void {
  for (const key of disabledGlobals) {
    try {
      Object.defineProperty(globalThis, key, {
        configurable: false,
        enumerable: false,
        value: undefined,
        writable: false,
      });
    } catch {
      // Non-configurable globals stay unavailable to handlers through source policy.
    }
  }
}

async function importHandlerModule(source: string): Promise<unknown> {
  const blob = new Blob([source], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    const module = await import(/* @vite-ignore */ url);
    return (module as { default?: unknown }).default ?? null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function isActivityEventModule(value: unknown): value is ActivityEventModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { execute?: unknown }).execute === 'function'
  );
}

function isContinuousModule(value: unknown): value is ContinuousModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { update?: unknown }).update === 'function'
  );
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

function makeCallId(): string {
  return `call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function rpc(requestId: string, method: ProjectionRpcMethod, args: unknown[]): Promise<unknown> {
  const callId = makeCallId();
  return new Promise((resolve, reject) => {
    projectionCalls.set(callId, { resolve, reject });
    post({ type: 'projection-call', requestId, callId, method, args });
  });
}

function createProjection(requestId: string, snapshot: SandboxProjectionSnapshot): WorkerProjectionApi {
  const signals = new Map<string, number>();
  return {
    async triggerMotion(motionId, opts) {
      await rpc(requestId, 'triggerMotion', [motionId, opts]);
    },
    stopMotion() {
      void rpc(requestId, 'stopMotion', []);
    },
    setSignal(signalId, value, weight = 1) {
      signals.set(signalId, value);
      void rpc(requestId, 'setSignal', [signalId, value, weight]);
    },
    getSignal(signalId) {
      return signals.get(signalId) ?? 0;
    },
    addSignal(signalId, delta) {
      const next = (signals.get(signalId) ?? 0) + delta;
      signals.set(signalId, next);
      void rpc(requestId, 'addSignal', [signalId, delta]);
    },
    async setExpression(expressionId) {
      await rpc(requestId, 'setExpression', [expressionId]);
    },
    clearExpression() {
      void rpc(requestId, 'clearExpression', []);
    },
    setPose(poseId, loop = false) {
      void rpc(requestId, 'setPose', [poseId, loop]);
    },
    clearPose() {
      void rpc(requestId, 'clearPose', []);
    },
    async wait(ms) {
      const controller = abortControllers.get(requestId);
      if (controller?.signal.aborted) return;
      await new Promise<void>((resolve) => {
        const timer = globalThis.setTimeout(resolve, Math.max(0, Number(ms) || 0));
        controller?.signal.addEventListener('abort', () => {
          globalThis.clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    },
    getSurfaceBounds() {
      return snapshot.surfaceBounds;
    },
    async runDefaultActivity(activityId) {
      await rpc(requestId, 'runDefaultActivity', [activityId]);
    },
  };
}

async function handleLoad(message: Extract<WorkerRequest, { type: 'load' }>): Promise<void> {
  const policy = validateSandboxSourcePolicy(message.source);
  if (!policy.ok) {
    throw new Error(policy.reason);
  }
  lockDownAmbientGlobals();
  const module = await importHandlerModule(message.source);
  if (message.handlerKind === 'activity-event') {
    if (!isActivityEventModule(module)) {
      throw new Error('NAS activity/event handler must export default { execute() }');
    }
    loadedHandler = module;
    loadedKind = message.handlerKind;
    post({ type: 'ready', requestId: message.requestId, meta: module.meta });
    return;
  }
  if (!isContinuousModule(module)) {
    throw new Error('NAS continuous handler must export default { update() }');
  }
  loadedHandler = module;
  loadedKind = message.handlerKind;
  post({
    type: 'ready',
    requestId: message.requestId,
    meta: module.meta,
    fps: typeof module.fps === 'number' && module.fps > 0 ? module.fps : 60,
  });
}

async function handleExecute(message: Extract<WorkerRequest, { type: 'execute' }>): Promise<void> {
  if (loadedKind !== 'activity-event' || !isActivityEventModule(loadedHandler)) {
    throw new Error('NAS sandbox has no activity/event handler loaded');
  }
  const controller = new AbortController();
  abortControllers.set(message.requestId, controller);
  try {
    await loadedHandler.execute(message.ctx, createProjection(message.requestId, message.snapshot), {
      signal: controller.signal,
    });
  } finally {
    abortControllers.delete(message.requestId);
  }
}

async function handleUpdate(message: Extract<WorkerRequest, { type: 'update' }>): Promise<void> {
  if (loadedKind !== 'continuous' || !isContinuousModule(loadedHandler)) {
    throw new Error('NAS sandbox has no continuous handler loaded');
  }
  const returned = loadedHandler.update(message.ctx, createProjection(message.requestId, message.snapshot));
  if (isPromiseLike(returned)) {
    throw new Error('NAS continuous update must be synchronous and must not return a Promise');
  }
}

globalThis.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  void (async () => {
    try {
      if (message.type === 'load') {
        await handleLoad(message);
        return;
      }
      if (message.type === 'execute') {
        await handleExecute(message);
        post({ type: 'done', requestId: message.requestId });
        return;
      }
      if (message.type === 'update') {
        await handleUpdate(message);
        post({ type: 'done', requestId: message.requestId });
        return;
      }
      if (message.type === 'abort') {
        abortControllers.get(message.requestId)?.abort();
        return;
      }
      if (message.type === 'projection-result') {
        const pending = projectionCalls.get(message.callId);
        if (!pending) return;
        projectionCalls.delete(message.callId);
        if (message.ok) {
          pending.resolve(message.value);
        } else {
          pending.reject(new Error(message.error ?? 'projection call failed'));
        }
      }
    } catch (err) {
      post({
        type: 'error',
        requestId: message.requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
});
