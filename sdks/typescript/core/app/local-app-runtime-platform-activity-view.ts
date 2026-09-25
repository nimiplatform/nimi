import { extractNimiErrorFields } from '../../types/errors.js';
import type {
  NimiAppActivityChange,
  NimiAppActivityFilter,
  NimiAppActivityRecord,
  NimiAppActivitySubscription,
  NimiLocalAppActivityClient,
} from './local-app-runtime-platform-activity.js';

export type NimiAppActivityViewStatus = 'loading' | 'ready' | 'unavailable';

export type NimiAppActivityViewSnapshot = Readonly<{
  status: NimiAppActivityViewStatus;
  /** Records currently matching the view filter, newest first. */
  records: readonly NimiAppActivityRecord[];
  /** True once every page of the current baseline has been merged. */
  complete: boolean;
  /**
   * True when listing paused at the `maxRecords` bound while older pages of
   * the same baseline remain; `loadMore` continues it. The records are then a
   * truncated projection and never the complete set.
   */
  hasMore: boolean;
  error: unknown;
}>;

export type NimiAppActivityViewOptions = {
  readonly activity: Pick<NimiLocalAppActivityClient, 'list' | 'subscribe'>;
  readonly filter?: NimiAppActivityFilter;
  readonly pageSize?: number;
  /** Records merged per listing step; listing pauses with `hasMore` once reached. */
  readonly maxRecords?: number;
  readonly onUpdate: (snapshot: NimiAppActivityViewSnapshot) => void;
};

export type NimiAppActivityView = {
  readonly start: () => void;
  readonly stop: () => Promise<void>;
  readonly relist: () => void;
  /** Continues a paused listing of the same baseline by up to another `maxRecords` records. */
  readonly loadMore: () => void;
  readonly snapshot: () => NimiAppActivityViewSnapshot;
};

const cursorValue = (value: string): bigint => BigInt(value);

/**
 * Pure merge state: highest change sequence per id wins, filter membership is
 * evaluated after the merge, and removed or filtered-out ids keep their
 * highest sequence so an older page or in-flight change cannot resurrect or
 * regress them. The state lives for one listing baseline only.
 */
export class NimiAppActivityMergeState {
  private readonly records = new Map<string, NimiAppActivityRecord>();
  private readonly retired = new Map<string, bigint>();

  constructor(private readonly filter: NimiAppActivityFilter = {}) {}

  private highest(activityId: string): bigint {
    const current = this.records.get(activityId);
    const retired = this.retired.get(activityId);
    const candidates = [current ? cursorValue(current.changeSeq) : -1n, retired ?? -1n];
    return candidates[0]! > candidates[1]! ? candidates[0]! : candidates[1]!;
  }

  /** Merges a listed or changed projection; returns true when visible state changed. */
  mergeRecord(record: NimiAppActivityRecord): boolean {
    const seq = cursorValue(record.changeSeq);
    if (seq <= this.highest(record.activityId)) return false;
    if (matchesNimiAppActivityFilter(record, this.filter)) {
      this.records.set(record.activityId, record);
      this.retired.delete(record.activityId);
      return true;
    }
    const wasVisible = this.records.delete(record.activityId);
    this.retired.set(record.activityId, seq);
    return wasVisible;
  }

  mergeRemove(activityId: string, changeSeq: string): boolean {
    const seq = cursorValue(changeSeq);
    if (seq <= this.highest(activityId)) return false;
    const wasVisible = this.records.delete(activityId);
    this.retired.set(activityId, seq);
    return wasVisible;
  }

  mergeChange(change: NimiAppActivityChange): boolean {
    return change.kind === 'upsert'
      ? this.mergeRecord(change.record)
      : this.mergeRemove(change.activityId, change.changeSeq);
  }

  list(): readonly NimiAppActivityRecord[] {
    return [...this.records.values()].sort((left, right) => (
      right.occurredAt.localeCompare(left.occurredAt) || right.activityId.localeCompare(left.activityId)
    ));
  }
}

export function matchesNimiAppActivityFilter(record: NimiAppActivityRecord, filter: NimiAppActivityFilter): boolean {
  if (filter.sourceRef !== undefined && record.source.sourceRef !== filter.sourceRef) return false;
  if (filter.kind !== undefined && record.kind !== filter.kind) return false;
  if (filter.todoStates !== undefined && filter.todoStates.length > 0 &&
    (record.todoState === null || !filter.todoStates.includes(record.todoState))) return false;
  if (filter.agentRef !== undefined && record.agent?.agentRef !== filter.agentRef) return false;
  if (filter.occurredAfter !== undefined && Date.parse(record.occurredAt) < Date.parse(filter.occurredAfter)) return false;
  if (filter.occurredBefore !== undefined && Date.parse(record.occurredAt) >= Date.parse(filter.occurredBefore)) return false;
  return true;
}

function cursorProblem(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  return [record.code, record.reasonCode].some((value) => {
    const token = String(value ?? '').toLowerCase();
    return token === 'invalid-cursor' || token === 'app_activity_cursor_expired' || token === 'app_activity_page_token_invalid';
  });
}

// @nimi-authority: rule.nimi.platform.core-protocol.p-actv-003
// @nimi-authority: rule.nimi.sdks.feature-clients.r113
/**
 * Maintains one filtered activity projection from the public list and
 * subscribe operations. It never marks records read. A new filter requires a
 * new view. Any ended or failed subscription, including an expired cursor,
 * is recovered by a fresh listing baseline.
 */
export function createNimiAppActivityView(options: NimiAppActivityViewOptions): NimiAppActivityView {
  const filter = options.filter ?? {};
  const pageSize = options.pageSize ?? 100;
  const maxRecords = options.maxRecords ?? 500;
  let generation = 0;
  let state = new NimiAppActivityMergeState(filter);
  let current: NimiAppActivitySnapshotInternal = { status: 'loading', complete: false, hasMore: false, error: null };
  let subscription: NimiAppActivitySubscription | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let failures = 0;
  // The paused continuation of the current listing baseline, if any.
  let continuation: { readonly generation: number; readonly token: string } | null = null;
  let pagingGeneration = 0;

  const publish = () => {
    options.onUpdate(Object.freeze({ ...current, records: Object.freeze(state.list()) }));
  };

  const closeSubscription = async () => {
    const active = subscription;
    subscription = undefined;
    await active?.cancel().catch(() => undefined);
  };

  const scheduleRetry = (action: () => void, delayMs: number) => {
    if (!running) return;
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (running) action();
    }, delayMs);
  };

  const follow = async (listingGeneration: number, afterChangeSeq: string) => {
    let openedAt: number | undefined;
    let expired = false;
    try {
      const active = await options.activity.subscribe({ afterChangeSeq });
      if (!running || listingGeneration !== generation) {
        await active.cancel().catch(() => undefined);
        return;
      }
      subscription = active;
      openedAt = Date.now();
      for await (const change of active) {
        if (!running || listingGeneration !== generation) return;
        if (state.mergeChange(change)) publish();
      }
    } catch (error) {
      if (!running || listingGeneration !== generation) return;
      if (cursorProblem(error)) expired = true;
      else current = { ...current, error };
    }
    if (!running || listingGeneration !== generation) return;
    // The ended stream may belong to a previous account. Invalidate pending
    // pages and clear its projection before waiting for a new baseline.
    generation += 1;
    state = new NimiAppActivityMergeState(filter);
    continuation = null;
    current = { status: 'loading', complete: false, hasMore: false, error: current.error };
    void closeSubscription();
    publish();
    // Change cursors are not bound to an account, and an ended subscription
    // may belong to a session that was replaced by another account or a
    // restarted Runtime. Recovery therefore starts a fresh listing baseline
    // instead of replaying from the last processed change.
    // A long-lived subscription that ends starts a new backoff series.
    failures = openedAt !== undefined && Date.now() - openedAt >= 30_000 ? 1 : failures + 1;
    // A first expired cursor is an explicit relist requirement, not a fault.
    const delay = expired && failures === 1 ? 0 : Math.min(250 * 2 ** (failures - 1), 5_000);
    scheduleRetry(() => startListing(), delay);
  };

  // Merges continuation pages of one baseline until the step budget is spent;
  // a remaining token pauses the listing with hasMore instead of claiming it
  // complete.
  const continueListing = async (listingGeneration: number, token: string | null, budget: number) => {
    pagingGeneration = listingGeneration;
    try {
      let next = token;
      let merged = 0;
      while (next !== null && merged < budget) {
        const page = await options.activity.list({ filter, pageSize, pageToken: next });
        if (!running || listingGeneration !== generation) return;
        for (const record of page.records) state.mergeRecord(record);
        merged += page.records.length;
        next = page.nextPageToken;
        if (next !== null) publish();
      }
      continuation = next === null ? null : { generation: listingGeneration, token: next };
      current = { ...current, complete: next === null, hasMore: next !== null, error: null };
      publish();
    } finally {
      if (pagingGeneration === listingGeneration) pagingGeneration = 0;
    }
  };

  const startListing = ({ keepVisible = false, background = false } = {}) => {
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    retryTimer = undefined;
    generation += 1;
    const listingGeneration = generation;
    const next = new NimiAppActivityMergeState(filter);
    // A relist may keep the previous projection visible until its first page
    // arrives; the projection is replaced, never merged, with the new baseline.
    if (!keepVisible) state = next;
    // Automatic recovery keeps the read failure visible until a new baseline
    // succeeds. Returning to initial loading on every retry makes consumers
    // repeatedly remove their error/empty state and flash a loading skeleton.
    if (!background) current = { status: 'loading', complete: false, hasMore: false, error: null };
    continuation = null;
    void closeSubscription();
    if (!background) publish();
    void (async () => {
      try {
        const first = await options.activity.list({ filter, pageSize });
        if (!running || listingGeneration !== generation) return;
        state = next;
        for (const record of first.records) state.mergeRecord(record);
        current = { status: 'ready', complete: first.nextPageToken === null, hasMore: false, error: null };
        publish();
        void follow(listingGeneration, first.baselineChangeSeq);
        if (first.nextPageToken !== null) {
          await continueListing(listingGeneration, first.nextPageToken, maxRecords - first.records.length);
        }
      } catch (error) {
        if (!running || listingGeneration !== generation) return;
        // Without a current listing the previous projection may belong to a
        // session that no longer exists; drop it rather than show it as current.
        state = new NimiAppActivityMergeState(filter);
        current = { status: 'unavailable', complete: false, hasMore: false, error };
        continuation = null;
        publish();
        if (extractNimiErrorFields(error).retryable !== false) {
          scheduleRetry(() => startListing({ background: true }), 3_000);
        }
      }
    })();
  };

  const loadMore = () => {
    const paused = continuation;
    if (!running || !paused || paused.generation !== generation || pagingGeneration === generation) return;
    void continueListing(paused.generation, paused.token, maxRecords).catch((error) => {
      if (!running || paused.generation !== generation) return;
      // A continuation that no longer belongs to this account or baseline
      // requires a fresh listing; other failures keep the paused position.
      if (cursorProblem(error)) {
        startListing({ keepVisible: true });
        return;
      }
      current = { ...current, error };
      publish();
    });
  };

  return Object.freeze({
    start: () => {
      if (running) return;
      running = true;
      startListing();
    },
    stop: async () => {
      running = false;
      generation += 1;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
      await closeSubscription();
    },
    relist: () => {
      if (running) startListing({ keepVisible: true });
    },
    loadMore,
    snapshot: () => Object.freeze({ ...current, records: Object.freeze(state.list()) }),
  });
}

type NimiAppActivitySnapshotInternal = {
  status: NimiAppActivityViewStatus;
  complete: boolean;
  hasMore: boolean;
  error: unknown;
};
