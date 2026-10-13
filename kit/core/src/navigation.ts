// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-navigation
export const NIMI_NAVIGATION_HISTORY_LIMIT = 100;

export type NimiDestination = { readonly id: string };
export type NimiNavigationEntry<D extends NimiDestination> = {
  readonly key: string;
  readonly destination: Readonly<D>;
};
export type NimiNavigationSnapshot<D extends NimiDestination> = {
  readonly current: NimiNavigationEntry<D>;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly transitionState: 'idle' | 'pending' | 'disposed';
  /** Local invalidation generation; never an authorization credential. */
  readonly generation: number;
};
export type NimiNavigationOperation = 'push' | 'replace' | 'back' | 'forward';
export type NimiNavigationResult =
  | { readonly status: 'committed' | 'unchanged' | 'cancelled' | 'busy' | 'invalidated' | 'disposed' }
  | { readonly status: 'invalid' | 'failed'; readonly error: unknown };
export type NimiNavigationLeaveContext<D extends NimiDestination> = {
  readonly from: Readonly<D>;
  readonly to: Readonly<D>;
  readonly operation: NimiNavigationOperation;
  readonly signal: AbortSignal;
};
export type NimiNavigationLeaveGuard<D extends NimiDestination> = (
  context: NimiNavigationLeaveContext<D>,
) => 'allow' | 'cancel' | 'busy' | Promise<'allow' | 'cancel' | 'busy'>;
export type NimiNavigationInput<D extends NimiDestination> = {
  readonly initial: D;
  /** All entry points call this App-owned validator; it rejects extra fields. */
  readonly validate: (value: unknown) => D;
  readonly beforeLeave?: NimiNavigationLeaveGuard<D>;
};
export type NimiNavigationController<D extends NimiDestination> = {
  readonly getSnapshot: () => NimiNavigationSnapshot<D>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly push: (destination: D) => Promise<NimiNavigationResult>;
  readonly replace: (destination: D) => Promise<NimiNavigationResult>;
  readonly back: () => Promise<NimiNavigationResult>;
  readonly forward: () => Promise<NimiNavigationResult>;
  /** Forced lifecycle reset cancels the pending guard and clears both sides. */
  readonly reset: (initial: D) => void;
  readonly dispose: () => void;
};

/** The only history implementation. It contains no effect or persistence port. */
export function createNimiNavigation<D extends NimiDestination>(
  input: NimiNavigationInput<D>,
): NimiNavigationController<D> {
  let serial = 0;
  let generation = 0;
  let disposed = false;
  let cursor = 0;
  let pending: AbortController | null = null;
  const listeners = new Set<() => void>();
  const normalize = (value: unknown): Readonly<D> => {
    const validated = input.validate(value);
    if (!validated || typeof validated.id !== 'string' || !validated.id.trim()) {
      throw new TypeError('Navigation requires a validated destination ID.');
    }
    return copyPosition(validated) as Readonly<D>;
  };
  const entry = (destination: Readonly<D>): NimiNavigationEntry<D> => Object.freeze({
    key: `navigation-${generation}-${++serial}`, destination,
  });
  let entries = [entry(normalize(input.initial))];
  const snapshot = (): NimiNavigationSnapshot<D> => Object.freeze({
    current: entries[cursor]!,
    canGoBack: !disposed && cursor > 0,
    canGoForward: !disposed && cursor < entries.length - 1,
    transitionState: disposed ? 'disposed' : pending ? 'pending' : 'idle',
    generation,
  });
  let currentSnapshot = snapshot();
  const publish = () => {
    currentSnapshot = snapshot();
    for (const listener of [...listeners]) {
      try { listener(); } catch (error) { queueMicrotask(() => { throw error; }); }
    }
  };

  // @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-navigation-lifecycle
  const transition = async (operation: NimiNavigationOperation, value?: D): Promise<NimiNavigationResult> => {
    if (disposed) return { status: 'disposed' };
    if (pending) return { status: 'busy' };
    let destination: Readonly<D>;
    const targetCursor = operation === 'back' ? cursor - 1 : cursor + 1;
    try {
      if (operation === 'back' || operation === 'forward') {
        if (targetCursor < 0 || targetCursor >= entries.length) return { status: 'unchanged' };
        destination = normalize(entries[targetCursor]!.destination);
      } else {
        destination = normalize(value);
        if (JSON.stringify(destination) === JSON.stringify(entries[cursor]!.destination)) {
          return { status: 'unchanged' };
        }
      }
    } catch (error) { return { status: 'invalid', error }; }

    const guard = new AbortController();
    const capturedGeneration = generation;
    pending = guard;
    publish();
    try {
      const decision = input.beforeLeave ? await input.beforeLeave({
        from: entries[cursor]!.destination, to: destination, operation, signal: guard.signal,
      }) : 'allow';
      if (disposed || capturedGeneration !== generation || guard.signal.aborted) return { status: 'invalidated' };
      if (decision === 'cancel') return { status: 'cancelled' };
      if (decision === 'busy') return { status: 'busy' };
      if (decision !== 'allow') throw new TypeError('Invalid leave decision.');
      if (operation === 'back' || operation === 'forward') {
        cursor = targetCursor;
        // The current App validator may normalize a still-valid reference.
        entries[cursor] = Object.freeze({ key: entries[cursor]!.key, destination });
      } else if (operation === 'replace') {
        entries[cursor] = entry(destination);
      } else {
        entries = [...entries.slice(0, cursor + 1), entry(destination)];
        if (entries.length > NIMI_NAVIGATION_HISTORY_LIMIT) entries.shift();
        cursor = entries.length - 1;
      }
      return { status: 'committed' };
    } catch (error) {
      return disposed || capturedGeneration !== generation || guard.signal.aborted
        ? { status: 'invalidated' } : { status: 'failed', error };
    } finally {
      if (pending === guard) { pending = null; publish(); }
    }
  };

  return Object.freeze({
    getSnapshot: () => currentSnapshot,
    subscribe: (listener: () => void) => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    push: (destination: D) => transition('push', destination),
    replace: (destination: D) => transition('replace', destination),
    back: () => transition('back'),
    forward: () => transition('forward'),
    reset: (initial: D) => {
      if (disposed) throw new Error('Navigation is disposed.');
      const destination = normalize(initial);
      generation += 1;
      pending?.abort();
      pending = null;
      entries = [entry(destination)];
      cursor = 0;
      publish();
    },
    dispose: () => {
      if (disposed) return;
      generation += 1;
      disposed = true;
      pending?.abort();
      pending = null;
      entries = [entries[cursor]!];
      cursor = 0;
      publish();
      listeners.clear();
    },
  });
}

/** Sort/copy/freeze position data so caller mutation cannot rewrite history. */
function copyPosition(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || !value || ancestors.has(value)) {
    throw new TypeError('Destinations contain finite copyable position data only.');
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Destination values must be plain objects or arrays.');
  }
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError('Symbol destination fields are not supported.');
  ancestors.add(value);
  try {
    return Object.freeze(Array.isArray(value)
      ? value.map(item => copyPosition(item, ancestors))
      : Object.fromEntries(Object.keys(value).sort().map(key => [key, copyPosition((value as Record<string, unknown>)[key], ancestors)])));
  } finally { ancestors.delete(value); }
}
