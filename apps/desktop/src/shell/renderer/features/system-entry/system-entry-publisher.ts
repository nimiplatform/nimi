import { SYSTEM_ENTRY_HEARTBEAT_MS, SYSTEM_ENTRY_LIVENESS_MS, type SystemEntryContext, type SystemEntryProjection } from '../../../shared/system-entry-types.js';

export type SystemEntryProjectionDraft = Omit<SystemEntryProjection, 'revision'>;
export type SystemEntryPublisher = {
  start(): void;
  stop(): void;
  update(): void;
  refreshContext(): Promise<SystemEntryContext | null>;
  currentContext(): SystemEntryContext | null;
  published(): SystemEntryProjection | null;
};

/** Serializes display publication; no SDK, business action or task is replayed. */
export function createSystemEntryPublisher(input: {
  readContext(): Promise<SystemEntryContext>;
  heartbeat(generation: string): Promise<void>;
  publish(projection: SystemEntryProjection): Promise<void>;
  draft(): SystemEntryProjectionDraft | null;
  onContext(context: SystemEntryContext | null): void;
  onPublished(projection: SystemEntryProjection | null): void;
  refreshSources(): Promise<void>;
  now?: () => number;
}): SystemEntryPublisher {
  const now = input.now ?? Date.now;
  let active = false;
  let context: SystemEntryContext | null = null;
  let generation: string | null = null;
  let published: SystemEntryProjection | null = null;
  let revision = 0;
  let signature = '';
  let queued = false;
  let publishing = false;
  let checking: Promise<SystemEntryContext | null> | null = null;
  let heartbeatRunning = false;
  let heartbeatAt = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let epoch = 0;

  const refreshContext = (): Promise<SystemEntryContext | null> => {
    if (!active) return Promise.resolve(null);
    if (checking) return checking;
    const captured = epoch;
    const read = input.readContext().then((next) => {
      if (!active || captured !== epoch) return null;
      if (generation !== next.generation) {
        generation = next.generation;
        revision = 0; signature = ''; published = null;
        input.onPublished(null);
      }
      context = next;
      if (next.state !== 'ready') { published = null; signature = ''; input.onPublished(null); }
      input.onContext(next);
      return next;
    }, () => {
      if (active && captured === epoch) {
        context = null; published = null; signature = '';
        input.onContext(null); input.onPublished(null);
      }
      return null;
    });
    const tracked = read.finally(() => { if (checking === tracked) checking = null; });
    checking = tracked;
    return tracked;
  };
  const pump = async (): Promise<void> => {
    if (!active || publishing) return;
    publishing = true;
    try {
      while (active && queued) {
        queued = false;
        const draft = input.draft();
        if (!draft || context?.state !== 'ready' || draft.generation !== context.generation) continue;
        const nextSignature = JSON.stringify(draft);
        if (nextSignature === signature) continue;
        const captured = epoch;
        const projection = { ...draft, revision: ++revision };
        try {
          await input.publish(projection);
          if (!active || captured !== epoch || context?.generation !== projection.generation) continue;
          signature = nextSignature; published = projection; heartbeatAt = now();
          input.onPublished(projection);
        } catch {
          if (!active || captured !== epoch) continue;
          published = null; input.onPublished(null);
          await refreshContext();
          // A subsequent current source observation will publish a newer
          // revision. Never spin on refused data or turn a heartbeat into it.
          queued = false;
        }
      }
    } finally { publishing = false; }
  };
  const tick = async (): Promise<void> => {
    if (!active || heartbeatRunning) return;
    heartbeatRunning = true;
    try {
      if (!context) await refreshContext();
      const current = context;
      if (!current) return;
      const gap = heartbeatAt > 0 && now() - heartbeatAt >= SYSTEM_ENTRY_LIVENESS_MS;
      await input.heartbeat(current.generation);
      heartbeatAt = now();
      if (gap && current.state === 'ready') {
        signature = '';
        await input.refreshSources().catch(() => undefined);
        queued = true;
        await pump();
      }
    } catch {
      const next = await refreshContext();
      if (next?.state === 'ready') {
        signature = '';
        await input.refreshSources().catch(() => undefined);
        queued = true;
        await pump();
      }
    } finally { heartbeatRunning = false; }
  };
  return {
    start(): void {
      if (active) return;
      active = true; epoch += 1;
      void refreshContext();
      timer = setInterval(() => { void tick(); }, SYSTEM_ENTRY_HEARTBEAT_MS);
    },
    stop(): void {
      active = false; epoch += 1;
      if (timer) clearInterval(timer);
      timer = undefined; queued = false; context = null; published = null;
    },
    update(): void { queued = true; void pump(); },
    refreshContext,
    currentContext: () => context,
    published: () => published,
  };
}
