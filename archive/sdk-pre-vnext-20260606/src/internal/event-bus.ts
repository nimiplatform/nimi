export type EventHandler<T> = (event: T) => void;

export type EventBus<Events extends Record<string, unknown>> = {
  on<Name extends keyof Events & string>(name: Name, handler: EventHandler<Events[Name]>): () => void;
  once<Name extends keyof Events & string>(name: Name, handler: EventHandler<Events[Name]>): () => void;
  emit<Name extends keyof Events & string>(name: Name, event: Events[Name]): void;
};

export function createEventBus<Events extends Record<string, unknown>>(): EventBus<Events> {
  const handlers = new Map<keyof Events & string, Set<EventHandler<Events[keyof Events & string]>>>();

  const on = <Name extends keyof Events & string>(
    name: Name,
    handler: EventHandler<Events[Name]>,
  ): (() => void) => {
    const set = handlers.get(name) || new Set<EventHandler<Events[Name]>>();
    set.add(handler);
    handlers.set(name, set as Set<EventHandler<Events[keyof Events & string]>>);

    return () => {
      const current = handlers.get(name);
      if (!current) {
        return;
      }
      current.delete(handler as EventHandler<Events[keyof Events & string]>);
      if (current.size === 0) {
        handlers.delete(name);
      }
    };
  };

  const once = <Name extends keyof Events & string>(
    name: Name,
    handler: EventHandler<Events[Name]>,
  ): (() => void) => {
    const off = on(name, (event: Events[Name]) => {
      off();
      handler(event);
    });
    return off;
  };

  const emit = <Name extends keyof Events & string>(name: Name, event: Events[Name]): void => {
    const set = handlers.get(name);
    if (!set || set.size === 0) {
      return;
    }
    for (const handler of set) {
      handler(event as Events[keyof Events & string]);
    }
  };

  return {
    on,
    once,
    emit,
  };
}
