import type { EmitResult, EventHandler } from '../contracts/types.js';

const DEFAULT_HANDLER_TIMEOUT_MS = 5_000;

interface HandlerEntry {
  modId: string;
  handler: EventHandler;
  once: boolean;
}

function topicMatches(pattern: string, topic: string): boolean {
  if (pattern === topic) return true;
  // Wildcard: "chat.*" matches "chat.message", "chat.reaction"
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -1);
    return topic.startsWith(prefix);
  }
  return false;
}

export class EventBus {
  private readonly handlers = new Map<string, HandlerEntry[]>();
  private handlerTimeoutMs: number = DEFAULT_HANDLER_TIMEOUT_MS;

  setHandlerTimeout(ms: number): void {
    this.handlerTimeoutMs = ms;
  }

  register(input: {
    modId: string;
    topic: string;
    handler: EventHandler;
    once?: boolean;
  }): void {
    const list = this.handlers.get(input.topic) || [];
    list.push({
      modId: input.modId,
      handler: input.handler,
      once: input.once ?? false,
    });
    this.handlers.set(input.topic, list);
  }

  unregister(input: {
    modId: string;
    topic?: string;
  }): number {
    const modId = String(input.modId || '').trim();
    if (!modId) {
      return 0;
    }

    const topic = String(input.topic || '').trim();
    let removed = 0;

    if (topic) {
      const list = this.handlers.get(topic) || [];
      const filtered = list.filter((item) => item.modId !== modId);
      removed = list.length - filtered.length;
      if (filtered.length === 0) {
        this.handlers.delete(topic);
      } else {
        this.handlers.set(topic, filtered);
      }
      return removed;
    }

    for (const [pattern, list] of this.handlers) {
      const filtered = list.filter((item) => item.modId !== modId);
      removed += list.length - filtered.length;
      if (filtered.length === 0) {
        this.handlers.delete(pattern);
      } else {
        this.handlers.set(pattern, filtered);
      }
    }

    return removed;
  }

  unregisterByMod(modId: string): void {
    this.unregister({
      modId,
    });
  }

  unregisterByTopic(topic: string): void {
    this.handlers.delete(topic);
  }

  async emit(topic: string, payload: Record<string, unknown>): Promise<EmitResult> {
    // Collect handlers from exact matches and wildcard patterns
    const matched: Array<{ pattern: string; entry: HandlerEntry }> = [];
    for (const [pattern, list] of this.handlers) {
      if (topicMatches(pattern, topic)) {
        for (const entry of list) {
          matched.push({ pattern, entry });
        }
      }
    }

    let delivered = 0;
    let failed = 0;
    const errors: Array<{ modId: string; error: string }> = [];
    const onceToRemove: Array<{ pattern: string; entry: HandlerEntry }> = [];

    for (const { pattern, entry } of matched) {
      try {
        await this.invokeWithTimeout(entry.handler, payload);
        delivered += 1;
        if (entry.once) onceToRemove.push({ pattern, entry });
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ modId: entry.modId, error: message });
      }
    }

    // Remove once-listeners that fired successfully
    for (const { pattern, entry } of onceToRemove) {
      const list = this.handlers.get(pattern);
      if (list) {
        const idx = list.indexOf(entry);
        if (idx >= 0) list.splice(idx, 1);
        if (list.length === 0) this.handlers.delete(pattern);
      }
    }

    return { delivered, failed, errors };
  }

  listTopics(): string[] {
    return [...this.handlers.keys()];
  }

  listenerCount(topic: string): number {
    return (this.handlers.get(topic) || []).length;
  }

  private invokeWithTimeout(
    handler: EventHandler,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('HOOK_EVENT_HANDLER_TIMEOUT'));
      }, this.handlerTimeoutMs);

      Promise.resolve(handler(payload))
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
