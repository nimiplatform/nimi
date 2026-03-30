import { hasTauriInvoke } from './env.js';
import { invokeTauri } from './tauri-api.js';

export class BridgeError extends Error {
  constructor(message: string, public readonly command: string) {
    super(message);
    this.name = 'BridgeError';
  }
}

export async function invoke(command: string, payload: Record<string, unknown> = {}) {
  if (!hasTauriInvoke()) {
    throw new BridgeError('Tauri runtime is not available', command);
  }
  try {
    return await invokeTauri(command, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    throw new BridgeError(message || `invoke ${command} failed`, command);
  }
}
