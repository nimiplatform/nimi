import type { DataQueryHandler } from '../contracts/types.js';
import { createHookError } from '../contracts/errors.js';

export class DataApi {
  private readonly handlers = new Map<string, DataQueryHandler>();

  register(capability: string, handler: DataQueryHandler): void {
    this.handlers.set(capability, handler);
  }

  unregister(capability: string): boolean {
    return this.handlers.delete(capability);
  }

  async query(capability: string, input: Record<string, unknown>): Promise<unknown> {
    const handler = this.handlers.get(capability);
    if (!handler) {
      throw createHookError('HOOK_DATA_CAPABILITY_UNSUPPORTED', capability, {
        capability,
      });
    }
    return handler(input);
  }

  has(capability: string): boolean {
    return this.handlers.has(capability);
  }

  listCapabilities(): string[] {
    return [...this.handlers.keys()];
  }
}
