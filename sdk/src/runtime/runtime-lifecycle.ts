import { ReasonCode } from '../types/index.js';
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
  state: RuntimeConnectionState;
  connectPromise: Promise<void> | null;
  setState: (state: RuntimeConnectionState) => void;
  setConnectPromise: (promise: Promise<void> | null) => void;
  setClient: (client: RuntimeClient | null) => void;
  emitConnected: (at: string) => void;
  emitTelemetry: (name: string, data?: Record<string, unknown>) => void;
}): Promise<void> {
  if (input.state.status === 'ready') {
    return;
  }
  if (input.connectPromise) {
    return input.connectPromise;
  }

  input.setState({
    ...input.state,
    status: 'connecting',
  });

  const connectedAt = nowIso();
  const connectPromise = (async () => {
    input.setClient(createRuntimeClient({
      appId: input.appId,
      transport: input.options.transport,
      defaults: input.options.defaults,
      auth: input.options.auth,
    }));
    input.setState({
      ...input.state,
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
    input.setState({
      ...input.state,
      status: 'idle',
    });
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

export function closeRuntime(input: {
  state: RuntimeConnectionState;
  setState: (state: RuntimeConnectionState) => void;
  setClient: (client: RuntimeClient | null) => void;
  emitDisconnected: (at: string) => void;
  emitTelemetry: (name: string, data?: Record<string, unknown>) => void;
}): void {
  if (input.state.status === 'closed') {
    return;
  }

  input.setState({
    ...input.state,
    status: 'closing',
  });

  input.setClient(null);

  const at = nowIso();
  input.setState({
    ...input.state,
    status: 'closed',
  });
  input.emitDisconnected(at);
  input.emitTelemetry('runtime.disconnected', { at });
}
