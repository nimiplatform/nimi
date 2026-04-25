import { describe, expect, it, vi } from 'vitest';
import type { AgentDataBundle } from '../driver/types.js';
import type { EmbodimentProjectionApi } from './embodiment-projection-api.js';
import { createSandboxedActivityOrEventHandler, type SandboxWorkerFactory } from './handler-sandbox.js';

type WorkerListener = (event: MessageEvent<Record<string, unknown>>) => void;

class FakeWorker {
  readonly projectionResults: Array<Record<string, unknown>> = [];
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
        method: 'setSignal',
        args: ['gaze.x', 0.5, 1],
      });
      return;
    }
    if (message['type'] === 'projection-result') {
      this.projectionResults.push(message);
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

function createProjection(): EmbodimentProjectionApi {
  return {
    triggerMotion: vi.fn(async () => undefined),
    stopMotion: vi.fn(),
    setSignal: vi.fn(),
    getSignal: vi.fn(() => 0),
    addSignal: vi.fn(),
    setExpression: vi.fn(async () => undefined),
    clearExpression: vi.fn(),
    setPose: vi.fn(),
    clearPose: vi.fn(),
    wait: vi.fn(async () => undefined),
    getSurfaceBounds: vi.fn(() => ({ x: 0, y: 0, width: 120, height: 240 })),
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
  active_user_id: 'user',
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
      'export default { async execute(ctx, projection) { projection.setSignal("gaze.x", 0.5); } };',
      '/model/runtime/nimi/activity/happy.js',
      createWorker,
    );
    const projection = createProjection();

    await handler.execute(bundle, projection, { signal: new AbortController().signal });

    expect(projection.setSignal).toHaveBeenCalledWith('gaze.x', 0.5, 1);
    expect(worker.projectionResults).toMatchObject([{ type: 'projection-result', callId: 'call-1', ok: true }]);
    handler.dispose?.();
  });
});
