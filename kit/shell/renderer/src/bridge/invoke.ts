import type { JsonValue } from './types.js';
import { hasShellHostInvoke } from './env.js';
import { invokeShell } from './tauri-api.js';

export class BridgeError extends Error {
  constructor(
    message: string,
    public readonly command: string,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

type ShellInvokeFn = (command: string, payload?: JsonValue) => Promise<JsonValue>;

function resolveShellInvoke(): ShellInvokeFn {
  if (!hasShellHostInvoke()) {
    throw new BridgeError('Shell host invoke is not available', 'resolve');
  }
  return invokeShell;
}

export async function invoke(command: string, payload: JsonValue = {}): Promise<JsonValue> {
  if (!hasShellHostInvoke()) {
    throw new BridgeError('Shell host runtime is not available', command);
  }
  const shellInvoke = resolveShellInvoke();
  try {
    return await shellInvoke(command, payload);
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
