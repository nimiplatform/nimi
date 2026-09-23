import type {
  NimiLoadoutRecipe,
  NimiMachineLoadout,
  NimiMachineLoadoutClient,
  NimiPrepareLoadoutInput,
  NimiRuntimeLocalEnvironmentClient,
  NimiRuntimeLocalEnvironmentDependencyJob,
  NimiRuntimeLocalEnvironmentPlan,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import {
  isNimiRuntimeLocalEnvironmentDependencyJobActiveState,
  isNimiRuntimeLocalEnvironmentDependencyJobCancelledState,
  isNimiRuntimeLocalEnvironmentDependencyReadyState,
} from '@nimiplatform/sdk/runtime';
import type {
  NimiAIConfigCloudTargetOption,
  NimiAIConfigOptionsQuery,
  NimiAIConfigOptionsResult,
  NimiAIConfigOverwriteResult,
  NimiAIConfigSnapshot,
  NimiPortableAppAIConfigIntent,
} from '@nimiplatform/sdk/ai';
import {
  createNimiCloudAIConfigCapabilityIntent,
  runtimeAIConfigStructToJson,
} from '@nimiplatform/sdk/ai';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { loadoutModelPresentation } from './runtime-config-loadout-model-display.js';
import type {
  RuntimeSetupAuthorization,
  RuntimeSetupAuthorizationMode,
  RuntimeSetupScopeItem,
  RuntimeSetupTask,
  RuntimeSetupTaskFailure,
  RuntimeSetupTaskPendingAxis,
  RuntimeSetupTaskSource,
  RuntimeSetupTaskStage,
  RuntimeSetupTaskStore,
} from './runtime-setup-task-store';
import { runtimeSetupTaskUnconfirmed } from './runtime-setup-task-store.js';

/**
 * Orchestration logic for one Runtime model setup task. All Runtime access is
 * injected through typed ports so the module stays pure and unit-testable;
 * every step returns a typed result and a resolved Promise never implies
 * success. Guards re-check the task's stop/supersede state and the account
 * snapshot before every write.
 */
// @nimi-authority: rule.nimi.desktop.ai-consumption.r026

export type RuntimeSetupRunnerAIConfigPort = {
  readonly get: () => Promise<NimiAIConfigSnapshot>;
  readonly overwrite: (input: {
    readonly expectedRevision: string;
    readonly capabilities: readonly NimiPortableAppAIConfigIntent[];
  }) => Promise<NimiAIConfigOverwriteResult>;
  /** Owner-scoped option queries: visible connectors and exact cloud targets. */
  readonly listOptions: (query: NimiAIConfigOptionsQuery) => Promise<NimiAIConfigOptionsResult>;
};

export type RuntimeSetupRunnerPorts = {
  readonly loadouts: Pick<NimiMachineLoadoutClient, 'listRecipes' | 'get' | 'prepare' | 'commit' | 'select'>;
  readonly environment: Pick<NimiRuntimeLocalEnvironmentClient, 'resolveEnvironmentPlan' | 'applyEnvironmentPlan' | 'listEnvironmentDependencyJobs'>;
  readonly install: Pick<NimiRuntimeLocalEnvironmentClient, 'resolveInstallPlan' | 'resolveOfferInstallPlan' | 'install' | 'listTransfers' | 'listModelAssets'>;
  /** null when the source has no consumer AIConfig route to save. */
  readonly aiConfigForSource: (source: RuntimeSetupTaskSource) => RuntimeSetupRunnerAIConfigPort | null;
  readonly account: { readonly currentAccountId: () => string | Promise<string> };
  readonly now: () => string;
  /** Test hook for the dependency-job polling wait; defaults to setTimeout. */
  readonly sleep?: (ms: number) => Promise<void>;
};

export type RuntimeSetupRunnerFailure = RuntimeSetupTaskFailure;

export type RuntimeSetupRunnerResult<TValue = undefined> =
  | { readonly status: 'ok'; readonly value: TValue }
  | { readonly status: 'blocked'; readonly failure: RuntimeSetupRunnerFailure }
  | {
    readonly status: 'needs-attention';
    readonly failure: RuntimeSetupRunnerFailure;
    /** Current Runtime state returned alongside a declined conditional write. */
    readonly observed?: unknown;
  }
  | { readonly status: 'failed'; readonly failure: RuntimeSetupRunnerFailure };

/**
 * Portable acquisition source for a declared content identity (AIProfile
 * download-required axis) when no installed catalog offer matches the content.
 * Runtime validates the resolved plan against the declared hashes.
 */
export type RuntimeSetupPortableSource = {
  readonly repo: string;
  readonly revision: string;
  readonly file: string;
  readonly sizeBytes?: number;
  readonly expectedHash?: string;
};

export type RuntimeSetupAcquireOption = {
  readonly offerRef: string;
  readonly title: string;
  readonly variantLabel: string;
  readonly sizeBytes: number | null;
  readonly installedModelAssetId?: string;
  readonly recommended?: boolean;
  /** Declared content identity to bind after acquisition (profile pending axis). */
  readonly expectedContentId?: string;
  /** Exact Runtime template takes precedence over the portable single-file source. */
  readonly templateId?: string;
  /** Acquisition goes through the portable-source install plan, not an offer. */
  readonly portableSource?: RuntimeSetupPortableSource;
};

export type RuntimeSetupPreparationPlan = {
  readonly reuse: readonly { readonly slotId: string; readonly label: string; readonly modelAssetId: string;
    readonly expectedContentId?: string;
  }[];
  readonly acquire: readonly { readonly slotId: string; readonly label: string; readonly offer: RuntimeSetupAcquireOption;
  }[];
  readonly awaitingChoice: readonly {
    readonly slotId: string;
    readonly label: string;
    readonly options: readonly RuntimeSetupAcquireOption[];
  }[];
  readonly unavailable: readonly { readonly slotId: string; readonly label: string; readonly reasonCode?: string;
  }[];
  readonly components: readonly {
    readonly dependencyFamily: string;
    readonly dependencyId: string;
    readonly label: string;
    readonly state: string;
    readonly required: boolean;
  }[];
  readonly options: readonly { readonly slotId: string; readonly label: string }[];
  readonly environmentPlanId: string;
  readonly environmentScope?: string;
  readonly environmentDependencies?: NimiRuntimeLocalEnvironmentPlan['dependencies'];
  readonly candidateRevision: string;
  /** Whether the machine had any selection record for the capability at review. */
  readonly selectionRevisionPresent: boolean;
  readonly selectionRevision?: string;
  readonly ownerAIConfigRevision?: string;
};

export type RuntimeSetupCandidateValue = {
  readonly candidateLoadoutId: string;
  readonly candidateRevision: string;
};

export type RuntimeSetupUseValue = {
  readonly selected: boolean;
  readonly selectionRevision: string;
  readonly ownerRouteSaved: boolean;
  readonly ownerRouteRevision?: string;
};

export type RuntimeSetupReuseValue = {
  readonly machineWrites: 0;
  readonly ownerRouteSaved: boolean;
  readonly alreadyLocalIntent: boolean;
  readonly selectedLoadoutId: string | null;
};

const RUNTIME_SETUP_CONDITION_CONFLICT = 'AI_LOADOUT_CONDITION_CONFLICT';
const RUNTIME_SETUP_ACCOUNT_CHANGED = 'RUNTIME_SETUP_ACCOUNT_CHANGED';
const RUNTIME_SETUP_TASK_INACTIVE = 'RUNTIME_SETUP_TASK_INACTIVE';
const RUNTIME_SETUP_TASK_SUPERSEDED = 'RUNTIME_SETUP_TASK_SUPERSEDED';
const RUNTIME_SETUP_PLAN_CHANGED = 'RUNTIME_SETUP_PLAN_CHANGED';
const RUNTIME_SETUP_DEPENDENCY_JOB_POLL_INTERVAL_MS = 2000;

function errorReasonCode(error: unknown): string | undefined {
  const reasonCode = extractNimiErrorFields(error).reasonCode;
  return reasonCode || undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

function isConditionConflict(error: unknown): boolean {
  return errorReasonCode(error) === RUNTIME_SETUP_CONDITION_CONFLICT;
}

function environmentComponentReady(state: string): boolean {
  return state === 'ready_managed' || state === 'ready_system';
}

function sleepFor(ports: RuntimeSetupRunnerPorts, ms: number): Promise<void> {
  if (ports.sleep) return ports.sleep(ms);
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Saves for the same account-scoped owner share one read/merge/write queue.
 */
function ownerRouteKey(source: RuntimeSetupTaskSource): string {
  return `${source.kind}:${source.ownerAppId ?? ''}:${source.accountId}`;
}

/**
 * A terminal task outcome (stopped/done/failed) is never rewritten back to an
 * in-flight status by a late bookkeeping update from an awaited write.
 */
function updateLiveTask(
  store: RuntimeSetupTaskStore,
  taskId: string,
  patch: Partial<RuntimeSetupTask>,
): void {
  store.updateTask(taskId, (current) => (
    current.status === 'done' || current.status === 'failed' || current.status === 'stopped'
      ? {}
      : patch
  ));
}

function ok<TValue>(value: TValue): RuntimeSetupRunnerResult<TValue> {
  return { status: 'ok', value };
}

function blocked(failure: RuntimeSetupRunnerFailure): RuntimeSetupRunnerResult<never> {
  return { status: 'blocked', failure };
}

function attention(
  failure: RuntimeSetupRunnerFailure,
  observed?: unknown,
): RuntimeSetupRunnerResult<never> {
  return { status: 'needs-attention', failure, ...(observed !== undefined ? { observed } : {}) };
}

function failed(failure: RuntimeSetupRunnerFailure): RuntimeSetupRunnerResult<never> {
  return { status: 'failed', failure };
}

function failTask(
  store: RuntimeSetupTaskStore,
  taskId: string,
  status: 'needs-attention' | 'failed',
  failure: RuntimeSetupRunnerFailure,
): void {
  store.updateTask(taskId, (current) => {
    // A task that already reached a terminal state (for example user-stopped)
    // keeps that honest outcome; a late error from an in-flight request must
    // not rewrite it into a failure the user never saw happen.
    if (current.status === 'done' || current.status === 'failed' || current.status === 'stopped') return {};
    // Renderer-side request cancellation happens when the page unloads or
    // reloads mid-flight; it is not a task failure. Keep the current status so
    // the restart-recovery path (reverify) handles the task on next load.
    if (failure.reasonCode === 'runtime-request-canceled') return {};
    return {
      status,
      failure,
      nextAction: status === 'needs-attention' ? 'review-changes' : 'inspect-failure',
    };
  });
}

/**
 * Pre-write admission: the task must be live, still hold the capability's
 * pending automatic use when a use-action requires it, and the account
 * snapshot must be unchanged. A failed admission performs no write.
 */
async function assertWriteAdmissible(
  store: RuntimeSetupTaskStore,
  taskId: string,
  ports: RuntimeSetupRunnerPorts,
  options: { readonly stage: RuntimeSetupTaskStage; readonly requireClaim?: boolean },
): Promise<{ readonly task: RuntimeSetupTask } | { readonly failure: RuntimeSetupRunnerFailure; readonly attention: boolean }> {
  const observed = store.getTask(taskId);
  if (!observed || observed.status === 'stopped' || observed.status === 'done' || observed.status === 'failed') {
    return {
      failure: { stage: options.stage, reasonCode: RUNTIME_SETUP_TASK_INACTIVE, message: 'This setup task is no longer active.' },
      attention: false,
    };
  }
  // Account lookup is asynchronous. Read the task afterwards so Stop or
  // replacement during that lookup cannot authorize a later write.
  const currentAccountId = await ports.account.currentAccountId();
  const task = store.getTask(taskId);
  if (!task || task.status === 'stopped' || task.status === 'done' || task.status === 'failed') {
    return {
      failure: { stage: options.stage, reasonCode: RUNTIME_SETUP_TASK_INACTIVE, message: 'This setup task is no longer active.' },
      attention: false,
    };
  }
  if (task.supersededBy && (options.requireClaim || options.stage === 'save-route')) {
    return {
      failure: { stage: options.stage, reasonCode: RUNTIME_SETUP_TASK_SUPERSEDED, message: 'A newer setup task now owns automatic use for this capability.' },
      attention: true,
    };
  }
  if (options.requireClaim && !store.isCapabilityUseCurrent(taskId, task.capabilityContract)) {
    return {
      failure: { stage: options.stage, reasonCode: RUNTIME_SETUP_TASK_SUPERSEDED, message: 'A newer setup task now owns automatic use for this capability.' },
      attention: true,
    };
  }
  if (currentAccountId !== task.source.accountId) {
    return {
      failure: { stage: options.stage, reasonCode: RUNTIME_SETUP_ACCOUNT_CHANGED, message: 'The signed-in account changed since this task was created.' },
      attention: true,
    };
  }
  return { task };
}

async function guardWrite(
  store: RuntimeSetupTaskStore,
  taskId: string,
  ports: RuntimeSetupRunnerPorts,
  options: { readonly stage: RuntimeSetupTaskStage; readonly requireClaim?: boolean },
): Promise<{ readonly task: RuntimeSetupTask } | RuntimeSetupRunnerResult<never>> {
  const admission = await assertWriteAdmissible(store, taskId, ports, options);
  if ('task' in admission) return admission;
  if (admission.attention) failTask(store, taskId, 'needs-attention', admission.failure);
  return admission.attention
    ? attention(admission.failure)
    : blocked(admission.failure);
}

type RecipeSlot = NimiLoadoutRecipe['slots'][number];
type RecipeSlotOffer = RecipeSlot['offers'][number];

/** Keep a snapshot and its CAS revision together throughout an owner save. */
async function writeRuntimeSetupOwnerConfig(
  store: RuntimeSetupTaskStore,
  ports: RuntimeSetupRunnerPorts,
  taskIds: readonly string[],
  buildIntents: (snapshot: NimiAIConfigSnapshot) => readonly NimiPortableAppAIConfigIntent[] | null,
  options: { readonly requireClaim?: boolean; readonly conflictMessage: string; readonly machineSelected?: boolean },
): Promise<RuntimeSetupRunnerResult<{ readonly saved: boolean; readonly revision: string }>> {
  const stage: RuntimeSetupTaskStage = 'save-route';
  const first = store.getTask(taskIds[0] ?? '');
  if (!first) return blocked({ stage, reasonCode: RUNTIME_SETUP_TASK_INACTIVE, message: 'This setup task is no longer active.' });
  const ownerKey = ownerRouteKey(first.source);
  return store.runOwnerRouteSave(ownerKey, async () => {
    const admitTasks = async () => {
      const tasks: RuntimeSetupTask[] = [];
      for (const taskId of taskIds) {
        const admission = await guardWrite(store, taskId, ports, { stage, requireClaim: options.requireClaim });
        if (!('task' in admission)) return admission;
        if (ownerRouteKey(admission.task.source) !== ownerKey) {
          return blocked({ stage, reasonCode: 'RUNTIME_SETUP_OWNER_MISMATCH', message: 'These setup tasks do not share one owner.' });
        }
        tasks.push(admission.task);
      }
      return { tasks };
    };
    const admission = await admitTasks();
    if (!('tasks' in admission)) return admission;
    const aiConfig = ports.aiConfigForSource(first.source);
    if (!aiConfig) {
      const failure: RuntimeSetupRunnerFailure = { stage, reasonCode: 'RUNTIME_SETUP_OWNER_REQUIRED', message: 'A route can only be saved for a specific app or the shared LocalAgent.' };
      for (const taskId of taskIds) failTask(store, taskId, 'failed', failure);
      return failed(failure);
    }
    const failAll = (status: 'needs-attention' | 'failed', failure: RuntimeSetupRunnerFailure) => {
      for (const taskId of taskIds) failTask(store, taskId, status, failure);
    };
    const conflict = (snapshot: Pick<NimiAIConfigSnapshot, 'config' | 'revision'>, reasonCode: string) => {
      const failure: RuntimeSetupRunnerFailure = {
        stage, reasonCode, message: options.conflictMessage,
        ...(options.machineSelected ? { machineSelected: true } : {}),
        ownerSaveState: 'not-saved',
      };
      failAll('needs-attention', failure);
      return attention(failure, {
        ...(options.machineSelected ? { machineSelected: true } : {}),
        ownerSaved: false, latestRevision: snapshot.revision, currentConfig: snapshot.config,
      });
    };
    let overwriteStarted = false;
    let snapshotRead = false;
    try {
      const snapshot = await aiConfig.get();
      snapshotRead = true;
      // A queued or reading task can be stopped while another save is running.
      const writeAdmission = await admitTasks();
      if (!('tasks' in writeAdmission)) return writeAdmission;
      // Checking several participants involved awaits. Inspect them together
      // once more before merging/writing so a later check cannot hide an
      // earlier participant's Stop or replacement.
      for (const [index, task] of writeAdmission.tasks.entries()) {
        const current = store.getTask(task.taskId);
        if (!current || current.status === 'stopped' || current.status === 'done' || current.status === 'failed') {
          return blocked({ stage, reasonCode: RUNTIME_SETUP_TASK_INACTIVE, message: 'This setup task is no longer active.' });
        }
        if (current.supersededBy || (options.requireClaim && !store.isCapabilityUseCurrent(current.taskId, current.capabilityContract))) {
          const failure: RuntimeSetupRunnerFailure = { stage, reasonCode: RUNTIME_SETUP_TASK_SUPERSEDED, message: 'A newer setup task now owns automatic use for this capability.' };
          failAll('needs-attention', failure);
          return attention(failure);
        }
        writeAdmission.tasks[index] = current;
      }
      const intents = buildIntents(snapshot);
      if (intents === null) {
        for (const task of writeAdmission.tasks) {
          updateLiveTask(store, task.taskId, { refs: { ...task.refs, aiConfigBaselineRevision: snapshot.revision } });
        }
        return ok({ saved: false, revision: snapshot.revision });
      }
      if (writeAdmission.tasks.some((task) => (
        task.refs.aiConfigBaselineRevision !== undefined
        && task.refs.aiConfigBaselineRevision !== snapshot.revision
      ))) {
        return conflict(snapshot, 'AI_CONFIG_REVISION_CONFLICT');
      }
      overwriteStarted = true;
      const overwrite = await aiConfig.overwrite({
        expectedRevision: snapshot.revision,
        capabilities: mergeRuntimeSetupOwnerCapabilities(snapshot, intents),
      });
      if (overwrite.outcome === 'conflict') return conflict(overwrite, overwrite.reasonCode);

      // Only tasks that observed the exact state this save replaced may follow
      // our own successful revision advance. Foreign revisions are never adopted.
      for (const task of store.getSnapshot().tasks) {
        if (ownerRouteKey(task.source) !== ownerKey || task.refs.aiConfigBaselineRevision !== snapshot.revision) continue;
        updateLiveTask(store, task.taskId, { refs: { ...task.refs, aiConfigBaselineRevision: overwrite.revision } });
      }
      for (const taskId of taskIds) {
        store.updateTask(taskId, (current) => ({ refs: { ...current.refs, aiConfigBaselineRevision: overwrite.revision } }));
      }
      return ok({ saved: true, revision: overwrite.revision });
    } catch (error) {
      const failure: RuntimeSetupRunnerFailure = {
        stage, reasonCode: errorReasonCode(error), message: errorMessage(error),
        ...(options.machineSelected ? { machineSelected: true } : {}),
        ownerSaveState: overwriteStarted || (!snapshotRead && first.failure?.ownerSaveState === 'unknown') ? 'unknown' : 'not-saved',
      };
      failAll('failed', failure);
      return failed(failure);
    }
  });
}

function acquireOptionFromOffer(offer: RecipeSlotOffer): RuntimeSetupAcquireOption {
  return {
    offerRef: offer.candidate.offerRef,
    title: offer.candidate.title || offer.candidate.offerRef,
    variantLabel: offer.candidate.variantLabel,
    sizeBytes: typeof offer.candidate.totalSizeBytes === 'number' && Number.isFinite(offer.candidate.totalSizeBytes)
      ? offer.candidate.totalSizeBytes
      : null,
    ...(offer.installedModelAssetId ? { installedModelAssetId: offer.installedModelAssetId } : {}),
  };
}

/**
 * Install-plan input for a profile-declared portable source. Mirrors the
 * AIProfile transfer acquisition: Runtime resolves and validates the exact
 * repo/revision/file content against the declared SHA-256.
 */
function portableSourceInstallPlanInput(
  capabilityContract: string,
  source: RuntimeSetupPortableSource,
): Parameters<RuntimeSetupRunnerPorts['install']['resolveInstallPlan']>[0] {
  return {
    source: 'huggingface',
    modelId: source.repo,
    repo: source.repo,
    revision: source.revision,
    capabilities: [capabilityContract],
    entry: source.file,
    files: [source.file],
    ...(source.expectedHash
      ? { hashes: { [source.file]: source.expectedHash.trim().toLowerCase().replace(/^sha256:/u, '') } }
      : {}),
  };
}

/**
 * Default slot resolution comes only from Runtime recipe facts: an installed
 * compatible offer is reused; a single installable offer is the default
 * acquisition; multiple recommendations are surfaced for the user to choose.
 * Nothing is ever taken from array order alone. A queued preferred offer (the
 * user's reviewed variant pick) outranks the current binding whenever it names
 * different content: an installed preferred variant rebinds without a
 * download, an installable one is acquired; only an exact match with the
 * current binding falls through to reuse.
 */
function planSlot(
  slot: RecipeSlot,
  candidate: NimiMachineLoadout,
  preferredOfferRef?: string,
): (
  | { readonly kind: 'reuse'; readonly slotId: string; readonly label: string; readonly modelAssetId: string }
  | { readonly kind: 'acquire'; readonly slotId: string; readonly label: string; readonly offer: RuntimeSetupAcquireOption }
  | { readonly kind: 'choice'; readonly slotId: string; readonly label: string; readonly options: readonly RuntimeSetupAcquireOption[] }
  | { readonly kind: 'unavailable'; readonly slotId: string; readonly label: string; readonly reasonCode?: string }
) {
  const bound = candidate.modelAxes.find((axis) => axis.slotId === slot.slotId && axis.modelAssetId);
  const preferred = preferredOfferRef
    ? slot.offers.find((offer) => offer.candidate.offerRef === preferredOfferRef && offer.applicability !== 'unsupported')
    : undefined;
  if (preferred?.installedModelAssetId) {
    if (bound && bound.modelAssetId === preferred.installedModelAssetId) {
      return { kind: 'reuse', slotId: slot.slotId, label: slot.displayLabel || slot.slotId, modelAssetId: bound.modelAssetId };
    }
    // Installed on this machine but not the current binding: rebind to the
    // chosen variant without downloading again.
    return { kind: 'acquire', slotId: slot.slotId, label: slot.displayLabel || slot.slotId, offer: acquireOptionFromOffer(preferred) };
  }
  if (preferred?.candidate.installable) {
    // Not installed: Runtime would have marked the offer installed when its
    // content matched the current binding, so this is always new content.
    return { kind: 'acquire', slotId: slot.slotId, label: slot.displayLabel || slot.slotId, offer: acquireOptionFromOffer(preferred) };
  }
  if (bound) {
    return { kind: 'reuse', slotId: slot.slotId, label: slot.displayLabel || slot.slotId, modelAssetId: bound.modelAssetId };
  }
  const installedOffers = slot.offers.filter(
    (offer) => offer.installedModelAssetId && offer.applicability !== 'unsupported',
  );
  if (installedOffers.length === 1) {
    return {
      kind: 'reuse',
      slotId: slot.slotId,
      label: slot.displayLabel || slot.slotId,
      modelAssetId: installedOffers[0]!.installedModelAssetId!,
    };
  }
  if (installedOffers.length > 1) {
    return {
      kind: 'choice',
      slotId: slot.slotId,
      label: slot.displayLabel || slot.slotId,
      options: installedOffers.map(acquireOptionFromOffer),
    };
  }
  const installable = slot.offers.filter(
    (offer) => !offer.installedModelAssetId && offer.applicability !== 'unsupported' && offer.candidate.installable,
  );
  if (installable.length === 1) {
    return {
      kind: 'acquire',
      slotId: slot.slotId,
      label: slot.displayLabel || slot.slotId,
      offer: acquireOptionFromOffer(installable[0]!),
    };
  }
  if (installable.length > 1) {
    return {
      kind: 'choice',
      slotId: slot.slotId,
      label: slot.displayLabel || slot.slotId,
      options: installable.map(acquireOptionFromOffer),
    };
  }
  return {
    kind: 'unavailable',
    slotId: slot.slotId,
    label: slot.displayLabel || slot.slotId,
    reasonCode: slot.reasons[0],
  };
}

type ComputedPreparation = {
  readonly plan: RuntimeSetupPreparationPlan;
  readonly candidate: NimiMachineLoadout;
  readonly environmentPlan: NimiRuntimeLocalEnvironmentPlan;
};

/**
 * A slot with a declared content identity (AIProfile pending axis) is planned
 * against exactly that identity: an installed catalog offer whose asset
 * content matches rebinds without a download; otherwise the portable source
 * installs through the Runtime-validated plan; with neither, the slot is
 * honestly unavailable. The declared contentId is what Prepare binds — a
 * content mismatch is rejected at the Runtime condition boundary.
 */
function planPendingSlot(
  slot: RecipeSlot,
  pending: RuntimeSetupTaskPendingAxis,
  candidate: NimiMachineLoadout,
  installedAssets: readonly NimiRuntimeModelAssetRecord[],
): (
  | { readonly kind: 'reuse'; readonly slotId: string; readonly label: string; readonly modelAssetId: string }
  | { readonly kind: 'acquire'; readonly slotId: string; readonly label: string; readonly offer: RuntimeSetupAcquireOption }
  | { readonly kind: 'unavailable'; readonly slotId: string; readonly label: string; readonly reasonCode?: string }
) {
  const label = slot.displayLabel || slot.slotId;
  const bound = candidate.modelAxes.find((axis) => axis.slotId === slot.slotId && axis.modelAssetId);
  if (bound && bound.expectedContentId === pending.contentId) {
    return { kind: 'reuse', slotId: slot.slotId, label, modelAssetId: bound.modelAssetId };
  }
  const installed = installedAssets.find((asset) => asset.contentId === pending.contentId);
  if (installed) {
    return {
      kind: 'acquire', slotId: slot.slotId, label,
      offer: {
        offerRef: `profile-content:${pending.contentId}`,
        title: installed.displayName, variantLabel: '', sizeBytes: installed.totalSizeBytes,
        installedModelAssetId: installed.modelAssetId, expectedContentId: pending.contentId,
      },
    };
  }
  if (pending.templateId) {
    return {
      kind: 'acquire', slotId: slot.slotId, label,
      offer: {
        offerRef: `profile-template:${pending.templateId}`,
        title: pending.source?.repo ?? pending.templateId, variantLabel: '',
        sizeBytes: pending.source?.sizeBytes ?? null,
        expectedContentId: pending.contentId, templateId: pending.templateId,
      },
    };
  }
  if (pending.source) {
    return {
      kind: 'acquire',
      slotId: slot.slotId,
      label,
      offer: {
        offerRef: `profile-source:${slot.slotId}`,
        title: pending.source.repo,
        variantLabel: '',
        sizeBytes: typeof pending.source.sizeBytes === 'number' && Number.isFinite(pending.source.sizeBytes)
          ? pending.source.sizeBytes
          : null,
        expectedContentId: pending.contentId,
        portableSource: {
          repo: pending.source.repo,
          revision: pending.source.revision,
          file: pending.source.file,
          ...(pending.source.sizeBytes !== undefined ? { sizeBytes: pending.source.sizeBytes } : {}),
          ...(pending.expectedHash ? { expectedHash: pending.expectedHash } : {}),
        },
      },
    };
  }
  return {
    kind: 'unavailable',
    slotId: slot.slotId,
    label,
    reasonCode: 'AI_PROFILE_MODEL_SOURCE_REQUIRED',
  };
}

async function computePreparation(
  task: RuntimeSetupTask,
  ports: RuntimeSetupRunnerPorts,
): Promise<ComputedPreparation> {
  if (!task.candidateLoadoutId) {
    throw new Error('Runtime setup task has no candidate Loadout yet.');
  }
  const pendingAxes = task.draft?.pendingAxes ?? [];
  const [aggregate, recipes, environmentPlan] = await Promise.all([
    ports.loadouts.get(),
    ports.loadouts.listRecipes(task.capabilityContract),
    ports.environment.resolveEnvironmentPlan({
      capabilityContract: task.capabilityContract,
      candidateLoadoutId: task.candidateLoadoutId,
    }),
  ]);
    const candidate = aggregate.loadouts.find((loadout) => loadout.loadoutId === task.candidateLoadoutId);
  if (!candidate) {
    throw new Error('Runtime setup candidate Loadout no longer exists.');
  }
  // Content matching for pending axes reads the real asset inventory; it only
  // runs when a draft actually declares pending content.
  const installedAssets = pendingAxes.length > 0 ? await ports.install.listModelAssets() : [];
  const disabledOptionalSlots = new Set(task.draft?.disabledOptionalSlots ?? []);
  const recipe = recipes.find((item) => item.recipeId === candidate.recipeId);
  const reuse: RuntimeSetupPreparationPlan['reuse'][number][] = [];
  const acquire: RuntimeSetupPreparationPlan['acquire'][number][] = [];
  const awaitingChoice: RuntimeSetupPreparationPlan['awaitingChoice'][number][] = [];
  const unavailable: RuntimeSetupPreparationPlan['unavailable'][number][] = [];
  const options: RuntimeSetupPreparationPlan['options'][number][] = [];
  for (const slot of recipe?.slots ?? []) {
    const preferredOfferRef = task.draft?.preferredOffers?.[slot.slotId];
    if (preferredOfferRef && !disabledOptionalSlots.has(slot.slotId)) {
      const planned = planSlot(slot, candidate, preferredOfferRef);
      if (planned.kind === 'reuse') reuse.push(planned);
      else if (planned.kind === 'acquire') acquire.push(planned);
      else if (planned.kind === 'choice') awaitingChoice.push(planned);
      else unavailable.push(planned);
      continue;
    }
    const pending = pendingAxes.find((axis) => axis.slotId === slot.slotId);
    if (pending && !disabledOptionalSlots.has(slot.slotId)) {
      const planned = planPendingSlot(slot, pending, candidate, installedAssets);
      if (planned.kind === 'reuse') reuse.push(planned);
      else if (planned.kind === 'acquire') acquire.push(planned);
      else unavailable.push(planned);
      continue;
    }
    if (slot.presence === 'optional-conditional') {
      const boundAxis = candidate.modelAxes.find((axis) => axis.slotId === slot.slotId && axis.modelAssetId);
      if (boundAxis) {
        reuse.push({ slotId: slot.slotId, label: slot.displayLabel || slot.slotId, modelAssetId: boundAxis.modelAssetId });
      } else {
        options.push({ slotId: slot.slotId, label: slot.displayLabel || slot.slotId });
      }
      continue;
    }
    const planned = planSlot(slot, candidate);
    if (planned.kind === 'reuse') reuse.push(planned);
    else if (planned.kind === 'acquire') acquire.push(planned);
    else if (planned.kind === 'choice') awaitingChoice.push(planned);
    else unavailable.push(planned);
  }
  // Mark the existing offer using Runtime-owned identity. Adding a separate
  // template choice would show the same model twice; names and offer order
  // are not identities and must not decide which variant is recommended.
  const recommendedSlots = awaitingChoice.filter((choice) => (
    recipe?.slots.find((slot) => slot.slotId === choice.slotId)?.recommendedVariantIds.length === 1
  ));
  if (recommendedSlots.length > 0) {
    const recommendationAssets = pendingAxes.length > 0 ? installedAssets
      : recommendedSlots.some((choice) => choice.options.some((option) => option.installedModelAssetId))
        ? await ports.install.listModelAssets() : [];
    for (const choice of recommendedSlots) {
      const slot = recipe!.slots.find((item) => item.slotId === choice.slotId)!;
      let recommended: RuntimeSetupAcquireOption | undefined;
      for (const option of choice.options) {
        if (option.installedModelAssetId) {
          const asset = recommendationAssets.find((item) => item.modelAssetId === option.installedModelAssetId);
          if (asset && slot.recommendedContentIds.includes(asset.contentId)) recommended = option;
        } else {
          const installPlan = await ports.install.resolveOfferInstallPlan(option.offerRef);
          if (installPlan.templateId === slot.recommendedVariantIds[0] && installPlan.installAvailable) recommended = option;
        }
        if (recommended) break;
      }
      if (recommended) {
        awaitingChoice[awaitingChoice.indexOf(choice)] = {
          ...choice,
          options: choice.options.map((option) => ({ ...option, recommended: option === recommended })),
        };
      }
    }
  }
  const components = environmentPlan.dependencies
    .filter((dependency) => !environmentComponentReady(dependency.state))
    .map((dependency) => ({
      dependencyFamily: dependency.dependencyFamily,
      dependencyId: dependency.dependencyId,
      label: `${dependency.dependencyFamily} / ${dependency.dependencyId}`,
      state: dependency.state,
      required: dependency.required,
    }));
  const aiConfig = ports.aiConfigForSource(task.source);
  const ownerSnapshot = aiConfig ? await aiConfig.get() : null;
  const selectionRevision = aggregate.selectionRevisions[task.capabilityContract];
  return {
    candidate,
    environmentPlan,
    plan: {
      reuse: reuse.map((item) => ({
        ...item,
        expectedContentId:
          candidate.modelAxes.find((axis) => axis.slotId === item.slotId)?.expectedContentId ||
          pendingAxes.find((axis) => axis.slotId === item.slotId)?.contentId,
      })),
      acquire,
      awaitingChoice,
      unavailable,
      components,
      options,
      environmentPlanId: environmentPlan.planId,
      environmentScope: JSON.stringify([
        environmentPlan.packId,
        environmentPlan.hostProfileId,
        environmentPlan.platformTuple,
        environmentPlan.runtimeDataRoot,
        environmentPlan.consumerScope,
      ]),
      environmentDependencies: environmentPlan.dependencies,
      candidateRevision: candidate.revision,
      selectionRevisionPresent: Boolean(selectionRevision),
      ...(selectionRevision ? { selectionRevision } : {}),
      ...(ownerSnapshot ? { ownerAIConfigRevision: ownerSnapshot.revision } : {}),
    },
  };
}

function samePlan(left: RuntimeSetupPreparationPlan, right: RuntimeSetupPreparationPlan): boolean {
  const acquisitionIdentity = (offer: RuntimeSetupAcquireOption) => JSON.stringify([
    offer.offerRef,
    offer.expectedContentId,
    offer.templateId,
    offer.portableSource,
  ]);
  // A newly missing asset adds work even when its content identity is unchanged.
  // Only downloads already reviewed from the same source may still be dispatched.
  if (right.acquire.some((item) => {
    if (item.offer.installedModelAssetId) return false;
    const reviewed = left.acquire.find((entry) => entry.slotId === item.slotId);
    return !reviewed || Boolean(reviewed.offer.installedModelAssetId)
      || acquisitionIdentity(reviewed.offer) !== acquisitionIdentity(item.offer);
  })) return false;
  const normalize = (plan: RuntimeSetupPreparationPlan) => JSON.stringify({
    reuse: plan.reuse.map((item) => [item.slotId, item.modelAssetId, item.expectedContentId]),
    acquire: plan.acquire.map((item) => [item.slotId, acquisitionIdentity(item.offer), item.offer.installedModelAssetId]),
    awaitingChoice: plan.awaitingChoice.map((item) => [item.slotId, item.options.map((option) => option.offerRef)]),
    unavailable: plan.unavailable.map((item) => item.slotId),
    components: plan.components.map((item) => [item.dependencyFamily, item.dependencyId, item.state]),
    options: plan.options.map((item) => item.slotId),
    environmentPlanId: plan.environmentPlanId,
  });
  if (normalize(left) === normalize(right)) return true;
  if (
    !left.environmentScope ||
    left.environmentScope !== right.environmentScope ||
    !left.environmentDependencies ||
    !right.environmentDependencies
  )
    return false;
  if (environmentPlanRequiredDependencyChange(left.environmentDependencies, right.environmentDependencies))
    return false;
  const optional = (plan: RuntimeSetupPreparationPlan) =>
    JSON.stringify(
      plan.environmentDependencies
        ?.filter((item) => !item.required)
        .map((item) => [item.dependencyFamily, item.dependencyId, item.state])
        .sort(),
    );
  if (optional(left) !== optional(right)) return false;
  const resources = (plan: RuntimeSetupPreparationPlan) =>
    JSON.stringify({
      targets: [
        ...plan.reuse.map((item) => [item.slotId, item.expectedContentId || `asset:${item.modelAssetId}`]),
        ...plan.acquire.map((item) => [
          item.slotId,
          item.offer.expectedContentId || `offer:${item.offer.offerRef}`,
        ]),
      ].sort((a, b) => a[0]!.localeCompare(b[0]!)),
      choices: plan.awaitingChoice,
      unavailable: plan.unavailable.map((item) => item.slotId),
      options: plan.options.map((item) => item.slotId),
    });
  // Reuse gained by another task is progress under the same scope, not a new
  // acquisition. Selection/candidate/owner CAS conditions remain unchanged.
  return resources(left) === resources(right);
}

/**
 * Choice structure comparison: the same slots must still await a choice and
 * each slot must offer the same option refs. Order-insensitive; a changed
 * option set is a changed plan even when the user's pick still exists.
 */
function sameAwaitingChoiceStructure(
  left: RuntimeSetupPreparationPlan['awaitingChoice'],
  right: RuntimeSetupPreparationPlan['awaitingChoice'],
): boolean {
  const shape = (choices: RuntimeSetupPreparationPlan['awaitingChoice']) => JSON.stringify(
    choices
      .map((choice) => [choice.slotId, [...choice.options.map((option) => option.offerRef)].sort()] as const)
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
  return shape(left) === shape(right);
}

type EnvironmentDependencyFacts = {
  readonly dependencyFamily: string;
  readonly dependencyId: string;
  readonly required: boolean;
  readonly state: string;
};

function dependencyKey(dependency: Pick<EnvironmentDependencyFacts, 'dependencyFamily' | 'dependencyId'>): string {
  return `${dependency.dependencyFamily}/${dependency.dependencyId}`;
}

/**
 * Substantive environment-plan comparison across the rebind: the required
 * (family, id) set must be identical, and every required dependency that is
 * not ready in the fresh plan must be one the reviewed plan already listed as
 * not ready. A brand-new required dependency or a ready dependency regressing
 * to not-ready is a plan change the user never reviewed.
 */
function environmentPlanRequiredDependencyChange(
  reviewedDependencies: readonly EnvironmentDependencyFacts[],
  freshDependencies: readonly EnvironmentDependencyFacts[],
): string | null {
  const reviewedRequired = new Set(
    reviewedDependencies.filter((dependency) => dependency.required).map(dependencyKey),
  );
  const freshRequired = new Set(
    freshDependencies.filter((dependency) => dependency.required).map(dependencyKey),
  );
  for (const key of freshRequired) {
    if (!reviewedRequired.has(key)) return `new required dependency: ${key}`;
  }
  for (const key of reviewedRequired) {
    if (!freshRequired.has(key)) return `required dependency no longer required: ${key}`;
  }
  const reviewedNotReady = new Set(
    reviewedDependencies
      .filter((dependency) => dependency.required && !environmentComponentReady(dependency.state))
      .map(dependencyKey),
  );
  for (const dependency of freshDependencies) {
    if (!dependency.required || environmentComponentReady(dependency.state)) continue;
    if (!reviewedNotReady.has(dependencyKey(dependency))) {
      return `dependency not ready after review: ${dependencyKey(dependency)}`;
    }
  }
  return null;
}

type WaitedDependencyJob = Pick<
  NimiRuntimeLocalEnvironmentDependencyJob,
  'jobId' | 'dependencyFamily' | 'dependencyId'
>;

/**
 * Waits for the required jobs returned by Apply to reach a terminal state.
 * Every poll round first re-checks that the task was not stopped (and, when
 * the task holds the capability's use claim, not superseded); a
 * failed/cancelled (or vanished) job fails the task honestly with the Runtime
 * reason preserved. While polling, the task stays in `preparing` and keeps
 * the job refs so a restart recovers through reverify.
 */
async function waitForEnvironmentDependencyJobs(
  store: RuntimeSetupTaskStore,
  taskId: string,
  ports: RuntimeSetupRunnerPorts,
  awaitedJobs: readonly WaitedDependencyJob[],
  options: { readonly requireClaim: boolean },
): Promise<RuntimeSetupRunnerResult<never> | null> {
  const stage: RuntimeSetupTaskStage = 'environment';
  const awaited = new Map(awaitedJobs.map((job) => [job.jobId, job]));
  if (awaited.size === 0) return null;
  for (;;) {
    // Every poll round first re-checks the task was not stopped and — when the
    // task holds the capability's use claim — not superseded.
    const admission = await guardWrite(store, taskId, ports, { stage, requireClaim: options.requireClaim });
    if (!('task' in admission)) return admission;
    let jobs: readonly NimiRuntimeLocalEnvironmentDependencyJob[];
    try {
      jobs = await ports.environment.listEnvironmentDependencyJobs();
    } catch (error) {
      const failure: RuntimeSetupRunnerFailure = { stage, reasonCode: errorReasonCode(error), message: errorMessage(error) };
      failTask(store, taskId, 'failed', failure);
      return failed(failure);
    }
    const observed = new Map(jobs.map((job) => [job.jobId, job]));
    let pending = false;
    for (const [jobId, awaitedJob] of awaited) {
      const job = observed.get(jobId);
      const label = `${awaitedJob.dependencyFamily} / ${awaitedJob.dependencyId}`;
      if (!job) {
        const failure: RuntimeSetupRunnerFailure = {
          stage,
          reasonCode: 'RUNTIME_SETUP_DEPENDENCY_JOB_MISSING',
          message: `The dependency job for ${label} is no longer visible.`,
        };
        failTask(store, taskId, 'failed', failure);
        return failed(failure);
      }
      if (isNimiRuntimeLocalEnvironmentDependencyReadyState(job.state)) continue;
      if (isNimiRuntimeLocalEnvironmentDependencyJobActiveState(job.state)) {
        pending = true;
        continue;
      }
      // Any other state (failed, cancelled, unsupported, unknown) is terminal
      // for this preparation: the job will not become ready on its own.
      const failure: RuntimeSetupRunnerFailure = {
        stage,
        reasonCode: job.reasonCode || (isNimiRuntimeLocalEnvironmentDependencyJobCancelledState(job.state)
          ? 'RUNTIME_SETUP_DEPENDENCY_JOB_CANCELLED'
          : 'RUNTIME_SETUP_DEPENDENCY_JOB_FAILED'),
        message: `The dependency job for ${label} did not become ready (state: ${job.state})${job.failureDetail ? `: ${job.failureDetail}` : ''}.`,
      };
      failTask(store, taskId, 'failed', failure);
      return failed(failure);
    }
    if (!pending) return null;
    await sleepFor(ports, RUNTIME_SETUP_DEPENDENCY_JOB_POLL_INTERVAL_MS);
  }
}

function buildAuthorization(input: {
  readonly plan: RuntimeSetupPreparationPlan;
  readonly acquire: readonly { readonly slotId: string; readonly label: string; readonly offer: RuntimeSetupAcquireOption }[];
  readonly mode: RuntimeSetupAuthorizationMode;
  readonly source: RuntimeSetupTaskSource;
  readonly ownerLabel?: string;
  readonly confirmedAt: string;
}): RuntimeSetupAuthorization {
  const items: RuntimeSetupScopeItem[] = [
    ...input.plan.reuse.map((item) => ({
      kind: 'reuse-asset' as const,
      id: item.modelAssetId,
      label: item.label,
    })),
    ...input.acquire.map((item) => ({
      kind: 'acquire-asset' as const,
      id: item.offer.offerRef,
      label: item.offer.title,
      sizeBytes: item.offer.sizeBytes,
    })),
    ...input.plan.components.map((item) => ({
      kind: 'component' as const,
      id: item.dependencyId,
      label: item.label,
      detail: item.state,
    })),
    ...input.plan.options.map((item) => ({
      kind: 'option' as const,
      id: item.slotId,
      label: item.label,
    })),
  ];
  return {
    scope: {
      items,
      usage: {
        selectOnMachine: input.mode === 'prepare-and-use',
        saveOwnerRoute: input.mode === 'prepare-and-use' && input.source.kind !== 'runtime',
        ...(input.ownerLabel ? { ownerLabel: input.ownerLabel } : {}),
      },
    },
    confirmedAt: input.confirmedAt,
    mode: input.mode,
  };
}

/**
 * Creates the unselected candidate Loadout (draft auto-save). Only fully
 * bound axes are sent; unresolved slots stay absent from model_axes.
 */
/**
 * Default candidate name: recipe title plus the chosen variant when the task
 * draft resolves one, so multiple candidates of one recipe stay
 * distinguishable in Saved configurations.
 */
function candidateDisplayName(
  recipe: NimiLoadoutRecipe,
  axes: readonly { readonly slotId: string; readonly modelAssetId: string }[],
  preferredOffers: Readonly<Record<string, string>> | undefined,
): string {
  for (const slot of recipe.slots) {
    if (slot.presence === 'optional-conditional') continue;
    const bound = axes.find((axis) => axis.slotId === slot.slotId);
    const preferredRef = preferredOffers?.[slot.slotId];
    const offer = slot.offers.find((item) => (
      (bound && item.installedModelAssetId === bound.modelAssetId)
      || (preferredRef && item.candidate.offerRef === preferredRef)
    ));
    if (!offer) continue;
    const headline = loadoutModelPresentation({
      title: offer.candidate.title,
      variantLabel: offer.candidate.variantLabel,
    }).headline.trim();
    if (headline) return `${recipe.title} · ${headline}`;
  }
  return recipe.title;
}

export async function createRuntimeSetupCandidate(
  store: RuntimeSetupTaskStore,
  taskId: string,
  ports: RuntimeSetupRunnerPorts,
  input: {
    readonly recipeId: string;
    readonly options?: NimiPrepareLoadoutInput['options'];
    readonly displayName?: string;
    readonly axes?: readonly { readonly slotId: string; readonly modelAssetId: string; readonly expectedContentId: string }[];
    /** Extra provenance facts (e.g. source_profile_id) merged over the task reference. */
    readonly provenance?: Readonly<Record<string, string>>;
  },
): Promise<RuntimeSetupRunnerResult<RuntimeSetupCandidateValue>> {
  const stage: RuntimeSetupTaskStage = 'create-candidate';
  const admission = await guardWrite(store, taskId, ports, { stage });
  if (!('task' in admission)) return admission;
  const task = admission.task;
  if (task.status !== 'draft' && task.status !== 'review') {
    return blocked({ stage, reasonCode: RUNTIME_SETUP_TASK_INACTIVE, message: `Cannot create a candidate while the task is ${task.status}.` });
  }
  const recipes = await ports.loadouts.listRecipes(task.capabilityContract);
  const recipe = recipes.find((item) => item.recipeId === input.recipeId);
  if (!recipe) {
    return failed({ stage, reasonCode: 'RUNTIME_SETUP_RECIPE_UNAVAILABLE', message: `Recipe ${input.recipeId} is not available for ${task.capabilityContract}.` });
  }
  const modelAxes = (input.axes ?? [])
    .filter((axis) => axis.slotId && axis.modelAssetId && axis.expectedContentId)
    .map((axis) => ({ slotId: axis.slotId, modelAssetId: axis.modelAssetId, expectedContentId: axis.expectedContentId }));
  try {
    const prepareAdmission = await guardWrite(store, taskId, ports, { stage });
    if (!('task' in prepareAdmission)) return prepareAdmission;
    const prepared = await ports.loadouts.prepare({
      capabilityContract: task.capabilityContract,
      recipeId: recipe.recipeId,
      options: input.options ?? recipe.defaultOptions,
      modelAxes,
      displayName: input.displayName?.trim() || candidateDisplayName(recipe, modelAxes, task.draft?.preferredOffers),
      provenance: { desktop_setup_task_id: task.taskId, ...(input.provenance ?? {}) },
    });
    // A fresh unselected draft must not carry a machine-impact confirmation;
    // if Runtime ever requires one, the typed failure surfaces instead.
    const commitAdmission = await guardWrite(store, taskId, ports, { stage });
    if (!('task' in commitAdmission)) return commitAdmission;
    const committed = await ports.loadouts.commit(prepared.prepareId, false);
    store.updateTask(taskId, () => ({
      candidateLoadoutId: committed.loadoutId,
      candidateRevisionBaseline: committed.revision,
      nextAction: 'review-preparation',
    }));
    return ok({ candidateLoadoutId: committed.loadoutId, candidateRevision: committed.revision });
  } catch (error) {
    const failure: RuntimeSetupRunnerFailure = { stage, reasonCode: errorReasonCode(error), message: errorMessage(error) };
    failTask(store, taskId, 'failed', failure);
    return failed(failure);
  }
}

/**
 * Rewrites the still-unselected candidate from the task draft (advanced
 * editing). The Prepare boundary carries the candidate revision condition so
 * edits made outside this task are never silently overwritten.
 */
export async function updateRuntimeSetupCandidate(
  store: RuntimeSetupTaskStore,
  taskId: string,
  ports: RuntimeSetupRunnerPorts,
  input: {
    readonly options?: NimiPrepareLoadoutInput['options'];
    readonly displayName?: string;
    readonly axes?: readonly { readonly slotId: string; readonly modelAssetId: string; readonly expectedContentId: string }[];
  },
): Promise<RuntimeSetupRunnerResult<RuntimeSetupCandidateValue>> {
  const stage: RuntimeSetupTaskStage = 'update-candidate';
  const admission = await guardWrite(store, taskId, ports, { stage });
  if (!('task' in admission)) return admission;
  const task = admission.task;
  if ((task.status !== 'draft' && task.status !== 'review') || !task.candidateLoadoutId) {
    return blocked({ stage, reasonCode: RUNTIME_SETUP_TASK_INACTIVE, message: 'This task has no editable candidate configuration.' });
  }
  try {
    const aggregate = await ports.loadouts.get();
    const candidate = aggregate.loadouts.find((loadout) => loadout.loadoutId === task.candidateLoadoutId);
    if (!candidate) {
      const failure: RuntimeSetupRunnerFailure = { stage, reasonCode: 'RUNTIME_SETUP_CANDIDATE_MISSING', message: 'The candidate configuration no longer exists.' };
      failTask(store, taskId, 'failed', failure);
      return failed(failure);
    }
    if (task.candidateRevisionBaseline && candidate.revision !== task.candidateRevisionBaseline) {
      const failure: RuntimeSetupRunnerFailure = {
        stage,
        reasonCode: RUNTIME_SETUP_CONDITION_CONFLICT,
        message: 'The candidate configuration was modified outside this task.',
      };
      failTask(store, taskId, 'needs-attention', failure);
      return attention(failure, { candidateRevision: candidate.revision });
    }
    const draftAxes = input.axes ?? candidate.modelAxes;
    const modelAxes = draftAxes
      .filter((axis) => axis.slotId && axis.modelAssetId && axis.expectedContentId)
      .map((axis) => ({ slotId: axis.slotId, modelAssetId: axis.modelAssetId, expectedContentId: axis.expectedContentId }));
    const prepareAdmission = await guardWrite(store, taskId, ports, { stage });
    if (!('task' in prepareAdmission)) return prepareAdmission;
    const prepared = await ports.loadouts.prepare({
      loadoutId: candidate.loadoutId,
      capabilityContract: task.capabilityContract,
      recipeId: candidate.recipeId,
      options: input.options ?? candidate.options,
      modelAxes,
      displayName: input.displayName?.trim() || candidate.displayName,
      provenance: candidate.provenance,
      ...(task.candidateRevisionBaseline ? { expectedLoadoutRevision: task.candidateRevisionBaseline } : {}),
    });
    const commitAdmission = await guardWrite(store, taskId, ports, { stage });
    if (!('task' in commitAdmission)) return commitAdmission;
    const committed = await ports.loadouts.commit(prepared.prepareId, false);
    store.updateTask(taskId, () => ({
      candidateRevisionBaseline: committed.revision,
      nextAction: 'review-preparation',
    }));
    return ok({ candidateLoadoutId: committed.loadoutId, candidateRevision: committed.revision });
  } catch (error) {
    const failure: RuntimeSetupRunnerFailure = { stage, reasonCode: errorReasonCode(error), message: errorMessage(error) };
    failTask(store, taskId, isConditionConflict(error) ? 'needs-attention' : 'failed', failure);
    return isConditionConflict(error) ? attention(failure) : failed(failure);
  }
}

/**
 * Reads the current candidate, environment plan, and owner baselines and
 * produces the preparation list for review. A candidate revision drift is
 * reported as needs-attention unless the caller is an explicit re-review that
 * accepts the externally modified candidate as the new baseline.
 */
export async function resolveRuntimeSetupPreparation(
  store: RuntimeSetupTaskStore,
  taskId: string,
  ports: RuntimeSetupRunnerPorts,
  options?: { readonly acceptExternalCandidateState?: boolean },
): Promise<RuntimeSetupRunnerResult<RuntimeSetupPreparationPlan>> {
  const stage: RuntimeSetupTaskStage = 'resolve-preparation';
  const admission = await guardWrite(store, taskId, ports, { stage });
  if (!('task' in admission)) return admission;
  const task = admission.task;
  try {
    const computed = await computePreparation(task, ports);
    const reviewAdmission = await guardWrite(store, taskId, ports, { stage });
    if (!('task' in reviewAdmission)) return reviewAdmission;
    const baseline = task.candidateRevisionBaseline;
    if (baseline && computed.candidate.revision !== baseline && options?.acceptExternalCandidateState !== true) {
      const failure: RuntimeSetupRunnerFailure = {
        stage,
        reasonCode: RUNTIME_SETUP_CONDITION_CONFLICT,
        message: 'The candidate configuration was modified outside this task.',
      };
      failTask(store, taskId, 'needs-attention', failure);
      return attention(failure, { candidateRevision: computed.candidate.revision });
    }
    store.updateTask(taskId, () => ({
      candidateRevisionBaseline: computed.candidate.revision,
      ...(computed.plan.selectionRevision ? { selectionRevisionBaseline: computed.plan.selectionRevision } : {}),
      refs: {
        ...task.refs,
        environmentPlanId: computed.environmentPlan.planId,
        ...(computed.plan.ownerAIConfigRevision
          ? { aiConfigBaselineRevision: computed.plan.ownerAIConfigRevision }
          : {}),
      },
      status: 'review',
      nextAction: 'confirm-preparation',
      failure: undefined,
    }));
    return ok(computed.plan);
  } catch (error) {
    const failure: RuntimeSetupRunnerFailure = { stage, reasonCode: errorReasonCode(error), message: errorMessage(error) };
    failTask(store, taskId, 'failed', failure);
    return failed(failure);
  }
}

/**
 * Executes the confirmed preparation list: acquire missing assets, rebind the
 * candidate under its revision condition, then apply the environment plan.
 * Mode 'prepare-and-use' continues into commitUse; 'prepare-only' stops with
 * the candidate prepared and unselected.
 */
export async function runRuntimeSetupPreparation(
  store: RuntimeSetupTaskStore,
  taskId: string,
  ports: RuntimeSetupRunnerPorts,
  input: {
    readonly mode: RuntimeSetupAuthorizationMode;
    readonly reviewedPlan: RuntimeSetupPreparationPlan;
    readonly choices?: Readonly<Record<string, string>>;
    readonly ownerLabel?: string;
  },
): Promise<RuntimeSetupRunnerResult<RuntimeSetupUseValue | { readonly prepared: true }>> {
  const stage: RuntimeSetupTaskStage = 'prepare';
  const admission = await guardWrite(store, taskId, ports, { stage, requireClaim: false });
  if (!('task' in admission)) return admission;
  let task = admission.task;
  if (task.status !== 'review') {
    return blocked({ stage, reasonCode: RUNTIME_SETUP_TASK_INACTIVE, message: `Cannot run preparation while the task is ${task.status}.` });
  }
  if (input.mode === 'prepare-and-use' && !store.claimCapabilityUse(taskId, task.capabilityContract)) {
    // A superseded task must surface its lost claim instead of silently
    // ignoring the confirm; a terminal task's view already shows its outcome.
    if (task.supersededBy) {
      const failure: RuntimeSetupRunnerFailure = {
        stage,
        reasonCode: RUNTIME_SETUP_TASK_SUPERSEDED,
        message: 'A newer setup task now owns automatic use for this capability.',
      };
      failTask(store, taskId, 'needs-attention', failure);
      return attention(failure);
    }
    return blocked({ stage, reasonCode: RUNTIME_SETUP_TASK_INACTIVE, message: 'This task can no longer claim automatic use for the capability.' });
  }
  // Recompute the plan and refuse to write when reality drifted from what the
  // user reviewed; only the reviewed scope may proceed automatically.
  let computed: ComputedPreparation;
  try {
    computed = await computePreparation(task, ports);
  } catch (error) {
    const failure: RuntimeSetupRunnerFailure = { stage: 'resolve-preparation', reasonCode: errorReasonCode(error), message: errorMessage(error) };
    failTask(store, taskId, 'failed', failure);
    return failed(failure);
  }
  if (computed.candidate.revision !== task.candidateRevisionBaseline) {
    const failure: RuntimeSetupRunnerFailure = {
      stage,
      reasonCode: RUNTIME_SETUP_CONDITION_CONFLICT,
      message: 'The candidate configuration was modified outside this task.',
    };
    failTask(store, taskId, 'needs-attention', failure);
    return attention(failure, { candidateRevision: computed.candidate.revision });
  }
  const choices = input.choices ?? {};
  // The choice structure itself is part of the reviewed plan: a changed slot
  // set or a changed option set means the user reviewed a different plan.
  if (!sameAwaitingChoiceStructure(input.reviewedPlan.awaitingChoice, computed.plan.awaitingChoice)) {
    const failure: RuntimeSetupRunnerFailure = {
      stage,
      reasonCode: RUNTIME_SETUP_PLAN_CHANGED,
      message: 'The preparation plan changed since it was reviewed. Review the updated plan before continuing.',
    };
    failTask(store, taskId, 'needs-attention', failure);
    return attention(failure);
  }
  const resolvedAcquire = [...computed.plan.acquire];
  for (const choice of computed.plan.awaitingChoice) {
    const chosenOfferRef = choices[choice.slotId];
    const chosen = choice.options.find((option) => option.offerRef === chosenOfferRef);
    if (!chosen) {
      return blocked({
        stage,
        reasonCode: 'RUNTIME_SETUP_CHOICE_REQUIRED',
        message: `Choose an option for ${choice.label} before continuing.`,
      });
    }
    resolvedAcquire.push({ slotId: choice.slotId, label: choice.label, offer: chosen });
  }
  if (computed.plan.unavailable.length > 0) {
    return blocked({
      stage,
      reasonCode: 'RUNTIME_SETUP_SLOT_UNAVAILABLE',
      message: `No installable option exists for: ${computed.plan.unavailable.map((item) => item.label).join(', ')}.`,
    });
  }
  // The reviewed plan still carries its awaitingChoice slots; apply the same
  // choices to it so the comparison is like-for-like instead of failing on
  // the resolved-versus-pending shape difference.
  const reviewedAcquire = [...input.reviewedPlan.acquire];
  for (const choice of input.reviewedPlan.awaitingChoice) {
    const chosen = choice.options.find((option) => option.offerRef === choices[choice.slotId]);
    // The structures are identical at this point, so the same choice resolves.
    if (chosen) reviewedAcquire.push({ slotId: choice.slotId, label: choice.label, offer: chosen });
  }
  const freshPlan: RuntimeSetupPreparationPlan = { ...computed.plan, acquire: resolvedAcquire, awaitingChoice: [] };
  const reviewedResolvedPlan: RuntimeSetupPreparationPlan = { ...input.reviewedPlan, acquire: reviewedAcquire, awaitingChoice: [] };
  if (!samePlan(reviewedResolvedPlan, freshPlan)) {
    const failure: RuntimeSetupRunnerFailure = {
      stage,
      reasonCode: RUNTIME_SETUP_PLAN_CHANGED,
      message: 'The preparation plan changed since it was reviewed. Review the updated plan before continuing.',
    };
    failTask(store, taskId, 'needs-attention', failure);
    return attention(failure);
  }
  const authorization = buildAuthorization({
    plan: computed.plan,
    acquire: resolvedAcquire,
    mode: input.mode,
    source: task.source,
    ...(input.ownerLabel ? { ownerLabel: input.ownerLabel } : {}),
    confirmedAt: ports.now(),
  });
  updateLiveTask(store, taskId, { authorization, status: 'preparing', failure: undefined });

  // Acquire missing assets one by one; completed downloads stay acquired even
  // when a later step fails.
  const bindings = new Map<string, { readonly modelAssetId: string; readonly expectedContentId: string }>();
  for (const item of resolvedAcquire) {
    const installAdmission = await guardWrite(store, taskId, ports, { stage: 'install' });
    if (!('task' in installAdmission)) return installAdmission;
    if (item.offer.installedModelAssetId) {
      // Installed offers bind without a download; the content identity comes
      // from the Runtime asset inventory, never from a guessed name. A
      // declared pending identity (profile axis) is bound as declared.
      try {
        const assets = await ports.install.listModelAssets();
        const asset = assets.find((entry) => entry.modelAssetId === item.offer.installedModelAssetId);
        if (!asset) throw new Error(`Installed ModelAsset ${item.offer.installedModelAssetId} is no longer present.`);
        bindings.set(item.slotId, { modelAssetId: asset.modelAssetId, expectedContentId: item.offer.expectedContentId ?? asset.contentId });
      } catch (error) {
        const failure: RuntimeSetupRunnerFailure = { stage: 'install', reasonCode: errorReasonCode(error), message: errorMessage(error) };
        failTask(store, taskId, 'failed', failure);
        return failed(failure);
      }
      continue;
    }
    try {
      const installPlan = item.offer.templateId
        ? await ports.install.resolveInstallPlan({ templateId: item.offer.templateId })
        : item.offer.portableSource
          ? await ports.install.resolveInstallPlan(portableSourceInstallPlanInput(task.capabilityContract, item.offer.portableSource))
          : await ports.install.resolveOfferInstallPlan(item.offer.offerRef);
      store.updateTask(taskId, (current) => ({
        refs: { ...current.refs, installPlanIds: [...current.refs.installPlanIds, installPlan.planId] },
      }));
      const installGuard = await guardWrite(store, taskId, ports, { stage: 'install' });
      if (!('task' in installGuard)) return installGuard;
      const installed = await ports.install.install(installPlan.planId, { caller: 'core' });
      store.updateTask(taskId, (current) => ({
        refs: {
          ...current.refs,
          transferIds: installed.installSessionId
            ? [...current.refs.transferIds, installed.installSessionId]
            : current.refs.transferIds,
        },
      }));
      bindings.set(item.slotId, {
        modelAssetId: installed.modelAsset.modelAssetId,
        // A declared pending identity binds as declared; Prepare/Commit reject
        // the binding when the acquired content does not match it.
        expectedContentId: item.offer.expectedContentId ?? installed.modelAsset.contentId,
      });
    } catch (error) {
      const failure: RuntimeSetupRunnerFailure = { stage: 'install', reasonCode: errorReasonCode(error), message: errorMessage(error) };
      failTask(store, taskId, 'failed', failure);
      return failed(failure);
    }
  }

  // Rebind the candidate under its revision condition; the Prepare boundary
  // atomically rejects edits that happened while downloads ran.
  const prepareAdmission = await guardWrite(store, taskId, ports, { stage });
  if (!('task' in prepareAdmission)) return prepareAdmission;
  task = prepareAdmission.task;
  try {
    const candidate = computed.candidate;
    const reusesToBind = computed.plan.reuse.filter(
      (item) =>
        !candidate.modelAxes.some(
          (axis) => axis.slotId === item.slotId && axis.modelAssetId === item.modelAssetId,
        ),
    );
    if (reusesToBind.length > 0) {
        const assets = await ports.install.listModelAssets();
      for (const item of reusesToBind) {
        const asset = assets.find((asset) => asset.modelAssetId === item.modelAssetId);
        if (!asset) throw new Error(`The model to reuse is no longer present: ${item.label}`);
        bindings.set(item.slotId, {
          modelAssetId: asset.modelAssetId,
          expectedContentId: item.expectedContentId || asset.contentId,
        });
      }
    }
    const modelAxes = candidate.modelAxes
      .filter((axis) => axis.modelAssetId && axis.expectedContentId)
      .map((axis) => ({ slotId: axis.slotId, modelAssetId: axis.modelAssetId, expectedContentId: axis.expectedContentId }))
      .filter((axis) => !bindings.has(axis.slotId));
    for (const [slotId, binding] of bindings) {
      modelAxes.push({ slotId, modelAssetId: binding.modelAssetId, expectedContentId: binding.expectedContentId });
    }
    const prepared = await ports.loadouts.prepare({
      loadoutId: candidate.loadoutId,
      capabilityContract: task.capabilityContract,
      recipeId: candidate.recipeId,
      options: candidate.options,
      modelAxes,
      displayName: candidate.displayName,
      provenance: candidate.provenance,
      ...(task.candidateRevisionBaseline ? { expectedLoadoutRevision: task.candidateRevisionBaseline } : {}),
    });
    // A stop or supersede that landed while Prepare was in flight must block
    // the Commit: admission is re-checked between the two writes.
    const commitAdmission = await guardWrite(store, taskId, ports, { stage });
    if (!('task' in commitAdmission)) return commitAdmission;
    const committed = await ports.loadouts.commit(prepared.prepareId, prepared.impact.confirmationRequired === true);
    // Terminal protection: a task stopped during the Commit flight keeps its
    // stopped outcome instead of being rewritten back to preparing.
    updateLiveTask(store, taskId, {
      candidateRevisionBaseline: committed.revision,
      status: 'preparing',
    });
  } catch (error) {
    const failure: RuntimeSetupRunnerFailure = { stage, reasonCode: errorReasonCode(error), message: errorMessage(error) };
    failTask(store, taskId, isConditionConflict(error) ? 'needs-attention' : 'failed', failure);
    return isConditionConflict(error) ? attention(failure) : failed(failure);
  }

  // The environment plan identity includes the candidate revision, so the
  // reviewed plan id is stale after the rebind Commit: resolve a fresh plan
  // against the committed candidate, compare its required dependency content
  // with what was reviewed, and only then apply the fresh plan id.
  const envAdmission = await guardWrite(store, taskId, ports, { stage: 'environment' });
  if (!('task' in envAdmission)) return envAdmission;
  task = envAdmission.task;
  let freshEnvironmentPlan: NimiRuntimeLocalEnvironmentPlan;
  try {
    freshEnvironmentPlan = await ports.environment.resolveEnvironmentPlan({
      capabilityContract: task.capabilityContract,
      ...(task.candidateLoadoutId ? { candidateLoadoutId: task.candidateLoadoutId } : {}),
    });
  } catch (error) {
    const failure: RuntimeSetupRunnerFailure = { stage: 'environment', reasonCode: errorReasonCode(error), message: errorMessage(error) };
    failTask(store, taskId, 'failed', failure);
    return failed(failure);
  }
  const dependencyChange = environmentPlanRequiredDependencyChange(
    computed.environmentPlan.dependencies,
    freshEnvironmentPlan.dependencies,
  );
  if (dependencyChange) {
    const failure: RuntimeSetupRunnerFailure = {
      stage: 'environment',
      reasonCode: RUNTIME_SETUP_PLAN_CHANGED,
      message: `The environment plan changed after the candidate was updated (${dependencyChange}). Review the updated plan before continuing.`,
    };
    failTask(store, taskId, 'needs-attention', failure);
    return attention(failure);
  }
  try {
    if (freshEnvironmentPlan.dependencies.some((dependency) => !environmentComponentReady(dependency.state))) {
      const applyAdmission = await guardWrite(store, taskId, ports, { stage: 'environment' });
      if (!('task' in applyAdmission)) return applyAdmission;
      const applied = await ports.environment.applyEnvironmentPlan({
        resolution: {
          capabilityContract: task.capabilityContract,
          ...(task.candidateLoadoutId ? { candidateLoadoutId: task.candidateLoadoutId } : {}),
        },
        expectedPlanId: freshEnvironmentPlan.planId,
        confirmed: true,
      }, { caller: 'core' });
      updateLiveTask(store, taskId, {
        refs: {
          ...task.refs,
          environmentPlanId: applied.plan.planId,
          dependencyJobIds: applied.jobs.map((job) => job.jobId),
        },
      });
      // Required dependency jobs must reach a terminal state before the
      // candidate counts as prepared; preparation never continues into Select
      // while a required component is still installing.
      const requiredJobIds = applied.jobs.filter((job) => (
        freshEnvironmentPlan.dependencies.some((dependency) => (
          dependency.required
          && dependency.dependencyFamily === job.dependencyFamily
          && dependency.dependencyId === job.dependencyId
        ))
      ));
      const waitOutcome = await waitForEnvironmentDependencyJobs(store, taskId, ports, requiredJobIds, {
        requireClaim: input.mode === 'prepare-and-use',
      });
      if (waitOutcome) return waitOutcome;
    }
  } catch (error) {
    const failure: RuntimeSetupRunnerFailure = { stage: 'environment', reasonCode: errorReasonCode(error), message: errorMessage(error) };
    failTask(store, taskId, isConditionConflict(error) ? 'needs-attention' : 'failed', failure);
    return isConditionConflict(error) ? attention(failure) : failed(failure);
  }

  const completionAdmission = await guardWrite(store, taskId, ports, { stage: 'environment' });
  if (!('task' in completionAdmission)) return completionAdmission;
  updateLiveTask(store, taskId, { status: 'prepared', nextAction: 'use-when-ready' });
  if (input.mode === 'prepare-only') {
    return ok({ prepared: true as const });
  }
  return commitRuntimeSetupUse(store, taskId, ports);
}

/** JSON with object keys sorted at every level, so key order never affects equality. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Identity of what a Loadout runs: recipe, implementation, bound model
 * files, options and the user-facing name. Provenance, timestamps, derived
 * feature projections and the Loadout id itself are deliberately excluded.
 */
export function loadoutCompositionKey(loadout: NimiMachineLoadout): string {
  return canonicalJson({
    capabilityContract: loadout.capabilityContract,
    recipeId: loadout.recipeId,
    recipeRevision: loadout.recipeRevision,
    implementation: loadout.implementation,
    options: loadout.options,
    displayName: loadout.displayName.trim(),
    modelAxes: [...loadout.modelAxes]
      .map((axis) => ({ slotId: axis.slotId, modelAssetId: axis.modelAssetId, expectedContentId: axis.expectedContentId }))
      .sort((left, right) => (left.slotId < right.slotId ? -1 : left.slotId > right.slotId ? 1 : 0)),
  });
}

/**
 * Final use: conditional machine selection, then — only when the source has
 * an owner route — the whole-object AIConfig save under the baseline CAS.
 * A declined condition or AIConfig conflict never triggers a blind retry.
 */
export async function commitRuntimeSetupUse(
  store: RuntimeSetupTaskStore,
  taskId: string,
  ports: RuntimeSetupRunnerPorts,
): Promise<RuntimeSetupRunnerResult<RuntimeSetupUseValue>> {
  const stage: RuntimeSetupTaskStage = 'select';
  const admission = await guardWrite(store, taskId, ports, { stage, requireClaim: true });
  if (!('task' in admission)) return admission;
  const task = admission.task;
  if (task.authorization?.mode !== 'prepare-and-use') {
    return blocked({ stage, reasonCode: RUNTIME_SETUP_TASK_INACTIVE, message: 'This task was not confirmed for use.' });
  }
  if (task.status === 'committing') {
    // A repeated use action shares the in-flight submission instead of
    // issuing a competing Select with the same conditions.
    return blocked({ stage, reasonCode: 'RUNTIME_SETUP_COMMIT_IN_FLIGHT', message: 'The selection commit is already in flight.' });
  }
  if (!task.candidateLoadoutId || !task.candidateRevisionBaseline) {
    return blocked({ stage, reasonCode: RUNTIME_SETUP_TASK_INACTIVE, message: 'This task has no prepared candidate to use.' });
  }
  store.updateTask(taskId, () => ({ status: 'committing' }));
  let selection: Awaited<ReturnType<RuntimeSetupRunnerPorts['loadouts']['select']>>;
  try {
    selection = await ports.loadouts.select(task.capabilityContract, task.candidateLoadoutId, true, {
      // A recorded selection entry drives the revision condition; when the
      // review observed no entry at all, the first-ever selection is asserted
      // explicitly instead of falling back to an unchecked write.
      ...(task.selectionRevisionBaseline
        ? { expectedSelectionRevision: task.selectionRevisionBaseline }
        : { expectNoPriorSelection: true }),
      ...(task.candidateRevisionBaseline ? { expectedCandidateRevision: task.candidateRevisionBaseline } : {}),
    });
  } catch (error) {
    const failure: RuntimeSetupRunnerFailure = { stage, reasonCode: errorReasonCode(error), message: errorMessage(error) };
    failTask(store, taskId, 'failed', failure);
    return failed(failure);
  }
  if (!selection.applied) {
    // The observed selection or candidate changed since review: keep the
    // acquired resources, show the current state, and wait for the user.
    const failure: RuntimeSetupRunnerFailure = {
      stage,
      reasonCode: selection.reasonCode || RUNTIME_SETUP_CONDITION_CONFLICT,
      message: 'The machine selection changed since this task was confirmed. Review the current state before retrying.',
    };
    failTask(store, taskId, 'needs-attention', failure);
    return attention(failure, {
      selection: selection.selection,
      selectionRevision: selection.selectionRevision,
    });
  }
  store.updateTask(taskId, () => ({ selectionRevisionBaseline: selection.selectionRevision }));

  if (task.source.kind === 'runtime') {
    updateLiveTask(store, taskId, { status: 'done', nextAction: 'return-to-source' });
    return ok({ selected: true, selectionRevision: selection.selectionRevision, ownerRouteSaved: false });
  }
  const saved = await writeRuntimeSetupOwnerConfig(store, ports, [taskId], (snapshot) => (
    snapshot.config?.capabilities.some((entry) => (
      entry.capabilityContract === task.capabilityContract && entry.route.oneofKind === 'local'
    )) ? null : [buildRuntimeSetupLocalOwnerIntent(snapshot, task.capabilityContract)]
  ), {
    requireClaim: true,
    machineSelected: true,
    conflictMessage: 'The machine selection switched, but the app route was not saved because the app configuration changed elsewhere.',
  });
  if (saved.status !== 'ok') return saved;
  updateLiveTask(store, taskId, { status: 'done', nextAction: 'return-to-source' });
  return ok({
    selected: true,
    selectionRevision: selection.selectionRevision,
    ownerRouteSaved: saved.value.saved,
    ...(saved.value.saved ? { ownerRouteRevision: saved.value.revision } : {}),
  });
}

/**
 * Short path for reusing the current machine configuration: never creates or
 * updates a Loadout, never selects, never installs. The only possible write
 * is the source owner's AIConfig route.
 */
export async function reuseRuntimeSetupCurrent(
  store: RuntimeSetupTaskStore,
  taskId: string,
  ports: RuntimeSetupRunnerPorts,
): Promise<RuntimeSetupRunnerResult<RuntimeSetupReuseValue>> {
  const stage: RuntimeSetupTaskStage = 'reuse-check';
  const admission = await guardWrite(store, taskId, ports, { stage });
  if (!('task' in admission)) return admission;
  const task = admission.task;
  try {
    const aggregate = await ports.loadouts.get();
    const freshAdmission = await guardWrite(store, taskId, ports, { stage });
    if (!('task' in freshAdmission)) return freshAdmission;
    const selectedLoadoutId = aggregate.selections.find(
      (entry) => entry.capabilityContract === task.capabilityContract,
    )?.loadoutId ?? null;
    const selected = aggregate.loadouts.find((entry) => entry.loadoutId === selectedLoadoutId);
    if (!selected || selected.validationState !== 'configured') {
      const failure: RuntimeSetupRunnerFailure = {
        stage,
        reasonCode: selected ? 'RUNTIME_SETUP_CURRENT_MODEL_NEEDS_PREPARATION' : 'AI_LOCAL_SELECTION_NOT_FOUND',
        message: selected
          ? 'The current local model needs preparation. Choose a model to continue.'
          : 'No local model is selected for this capability yet. Choose a model to continue.',
      };
      updateLiveTask(store, taskId, {
        status: 'draft', nextAction: 'choose-model', failure,
        draft: { ...task.draft, route: 'local' },
      });
      return attention(failure);
    }
    if (task.source.kind === 'runtime') {
      updateLiveTask(store, taskId, { status: 'done', nextAction: 'return-to-source' });
      return ok({ machineWrites: 0, ownerRouteSaved: false, alreadyLocalIntent: true, selectedLoadoutId });
    }
    const saved = await writeRuntimeSetupOwnerConfig(store, ports, [taskId], (snapshot) => (
      snapshot.config?.capabilities.some((entry) => (
        entry.capabilityContract === task.capabilityContract && entry.route.oneofKind === 'local'
      )) ? null : [buildRuntimeSetupLocalOwnerIntent(snapshot, task.capabilityContract)]
    ), {
      conflictMessage: 'The app configuration changed elsewhere before the route could be saved.',
      machineSelected: task.failure?.machineSelected,
    });
    if (saved.status !== 'ok') return saved;
    updateLiveTask(store, taskId, { status: 'done', nextAction: 'return-to-source', failure: undefined });
    return ok({ machineWrites: 0, ownerRouteSaved: saved.value.saved, alreadyLocalIntent: !saved.value.saved, selectedLoadoutId });
  } catch (error) {
    const failure: RuntimeSetupRunnerFailure = {
      stage, reasonCode: errorReasonCode(error), message: errorMessage(error),
      ...(task.failure?.machineSelected ? { machineSelected: true, ownerSaveState: task.failure.ownerSaveState } : {}),
    };
    failTask(store, taskId, 'failed', failure);
    return failed(failure);
  }
}

/** Explicitly retry only the owner step after a completed machine selection. */
export async function resumeRuntimeSetupOwnerRoute(
  store: RuntimeSetupTaskStore,
  taskId: string,
  ports: RuntimeSetupRunnerPorts,
): Promise<RuntimeSetupRunnerResult<RuntimeSetupReuseValue>> {
  const task = store.getTask(taskId);
  if (!task?.failure?.machineSelected || (task.status !== 'failed' && task.status !== 'needs-attention')) {
    return blocked({ stage: 'save-route', reasonCode: RUNTIME_SETUP_TASK_INACTIVE, message: 'There is no unfinished app save to continue.' });
  }
  // A new explicit request to follow the current machine. Reuse reads the
  // owner first and skips writing if the earlier request already saved Local.
  store.updateTask(taskId, (current) => ({
    status: 'draft', nextAction: 'choose-model',
    authorization: undefined,
    refs: { ...current.refs, aiConfigBaselineRevision: undefined },
  }));
  return reuseRuntimeSetupCurrent(store, taskId, ports);
}

/**
 * Stops subsequent automatic writes. Saved Loadouts, acquired assets, and
 * shared component jobs are not touched; refs stay available for queries.
 */
export function stopRuntimeSetupTask(
  store: RuntimeSetupTaskStore,
  taskId: string,
): RuntimeSetupRunnerResult<{ readonly stopped: true }> {
  const stopped = store.stopTask(taskId);
  if (!stopped) {
    return blocked({ stage: 'lifecycle', reasonCode: RUNTIME_SETUP_TASK_INACTIVE, message: 'This setup task is already finished.' });
  }
  return ok({ stopped: true });
}

/**
 * Drops a setup the person left before confirming it. Only an unconfirmed
 * task is removed; the candidate Loadout it committed and any assets stay
 * untouched, and choosing a model again starts a fresh task.
 */
export function discardRuntimeSetupTask(
  store: RuntimeSetupTaskStore,
  taskId: string,
): RuntimeSetupRunnerResult<{ readonly discarded: true }> {
  const task = store.getTask(taskId);
  if (!task || !runtimeSetupTaskUnconfirmed(task)) {
    return blocked({ stage: 'lifecycle', reasonCode: RUNTIME_SETUP_TASK_INACTIVE, message: 'Only an unconfirmed setup task can be discarded.' });
  }
  store.stopTask(taskId);
  store.dismissTask(taskId);
  return ok({ discarded: true });
}

/**
 * Returns a failed or needs-attention task to the review path. Retrying is
 * always a fresh user review: baselines are re-read and the preparation list
 * is recomputed before any further write.
 */
export function reopenRuntimeSetupTask(
  store: RuntimeSetupTaskStore,
  taskId: string,
): RuntimeSetupRunnerResult<{ readonly reopened: true }> {
  const task = store.getTask(taskId);
  if (!task || (task.status !== 'failed' && task.status !== 'needs-attention')) {
    return blocked({ stage: 'lifecycle', reasonCode: RUNTIME_SETUP_TASK_INACTIVE, message: 'Only a failed or attention-needed task can be reopened.' });
  }
  store.updateTask(taskId, () => ({ status: 'draft', nextAction: 'review-preparation', failure: undefined }));
  return ok({ reopened: true });
}

/**
 * The owner intent "follow this machine's local configuration" for one
 * capability, preserving the owner's existing required features and defaults.
 */
export function buildRuntimeSetupLocalOwnerIntent(
  snapshot: NimiAIConfigSnapshot,
  capabilityContract: string,
): NimiPortableAppAIConfigIntent {
  const current = snapshot.config?.capabilities.find(
    (entry) => entry.capabilityContract === capabilityContract,
  );
  return {
    capabilityContract,
    requiredFeatures: current ? [...current.requiredFeatures] : [],
    ...(current?.defaults ? { defaults: current.defaults } : {}),
    route: { oneofKind: 'local', local: {} },
  };
}

/**
 * Whole-object merge: every existing capability entry is preserved verbatim;
 * each supplied intent replaces the entry with the same CapabilityContract.
 */
export function mergeRuntimeSetupOwnerCapabilities(
  snapshot: NimiAIConfigSnapshot,
  intents: readonly NimiPortableAppAIConfigIntent[],
): NimiPortableAppAIConfigIntent[] {
  const replacedContracts = new Set(intents.map((intent) => intent.capabilityContract));
  return [
    ...(snapshot.config?.capabilities ?? []).filter((entry) => !replacedContracts.has(entry.capabilityContract)),
    ...intents,
  ];
}

export type RuntimeSetupCloudTargetSelection = {
  readonly connectorRef: string;
  readonly connectorLabel?: string;
  readonly targetLabel?: string;
  readonly implementation: NimiAIConfigCloudTargetOption['implementation'];
  readonly providerModelTarget: NimiAIConfigCloudTargetOption['providerModelTarget'];
};

export type RuntimeSetupCloudUseValue = {
  readonly ownerRouteSaved: true;
  readonly ownerRouteRevision: string;
  readonly connectorRef: string;
};

function buildCloudIntent(
  snapshot: NimiAIConfigSnapshot,
  capabilityContract: string,
  selection: RuntimeSetupCloudTargetSelection,
): NimiPortableAppAIConfigIntent {
  const existing = snapshot.config?.capabilities.find(
    (entry) => entry.capabilityContract === capabilityContract,
  );
  const existingDefaults = existing?.defaults ? runtimeAIConfigStructToJson(existing.defaults) : undefined;
  return createNimiCloudAIConfigCapabilityIntent({
    capabilityContract,
    connectorRef: selection.connectorRef,
    ...(existing ? { requiredFeatures: [...existing.requiredFeatures] } : {}),
    ...(existingDefaults && Object.keys(existingDefaults).length > 0 ? { defaults: existingDefaults } : {}),
    implementation: selection.implementation,
    providerModelTarget: selection.providerModelTarget,
  });
}

/**
 * Cloud branch of the setup task: saves the source owner's AIConfig cloud
 * route for the exact Driver-owned provider-model target. This performs no
 * machine write — no Loadout is created or selected and no environment plan
 * runs. A CAS conflict keeps the draft and reports the current value; there
 * is never a blind retry on a freshly read revision.
 */
export async function commitRuntimeSetupCloudUse(
  store: RuntimeSetupTaskStore,
  taskId: string,
  ports: RuntimeSetupRunnerPorts,
  input: RuntimeSetupCloudTargetSelection,
): Promise<RuntimeSetupRunnerResult<RuntimeSetupCloudUseValue>> {
  const saved = await writeRuntimeSetupOwnerConfig(store, ports, [taskId], (snapshot) => {
    const task = store.getTask(taskId)!;
    return [buildCloudIntent(snapshot, task.capabilityContract, input)];
  }, { conflictMessage: 'The app configuration changed elsewhere before the cloud route could be saved. The draft is kept; review the current value.' });
  if (saved.status !== 'ok') return saved;
  updateLiveTask(store, taskId, { status: 'done', nextAction: 'return-to-source', failure: undefined });
  return ok({ ownerRouteSaved: true, ownerRouteRevision: saved.value.revision, connectorRef: input.connectorRef });
}

export type RuntimeSetupOwnerIntentEntry = {
  readonly capabilityContract: string;
  readonly intent: NimiPortableAppAIConfigIntent;
};

export type RuntimeSetupOwnerIntentsSaveValue = {
  readonly savedRevision: string;
  readonly savedCapabilityContracts: readonly string[];
};

/** Saves the authorized capability subset in the same per-owner queue. */
export async function saveRuntimeSetupOwnerIntents(
  store: RuntimeSetupTaskStore,
  ports: RuntimeSetupRunnerPorts,
  input: {
    readonly taskIds: readonly string[];
    readonly intents: readonly RuntimeSetupOwnerIntentEntry[];
  },
): Promise<RuntimeSetupRunnerResult<RuntimeSetupOwnerIntentsSaveValue>> {
  if (input.taskIds.length === 0 || input.intents.length === 0) {
    return blocked({ stage: 'save-route', reasonCode: 'RUNTIME_SETUP_OWNER_INTENTS_EMPTY', message: 'No authorized capability change was supplied.' });
  }
  const saved = await writeRuntimeSetupOwnerConfig(
    store, ports, input.taskIds, () => input.intents.map((entry) => entry.intent),
    { conflictMessage: 'The app configuration changed elsewhere before the routes could be saved. Drafts are kept; review the current value.' },
  );
  if (saved.status !== 'ok') return saved;
  return ok({ savedRevision: saved.value.revision, savedCapabilityContracts: input.intents.map((entry) => entry.capabilityContract) });
}
