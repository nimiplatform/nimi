// Public App Activity: other Apps' shared records in, NimiDay's own
// reminders and results out to Nimi Home. Read state is shared with Home and
// only changes on an explicit user action.

import {
  createNimiAppActivityView,
  type NimiAppActivityFilter,
  type NimiAppActivityOpenHandler,
  type NimiAppActivityOpenResult,
  type NimiAppActivityPutInput,
  type NimiAppActivityRecord,
  type NimiAppActivityView,
  type NimiAppActivityViewSnapshot,
  type NimiLocalAppClient,
} from '@nimiplatform/sdk/app';
import type { ActivityCoverage, ListingCoverage } from '../domain/sources.js';

export type { ActivityCoverage, ListingCoverage } from '../domain/sources.js';

export type ActivityStatus = 'idle' | 'loading' | 'ready' | 'no-access' | 'unavailable';


export type ActivityState = {
  readonly status: ActivityStatus;
  readonly records: readonly NimiAppActivityRecord[];
  /** Some listing paused with older records left; `loadMore` continues it. */
  readonly hasMore: boolean;
  readonly coverage: ActivityCoverage;
  readonly error: string | null;
};

const PAGE_SIZE = 100;
/** Records merged per listing step before it pauses and waits for "load more". */
const LISTING_STEP = 400;
const OPEN_TODOS: NimiAppActivityFilter = { kind: 'todo', todoStates: ['open'] };
const NO_COVERAGE: ActivityCoverage = { openTodos: 'loading', recent: 'loading', recentCount: 0 };

function coverageOf(snapshot: NimiAppActivityViewSnapshot | null): ListingCoverage {
  if (!snapshot || snapshot.status === 'loading') return 'loading';
  if (snapshot.status === 'unavailable') return 'partial';
  if (snapshot.complete) return 'complete';
  return snapshot.hasMore ? 'partial' : 'loading';
}

/** One record per activity, the newest revision winning. */
function mergeRecords(...lists: readonly (readonly NimiAppActivityRecord[])[]): NimiAppActivityRecord[] {
  const byId = new Map<string, NimiAppActivityRecord>();
  for (const list of lists) {
    for (const record of list) {
      const previous = byId.get(record.activityId);
      if (!previous || BigInt(record.changeSeq) > BigInt(previous.changeSeq)) byId.set(record.activityId, record);
    }
  }
  return [...byId.values()];
}

type ActivityClient = NimiLocalAppClient['activity'];

function code(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const record = error as { reasonCode?: unknown; code?: unknown };
  return String(record.reasonCode ?? record.code ?? '').toLowerCase();
}

/** App Access for `app.activity` was not granted to this App session. */
export function isActivityAccessDenied(error: unknown): boolean {
  const value = code(error);
  return value.includes('permission-denied') || value.includes('operation-unavailable')
    || value.includes('operation_unavailable') || value.includes('forbidden') || value.includes('capability-unavailable');
}

function message(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Shared activity is unavailable.';
}

export type ActivityBridge = {
  readonly getState: () => ActivityState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly start: () => void;
  readonly stop: () => Promise<void>;
  readonly retry: () => void;
  readonly loadMore: () => void;
  readonly markRead: (record: NimiAppActivityRecord) => Promise<void>;
  readonly open: (activityId: string) => Promise<NimiAppActivityOpenResult>;
  readonly put: (input: NimiAppActivityPutInput) => Promise<NimiAppActivityRecord | null>;
  readonly onOpenRequest: (handler: NimiAppActivityOpenHandler) => Promise<() => Promise<void>>;
};

export function createActivityBridge(activity: ActivityClient): ActivityBridge {
  let state: ActivityState = { status: 'idle', records: [], hasMore: false, coverage: NO_COVERAGE, error: null };
  // Recent activity is listed newest first and pauses after each step; open
  // to-dos get a listing of their own, so an old reminder that is still open
  // is never lost behind a long tail of newer activity.
  let views: { recent: NimiAppActivityView; openTodos: NimiAppActivityView } | null = null;
  let recent: NimiAppActivityViewSnapshot | null = null;
  let openTodos: NimiAppActivityViewSnapshot | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: ActivityState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };

  const combine = () => {
    const failed = [recent, openTodos].find((snapshot) => snapshot?.status === 'unavailable');
    const denied = failed ? isActivityAccessDenied(failed.error) : false;
    // Recent activity decides readiness; open to-dos only widen what is known.
    const status: ActivityStatus = denied ? 'no-access'
      : recent?.status === 'unavailable' ? 'unavailable'
        : recent?.status === 'ready' ? 'ready' : 'loading';
    publish({
      status,
      records: mergeRecords(recent?.records ?? [], openTodos?.records ?? []),
      hasMore: Boolean(recent?.hasMore || openTodos?.hasMore),
      coverage: { openTodos: coverageOf(openTodos), recent: coverageOf(recent), recentCount: recent?.records.length ?? 0 },
      error: failed?.error ? message(failed.error) : null,
    });
  };

  const start = () => {
    if (views) return;
    publish({ ...state, status: 'loading', error: null });
    views = {
      recent: createNimiAppActivityView({
        activity,
        pageSize: PAGE_SIZE,
        maxRecords: LISTING_STEP,
        onUpdate: (snapshot) => { recent = snapshot; combine(); },
      }),
      openTodos: createNimiAppActivityView({
        activity,
        filter: OPEN_TODOS,
        pageSize: PAGE_SIZE,
        maxRecords: LISTING_STEP,
        onUpdate: (snapshot) => { openTodos = snapshot; combine(); },
      }),
    };
    views.recent.start();
    views.openTodos.start();
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,
    stop: async () => {
      const current = views;
      views = null;
      recent = null;
      openTodos = null;
      await Promise.all([current?.recent.stop(), current?.openTodos.stop()]);
    },
    retry: () => {
      if (!views) {
        start();
        return;
      }
      views.recent.relist();
      views.openTodos.relist();
    },
    // Only listings that paused with more left continue; nothing scans history on its own.
    loadMore: () => {
      if (recent?.hasMore) views?.recent.loadMore();
      if (openTodos?.hasMore) views?.openTodos.loadMore();
    },
    markRead: async (record) => {
      await activity.markRead({ activityId: record.activityId, displayedRevision: record.revision });
    },
    open: (activityId) => activity.open({ activityId }),
    put: async (input) => {
      if (state.status === 'no-access') return null;
      try {
        return (await activity.put(input)).record;
      } catch (error) {
        if (isActivityAccessDenied(error)) {
          publish({ ...state, status: 'no-access', error: message(error) });
          return null;
        }
        throw error;
      }
    },
    onOpenRequest: async (handler) => {
      const registration = await Promise.resolve(activity.onOpenRequest(handler));
      return () => registration.stop();
    },
  };
}

// ---- NimiDay's own records -------------------------------------------------

export const DAY_REMINDER_TYPE = 'nimi.day.care-reminder.v1';
export const DAY_DECISION_TYPE = 'nimi.day.decision.v1';
export const DAY_RESULT_TYPE = 'nimi.day.skill-result.v1';

export type OwnObject =
  | { readonly kind: 'item'; readonly id: string }
  | { readonly kind: 'run'; readonly id: string };

export function objectRefFor(object: OwnObject): string {
  return `${object.kind}:${object.id}`;
}

export function parseObjectRef(objectRef: string): OwnObject | null {
  const match = /^(item|run):([A-Za-z0-9_-]{1,120})$/u.exec(objectRef);
  if (!match) return null;
  return { kind: match[1] as OwnObject['kind'], id: match[2]! };
}
