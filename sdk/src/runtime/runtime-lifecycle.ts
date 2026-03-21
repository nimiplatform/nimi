import { ReasonCode } from '../types/index.js';
import type { JsonObject } from '../internal/utils.js';
import { createNimiError } from './errors.js';
import { createRuntimeClient } from './core/client.js';
import { normalizeText, nowIso } from './helpers.js';
import { withTimeout } from './runtime-infra.js';
import type {
  RuntimeClient,
  RuntimeConnectionState,
  RuntimeHealth,
  RuntimeOptions,
} from './types.js';

export async function connectRuntime(input: {
  appId: string;
  options: RuntimeOptions;
  getState: () => RuntimeConnectionState;
  getConnectPromise: () => Promise<void> | null;
  setState: (state: RuntimeConnectionState) => void;
  setConnectPromise: (promise: Promise<void> | null) => void;
  setClient: (client: RuntimeClient | null) => void;
  emitConnected: (at: string) => void;
  emitTelemetry: (name: string, data?: JsonObject) => void;
}): Promise<void> {
  const state = input.getState();
  if (state.status === 'ready') {
    return;
  }
  if (state.status === 'closing' || state.status === 'closed') {
    throw createNimiError({
      message: 'runtime is closing or closed',
      reasonCode: ReasonCode.OPERATION_ABORTED,
      actionHint: 'create_new_runtime_instance',
      source: 'sdk',
    });
  }
  const existingConnectPromise = input.getConnectPromise();
  if (existingConnectPromise) {
    return existingConnectPromise;
  }

  input.setState({
    ...input.getState(),
    status: 'connecting',
  });

  const connectedAt = nowIso();
  const connectPromise = (async () => {
    const transport = input.options.transport;
    if (!transport) {
      throw createNimiError({
        message: 'runtime transport is not configured. App-level consumers should use createPlatformClient(); low-level Runtime construction must run in Node.js defaults mode or pass transport explicitly.',
        reasonCode: ReasonCode.SDK_TRANSPORT_INVALID,
        actionHint: 'set_transport',
        source: 'sdk',
      });
    }
    const client = createRuntimeClient({
      appId: input.appId,
      transport,
      defaults: input.options.defaults,
      auth: input.options.auth,
    });
    const nextState = input.getState();
    if (nextState.status === 'closing' || nextState.status === 'closed') {
      await client.close();
      return;
    }
    input.setClient(client);
    input.setState({
      ...input.getState(),
      status: 'ready',
      connectedAt,
    });
    input.emitConnected(connectedAt);
    input.emitTelemetry('runtime.connected', { at: connectedAt });
  })();

  input.setConnectPromise(connectPromise);

  try {
    await connectPromise;
  } catch (error) {
    const currentState = input.getState();
    if (currentState.status !== 'closing' && currentState.status !== 'closed') {
      input.setState({
        ...currentState,
        status: 'idle',
      });
    }
    throw error;
  } finally {
    input.setConnectPromise(null);
  }
}

export async function readyRuntime(input: {
  timeoutMs: number;
  waitForReady: (timeoutMs: number) => Promise<void>;
  health: () => Promise<RuntimeHealth>;
  markReady: (at: string) => void;
}): Promise<void> {
  await input.waitForReady(input.timeoutMs);

  const health = await withTimeout(input.health(), input.timeoutMs, {
    reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
    actionHint: 'check_runtime_daemon_and_retry',
    source: 'runtime',
  });

  if (health.status === 'unavailable') {
    throw createNimiError({
      message: `runtime is unavailable: ${normalizeText(health.reason) || 'unknown reason'}`,
      reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      actionHint: 'check_runtime_daemon_and_retry',
      source: 'runtime',
    });
  }

  input.markReady(nowIso());
}

export async function closeRuntime(input: {
  getState: () => RuntimeConnectionState;
  getConnectPromise: () => Promise<void> | null;
  getClient: () => RuntimeClient | null;
  setState: (state: RuntimeConnectionState) => void;
  setConnectPromise: (promise: Promise<void> | null) => void;
  setClient: (client: RuntimeClient | null) => void;
  emitDisconnected: (at: string) => void;
  emitTelemetry: (name: string, data?: JsonObject) => void;
}): Promise<void> {
  if (input.getState().status === 'closed') {
    return;
  }

  input.setState({
    ...input.getState(),
    status: 'closing',
  });

  const pendingConnect = input.getConnectPromise();
  if (pendingConnect) {
    await pendingConnect.catch(() => {});
  }

  const client = input.getClient();
  if (client) {
    await client.close().catch(() => {});
  }

  input.setClient(null);
  input.setConnectPromise(null);

  const at = nowIso();
  input.setState({
    ...input.getState(),
    status: 'closed',
  });
  input.emitDisconnected(at);
  input.emitTelemetry('runtime.disconnected', { at });
}
