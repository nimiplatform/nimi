import { invoke } from '@nimiplatform/kit/shell/renderer/bridge';

export function invokeTesterCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke(command, args || {}) as Promise<T>;
}
