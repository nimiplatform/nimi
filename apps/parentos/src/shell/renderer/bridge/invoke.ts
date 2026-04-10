import type { JsonValue } from './types.js';
import { invokeTauri } from './tauri-api.js';

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
  return invokeTauri;
}

export async function invoke(command: string, payload: JsonValue = {}): Promise<JsonValue> {
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
