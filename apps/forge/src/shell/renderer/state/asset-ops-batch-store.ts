import { create } from 'zustand';
import type { AgentDeliverableStatus, WorldOwnedAgentRosterItem } from '@renderer/hooks/use-agent-queries.js';
import type { WorldDeliverableFamily } from '@renderer/features/asset-ops/deliverable-registry.js';

export type AssetOpsBatchRunKind =
  | 'WORLD_MISSING_DELIVERABLES'
  | 'AGENT_MISSING_DELIVERABLES';

export type AssetOpsBatchItemStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'SKIPPED';

export type AssetOpsBatchTask =
  | {
    kind: 'WORLD_IMAGE';
    worldId: string;
    family: WorldDeliverableFamily;
    worldName: string;
    worldDescription: string;
    worldOverview: string;
  }
  | {
    kind: 'AGENT_IMAGE';
    agentId: string;
    family: 'agent-avatar' | 'agent-cover';
    agentName: string;
    agentConcept: string;
    worldName: string;
    worldDescription: string;
  }
  | {
    kind: 'AGENT_GREETING';
    agentId: string;
    worldName: string;
    worldDescription: string;
    displayName: string;
    concept: string;
    description: string;
    scenario: string;
    greeting: string;
  }
  | {
    kind: 'AGENT_VOICE_DEMO';
    agentId: string;
    displayName: string;
    fallbackGreeting: string;
  };

export type AssetOpsBatchItemRecord = {
  id: string;
  runId: string;
  workspaceId: string;
  worldId: string | null;
  family: string;
  entityId: string | null;
  label: string;
  status: AssetOpsBatchItemStatus;
  task: AssetOpsBatchTask | null;
  attemptCount: number;
  lastError: string | null;
  resultSummary: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AssetOpsBatchRunRecord = {
  id: string;
  workspaceId: string;
  worldId: string | null;
  kind: AssetOpsBatchRunKind;
  label: string;
  status: 'PENDING' | 'RUNNING' | 'FAILED' | 'SUCCEEDED';
  createdAt: string;
  updatedAt: string;
  items: AssetOpsBatchItemRecord[];
};

type AssetOpsBatchProfileState = {
  runs: AssetOpsBatchRunRecord[];
};

type AssetOpsBatchPersistedState = {
  version: 1;
  profiles: Record<string, AssetOpsBatchProfileState>;
};

export type PlannedAssetOpsBatchItem = {
  workspaceId: string;
  worldId: string | null;
  family: string;
  entityId: string | null;
  label: string;
  task: AssetOpsBatchTask | null;
  status?: AssetOpsBatchItemStatus;
  lastError?: string | null;
};

type CreateBatchRunInput = {
  userId?: string | null;
  workspaceId: string;
  worldId?: string | null;
  kind: AssetOpsBatchRunKind;
  label: string;
  items: PlannedAssetOpsBatchItem[];
};

type AssetOpsBatchStore = {
  profiles: Record<string, AssetOpsBatchProfileState>;
  createRun: (input: CreateBatchRunInput) => AssetOpsBatchRunRecord | null;
  markItemRunning: (input: { userId?: string | null; runId: string; itemId: string }) => AssetOpsBatchItemRecord | null;
  markItemSucceeded: (input: { userId?: string | null; runId: string; itemId: string; resultSummary?: string | null }) => AssetOpsBatchItemRecord | null;
  markItemFailed: (input: { userId?: string | null; runId: string; itemId: string; error: string }) => AssetOpsBatchItemRecord | null;
  retryFailedRun: (input: { userId?: string | null; runId: string }) => AssetOpsBatchRunRecord | null;
  resumePendingRun: (input: { userId?: string | null; runId: string }) => AssetOpsBatchRunRecord | null;
  removeRun: (input: { userId?: string | null; runId: string }) => void;
};

const STORAGE_KEY = 'nimi:forge:asset-ops-batch:v1';
const EMPTY_PROFILE: AssetOpsBatchProfileState = { runs: [] };
const RUN_KIND_VALUES = [
  'WORLD_MISSING_DELIVERABLES',
  'AGENT_MISSING_DELIVERABLES',
] as const satisfies readonly AssetOpsBatchRunKind[];
const ITEM_STATUS_VALUES = [
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
] as const satisfies readonly AssetOpsBatchItemStatus[];

function getWindowStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const storage = window.localStorage;
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    return null;
  }
  return storage;
}

function normalizeUserId(userId?: string | null): string {
  const normalized = String(userId || '').trim();
  return normalized || 'anonymous';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeRunKind(value: unknown): AssetOpsBatchRunKind {
  return RUN_KIND_VALUES.find((entry) => entry === value) ?? 'WORLD_MISSING_DELIVERABLES';
}

function normalizeItemStatus(value: unknown): AssetOpsBatchItemStatus {
  return ITEM_STATUS_VALUES.find((entry) => entry === value) ?? 'PENDING';
}

function deriveRunStatus(items: AssetOpsBatchItemRecord[]): AssetOpsBatchRunRecord['status'] {
  if (items.some((item) => item.status === 'RUNNING')) {
    return 'RUNNING';
  }
  if (items.some((item) => item.status === 'PENDING')) {
    return 'PENDING';
  }
  if (items.some((item) => item.status === 'FAILED')) {
    return 'FAILED';
  }
  return 'SUCCEEDED';
}

function normalizeTask(value: unknown): AssetOpsBatchTask | null {
  if (!isRecord(value)) {
    return null;
  }
  const kind = toStringOrNull(value.kind);
  switch (kind) {
    case 'WORLD_IMAGE': {
      const worldId = toStringOrNull(value.worldId);
      const family = toStringOrNull(value.family) as WorldDeliverableFamily | null;
      if (!worldId || !family) {
        return null;
      }
      return {
        kind,
        worldId,
        family,
        worldName: toStringOrNull(value.worldName) || '',
        worldDescription: toStringOrNull(value.worldDescription) || '',
        worldOverview: toStringOrNull(value.worldOverview) || '',
      };
    }
    case 'AGENT_IMAGE': {
      const agentId = toStringOrNull(value.agentId);
      const family = toStringOrNull(value.family);
      if (!agentId || (family !== 'agent-avatar' && family !== 'agent-cover')) {
        return null;
      }
      return {
        kind,
        agentId,
        family,
        agentName: toStringOrNull(value.agentName) || '',
        agentConcept: toStringOrNull(value.agentConcept) || '',
        worldName: toStringOrNull(value.worldName) || '',
        worldDescription: toStringOrNull(value.worldDescription) || '',
      };
    }
    case 'AGENT_GREETING': {
      const agentId = toStringOrNull(value.agentId);
      if (!agentId) {
        return null;
      }
      return {
        kind,
        agentId,
        worldName: toStringOrNull(value.worldName) || '',
        worldDescription: toStringOrNull(value.worldDescription) || '',
        displayName: toStringOrNull(value.displayName) || '',
        concept: toStringOrNull(value.concept) || '',
        description: toStringOrNull(value.description) || '',
        scenario: toStringOrNull(value.scenario) || '',
        greeting: toStringOrNull(value.greeting) || '',
      };
    }
    case 'AGENT_VOICE_DEMO': {
      const agentId = toStringOrNull(value.agentId);
      if (!agentId) {
        return null;
      }
      return {
        kind,
        agentId,
        displayName: toStringOrNull(value.displayName) || '',
        fallbackGreeting: toStringOrNull(value.fallbackGreeting) || '',
      };
    }
    default:
      return null;
  }
}

function normalizeItem(value: unknown): AssetOpsBatchItemRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = toStringOrNull(value.id);
  const runId = toStringOrNull(value.runId);
  const workspaceId = toStringOrNull(value.workspaceId);
  const family = toStringOrNull(value.family);
  const label = toStringOrNull(value.label);
  if (!id || !runId || !workspaceId || !family || !label) {
    return null;
  }
  const createdAt = toStringOrNull(value.createdAt) || new Date(0).toISOString();
  const updatedAt = toStringOrNull(value.updatedAt) || createdAt;
  const status = normalizeItemStatus(value.status);
  return {
    id,
    runId,
    workspaceId,
    worldId: toStringOrNull(value.worldId),
    family,
    entityId: toStringOrNull(value.entityId),
    label,
    status: status === 'RUNNING' ? 'PENDING' : status,
    task: normalizeTask(value.task),
    attemptCount: Number.isFinite(Number(value.attemptCount)) ? Number(value.attemptCount) : 0,
    lastError: toStringOrNull(value.lastError),
    resultSummary: toStringOrNull(value.resultSummary),
    createdAt,
    updatedAt,
  };
}

function normalizeRun(value: unknown): AssetOpsBatchRunRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = toStringOrNull(value.id);
  const workspaceId = toStringOrNull(value.workspaceId);
  const label = toStringOrNull(value.label);
  if (!id || !workspaceId || !label) {
    return null;
  }
  const items = Array.isArray(value.items)
    ? value.items.map(normalizeItem).filter((item): item is AssetOpsBatchItemRecord => item !== null)
    : [];
  const createdAt = toStringOrNull(value.createdAt) || new Date(0).toISOString();
  const updatedAt = toStringOrNull(value.updatedAt) || createdAt;
  return {
    id,
    workspaceId,
    worldId: toStringOrNull(value.worldId),
    kind: normalizeRunKind(value.kind),
    label,
    status: deriveRunStatus(items),
    createdAt,
    updatedAt,
    items,
  };
}

function normalizeProfileState(value: unknown): AssetOpsBatchProfileState {
  if (!isRecord(value)) {
    return { ...EMPTY_PROFILE };
  }
  const runs = Array.isArray(value.runs)
    ? value.runs.map(normalizeRun).filter((item): item is AssetOpsBatchRunRecord => item !== null)
    : [];
  return { runs };
}

function readProfilesFromStorage(): Record<string, AssetOpsBatchProfileState> {
  const storage = getWindowStorage();
  if (!storage) {
    return {};
  }
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.profiles)) {
      return {};
    }
    return Object.entries(parsed.profiles).reduce<Record<string, AssetOpsBatchProfileState>>((acc, [profileId, profile]) => {
      acc[normalizeUserId(profileId)] = normalizeProfileState(profile);
      return acc;
    }, {});
  } catch {
    return {};
  }
}

function persistProfiles(profiles: Record<string, AssetOpsBatchProfileState>): void {
  const storage = getWindowStorage();
  if (!storage) {
    return;
  }
  const payload: AssetOpsBatchPersistedState = {
    version: 1,
    profiles,
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function getProfileRuns(
  profiles: Record<string, AssetOpsBatchProfileState>,
  userId?: string | null,
): AssetOpsBatchRunRecord[] {
  return profiles[normalizeUserId(userId)]?.runs ?? [];
}

function replaceProfileRuns(
  profiles: Record<string, AssetOpsBatchProfileState>,
  userId: string | null | undefined,
  runs: AssetOpsBatchRunRecord[],
): Record<string, AssetOpsBatchProfileState> {
  const profileId = normalizeUserId(userId);
  return {
    ...profiles,
    [profileId]: { runs },
  };
}

function updateRun(
  runs: AssetOpsBatchRunRecord[],
  runId: string,
  transform: (run: AssetOpsBatchRunRecord) => AssetOpsBatchRunRecord,
): AssetOpsBatchRunRecord[] {
  return runs.map((run) => (run.id === runId ? transform(run) : run));
}

export const useAssetOpsBatchStore = create<AssetOpsBatchStore>((set, get) => ({
  profiles: readProfilesFromStorage(),

  createRun: (input) => {
    const pendingOrSkippedItems = input.items.map<AssetOpsBatchItemRecord>((item) => {
      const now = new Date().toISOString();
      return {
        id: crypto.randomUUID(),
        runId: '',
        workspaceId: item.workspaceId,
        worldId: item.worldId,
        family: item.family,
        entityId: item.entityId,
        label: item.label,
        status: item.status ?? 'PENDING',
        task: item.task,
        attemptCount: 0,
        lastError: item.lastError ?? null,
        resultSummary: null,
        createdAt: now,
        updatedAt: now,
      };
    });
    if (pendingOrSkippedItems.length === 0) {
      return null;
    }
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();
    const run: AssetOpsBatchRunRecord = {
      id: runId,
      workspaceId: input.workspaceId,
      worldId: String(input.worldId || '').trim() || null,
      kind: input.kind,
      label: input.label,
      status: deriveRunStatus(pendingOrSkippedItems),
      createdAt: now,
      updatedAt: now,
      items: pendingOrSkippedItems.map((item) => ({ ...item, runId })),
    };
    const currentProfiles = get().profiles;
    const runs = getProfileRuns(currentProfiles, input.userId);
    const nextRuns = [run, ...runs];
    const nextProfiles = replaceProfileRuns(currentProfiles, input.userId, nextRuns);
    persistProfiles(nextProfiles);
    set({ profiles: nextProfiles });
    return run;
  },

  markItemRunning: (input) => {
    const currentProfiles = get().profiles;
    const runs = getProfileRuns(currentProfiles, input.userId);
    let updatedItem: AssetOpsBatchItemRecord | null = null;
    const nextRuns = updateRun(runs, input.runId, (run) => {
      const items = run.items.map((item) => {
        if (item.id !== input.itemId) {
          return item;
        }
        updatedItem = {
          ...item,
          status: 'RUNNING',
          attemptCount: item.attemptCount + 1,
          lastError: null,
          updatedAt: new Date().toISOString(),
        };
        return updatedItem;
      });
      return {
        ...run,
        status: deriveRunStatus(items),
        updatedAt: new Date().toISOString(),
        items,
      };
    });
    const nextProfiles = replaceProfileRuns(currentProfiles, input.userId, nextRuns);
    persistProfiles(nextProfiles);
    set({ profiles: nextProfiles });
    return updatedItem;
  },

  markItemSucceeded: (input) => {
    const currentProfiles = get().profiles;
    const runs = getProfileRuns(currentProfiles, input.userId);
    let updatedItem: AssetOpsBatchItemRecord | null = null;
    const nextRuns = updateRun(runs, input.runId, (run) => {
      const items = run.items.map((item) => {
        if (item.id !== input.itemId) {
          return item;
        }
        updatedItem = {
          ...item,
          status: 'SUCCEEDED',
          lastError: null,
          resultSummary: toStringOrNull(input.resultSummary) || 'Generated candidate queued.',
          updatedAt: new Date().toISOString(),
        };
        return updatedItem;
      });
      return {
        ...run,
        status: deriveRunStatus(items),
        updatedAt: new Date().toISOString(),
        items,
      };
    });
    const nextProfiles = replaceProfileRuns(currentProfiles, input.userId, nextRuns);
    persistProfiles(nextProfiles);
    set({ profiles: nextProfiles });
    return updatedItem;
  },

  markItemFailed: (input) => {
    const currentProfiles = get().profiles;
    const runs = getProfileRuns(currentProfiles, input.userId);
    let updatedItem: AssetOpsBatchItemRecord | null = null;
    const nextRuns = updateRun(runs, input.runId, (run) => {
      const items = run.items.map((item) => {
        if (item.id !== input.itemId) {
          return item;
        }
        updatedItem = {
          ...item,
          status: 'FAILED',
          lastError: input.error.trim() || 'Batch task failed.',
          updatedAt: new Date().toISOString(),
        };
        return updatedItem;
      });
      return {
        ...run,
        status: deriveRunStatus(items),
        updatedAt: new Date().toISOString(),
        items,
      };
    });
    const nextProfiles = replaceProfileRuns(currentProfiles, input.userId, nextRuns);
    persistProfiles(nextProfiles);
    set({ profiles: nextProfiles });
    return updatedItem;
  },

  retryFailedRun: (input) => {
    const currentProfiles = get().profiles;
    const runs = getProfileRuns(currentProfiles, input.userId);
    let updatedRun: AssetOpsBatchRunRecord | null = null;
    const nextRuns = updateRun(runs, input.runId, (run) => {
      const items = run.items.map((item) => (
        item.status === 'FAILED'
          ? {
            ...item,
            status: 'PENDING' as const,
            lastError: null,
            resultSummary: null,
            updatedAt: new Date().toISOString(),
          }
          : item
      ));
      updatedRun = {
        ...run,
        status: deriveRunStatus(items),
        updatedAt: new Date().toISOString(),
        items,
      };
      return updatedRun;
    });
    const nextProfiles = replaceProfileRuns(currentProfiles, input.userId, nextRuns);
    persistProfiles(nextProfiles);
    set({ profiles: nextProfiles });
    return updatedRun;
  },

  resumePendingRun: (input) => {
    const currentProfiles = get().profiles;
    const runs = getProfileRuns(currentProfiles, input.userId);
    const run = runs.find((item) => item.id === input.runId) ?? null;
    return run;
  },

  removeRun: (input) => {
    const currentProfiles = get().profiles;
    const runs = getProfileRuns(currentProfiles, input.userId);
    const nextRuns = runs.filter((run) => run.id !== input.runId);
    const nextProfiles = replaceProfileRuns(currentProfiles, input.userId, nextRuns);
    persistProfiles(nextProfiles);
    set({ profiles: nextProfiles });
  },
}));

export function selectAssetOpsBatchRuns(
  profiles: Record<string, AssetOpsBatchProfileState>,
  input: { userId?: string | null; workspaceId: string },
): AssetOpsBatchRunRecord[] {
  return getProfileRuns(profiles, input.userId)
    .filter((run) => run.workspaceId === input.workspaceId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
}
