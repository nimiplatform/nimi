import { useSyncExternalStore } from 'react';
import {
  readStorageJsonFrom,
  resolveBrowserStorage,
  writeStorageJsonTo,
} from '@nimiplatform/kit/core/storage-json';
import { createNimiClientId } from '@nimiplatform/sdk/types';
import type { NimiJsonObject } from '@nimiplatform/sdk/contracts';

/**
 * Shell-lifetime controller state for unified Runtime model setup tasks.
 * The store lives outside React so tasks survive panel unmounts; Runtime
 * remains the single source of truth for assets, Loadouts, selections, and
 * transfer/job progress. Only non-secret recovery fields are persisted, and
 * use-authorization is never persisted or replayed after a restart.
 */
// @nimi-authority: rule.nimi.desktop.ai-consumption.r026

export const RUNTIME_SETUP_TASKS_STORAGE_KEY = 'nimi:runtime-config:setup-tasks:v1';

export type RuntimeSetupTaskSourceKind = 'runtime' | 'app' | 'local-agent';

export type RuntimeSetupTaskSource = {
  readonly kind: RuntimeSetupTaskSourceKind;
  /** Exact consumer App id when the task was opened for one App owner. */
  readonly ownerAppId?: string;
  /** Account snapshot at task creation; writes stop when it no longer matches. */
  readonly accountId: string;
  /** Navigation-only return handle; grants no authority by itself. */
  readonly returnFocus?: string;
};

export type RuntimeSetupAuthorizationMode = 'prepare-and-use' | 'prepare-only';

export type RuntimeSetupScopeItem = {
  readonly kind: 'reuse-asset' | 'acquire-asset' | 'component' | 'option';
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  /** null means the size is unknown; unknown is never rendered as zero. */
  readonly sizeBytes?: number | null;
};

export type RuntimeSetupUsageScope = {
  /** The confirmation listed switching this machine's selection. */
  readonly selectOnMachine: boolean;
  /** The confirmation listed saving the source owner's AIConfig route. */
  readonly saveOwnerRoute: boolean;
  readonly ownerLabel?: string;
};

export type RuntimeSetupAuthorization = {
  readonly scope: {
    readonly items: readonly RuntimeSetupScopeItem[];
    readonly usage: RuntimeSetupUsageScope;
  };
  readonly confirmedAt: string;
  readonly mode: RuntimeSetupAuthorizationMode;
};

export type RuntimeSetupTaskDraftAxis = {
  readonly slotId: string;
  readonly modelAssetId: string;
  readonly expectedContentId: string;
};

/**
 * Declared content identity for a slot that still needs acquisition (from a
 * portable AIProfile's download-required axis). The task never substitutes a
 * recipe recommendation for this identity: preparation acquires exactly this
 * content or presents the slot as unavailable.
 */
export type RuntimeSetupTaskPendingAxis = {
  readonly slotId: string;
  readonly contentId: string;
  readonly expectedHash?: string;
  /** Runtime catalog template for the complete asset, including multi-file bundles. */
  readonly templateId?: string;
  readonly source?: {
    readonly repo: string;
    readonly revision: string;
    readonly file: string;
    readonly sizeBytes?: number;
  };
};

/**
 * Non-secret draft intent for the setup task. Advanced edits (exact variant
 * bindings, typed implementation options, optional-slot choices, route and
 * cloud target picks) survive view switches and restarts here; secrets and
 * use-authorization never do.
 */
export type RuntimeSetupTaskDraft = {
  readonly recipeId?: string;
  readonly route?: 'local' | 'cloud';
  readonly options?: Readonly<NimiJsonObject>;
  readonly axes?: readonly RuntimeSetupTaskDraftAxis[];
  /** Slots awaiting acquisition of a declared content identity (profile use). */
  readonly pendingAxes?: readonly RuntimeSetupTaskPendingAxis[];
  readonly disabledOptionalSlots?: readonly string[];
  /** Per-slot preferred offer chosen in advanced editing, consumed at review. */
  readonly preferredOffers?: Readonly<Record<string, string>>;
  readonly cloudConnectorRef?: string;
  readonly cloudTargetLabel?: string;
  /** Stable identity of the chosen cloud target for draft restore. */
  readonly cloudTargetKey?: string;
  /** Portable recommendation only; never a connection or a credential. */
  readonly cloudRecommendation?: RuntimeSetupCloudRecommendation;
  /** Source profile when the task was created from a portable AIProfile. */
  readonly profileId?: string;
  /** One explicitly reviewed use of a portable Profile; UI task association only. */
  readonly profileUseId?: string;
  readonly profileTitle?: string;
};

export type RuntimeSetupCloudRecommendation = {
  readonly implementation: {
    readonly implementationId: string;
    readonly driverId: string;
    readonly driverDialect: string;
  };
  readonly providerModelTarget: Readonly<NimiJsonObject>;
};

export type RuntimeSetupTaskStage =
  | 'create-candidate'
  | 'update-candidate'
  | 'resolve-preparation'
  | 'install'
  | 'prepare'
  | 'commit'
  | 'environment'
  | 'select'
  | 'save-route'
  | 'reuse-check'
  | 'restart-recovery'
  | 'lifecycle';

export type RuntimeSetupTaskFailure = {
  readonly stage: RuntimeSetupTaskStage;
  readonly reasonCode?: string;
  readonly message: string;
  readonly machineSelected?: boolean;
  readonly ownerSaveState?: 'not-saved' | 'unknown';
};

export type RuntimeSetupTaskRefs = {
  readonly installPlanIds: readonly string[];
  readonly transferIds: readonly string[];
  readonly environmentPlanId?: string;
  readonly dependencyJobIds: readonly string[];
  readonly aiConfigBaselineRevision?: string;
};

export type RuntimeSetupTaskStatus =
  | 'draft'
  | 'review'
  | 'preparing'
  | 'prepared'
  | 'committing'
  | 'done'
  | 'needs-attention'
  | 'failed'
  | 'stopped';

export type RuntimeSetupTaskNextAction =
  | 'choose-model'
  | 'review-preparation'
  | 'confirm-preparation'
  | 'reverify'
  | 'review-changes'
  | 'use-when-ready'
  | 'return-to-source'
  | 'inspect-failure'
  | 'none';

export type RuntimeSetupTask = {
  readonly taskId: string;
  readonly capabilityContract: string;
  readonly source: RuntimeSetupTaskSource;
  readonly candidateLoadoutId?: string;
  readonly candidateRevisionBaseline?: string;
  readonly selectionRevisionBaseline?: string;
  readonly refs: RuntimeSetupTaskRefs;
  /** In-session only; never persisted and never replayed after a restart. */
  readonly authorization?: RuntimeSetupAuthorization;
  /** Non-secret editable intent; persisted so advanced edits survive navigation. */
  readonly draft?: RuntimeSetupTaskDraft;
  readonly status: RuntimeSetupTaskStatus;
  readonly nextAction: RuntimeSetupTaskNextAction;
  readonly failure?: RuntimeSetupTaskFailure;
  /** Task that superseded this task's pending automatic use for the capability. */
  readonly supersededBy?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type RuntimeSetupTaskStoreSnapshot = {
  readonly tasks: readonly RuntimeSetupTask[];
  readonly capabilityClaims: Readonly<Record<string, string>>;
};

type PersistedRuntimeSetupTask = Omit<RuntimeSetupTask, 'authorization'>;

type PersistedRuntimeSetupTasks = {
  readonly version: 1;
  readonly tasks: readonly PersistedRuntimeSetupTask[];
  readonly capabilityClaims: Readonly<Record<string, string>>;
};

export type RuntimeSetupTaskStore = {
  getSnapshot(): RuntimeSetupTaskStoreSnapshot;
  getTask(taskId: string): RuntimeSetupTask | undefined;
  subscribe(listener: () => void): () => void;
  createTask(input: {
    readonly taskId?: string;
    readonly capabilityContract: string;
    readonly source: RuntimeSetupTaskSource;
  }): RuntimeSetupTask;
  updateTask(
    taskId: string,
    updater: (task: RuntimeSetupTask) => Partial<RuntimeSetupTask>,
  ): RuntimeSetupTask | null;
  claimCapabilityUse(taskId: string, capabilityContract: string): boolean;
  supersedeCapability(capabilityContract: string, newTaskId: string): void;
  isCapabilityUseCurrent(taskId: string, capabilityContract: string): boolean;
  /** Serializes each owner's complete read/merge/write; never persisted. */
  runOwnerRouteSave<T>(ownerKey: string, operation: () => Promise<T>): Promise<T>;
  stopTask(taskId: string): RuntimeSetupTask | null;
  dismissTask(taskId: string): boolean;
};

const TERMINAL_STATUSES: ReadonlySet<RuntimeSetupTaskStatus> = new Set([
  'done',
  'failed',
  'stopped',
]);

function isTerminalStatus(status: RuntimeSetupTaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * A setup the person never confirmed: still choosing or reviewing, with no
 * confirmed scope in this session and no install plan or component job left
 * by an earlier run, so no acquisition or environment work has run for it.
 */
export function runtimeSetupTaskUnconfirmed(task: RuntimeSetupTask): boolean {
  return (task.status === 'draft' || task.status === 'review')
    && !task.authorization
    && task.refs.installPlanIds.length === 0
    && task.refs.dependencyJobIds.length === 0;
}

function cloneRefs(refs: RuntimeSetupTaskRefs): RuntimeSetupTaskRefs {
  return {
    installPlanIds: [...refs.installPlanIds],
    transferIds: [...refs.transferIds],
    ...(refs.environmentPlanId ? { environmentPlanId: refs.environmentPlanId } : {}),
    dependencyJobIds: [...refs.dependencyJobIds],
    ...(refs.aiConfigBaselineRevision !== undefined
      ? { aiConfigBaselineRevision: refs.aiConfigBaselineRevision }
      : {}),
  };
}

function emptyRefs(): RuntimeSetupTaskRefs {
  return { installPlanIds: [], transferIds: [], dependencyJobIds: [] };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSource(raw: unknown): RuntimeSetupTaskSource | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const kind = record.kind;
  if (kind !== 'runtime' && kind !== 'app' && kind !== 'local-agent') return null;
  return {
    kind,
    ...(normalizeText(record.ownerAppId) ? { ownerAppId: normalizeText(record.ownerAppId) } : {}),
    accountId: normalizeText(record.accountId),
    ...(normalizeText(record.returnFocus) ? { returnFocus: normalizeText(record.returnFocus) } : {}),
  };
}

function normalizeTaskStatus(raw: unknown): RuntimeSetupTaskStatus {
  switch (raw) {
    case 'draft':
    case 'review':
    case 'preparing':
    case 'prepared':
    case 'committing':
    case 'done':
    case 'needs-attention':
    case 'failed':
    case 'stopped':
      return raw;
    default:
      return 'draft';
  }
}

function normalizeTaskNextAction(raw: unknown): RuntimeSetupTaskNextAction {
  switch (raw) {
    case 'choose-model':
    case 'review-preparation':
    case 'confirm-preparation':
    case 'reverify':
    case 'review-changes':
    case 'use-when-ready':
    case 'return-to-source':
    case 'inspect-failure':
      return raw;
    default:
      return 'none';
  }
}

function normalizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeText).filter(Boolean);
}

function normalizeRefs(raw: unknown): RuntimeSetupTaskRefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyRefs();
  const record = raw as Record<string, unknown>;
  return {
    installPlanIds: normalizeStringList(record.installPlanIds),
    transferIds: normalizeStringList(record.transferIds),
    ...(normalizeText(record.environmentPlanId)
      ? { environmentPlanId: normalizeText(record.environmentPlanId) }
      : {}),
    dependencyJobIds: normalizeStringList(record.dependencyJobIds),
    ...(normalizeText(record.aiConfigBaselineRevision)
      ? { aiConfigBaselineRevision: normalizeText(record.aiConfigBaselineRevision) }
      : {}),
  };
}

function normalizeFailure(raw: unknown): RuntimeSetupTaskFailure | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const message = normalizeText(record.message);
  if (!message) return undefined;
  return {
    stage: normalizeText(record.stage) as RuntimeSetupTaskStage || 'restart-recovery',
    ...(normalizeText(record.reasonCode) ? { reasonCode: normalizeText(record.reasonCode) } : {}),
    message,
    ...(record.machineSelected === true ? { machineSelected: true } : {}),
    ...(record.ownerSaveState === 'not-saved' || record.ownerSaveState === 'unknown'
      ? { ownerSaveState: record.ownerSaveState } : {}),
  };
}

function normalizeDraftOptions(raw: unknown): Readonly<NimiJsonObject> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  try {
    // Draft options are plain portable JSON; anything else is dropped.
    return JSON.parse(JSON.stringify(raw)) as NimiJsonObject;
  } catch {
    return undefined;
  }
}

function normalizeCloudRecommendation(raw: unknown): RuntimeSetupCloudRecommendation | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (!record.implementation || typeof record.implementation !== 'object') return undefined;
  const identity = record.implementation as Record<string, unknown>;
  const implementationId = normalizeText(identity.implementationId);
  const driverId = normalizeText(identity.driverId);
  const driverDialect = normalizeText(identity.driverDialect);
  const providerModelTarget = normalizeDraftOptions(record.providerModelTarget);
  if (!implementationId || !driverId || !driverDialect || !providerModelTarget) return undefined;
  return { implementation: { implementationId, driverId, driverDialect }, providerModelTarget };
}

function normalizeDraftPendingAxes(raw: unknown): RuntimeSetupTaskPendingAxis[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): RuntimeSetupTaskPendingAxis[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const axis = entry as Record<string, unknown>;
    const slotId = normalizeText(axis.slotId);
    const contentId = normalizeText(axis.contentId);
    if (!slotId || !contentId) return [];
    const rawSource = axis.source;
    let source: RuntimeSetupTaskPendingAxis['source'];
    if (rawSource && typeof rawSource === 'object' && !Array.isArray(rawSource)) {
      const sourceRecord = rawSource as Record<string, unknown>;
      const repo = normalizeText(sourceRecord.repo);
      const revision = normalizeText(sourceRecord.revision);
      const file = normalizeText(sourceRecord.file);
      const sizeBytes = typeof sourceRecord.sizeBytes === 'number' && Number.isFinite(sourceRecord.sizeBytes) && sourceRecord.sizeBytes > 0
        ? sourceRecord.sizeBytes
        : undefined;
      if (repo && revision && file) {
        source = { repo, revision, file, ...(sizeBytes !== undefined ? { sizeBytes } : {}) };
      }
    }
    return [{
      slotId,
      contentId,
      ...(normalizeText(axis.expectedHash) ? { expectedHash: normalizeText(axis.expectedHash) } : {}),
      ...(normalizeText(axis.templateId) ? { templateId: normalizeText(axis.templateId) } : {}),
      ...(source ? { source } : {}),
    }];
  });
}

function normalizeDraft(raw: unknown): RuntimeSetupTaskDraft | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const axes = Array.isArray(record.axes)
    ? record.axes.flatMap((entry): RuntimeSetupTaskDraftAxis[] => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const axis = entry as Record<string, unknown>;
      const slotId = normalizeText(axis.slotId);
      const modelAssetId = normalizeText(axis.modelAssetId);
      const expectedContentId = normalizeText(axis.expectedContentId);
      return slotId && modelAssetId && expectedContentId
        ? [{ slotId, modelAssetId, expectedContentId }]
        : [];
    })
    : [];
  const disabledOptionalSlots = normalizeStringList(record.disabledOptionalSlots);
  const pendingAxes = normalizeDraftPendingAxes(record.pendingAxes);
  const options = normalizeDraftOptions(record.options);
  const cloudRecommendation = normalizeCloudRecommendation(record.cloudRecommendation);
  const preferredOffersRaw = record.preferredOffers;
  const preferredOffers: Record<string, string> = {};
  if (preferredOffersRaw && typeof preferredOffersRaw === 'object' && !Array.isArray(preferredOffersRaw)) {
    for (const [slotId, offerRef] of Object.entries(preferredOffersRaw as Record<string, unknown>)) {
      const normalizedSlotId = normalizeText(slotId);
      const normalizedOfferRef = normalizeText(offerRef);
      if (normalizedSlotId && normalizedOfferRef) preferredOffers[normalizedSlotId] = normalizedOfferRef;
    }
  }
  const draft: RuntimeSetupTaskDraft = {
    ...(normalizeText(record.recipeId) ? { recipeId: normalizeText(record.recipeId) } : {}),
    ...(record.route === 'local' || record.route === 'cloud' ? { route: record.route } : {}),
    ...(options ? { options } : {}),
    ...(axes.length > 0 ? { axes } : {}),
    ...(pendingAxes.length > 0 ? { pendingAxes } : {}),
    ...(disabledOptionalSlots.length > 0 ? { disabledOptionalSlots } : {}),
    ...(Object.keys(preferredOffers).length > 0 ? { preferredOffers } : {}),
    ...(normalizeText(record.cloudConnectorRef) ? { cloudConnectorRef: normalizeText(record.cloudConnectorRef) } : {}),
    ...(normalizeText(record.cloudTargetLabel) ? { cloudTargetLabel: normalizeText(record.cloudTargetLabel) } : {}),
    ...(normalizeText(record.cloudTargetKey) ? { cloudTargetKey: normalizeText(record.cloudTargetKey) } : {}),
    ...(cloudRecommendation ? { cloudRecommendation } : {}),
    ...(normalizeText(record.profileId) ? { profileId: normalizeText(record.profileId) } : {}),
    ...(normalizeText(record.profileUseId) ? { profileUseId: normalizeText(record.profileUseId) } : {}),
    ...(normalizeText(record.profileTitle) ? { profileTitle: normalizeText(record.profileTitle) } : {}),
  };
  return Object.keys(draft).length > 0 ? draft : undefined;
}

function normalizePersistedTask(raw: unknown): PersistedRuntimeSetupTask | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const taskId = normalizeText(record.taskId);
  const capabilityContract = normalizeText(record.capabilityContract);
  const source = normalizeSource(record.source);
  if (!taskId || !capabilityContract || !source) return null;
  const failure = normalizeFailure(record.failure);
  const draft = normalizeDraft(record.draft);
  return {
    taskId,
    capabilityContract,
    source,
    ...(normalizeText(record.candidateLoadoutId)
      ? { candidateLoadoutId: normalizeText(record.candidateLoadoutId) }
      : {}),
    ...(normalizeText(record.candidateRevisionBaseline)
      ? { candidateRevisionBaseline: normalizeText(record.candidateRevisionBaseline) }
      : {}),
    ...(normalizeText(record.selectionRevisionBaseline)
      ? { selectionRevisionBaseline: normalizeText(record.selectionRevisionBaseline) }
      : {}),
    refs: normalizeRefs(record.refs),
    ...(draft ? { draft } : {}),
    status: normalizeTaskStatus(record.status),
    nextAction: normalizeTaskNextAction(record.nextAction),
    ...(failure ? { failure } : {}),
    ...(normalizeText(record.supersededBy) ? { supersededBy: normalizeText(record.supersededBy) } : {}),
    createdAt: normalizeText(record.createdAt) || new Date(0).toISOString(),
    updatedAt: normalizeText(record.updatedAt) || new Date(0).toISOString(),
  };
}

/**
 * Restart recovery: persisted records never carry a replayable authorization,
 * so any task that was mid-confirmation or mid-flight degrades to a state
 * that forces re-reading the real Runtime state before any further write.
 */
function restorePersistedTask(persisted: PersistedRuntimeSetupTask): RuntimeSetupTask {
  const base: RuntimeSetupTask = { ...persisted, refs: cloneRefs(persisted.refs) };
  if (persisted.status === 'preparing' || persisted.status === 'committing') {
    return {
      ...base,
      status: 'needs-attention',
      nextAction: 'reverify',
      failure: {
        stage: 'restart-recovery',
        message: 'Desktop restarted while this task was in flight. Re-verify the real state before continuing.',
      },
    };
  }
  if (persisted.status === 'review') {
    // The reviewed plan and use-confirmation do not survive a restart.
    return { ...base, status: 'draft', nextAction: 'review-preparation' };
  }
  return base;
}

export function createRuntimeSetupTaskStore(input?: {
  readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  readonly now?: () => string;
  readonly createId?: (prefix: string) => string;
}): RuntimeSetupTaskStore {
  const now = input?.now ?? (() => new Date().toISOString());
  const createId = input?.createId ?? createNimiClientId;
  const resolveStorage = () => (input && 'storage' in input ? input.storage : resolveBrowserStorage('local'));

  const tasks = new Map<string, RuntimeSetupTask>();
  let capabilityClaims: Record<string, string> = {};
  const ownerRouteSaves = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  // useSyncExternalStore requires a referentially stable snapshot between
  // publishes; rebuild the cached view only when state actually changes.
  let snapshotCache: RuntimeSetupTaskStoreSnapshot | null = null;

  const publish = () => {
    snapshotCache = null;
    for (const listener of listeners) listener();
  };

  const persist = () => {
    const storage = resolveStorage();
    if (!storage) return;
    // Recovery records keep only non-secret intent/reference fields. The
    // authorization (use confirmation) is deliberately never written out.
    const payload: PersistedRuntimeSetupTasks = {
      version: 1,
      tasks: [...tasks.values()].map((task) => {
        const { authorization: _authorization, ...record } = task;
        return { ...record, refs: cloneRefs(task.refs) };
      }),
      capabilityClaims: { ...capabilityClaims },
    };
    writeStorageJsonTo(storage, RUNTIME_SETUP_TASKS_STORAGE_KEY, payload);
  };

  const restore = () => {
    const storage = resolveStorage();
    if (!storage) return;
    const stored = readStorageJsonFrom<PersistedRuntimeSetupTasks>(storage, RUNTIME_SETUP_TASKS_STORAGE_KEY);
    if (stored.state !== 'ready' || !stored.value || typeof stored.value !== 'object') return;
    if (stored.value.version !== 1 || !Array.isArray(stored.value.tasks)) return;
    for (const rawTask of stored.value.tasks) {
      const normalized = normalizePersistedTask(rawTask);
      if (!normalized) continue;
      tasks.set(normalized.taskId, restorePersistedTask(normalized));
    }
    const rawClaims = stored.value.capabilityClaims;
    if (rawClaims && typeof rawClaims === 'object' && !Array.isArray(rawClaims)) {
      const claims: Record<string, string> = {};
      for (const [capability, taskId] of Object.entries(rawClaims)) {
        const normalizedCapability = normalizeText(capability);
        const normalizedTaskId = normalizeText(taskId);
        if (!normalizedCapability || !normalizedTaskId) continue;
        const claimed = tasks.get(normalizedTaskId);
        if (!claimed || isTerminalStatus(claimed.status) || claimed.supersededBy) continue;
        claims[normalizedCapability] = normalizedTaskId;
      }
      capabilityClaims = claims;
    }
  };

  const markSuperseded = (taskId: string, byTaskId: string) => {
    const task = tasks.get(taskId);
    if (!task || isTerminalStatus(task.status) || task.supersededBy === byTaskId) return;
    tasks.set(taskId, { ...task, supersededBy: byTaskId, updatedAt: now() });
  };

  restore();

  return {
    getSnapshot() {
      if (!snapshotCache) {
        snapshotCache = Object.freeze({
          tasks: Object.freeze([...tasks.values()]),
          capabilityClaims: Object.freeze({ ...capabilityClaims }),
        });
      }
      return snapshotCache;
    },
    getTask(taskId) {
      return tasks.get(taskId);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    createTask(createInput) {
      const timestamp = now();
      const task: RuntimeSetupTask = {
        taskId: normalizeText(createInput.taskId) || createId('runtime-setup-task'),
        capabilityContract: createInput.capabilityContract,
        source: createInput.source,
        refs: emptyRefs(),
        status: 'draft',
        nextAction: 'choose-model',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      tasks.set(task.taskId, task);
      persist();
      publish();
      return task;
    },
    updateTask(taskId, updater) {
      const current = tasks.get(taskId);
      if (!current) return null;
      const patch = updater(current);
      const merged: Record<string, unknown> = { ...current, ...patch };
      // An explicit `undefined` patch value removes the field rather than
      // persisting a JSON-incompatible undefined key.
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete merged[key];
      }
      const next = {
        ...merged,
        taskId: current.taskId,
        createdAt: current.createdAt,
        updatedAt: now(),
        refs: patch.refs ? cloneRefs(patch.refs) : cloneRefs(current.refs),
      } as RuntimeSetupTask;
      tasks.set(taskId, next);
      persist();
      publish();
      return next;
    },
    claimCapabilityUse(taskId, capabilityContract) {
      const task = tasks.get(taskId);
      if (!task || task.capabilityContract !== capabilityContract) return false;
      if (isTerminalStatus(task.status) || task.supersededBy) return false;
      const previous = capabilityClaims[capabilityContract];
      capabilityClaims = { ...capabilityClaims, [capabilityContract]: taskId };
      if (previous && previous !== taskId) markSuperseded(previous, taskId);
      persist();
      publish();
      return true;
    },
    supersedeCapability(capabilityContract, newTaskId) {
      const next = tasks.get(newTaskId);
      if (!next || next.capabilityContract !== capabilityContract) return;
      const previous = capabilityClaims[capabilityContract];
      capabilityClaims = { ...capabilityClaims, [capabilityContract]: newTaskId };
      if (previous && previous !== newTaskId) markSuperseded(previous, newTaskId);
      persist();
      publish();
    },
    isCapabilityUseCurrent(taskId, capabilityContract) {
      const task = tasks.get(taskId);
      if (!task || task.supersededBy || isTerminalStatus(task.status)) return false;
      return capabilityClaims[capabilityContract] === taskId;
    },
    runOwnerRouteSave(ownerKey, operation) {
      const previous = ownerRouteSaves.get(ownerKey) ?? Promise.resolve();
      const result = previous.then(operation);
      const settled = result.then(() => {}, () => {});
      ownerRouteSaves.set(ownerKey, settled);
      void settled.then(() => {
        if (ownerRouteSaves.get(ownerKey) === settled) ownerRouteSaves.delete(ownerKey);
      });
      return result;
    },
    stopTask(taskId) {
      const task = tasks.get(taskId);
      if (!task || isTerminalStatus(task.status)) return null;
      // Stopping blocks subsequent writes only: the saved Loadout, acquired
      // assets, and shared component jobs are deliberately left untouched.
      const next: RuntimeSetupTask = {
        ...task,
        status: 'stopped',
        nextAction: 'none',
        updatedAt: now(),
      };
      tasks.set(taskId, next);
      if (capabilityClaims[task.capabilityContract] === taskId) {
        const claims = { ...capabilityClaims };
        delete claims[task.capabilityContract];
        capabilityClaims = claims;
      }
      persist();
      publish();
      return next;
    },
    dismissTask(taskId) {
      const task = tasks.get(taskId);
      if (!task || !isTerminalStatus(task.status)) return false;
      tasks.delete(taskId);
      if (capabilityClaims[task.capabilityContract] === taskId) {
        const claims = { ...capabilityClaims };
        delete claims[task.capabilityContract];
        capabilityClaims = claims;
      }
      persist();
      publish();
      return true;
    },
  };
}

let sharedStore: RuntimeSetupTaskStore | null = null;

/** Shell-lifetime singleton; survives Runtime panel mount cycles. */
export function getRuntimeSetupTaskStore(): RuntimeSetupTaskStore {
  if (!sharedStore) {
    sharedStore = createRuntimeSetupTaskStore();
  }
  return sharedStore;
}

export function useRuntimeSetupTasks(
  store: RuntimeSetupTaskStore = getRuntimeSetupTaskStore(),
): RuntimeSetupTaskStoreSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
