import { describe, expect, it, vi } from 'vitest';
import type { AgentDataBundle } from '../driver/types.js';
import type { BackendProjection } from '../carrier/backend-branch.js';
import { createSandboxedActivityOrEventHandler, type SandboxWorkerFactory } from './handler-sandbox.js';

type WorkerListener = (event: MessageEvent<Record<string, unknown>>) => void;

class FakeWorker {
  readonly projectionResults: Array<Record<string, unknown>> = [];
  method = 'setExpression';
  args: unknown[] = ['joy'];
  private readonly listeners = new Set<WorkerListener>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type !== 'message' || typeof listener !== 'function') return;
    this.listeners.add(listener as WorkerListener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type !== 'message' || typeof listener !== 'function') return;
    this.listeners.delete(listener as WorkerListener);
  }

  terminate(): void {
    this.listeners.clear();
  }

  postMessage(message: Record<string, unknown>): void {
    if (message['type'] === 'load') {
      this.emit({ type: 'ready', requestId: message['requestId'] });
      return;
    }
    if (message['type'] === 'execute') {
      this.emit({
        type: 'projection-call',
        requestId: message['requestId'],
        callId: 'call-1',
        method: this.method,
        args: this.args,
      });
      return;
    }
    if (message['type'] === 'projection-result') {
      this.projectionResults.push(message);
      if (message['ok'] === false) {
        this.emit({
          type: 'error',
          requestId: message['requestId'],
          error: message['error'] ?? 'projection call failed',
        });
        return;
      }
      this.emit({ type: 'done', requestId: message['requestId'] });
    }
  }

  private emit(data: Record<string, unknown>): void {
    const event = { data } as MessageEvent<Record<string, unknown>>;
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function createProjection(): BackendProjection {
  return {
    applyActivity: vi.fn(),
    applyEmotion: vi.fn(),
    applyMotion: vi.fn(),
    applyExpression: vi.fn(),
    reset: vi.fn(),
  };
}

const bundle: AgentDataBundle = {
  posture: {
    posture_class: 'idle',
    action_family: 'rest',
    interrupt_mode: 'focused',
    transition_reason: 'test',
    truth_basis_ids: [],
  },
  status_text: 'Idle',
  execution_state: 'IDLE',
  active_world_id: 'world',
  active_agent_handle: 'user',
  app: {
    namespace: 'avatar',
    surface_id: 'main',
    visible: true,
    focused: true,
    window: { x: 0, y: 0, width: 120, height: 240 },
    cursor_x: 0,
    cursor_y: 0,
  },
  runtime: {
    now: '2026-04-25T00:00:00Z',
    session_id: 'session',
    locale: 'en-US',
  },
};

describe('createSandboxedActivityOrEventHandler', () => {
  it('forwards handler projection calls through the capability RPC boundary', async () => {
    const worker = new FakeWorker();
    const createWorker: SandboxWorkerFactory = () => worker;
    const handler = await createSandboxedActivityOrEventHandler(
      'export default { async execute(ctx, projection) { await projection.setExpression("joy"); } };',
      '/model/runtime/nimi/activity/happy.js',
      createWorker,
    );
    const projection = createProjection();

    await handler.execute(bundle, projection, { signal: new AbortController().signal });

    expect(projection.applyExpression).toHaveBeenCalledWith({ name: 'joy' });
    expect(worker.projectionResults).toMatchObject([{ type: 'projection-result', callId: 'call-1', ok: true }]);
    handler.dispose?.();
  });

  it('translates authority motion calls into backend projection calls', async () => {
    const worker = new FakeWorker();
    worker.method = 'triggerMotion';
    worker.args = ['wave', { loop: true, fadeIn: 0.25 }];
    const createWorker: SandboxWorkerFactory = () => worker;
    const handler = await createSandboxedActivityOrEventHandler(
      'export default { async execute(ctx, projection) { await projection.triggerMotion("wave", { loop: true, fadeIn: 0.25 }); } };',
      '/model/runtime/nimi/activity/happy.js',
      createWorker,
    );
    const projection = createProjection();

    await handler.execute(bundle, projection, { signal: new AbortController().signal });

    expect(projection.applyMotion).toHaveBeenCalledWith({ routeId: 'wave', loop: true, fade: 0.25 });
    expect(worker.projectionResults).toMatchObject([{ type: 'projection-result', callId: 'call-1', ok: true }]);
    handler.dispose?.();
  });

  it('translates authority signal calls into the admitted backend signal surface', async () => {
    const worker = new FakeWorker();
    worker.method = 'setSignal';
    worker.args = ['ParamMouthOpenY', 0.75, 0.5];
    const createWorker: SandboxWorkerFactory = () => worker;
    const handler = await createSandboxedActivityOrEventHandler(
      'export default { execute(ctx, projection) { projection.setSignal("ParamMouthOpenY", 0.75, 0.5); } };',
      '/model/runtime/nimi/activity/happy.js',
      createWorker,
    );
    const projection = createProjection();
    const live2d = { setParameter: vi.fn() };

    await handler.execute(bundle, projection, {
      signal: new AbortController().signal,
      extension: { live2d },
    });

    expect(live2d.setParameter).toHaveBeenCalledWith('ParamMouthOpenY', 0.75);
    expect(worker.projectionResults).toMatchObject([{ type: 'projection-result', callId: 'call-1', ok: true }]);
    handler.dispose?.();
  });

  it('fails closed when authority signal calls lack an admitted backend signal surface', async () => {
    const worker = new FakeWorker();
    worker.method = 'setSignal';
    worker.args = ['ParamMouthOpenY', 0.75, 0.5];
    const createWorker: SandboxWorkerFactory = () => worker;
    const handler = await createSandboxedActivityOrEventHandler(
      'export default { execute(ctx, projection) { projection.setSignal("ParamMouthOpenY", 0.75, 0.5); } };',
      '/model/runtime/nimi/activity/happy.js',
      createWorker,
    );
    const projection = createProjection();

    await expect(handler.execute(bundle, projection, {
      signal: new AbortController().signal,
    })).rejects.toThrow('NAS projection setSignal requires an admitted Live2D backend signal surface');

    expect(worker.projectionResults).toMatchObject([{
      type: 'projection-result',
      callId: 'call-1',
      ok: false,
      error: 'NAS projection setSignal requires an admitted Live2D backend signal surface',
    }]);
    handler.dispose?.();
  });

  it('rejects app-local projection calls before loading the sandbox worker', async () => {
    const createWorker = vi.fn<SandboxWorkerFactory>(() => new FakeWorker());

    await expect(createSandboxedActivityOrEventHandler(
      'export default { async execute(ctx, projection) { projection.applyExpression({ name: "joy" }); } };',
      '/model/runtime/nimi/activity/happy.js',
      createWorker,
    )).rejects.toThrow('NAS handler projection method is outside the authority-owned cue surface: applyExpression');
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('rejects unknown projection RPC methods fail-closed', async () => {
    const worker = new FakeWorker();
    worker.method = 'unknownCapability';
    const createWorker: SandboxWorkerFactory = () => worker;
    const handler = await createSandboxedActivityOrEventHandler(
      'export default { async execute(ctx, projection) { await projection.setExpression("joy"); } };',
      '/model/runtime/nimi/activity/happy.js',
      createWorker,
    );
    const projection = createProjection();

    await expect(handler.execute(bundle, projection, { signal: new AbortController().signal }))
      .rejects.toThrow('unsupported projection method: unknownCapability');

    expect(worker.projectionResults).toMatchObject([{
      type: 'projection-result',
      callId: 'call-1',
      ok: false,
      error: 'unsupported projection method: unknownCapability',
    }]);
    expect(projection.applyExpression).not.toHaveBeenCalled();
    handler.dispose?.();
  });
});
