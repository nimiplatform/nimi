import type { InterModHandler, InterModDiscovery } from '../contracts/types.js';
import { createHookError } from '../contracts/errors.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export class InterModBroker {
  private readonly handlers = new Map<string, Map<string, InterModHandler>>();
  private requestTimeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS;

  setRequestTimeout(ms: number): void {
    this.requestTimeoutMs = ms;
  }

  register(input: {
    modId: string;
    channel: string;
    handler: InterModHandler;
  }): void {
    const channelHandlers = this.handlers.get(input.channel) || new Map<string, InterModHandler>();
    channelHandlers.set(input.modId, input.handler);
    this.handlers.set(input.channel, channelHandlers);
  }

  unregisterByMod(modId: string): void {
    for (const [channel, channelHandlers] of this.handlers) {
      channelHandlers.delete(modId);
      if (channelHandlers.size === 0) {
        this.handlers.delete(channel);
      }
    }
  }

  unregisterByChannel(channel: string, modId: string): boolean {
    const channelHandlers = this.handlers.get(channel);
    if (!channelHandlers) return false;
    const deleted = channelHandlers.delete(modId);
    if (channelHandlers.size === 0) this.handlers.delete(channel);
    return deleted;
  }

  async request(input: {
    fromModId: string;
    toModId: string;
    channel: string;
    payload: Record<string, unknown>;
    context?: Record<string, unknown>;
  }): Promise<unknown> {
    const channelHandlers = this.handlers.get(input.channel);
    const handler = channelHandlers?.get(input.toModId);
    if (!handler) {
      throw createHookError(
        'HOOK_INTER_MOD_CHANNEL_NOT_FOUND',
        `${input.channel}:${input.toModId}`,
        {
          channel: input.channel,
          toModId: input.toModId,
        },
      );
    }
    return this.invokeWithTimeout(handler, input.payload, input.context);
  }

  async broadcast(input: {
    fromModId: string;
    channel: string;
    payload: Record<string, unknown>;
    context?: Record<string, unknown>;
  }): Promise<{ responses: Array<{ modId: string; result: unknown }>; errors: Array<{ modId: string; error: string }> }> {
    const channelHandlers = this.handlers.get(input.channel);
    if (!channelHandlers || channelHandlers.size === 0) {
      return { responses: [], errors: [] };
    }

    const responses: Array<{ modId: string; result: unknown }> = [];
    const errors: Array<{ modId: string; error: string }> = [];

    for (const [modId, handler] of channelHandlers) {
      if (modId === input.fromModId) continue; // Skip sender
      try {
        const result = await this.invokeWithTimeout(handler, input.payload, input.context);
        responses.push({ modId, result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ modId, error: message });
      }
    }

    return { responses, errors };
  }

  discover(): InterModDiscovery[] {
    const result: InterModDiscovery[] = [];
    for (const [channel, channelHandlers] of this.handlers) {
      result.push({
        channel,
        providers: [...channelHandlers.keys()],
      });
    }
    return result;
  }

  hasChannel(channel: string): boolean {
    const ch = this.handlers.get(channel);
    return ch !== undefined && ch.size > 0;
  }

  hasProvider(channel: string, modId: string): boolean {
    return this.handlers.get(channel)?.has(modId) ?? false;
  }

  private invokeWithTimeout(
    handler: InterModHandler,
    payload: Record<string, unknown>,
    context?: Record<string, unknown>,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('HOOK_INTER_MOD_REQUEST_TIMEOUT'));
      }, this.requestTimeoutMs);

      Promise.resolve(handler(payload, context))
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}
