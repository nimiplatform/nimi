import type { JsonValue } from './types.js';
import { hasTauriInvoke } from './env.js';

export class BridgeError extends Error {
  constructor(
    message: string,
    public readonly command: string,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

type TauriInvokeFn = (command: string, payload?: JsonValue) => Promise<JsonValue>;

function resolveTauriInvoke(): TauriInvokeFn {
  const invokeFn = window.__TAURI__?.core?.invoke;
  if (typeof invokeFn !== 'function') {
    throw new BridgeError('Tauri invoke is not available', 'resolve');
  }
  return invokeFn.bind(window.__TAURI__?.core);
}

export async function invoke(command: string, payload: JsonValue = {}): Promise<JsonValue> {
  if (!hasTauriInvoke()) {
    throw new BridgeError('Tauri runtime is not available', command);
  }
  const tauriInvoke = resolveTauriInvoke();
  try {
    return await tauriInvoke(command, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    throw new BridgeError(message || `invoke ${command} failed`, command);
  }
}

export async function invokeChecked<T>(
  command: string,
  payload: JsonValue,
  parseResult: (value: unknown) => T,
): Promise<T> {
  return parseResult(await invoke(command, payload));
}
