export class EventEmitter<TEvents extends Record<string, unknown>> {
  private readonly events: Map<string, Set<(data: unknown) => void>>;
  private readonly onListenerError?: (event: keyof TEvents, error: unknown) => void;

  constructor(onListenerError?: (event: keyof TEvents, error: unknown) => void) {
    this.events = new Map();
    this.onListenerError = onListenerError;
  }

  on<K extends keyof TEvents>(event: K, callback: (data: TEvents[K]) => void) {
    const key = String(event);
    if (!this.events.has(key)) {
      this.events.set(key, new Set());
    }
    this.events.get(key)?.add(callback as (data: unknown) => void);
    return () => this.off(event, callback);
  }

  off<K extends keyof TEvents>(event: K, callback: (data: TEvents[K]) => void) {
    this.events.get(String(event))?.delete(callback as (data: unknown) => void);
  }

  emit<K extends keyof TEvents>(event: K, data: TEvents[K]) {
    const callbacks = this.events.get(String(event));
    if (!callbacks) return;
    callbacks.forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        this.onListenerError?.(event, error);
      }
    });
  }
}
