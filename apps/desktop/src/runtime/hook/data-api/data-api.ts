import type { DataQueryHandler } from '../contracts/types.js';
import { createHookError } from '../contracts/errors.js';

export class DataApi {
  private readonly handlers = new Map<string, DataQueryHandler>();

  constructor() {
    // Default domain-scoped data capabilities
    this.handlers.set('agent.getProfile', (input) => ({ id: (input['agentId'] as string) || null }));
    this.handlers.set('world.getState', (input) => ({ id: (input['worldId'] as string) || null }));
    this.handlers.set('chat.getHistory', () => ({ items: [] }));
    this.handlers.set('memory.getSlice', () => ({ items: [] }));
    this.handlers.set('relationship.getEdges', () => ({ edges: [] }));
    this.handlers.set('economy.getBalance', () => ({ balance: 0 }));
    this.handlers.set('notification.list', () => ({ items: [] }));
  }

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
