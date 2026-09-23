import assert from 'node:assert/strict';
import test from 'node:test';
import { isRuntimeProfileRunning, runRuntimeProfileTasks } from '../src/shell/renderer/features/runtime-config/runtime-profile-task-runner.js';

import type {
  NimiLoadoutRecipe,
  NimiMachineLoadout,
  NimiRuntimeLocalEnvironmentDependencyJob,
  NimiRuntimeLocalEnvironmentPlan,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import type { NimiPortableAppAIConfig } from '@nimiplatform/sdk/ai';
import { createNimiError } from '@nimiplatform/sdk/types';

import {
  createRuntimeSetupTaskStore,
  runtimeSetupTaskUnconfirmed,
  type RuntimeSetupTaskStore,
} from '../src/shell/renderer/features/runtime-config/runtime-setup-task-store.js';
import {
  commitRuntimeSetupCloudUse,
  commitRuntimeSetupUse,
  createRuntimeSetupCandidate,
  discardRuntimeSetupTask,
  resolveRuntimeSetupPreparation,
  resumeRuntimeSetupOwnerRoute,
  reuseRuntimeSetupCurrent,
  runRuntimeSetupPreparation,
  saveRuntimeSetupOwnerIntents,
  updateRuntimeSetupCandidate,
  stopRuntimeSetupTask,
  type RuntimeSetupPreparationPlan,
  type RuntimeSetupRunnerPorts,
} from '../src/shell/renderer/features/runtime-config/runtime-setup-task-runner.js';

const CAPABILITY = 'image.generate';
const ACCOUNT = 'acct-1';

test('Profile execution stays live outside its view and a second invocation cannot duplicate it', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const ports = createPorts(baseState(), calls);
  const id = await createAppTask(store);
  store.updateTask(id, () => ({ draft: { profileUseId: 'group-liveness' } }));
  const plan = await reachReview(store, id, ports);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const guarded = { ...ports, account: { currentAccountId: async () => { await gate; return ACCOUNT; } } };
  const input = { store, taskIds: [id], ports: guarded, plans: { [id]: plan }, choices: {}, mode: 'prepare-and-use' as const };
  const first = runRuntimeProfileTasks(input);
  assert.equal(isRuntimeProfileRunning('group-liveness'), true);
  await runRuntimeProfileTasks(input);
  assert.equal(isRuntimeProfileRunning('group-liveness'), true);
  release();
  await first;
  assert.equal(isRuntimeProfileRunning('group-liveness'), false);
  assert.equal(store.getTask(id)?.status, 'done');
});

test('Profile group projects missing reviews and invalid cloud selections onto the affected tasks', async () => {
    const store = makeStore();
  const local = await createAppTask(store);
  const cloud = await createAppTask(store);
  store.updateTask(cloud, () => ({ draft: { route: 'cloud', cloudTargetKey: '{invalid' } }));
  await runRuntimeProfileTasks({ store, taskIds: [local, cloud], ports: createPorts(baseState(), []), plans: {}, choices: {}, mode: 'prepare-and-use' });
  assert.equal(store.getTask(local)?.status, 'needs-attention');
  assert.equal(store.getTask(cloud)?.status, 'needs-attention');
  assert.ok(store.getTask(local)?.failure?.message);
  assert.ok(store.getTask(cloud)?.failure?.message);
});

test('Profile group stop leaves completed effects intact and never starts stopped members', async () => {
    const store = makeStore();
  const done = await createAppTask(store);
  const stopped = await createAppTask(store);
  store.updateTask(done, () => ({ status: 'done' }));
  store.stopTask(stopped);
    const calls: CallLog = [];
  await runRuntimeProfileTasks({ store, taskIds: [done, stopped], ports: createPorts(baseState(), calls), plans: {}, choices: {}, mode: 'prepare-and-use' });
  assert.equal(store.getTask(done)?.status, 'done');
  assert.equal(store.getTask(stopped)?.status, 'stopped');
  assert.equal(calls.length, 0);
});

function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
    dump: () => new Map(map),
  } as const;
}

function makeStore(storage = createMemoryStorage()) {
  let counter = 0;
  return createRuntimeSetupTaskStore({
    storage,
    now: () => '2026-09-18T00:00:00.000Z',
    createId: (prefix) => `${prefix}-test-${counter++}`,
  });
}

function recipe(overrides?: Partial<NimiLoadoutRecipe>): NimiLoadoutRecipe {
  return {
    recipeId: 'image.recipe',
    revision: '1',
    title: 'Image recipe',
    capabilityContract: CAPABILITY,
    implementation: { implementationId: 'local.image', driverId: 'driver.image', driverDialect: 'image/v1' },
    defaultOptions: { steps: 20 },
    implementationSupportedFeatures: [],
    applicability: 'supported',
    reasons: [],
    slots: [{
      slotId: 'main.diffusion',
      displayLabel: 'Main model',
      recommendedContentIds: ['sha256:model-content'],
      recommendedVariantIds: ['variant:q8'],
      offers: [{
        candidate: {
          offerRef: 'offer:main',
          sourceLabel: 'model-index',
          title: 'Image Model (Q8)',
          description: '',
          categories: ['image'],
          variantLabel: 'q8',
          tags: [],
          verified: true,
          installed: false,
          installable: true,
          totalSizeBytes: 1024,
        },
        applicability: 'supported',
        reasons: [],
      }],
      applicability: 'supported',
      reasons: [],
      modelContract: {},
      presence: 'required',
      conditionalFeatures: [],
    }],
    ...overrides,
  } as NimiLoadoutRecipe;
}

function loadout(overrides: Partial<NimiMachineLoadout> & { readonly loadoutId: string }): NimiMachineLoadout {
  return {
    capabilityContract: CAPABILITY,
    implementation: { implementationId: 'local.image', driverId: 'driver.image', driverDialect: 'image/v1' },
    recipeId: 'image.recipe',
    recipeRevision: '1',
    options: { steps: 20 },
    modelAxes: [],
    recipeCustody: [],
    implementationSupportedFeatures: [],
    configuredFeatures: [],
    textBehaviors: [],
    validationState: 'unresolved',
    reasons: [],
    displayName: 'Image recipe',
    provenance: {},
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z',
    revision: 'r1',
    ...overrides,
  } as NimiMachineLoadout;
}

function environmentPlan(overrides?: Partial<NimiRuntimeLocalEnvironmentPlan>): NimiRuntimeLocalEnvironmentPlan {
  return {
    planId: 'env-plan-1',
    packId: 'local-image',
    productLabel: 'Local image',
    hostProfileId: 'host',
    platformTuple: 'windows-x86_64-cuda',
    runtimeDataRoot: 'D:\\DataNimi',
    consumerScope: 'image.stablediffusion',
    cloudOnlyImpact: '',
    state: 'needs_confirmation',
    dependencies: [{
      dependencyFamily: 'python-runtime',
      dependencyId: 'python-3.12',
      consumerScope: 'image.stablediffusion',
      required: true,
      state: 'needs_confirmation',
      sourceKind: 'managed',
      confirmationRequired: true,
      environmentKey: 'shared-python',
    }],
    requiredDependencyFamilies: ['python-runtime'],
    aggregateSizeKnown: false,
    aggregateSizeBytes: 0,
    storageCategories: ['environments'],
    sourceOwners: ['RuntimeLocalService'],
    noSystemMutation: true,
    candidateLoadoutId: 'loadout-1',
    candidateRevision: 'r1',
    ...overrides,
  } as NimiRuntimeLocalEnvironmentPlan;
}

const INSTALLED_ASSET = {
  modelAssetId: 'asset-1',
  contentId: 'sha256:model-content',
  displayName: 'Image Model (Q8)',
} as NimiRuntimeModelAssetRecord;

type CallLog = { readonly method: string; readonly args: unknown }[];

type PortState = {
  loadouts: NimiMachineLoadout[];
  selections: { capabilityContract: string; loadoutId: string; effectiveDefaults: Record<string, never> }[];
  selectionRevisions: Record<string, string>;
  recipes: NimiLoadoutRecipe[];
  plan: NimiRuntimeLocalEnvironmentPlan;
  /** Custom environment plan resolver, e.g. plan identity tracking the candidate revision. */
  resolvePlan?: (input: { capabilityContract: string; candidateLoadoutId?: string }) => NimiRuntimeLocalEnvironmentPlan;
  /** Jobs returned by applyEnvironmentPlan. */
  appliedJobs: NimiRuntimeLocalEnvironmentDependencyJob[];
  /** Terminal states observed when listing dependency jobs. */
  envJobs: NimiRuntimeLocalEnvironmentDependencyJob[];
  /** Per-call job listings; the last entry repeats once the sequence is exhausted. */
  envJobSequence?: NimiRuntimeLocalEnvironmentDependencyJob[][];
  /** Hook invoked on every dependency-job listing (e.g. stop the task mid-poll). */
  onListJobs?: () => void;
  assets: NimiRuntimeModelAssetRecord[];
  installResult?: NimiRuntimeModelAssetRecord;
  aiConfig: {
    config: NimiPortableAppAIConfig | null;
    revision: string;
  };
  aiConfigConflict?: boolean;
  prepareError?: unknown;
  accountId: string;
};

function envJob(state: string, overrides?: Partial<NimiRuntimeLocalEnvironmentDependencyJob>): NimiRuntimeLocalEnvironmentDependencyJob {
  return {
    jobId: 'job-1',
    environmentKey: 'shared-python',
    dependencyFamily: 'python-runtime',
    dependencyId: 'python-3.12',
    consumerScope: 'image.stablediffusion',
    state,
    sourceKind: 'managed',
    retryable: false,
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z',
    bytesReceived: 0,
    bytesTotal: 0,
    percent: 0,
    speedBytesPerSec: 0,
    etaSeconds: 0,
    ...overrides,
  };
}

function createPorts(state: PortState, calls: CallLog): RuntimeSetupRunnerPorts {
  let commitCount = 0;
  let prepareCount = 0;
  const proposals = new Map<string, NimiMachineLoadout>();
  return {
    loadouts: {
      async listRecipes(capabilityContract?: string) {
        calls.push({ method: 'loadouts.listRecipes', args: capabilityContract });
        return state.recipes.filter((item) => !capabilityContract || item.capabilityContract === capabilityContract);
      },
      async get() {
        calls.push({ method: 'loadouts.get', args: null });
        return {
          loadouts: state.loadouts,
          selections: state.selections,
          selectionRevisions: state.selectionRevisions,
        };
      },
      async prepare(input) {
        calls.push({ method: 'loadouts.prepare', args: input });
        if (state.prepareError) throw state.prepareError;
        const proposed = loadout({
          loadoutId: input.loadoutId || 'loadout-1',
          recipeId: input.recipeId,
          options: input.options ?? {},
          displayName: input.displayName,
          modelAxes: (input.modelAxes ?? []).map((axis) => ({
            slotId: axis.slotId,
            displayLabel: axis.slotId,
            modelAssetId: axis.modelAssetId ?? '',
            expectedContentId: axis.expectedContentId ?? '',
            recipeCompatible: true,
            reasons: [],
            presence: 'required',
            conditionalFeatures: [],
            resolution: axis.modelAssetId ? 'configured' : 'unresolved',
          })),
          revision: state.loadouts.find((item) => item.loadoutId === (input.loadoutId || 'loadout-1'))?.revision ?? 'r1',
        });
        const prepareId = `prepare-${++prepareCount}`;
        proposals.set(prepareId, proposed);
        return {
          prepareId,
          proposedLoadout: proposed,
          expiresAt: '2026-09-18T01:00:00.000Z',
          impact: {
            capabilityContract: input.capabilityContract,
            loadoutId: proposed.loadoutId,
            changesFutureLocalExecution: false,
            confirmationRequired: false,
          },
        };
      },
      async commit(prepareId, confirmedMachineImpact) {
        calls.push({ method: 'loadouts.commit', args: { prepareId, confirmedMachineImpact } });
        const proposal = proposals.get(prepareId);
        const committed = proposal
          ? { ...proposal, revision: `r${++commitCount}` }
          : loadout({ loadoutId: 'loadout-1', revision: `r${++commitCount}` });
        const existing = state.loadouts.findIndex((item) => item.loadoutId === committed.loadoutId);
        if (existing >= 0) state.loadouts[existing] = committed;
        else state.loadouts.push(committed);
        return committed;
      },
      async select(capabilityContract, loadoutId, confirmedMachineImpact, conditions) {
        calls.push({ method: 'loadouts.select', args: { capabilityContract, loadoutId, confirmedMachineImpact, conditions } });
        if (state.selectionRevisions[`${capabilityContract}:conflict`] === 'yes') {
          return {
            selection: state.selections.find((entry) => entry.capabilityContract === capabilityContract) ?? null,
            applied: false,
            reasonCode: 'AI_LOADOUT_CONDITION_CONFLICT',
            selectionRevision: state.selectionRevisions[capabilityContract] ?? '',
          };
        }
        const next = { capabilityContract, loadoutId: loadoutId ?? '', effectiveDefaults: {} };
        state.selections = [...state.selections.filter((entry) => entry.capabilityContract !== capabilityContract), next];
        state.selectionRevisions = { ...state.selectionRevisions, [capabilityContract]: 'sel-2' };
        return { selection: next, applied: true, reasonCode: 'REASON_CODE_UNSPECIFIED', selectionRevision: 'sel-2' };
      },
    },
    environment: {
      async resolveEnvironmentPlan(input) {
        calls.push({ method: 'environment.resolveEnvironmentPlan', args: input });
        return state.resolvePlan ? state.resolvePlan(input) : state.plan;
      },
      async applyEnvironmentPlan(input) {
        calls.push({ method: 'environment.applyEnvironmentPlan', args: input });
        return {
          plan: state.resolvePlan ? state.resolvePlan(input.resolution) : state.plan,
          jobs: state.appliedJobs,
        };
      },
      async listEnvironmentDependencyJobs() {
        calls.push({ method: 'environment.listEnvironmentDependencyJobs', args: null });
        state.onListJobs?.();
        if (state.envJobSequence && state.envJobSequence.length > 1) {
          return state.envJobSequence.shift()!;
        }
        return state.envJobSequence?.[0] ?? state.envJobs;
      },
    },
    install: {
      async resolveInstallPlan(input) {
        calls.push({ method: 'install.resolveInstallPlan', args: input });
        return {
          planId: `plan:portable:${input.repo ?? 'unknown'}`,
          itemId: input.modelId ?? input.repo ?? 'unknown',
          source: input.source ?? 'huggingface',
          modelId: input.modelId ?? '',
          repo: input.repo ?? '',
          revision: input.revision ?? '',
          capabilities: input.capabilities ?? [],
          engine: 'stablediffusion',
          installKind: 'model',
          installAvailable: true,
          endpoint: '',
          entry: input.entry ?? '',
          files: input.files ?? [],
          license: 'MIT',
          hashes: input.hashes ?? {},
          warnings: [],
          totalSizeBytes: 0,
        };
      },
      async resolveOfferInstallPlan(offerRef) {
        calls.push({ method: 'install.resolveOfferInstallPlan', args: offerRef });
        return {
          planId: `plan-${offerRef}`,
          itemId: offerRef,
          source: 'verified',
          modelId: 'image-model',
          repo: 'nimi/image',
          revision: 'rev',
          capabilities: [CAPABILITY],
          engine: 'stablediffusion',
          installKind: 'model',
          installAvailable: true,
          endpoint: '',
          entry: 'model.safetensors',
          files: ['model.safetensors'],
          license: 'MIT',
          hashes: {},
          warnings: [],
          totalSizeBytes: 1024,
        };
      },
      async install(planId) {
        calls.push({ method: 'install.install', args: planId });
        return { modelAsset: state.installResult ?? INSTALLED_ASSET, installSessionId: `session-${planId}` };
      },
      async listTransfers() {
        calls.push({ method: 'install.listTransfers', args: null });
        return [];
      },
      async listModelAssets() {
        calls.push({ method: 'install.listModelAssets', args: null });
        return state.assets;
      },
    },
    aiConfigForSource(source) {
      if (source.kind !== 'app') return null;
      return {
        async get() {
          calls.push({ method: 'aiConfig.get', args: null });
          return { config: state.aiConfig.config, revision: state.aiConfig.revision, effectiveSelections: [] };
        },
        async overwrite(input) {
          calls.push({ method: 'aiConfig.overwrite', args: input });
          if (state.aiConfigConflict) {
            return { outcome: 'conflict' as const, config: null, revision: '9', reasonCode: 'AI_CONFIG_REVISION_CONFLICT' as const };
          }
          // CAS semantics: a stale expected revision conflicts with the current
          // one, exactly like the Runtime boundary.
          if (input.expectedRevision !== state.aiConfig.revision) {
            return {
              outcome: 'conflict' as const,
              config: state.aiConfig.config,
              revision: state.aiConfig.revision,
              reasonCode: 'AI_CONFIG_REVISION_CONFLICT' as const,
            };
          }
          const nextRevision = String(Number(state.aiConfig.revision) + 1);
          const nextConfig: NimiPortableAppAIConfig = { capabilities: [...input.capabilities] };
          state.aiConfig = { config: nextConfig, revision: nextRevision };
          return { outcome: 'committed' as const, config: nextConfig, revision: nextRevision };
        },
        async listOptions(query) {
          calls.push({ method: 'aiConfig.listOptions', args: query });
          if (query.kind === 'cloud-connectors') return { kind: 'cloud-connectors' as const, options: [], truncated: false };
          if (query.kind === 'cloud-targets') return { kind: 'cloud-targets' as const, options: [], truncated: false };
          if (query.kind === 'local-loadouts') return { kind: 'local-loadouts' as const, options: [], truncated: false };
          return { kind: 'preset-voices' as const, options: [], truncated: false };
        },
      };
    },
    account: { currentAccountId: () => state.accountId },
    now: () => '2026-09-18T00:00:00.000Z',
    sleep: async () => {},
  } as RuntimeSetupRunnerPorts;
}

function baseState(overrides?: Partial<PortState>): PortState {
  return {
    loadouts: [],
    selections: [],
    selectionRevisions: { [CAPABILITY]: 'sel-1' },
    recipes: [recipe()],
    plan: environmentPlan(),
    appliedJobs: [envJob('installing')],
    envJobs: [envJob('ready_managed')],
    assets: [INSTALLED_ASSET],
    aiConfig: {
      config: {
        capabilities: [{
          capabilityContract: 'text.generate',
          requiredFeatures: [],
          route: { oneofKind: 'local', local: {} },
        }],
      },
      revision: '7',
    },
    accountId: ACCOUNT,
    ...overrides,
  };
}

async function createAppTask(store: RuntimeSetupTaskStore): Promise<string> {
  return store.createTask({
    capabilityContract: CAPABILITY,
    source: { kind: 'app', ownerAppId: 'app.chat', accountId: ACCOUNT, returnFocus: 'app:app.chat' },
  }).taskId;
}

function selectConfiguredModels(state: PortState, capabilities = [CAPABILITY, 'text.embed']) {
  state.loadouts = capabilities.map((capabilityContract) => loadout({
    loadoutId: `current:${capabilityContract}`, capabilityContract, validationState: 'configured',
  }));
  state.selections = state.loadouts.map((entry) => ({
    capabilityContract: entry.capabilityContract, loadoutId: entry.loadoutId, effectiveDefaults: {},
  }));
}

async function reachReview(store: RuntimeSetupTaskStore, taskId: string, ports: RuntimeSetupRunnerPorts): Promise<RuntimeSetupPreparationPlan> {
  const created = await createRuntimeSetupCandidate(store, taskId, ports, { recipeId: 'image.recipe' });
  assert.equal(created.status, 'ok');
  const resolved = await resolveRuntimeSetupPreparation(store, taskId, ports);
  assert.equal(resolved.status, 'ok');
  return resolved.status === 'ok' ? resolved.value : assert.fail('unreachable');
}

test('first-time local setup runs the full authorized chain in order with expected conditions', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState();
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);

  const plan = await reachReview(store, taskId, ports);
  assert.equal(plan.acquire.length, 1);
  assert.equal(plan.environmentPlanId, 'env-plan-1');
  assert.equal(plan.ownerAIConfigRevision, '7');
  assert.equal(plan.selectionRevision, 'sel-1');
  assert.equal(plan.selectionRevisionPresent, true);
  assert.equal(store.getTask(taskId)?.status, 'review');

  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-and-use', reviewedPlan: plan });
  assert.equal(result.status, 'ok');

  const writeCalls = calls
    .map((entry) => entry.method)
    .filter((method) => !method.endsWith('.get') && !method.includes('listRecipes') && !method.includes('resolveEnvironmentPlan') && !method.includes('list'));
  assert.deepEqual(writeCalls, [
    // Candidate draft creation, then the confirmed preparation chain.
    'loadouts.prepare',
    'loadouts.commit',
    'install.resolveOfferInstallPlan',
    'install.install',
    'loadouts.prepare',
    'loadouts.commit',
    'environment.applyEnvironmentPlan',
    'loadouts.select',
    'aiConfig.overwrite',
  ]);

  const prepareCall = calls.find((entry) => entry.method === 'loadouts.prepare' && (entry.args as { loadoutId?: string }).loadoutId);
  assert.equal((prepareCall?.args as { expectedLoadoutRevision?: string }).expectedLoadoutRevision, 'r1');
  const selectCall = calls.find((entry) => entry.method === 'loadouts.select');
  assert.deepEqual((selectCall?.args as { conditions: unknown }).conditions, {
    expectedSelectionRevision: 'sel-1',
    expectedCandidateRevision: 'r2',
  });
  const overwriteCall = calls.find((entry) => entry.method === 'aiConfig.overwrite');
  assert.equal((overwriteCall?.args as { expectedRevision: string }).expectedRevision, '7');
  // The owner AIConfig keeps its other capability entries verbatim.
  const capabilities = (overwriteCall?.args as { capabilities: { capabilityContract: string }[] }).capabilities;
  assert.deepEqual(capabilities.map((entry) => entry.capabilityContract).sort(), [CAPABILITY, 'text.generate'].sort());

  const task = store.getTask(taskId);
  assert.equal(task?.status, 'done');
  assert.equal(task?.nextAction, 'return-to-source');
  assert.deepEqual(task?.refs.installPlanIds, ['plan-offer:main']);
  assert.deepEqual(task?.refs.transferIds, ['session-plan-offer:main']);
  assert.deepEqual(task?.refs.dependencyJobIds, ['job-1']);
  assert.equal(task?.authorization?.mode, 'prepare-and-use');
  assert.equal(task?.candidateRevisionBaseline, 'r2');
  assert.equal(task?.selectionRevisionBaseline, 'sel-2');
});

test('prepare-only never selects and never writes the owner AIConfig', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const ports = createPorts(baseState(), calls);
  const taskId = await createAppTask(store);
  const plan = await reachReview(store, taskId, ports);

  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-only', reviewedPlan: plan });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.status === 'ok' ? result.value : null, { prepared: true });

  const methods = calls.map((entry) => entry.method);
  assert.equal(methods.includes('loadouts.select'), false);
  assert.equal(methods.includes('aiConfig.overwrite'), false);
  const task = store.getTask(taskId);
  assert.equal(task?.status, 'prepared');
  assert.equal(task?.nextAction, 'use-when-ready');
});

test('use selects the confirmed candidate and preserves other saved configurations even when equivalent', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState();
  // What the prepared candidate will run once its slot is bound to the installed asset.
  const boundAxes = [{
    slotId: 'main.diffusion',
    displayLabel: 'Main model',
    modelAssetId: INSTALLED_ASSET.modelAssetId,
    expectedContentId: INSTALLED_ASSET.contentId,
    recipeCompatible: true,
    reasons: [],
    presence: 'required' as const,
    conditionalFeatures: [],
    resolution: 'configured' as const,
  }];
  const equivalent = (loadoutId: string, createdAt: string, revision: string) => loadout({
    loadoutId, createdAt, revision, validationState: 'configured', modelAxes: boundAxes,
    // Key order and provenance must not matter for equivalence.
    options: { steps: 20 }, provenance: { desktop_setup_task_id: `older:${loadoutId}` },
  });
  state.loadouts = [
    equivalent('saved-old', '2026-01-01T00:00:00.000Z', 'r-old'),
    equivalent('saved-selected', '2026-02-01T00:00:00.000Z', 'r-selected'),
    equivalent('saved-live', '2026-03-01T00:00:00.000Z', 'r-live'),
    loadout({ loadoutId: 'saved-other', validationState: 'configured', modelAxes: boundAxes, options: { steps: 30 } }),
  ];
  state.selections = [{ capabilityContract: CAPABILITY, loadoutId: 'saved-selected', effectiveDefaults: {} }];
  // Another live task still refers to saved-live as its candidate.
  const otherTaskId = await createAppTask(store);
  store.updateTask(otherTaskId, () => ({ status: 'review', candidateLoadoutId: 'saved-live', candidateRevisionBaseline: 'r-live' }));
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);
  const plan = await reachReview(store, taskId, ports);

  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-and-use', reviewedPlan: plan });
  assert.equal(result.status, 'ok');

  const selectCall = calls.find((entry) => entry.method === 'loadouts.select');
  assert.deepEqual(selectCall?.args, {
    capabilityContract: CAPABILITY,
    loadoutId: 'loadout-1',
    confirmedMachineImpact: true,
    conditions: { expectedSelectionRevision: 'sel-1', expectedCandidateRevision: state.loadouts.find((item) => item.loadoutId === 'loadout-1')!.revision },
  });
  const deleted = calls.filter((entry) => entry.method === 'loadouts.delete').map((entry) => (entry.args as { loadoutId: string }).loadoutId);
  assert.deepEqual(deleted, []);
  assert.deepEqual(state.loadouts.map((entry) => entry.loadoutId).sort(), ['loadout-1', 'saved-live', 'saved-old', 'saved-other', 'saved-selected']);
  const task = store.getTask(taskId);
  assert.equal(task?.status, 'done');
  assert.equal(task?.candidateLoadoutId, 'loadout-1');
  assert.equal(task?.candidateRevisionBaseline, state.loadouts.find((item) => item.loadoutId === 'loadout-1')!.revision);
});

test('use keeps a candidate that has no saved equivalent', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState();
  state.loadouts = [loadout({ loadoutId: 'saved-other', validationState: 'configured', options: { steps: 30 } })];
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);
  const plan = await reachReview(store, taskId, ports);

  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-and-use', reviewedPlan: plan });
  assert.equal(result.status, 'ok');
  const selectCall = calls.find((entry) => entry.method === 'loadouts.select');
  assert.equal((selectCall?.args as { loadoutId: string }).loadoutId, 'loadout-1');
  assert.equal(calls.some((entry) => entry.method === 'loadouts.delete'), false);
  assert.deepEqual(state.loadouts.map((entry) => entry.loadoutId).sort(), ['loadout-1', 'saved-other']);
});

test('an external candidate edit during download stops at Prepare and keeps acquired resources', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState();
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);
  const created = await createRuntimeSetupCandidate(store, taskId, ports, { recipeId: 'image.recipe' });
  assert.equal(created.status, 'ok');
  const resolved = await resolveRuntimeSetupPreparation(store, taskId, ports);
  assert.equal(resolved.status, 'ok');
  // The external edit lands while downloads run; the next Prepare rejects it
  // at the Runtime condition boundary.
  state.prepareError = createNimiError({
    message: 'Loadout revision conflict',
    reasonCode: 'AI_LOADOUT_CONDITION_CONFLICT',
    source: 'runtime',
  });

  const plan = resolved.status === 'ok' ? resolved.value : assert.fail('unreachable');
  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-and-use', reviewedPlan: plan });
  assert.equal(result.status, 'needs-attention');

  const task = store.getTask(taskId);
  assert.equal(task?.status, 'needs-attention');
  assert.equal(task?.failure?.stage, 'prepare');
  assert.equal(task?.failure?.reasonCode, 'AI_LOADOUT_CONDITION_CONFLICT');
  // Acquired resources stay referenced for reconciliation.
  assert.deepEqual(task?.refs.installPlanIds, ['plan-offer:main']);
  assert.deepEqual(task?.refs.transferIds, ['session-plan-offer:main']);
  // No selection or owner write happened after the conflict.
  const methods = calls.map((entry) => entry.method);
  assert.equal(methods.includes('loadouts.select'), false);
  assert.equal(methods.includes('aiConfig.overwrite'), false);
});

test('a declined Select shows the current state and never retries blindly', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState();
  state.selectionRevisions[`${CAPABILITY}:conflict`] = 'yes';
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);
  const plan = await reachReview(store, taskId, ports);

  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-and-use', reviewedPlan: plan });
  assert.equal(result.status, 'needs-attention');
  if (result.status === 'needs-attention') {
    assert.equal(result.failure.stage, 'select');
    assert.deepEqual(result.observed, {
      selection: null,
      selectionRevision: 'sel-1',
    });
  }
  const selectCalls = calls.filter((entry) => entry.method === 'loadouts.select');
  assert.equal(selectCalls.length, 1);
  const task = store.getTask(taskId);
  assert.equal(task?.status, 'needs-attention');
  assert.equal(calls.filter((entry) => entry.method === 'aiConfig.overwrite').length, 0);
});

test('an AIConfig conflict reports machine-switched/app-not-saved without reversal', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState({ aiConfigConflict: true });
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);
  const plan = await reachReview(store, taskId, ports);

  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-and-use', reviewedPlan: plan });
  assert.equal(result.status, 'needs-attention');
  if (result.status === 'needs-attention') {
    assert.equal(result.failure.stage, 'save-route');
    assert.equal(result.failure.reasonCode, 'AI_CONFIG_REVISION_CONFLICT');
    assert.deepEqual(result.observed, { machineSelected: true, ownerSaved: false, latestRevision: '9', currentConfig: null });
  }
  const task = store.getTask(taskId);
  assert.equal(task?.status, 'needs-attention');
  // The machine selection was applied and is not reversed.
  assert.deepEqual(state.selections.map((entry) => entry.loadoutId), ['loadout-1']);
});

test('a superseded task cannot perform use writes for the capability', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const ports = createPorts(baseState(), calls);
  const taskA = await createAppTask(store);
  const taskB = await createAppTask(store);

  assert.equal(store.claimCapabilityUse(taskA, CAPABILITY), true);
  assert.equal(store.claimCapabilityUse(taskB, CAPABILITY), true);
  assert.equal(store.getTask(taskA)?.supersededBy, taskB);

  const prepared = store.updateTask(taskA, () => ({
    status: 'prepared',
    candidateLoadoutId: 'loadout-1',
    candidateRevisionBaseline: 'r2',
    selectionRevisionBaseline: 'sel-1',
    authorization: {
      scope: { items: [], usage: { selectOnMachine: true, saveOwnerRoute: true } },
      confirmedAt: '2026-09-18T00:00:00.000Z',
      mode: 'prepare-and-use',
    },
  }));
  assert.equal(prepared?.status, 'prepared');

  const result = await commitRuntimeSetupUse(store, taskA, ports);
  assert.equal(result.status, 'needs-attention');
  if (result.status === 'needs-attention') {
    assert.equal(result.failure.reasonCode, 'RUNTIME_SETUP_TASK_SUPERSEDED');
  }
  assert.equal(calls.filter((entry) => entry.method === 'loadouts.select').length, 0);
  // The superseded task surfaces its lost claim instead of silently waiting.
  assert.equal(store.getTask(taskA)?.status, 'needs-attention');
  assert.equal(store.getTask(taskA)?.failure?.reasonCode, 'RUNTIME_SETUP_TASK_SUPERSEDED');
});

test('a stopped task performs no further writes', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const ports = createPorts(baseState(), calls);
  const taskId = await createAppTask(store);
  const plan = await reachReview(store, taskId, ports);

  const stopped = stopRuntimeSetupTask(store, taskId);
  assert.equal(stopped.status, 'ok');
  assert.equal(store.getTask(taskId)?.status, 'stopped');

  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-and-use', reviewedPlan: plan });
  assert.equal(result.status, 'blocked');
  const writeCalls = calls.filter((entry) => entry.method.startsWith('install.install') || entry.method === 'loadouts.select');
  assert.equal(writeCalls.length, 0);
});

test('leaving an unconfirmed setup discards only its task record; a confirmed setup is kept', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const ports = createPorts(baseState(), calls);
  const reviewed = await createAppTask(store);
  await reachReview(store, reviewed, ports);
  assert.equal(runtimeSetupTaskUnconfirmed(store.getTask(reviewed)!), true);
  assert.equal(discardRuntimeSetupTask(store, reviewed).status, 'ok');
  assert.equal(store.getTask(reviewed), undefined);
  // The candidate Loadout committed on "select" is not deleted with the task.
  assert.equal(calls.filter((entry) => entry.method === 'loadouts.delete').length, 0);

  const confirmed = await createAppTask(store);
  const plan = await reachReview(store, confirmed, ports);
  await runRuntimeSetupPreparation(store, confirmed, ports, { mode: 'prepare-only', reviewedPlan: plan });
  assert.equal(runtimeSetupTaskUnconfirmed(store.getTask(confirmed)!), false);
  assert.equal(discardRuntimeSetupTask(store, confirmed).status, 'blocked');
  assert.notEqual(store.getTask(confirmed), undefined);
});

test('reuseCurrent with an existing Local intent performs zero writes', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState({
    loadouts: [loadout({ loadoutId: 'loadout-current', validationState: 'configured' })],
    selections: [{ capabilityContract: CAPABILITY, loadoutId: 'loadout-current', effectiveDefaults: {} }],
    aiConfig: {
      config: {
        capabilities: [{ capabilityContract: CAPABILITY, requiredFeatures: [], route: { oneofKind: 'local', local: {} } }],
      },
      revision: '7',
    },
  });
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);

  const result = await reuseRuntimeSetupCurrent(store, taskId, ports);
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') {
    assert.deepEqual(result.value, {
      machineWrites: 0,
      ownerRouteSaved: false,
      alreadyLocalIntent: true,
      selectedLoadoutId: 'loadout-current',
    });
  }
  const writes = calls.filter((entry) => !entry.method.endsWith('.get') && !entry.method.includes('list'));
  assert.deepEqual(writes, []);
  assert.equal(store.getTask(taskId)?.status, 'done');
});

test('reuseCurrent only overwrites the owner AIConfig when the route must change', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState({
    loadouts: [loadout({ loadoutId: 'loadout-current', validationState: 'configured' })],
    selections: [{ capabilityContract: CAPABILITY, loadoutId: 'loadout-current', effectiveDefaults: {} }],
    aiConfig: {
      config: {
        capabilities: [
          { capabilityContract: CAPABILITY, requiredFeatures: [], route: { oneofKind: 'cloud', cloud: { connectorRef: 'conn-1' } } },
          { capabilityContract: 'text.generate', requiredFeatures: [], route: { oneofKind: 'local', local: {} } },
        ],
      },
      revision: '7',
    },
  });
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);

  const result = await reuseRuntimeSetupCurrent(store, taskId, ports);
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') {
    assert.equal(result.value.machineWrites, 0);
    assert.equal(result.value.ownerRouteSaved, true);
  }
  const overwriteCalls = calls.filter((entry) => entry.method === 'aiConfig.overwrite');
  assert.equal(overwriteCalls.length, 1);
  const input = overwriteCalls[0]?.args as { expectedRevision: string; capabilities: { capabilityContract: string; route: { oneofKind: string } }[] };
  assert.equal(input.expectedRevision, '7');
  assert.equal(input.capabilities.find((entry) => entry.capabilityContract === CAPABILITY)?.route.oneofKind, 'local');
  assert.ok(input.capabilities.some((entry) => entry.capabilityContract === 'text.generate'));
  // No machine writes on the reuse path.
  assert.equal(calls.filter((entry) => entry.method.startsWith('loadouts.prepare') || entry.method === 'loadouts.commit' || entry.method === 'loadouts.select' || entry.method.startsWith('install.')).length, 0);
});

test('an account change blocks task writes before any Runtime mutation', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState({ accountId: 'acct-2' });
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);

  const created = await createRuntimeSetupCandidate(store, taskId, ports, { recipeId: 'image.recipe' });
  assert.equal(created.status, 'needs-attention');
  if (created.status === 'needs-attention') {
    assert.equal(created.failure.reasonCode, 'RUNTIME_SETUP_ACCOUNT_CHANGED');
  }
  assert.equal(store.getTask(taskId)?.status, 'needs-attention');
  assert.deepEqual(calls, []);
});

const CLOUD_TARGET = {
  implementation: { implementationId: 'cloud.text', driverId: 'driver.openai', driverDialect: 'openai/v1' },
  providerModelTarget: {
    provider: 'openai',
    providerModelId: 'gpt-5',
    remoteModelCatalogId: 'catalog:gpt-5',
  },
} as const;

function machineWriteCalls(calls: CallLog): CallLog {
  return calls.filter((entry) => (
    entry.method.startsWith('loadouts.')
    || entry.method.startsWith('install.')
    || entry.method.startsWith('environment.')
  ) && entry.method !== 'loadouts.get' && entry.method !== 'loadouts.listRecipes' && !entry.method.startsWith('install.list'));
}

test('cloud route save writes only the owner AIConfig and preserves other capabilities', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState();
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);

  const result = await commitRuntimeSetupCloudUse(store, taskId, ports, {
    connectorRef: 'conn-1',
    ...CLOUD_TARGET,
  });
  assert.equal(result.status, 'ok');

  // No machine write of any kind: no Loadout prepare/commit/select, no
  // install, no environment plan.
  assert.deepEqual(machineWriteCalls(calls), []);
  const overwriteCalls = calls.filter((entry) => entry.method === 'aiConfig.overwrite');
  assert.equal(overwriteCalls.length, 1);
  const input = overwriteCalls[0]?.args as {
    expectedRevision: string;
    capabilities: {
      capabilityContract: string;
      route: { oneofKind: string; cloud?: { connectorRef: string } };
    }[];
  };
  assert.equal(input.expectedRevision, '7');
  const cloudEntry = input.capabilities.find((entry) => entry.capabilityContract === CAPABILITY);
  assert.equal(cloudEntry?.route.oneofKind, 'cloud');
  assert.equal(cloudEntry?.route.cloud?.connectorRef, 'conn-1');
  // The other capability entry is preserved verbatim.
  assert.ok(input.capabilities.some((entry) => entry.capabilityContract === 'text.generate'));

  const task = store.getTask(taskId);
  assert.equal(task?.status, 'done');
  assert.equal(task?.nextAction, 'return-to-source');
  assert.equal(task?.refs.aiConfigBaselineRevision, '8');
});

test('cloud route save on a machine-scope task is refused without any write', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const ports = createPorts(baseState(), calls);
  const task = store.createTask({
    capabilityContract: CAPABILITY,
    source: { kind: 'runtime', accountId: ACCOUNT },
  });

  const result = await commitRuntimeSetupCloudUse(store, task.taskId, ports, {
    connectorRef: 'conn-1',
    ...CLOUD_TARGET,
  });
  assert.equal(result.status, 'failed');
  if (result.status === 'failed') {
    assert.equal(result.failure.reasonCode, 'RUNTIME_SETUP_OWNER_REQUIRED');
  }
  assert.deepEqual(calls, []);
});

test('cloud route save conflict keeps the draft and never retries on a fresh revision', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState({ aiConfigConflict: true });
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);
  store.updateTask(taskId, () => ({
    draft: { route: 'cloud', cloudConnectorRef: 'conn-1', cloudTargetLabel: 'gpt-5' },
  }));

  const result = await commitRuntimeSetupCloudUse(store, taskId, ports, {
    connectorRef: 'conn-1',
    ...CLOUD_TARGET,
  });
  assert.equal(result.status, 'needs-attention');
  if (result.status === 'needs-attention') {
    assert.equal(result.failure.stage, 'save-route');
    assert.deepEqual(result.observed, { ownerSaved: false, latestRevision: '9', currentConfig: null });
  }
  const task = store.getTask(taskId);
  assert.equal(task?.status, 'needs-attention');
  // The draft target selection is kept for the user's review.
  assert.equal(task?.draft?.cloudConnectorRef, 'conn-1');
  // Exactly one save attempt — no blind retry after reading the conflict.
  assert.equal(calls.filter((entry) => entry.method === 'aiConfig.overwrite').length, 1);
});

test('multi-capability owner save aggregates into one whole-object overwrite', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState();
  const ports = createPorts(state, calls);
  const taskA = await createAppTask(store);
  const taskB = store.createTask({
    capabilityContract: 'text.generate',
    source: { kind: 'app', ownerAppId: 'app.chat', accountId: ACCOUNT },
  }).taskId;
  store.updateTask(taskA, () => ({ refs: { installPlanIds: [], transferIds: [], dependencyJobIds: [], aiConfigBaselineRevision: '7' } }));
  store.updateTask(taskB, () => ({ refs: { installPlanIds: [], transferIds: [], dependencyJobIds: [], aiConfigBaselineRevision: '7' } }));

  const result = await saveRuntimeSetupOwnerIntents(store, ports, {
    taskIds: [taskA, taskB],
    intents: [
      { capabilityContract: CAPABILITY, intent: { capabilityContract: CAPABILITY, requiredFeatures: [], route: { oneofKind: 'local', local: {} } } },
      { capabilityContract: 'text.generate', intent: { capabilityContract: 'text.generate', requiredFeatures: [], route: { oneofKind: 'local', local: {} } } },
    ],
  });
  assert.equal(result.status, 'ok');

  const overwriteCalls = calls.filter((entry) => entry.method === 'aiConfig.overwrite');
  assert.equal(overwriteCalls.length, 1);
  const input = overwriteCalls[0]?.args as { expectedRevision: string; capabilities: { capabilityContract: string }[] };
  assert.equal(input.expectedRevision, '7');
  assert.deepEqual(input.capabilities.map((entry) => entry.capabilityContract).sort(), [CAPABILITY, 'text.generate'].sort());
  // Both task baselines chain to the returned revision for any staged save.
  assert.equal(store.getTask(taskA)?.refs.aiConfigBaselineRevision, '8');
  assert.equal(store.getTask(taskB)?.refs.aiConfigBaselineRevision, '8');
});

test('a staged owner save reuses this task chain returned revision', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState();
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);
  store.updateTask(taskId, () => ({ refs: { installPlanIds: [], transferIds: [], dependencyJobIds: [], aiConfigBaselineRevision: '7' } }));

  const first = await saveRuntimeSetupOwnerIntents(store, ports, {
    taskIds: [taskId],
    intents: [{ capabilityContract: CAPABILITY, intent: { capabilityContract: CAPABILITY, requiredFeatures: [], route: { oneofKind: 'local', local: {} } } }],
  });
  assert.equal(first.status, 'ok');

  // The staged second save uses the revision returned by this task's first
  // success — never a re-read foreign revision.
  state.aiConfig = { config: state.aiConfig.config, revision: '8' };
  const second = await saveRuntimeSetupOwnerIntents(store, ports, {
    taskIds: [taskId],
    intents: [{ capabilityContract: 'text.generate', intent: { capabilityContract: 'text.generate', requiredFeatures: [], route: { oneofKind: 'local', local: {} } } }],
  });
  assert.equal(second.status, 'ok');
  const overwriteCalls = calls.filter((entry) => entry.method === 'aiConfig.overwrite');
  assert.equal(overwriteCalls.length, 2);
  assert.equal((overwriteCalls[1]?.args as { expectedRevision: string }).expectedRevision, '8');
});

test('an external conflict during a multi-capability save marks every task without retrying', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState({ aiConfigConflict: true });
  const ports = createPorts(state, calls);
  const taskA = await createAppTask(store);
  const taskB = store.createTask({
    capabilityContract: 'text.generate',
    source: { kind: 'app', ownerAppId: 'app.chat', accountId: ACCOUNT },
  }).taskId;

  const result = await saveRuntimeSetupOwnerIntents(store, ports, {
    taskIds: [taskA, taskB],
    intents: [
      { capabilityContract: CAPABILITY, intent: { capabilityContract: CAPABILITY, requiredFeatures: [], route: { oneofKind: 'local', local: {} } } },
      { capabilityContract: 'text.generate', intent: { capabilityContract: 'text.generate', requiredFeatures: [], route: { oneofKind: 'local', local: {} } } },
    ],
  });
  assert.equal(result.status, 'needs-attention');
  assert.equal(store.getTask(taskA)?.status, 'needs-attention');
  assert.equal(store.getTask(taskB)?.status, 'needs-attention');
  assert.equal(calls.filter((entry) => entry.method === 'aiConfig.overwrite').length, 1);
});

test('an owner route that already follows the machine is not written again at commit', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState();
  // The owner already follows the machine for the capability (for example a
  // profile batch saved the route once): the use commit must not write again.
  state.aiConfig = {
    config: {
      capabilities: [
        { capabilityContract: 'text.generate', requiredFeatures: [], route: { oneofKind: 'local', local: {} } },
        { capabilityContract: CAPABILITY, requiredFeatures: [], route: { oneofKind: 'local', local: {} } },
      ],
    },
    revision: '7',
  };
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);

  const plan = await reachReview(store, taskId, ports);
  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-and-use', reviewedPlan: plan });
  assert.equal(result.status, 'ok');

  assert.equal(calls.some((entry) => entry.method === 'loadouts.select'), true);
  assert.equal(calls.some((entry) => entry.method === 'aiConfig.overwrite'), false);
  const task = store.getTask(taskId);
  assert.equal(task?.status, 'done');
  assert.equal(task?.nextAction, 'return-to-source');
  assert.equal(task?.refs.aiConfigBaselineRevision, '7');
});

test('a profile batch saves owner routes once and the per-task commit skips the duplicate write', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState();
  const ports = createPorts(state, calls);
  const taskA = await createAppTask(store);
  const taskB = store.createTask({
    capabilityContract: 'text.generate',
    source: { kind: 'app', ownerAppId: 'app.chat', accountId: ACCOUNT },
  }).taskId;

  const saved = await saveRuntimeSetupOwnerIntents(store, ports, {
    taskIds: [taskA, taskB],
    intents: [
      { capabilityContract: CAPABILITY, intent: { capabilityContract: CAPABILITY, requiredFeatures: [], route: { oneofKind: 'local', local: {} } } },
      { capabilityContract: 'text.generate', intent: { capabilityContract: 'text.generate', requiredFeatures: [], route: { oneofKind: 'local', local: {} } } },
    ],
  });
  assert.equal(saved.status, 'ok');
  assert.equal(calls.filter((entry) => entry.method === 'aiConfig.overwrite').length, 1);

  // The capability's use commit afterwards performs the machine select but no
  // second owner write — the batch already saved the follow-machine route.
  const plan = await reachReview(store, taskA, ports);
  const result = await runRuntimeSetupPreparation(store, taskA, ports, { mode: 'prepare-and-use', reviewedPlan: plan });
  assert.equal(result.status, 'ok');
  assert.equal(calls.some((entry) => entry.method === 'loadouts.select'), true);
  assert.equal(calls.filter((entry) => entry.method === 'aiConfig.overwrite').length, 1);
});

test('profile-derived candidates carry the portable recipe, options, axes, and profile provenance', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const ports = createPorts(baseState(), calls);
  const taskId = await createAppTask(store);
  store.updateTask(taskId, () => ({
    draft: {
      recipeId: 'image.recipe',
      route: 'local',
      options: { steps: 30 },
      axes: [{ slotId: 'main.diffusion', modelAssetId: 'asset-1', expectedContentId: 'sha256:model-content' }],
      profileId: 'profile.shared-1',
    },
  }));

  const created = await createRuntimeSetupCandidate(store, taskId, ports, {
    recipeId: 'image.recipe',
    options: { steps: 30 },
    axes: [{ slotId: 'main.diffusion', modelAssetId: 'asset-1', expectedContentId: 'sha256:model-content' }],
    displayName: 'Shared setup · Image recipe',
    provenance: { source_profile_id: 'profile.shared-1' },
  });
  assert.equal(created.status, 'ok');

  const prepareCall = calls.find((entry) => entry.method === 'loadouts.prepare');
  const args = prepareCall?.args as {
    recipeId: string;
    options: unknown;
    modelAxes: unknown[];
    displayName: string;
    provenance: Record<string, string>;
  };
  assert.equal(args.recipeId, 'image.recipe');
  assert.deepEqual(args.options, { steps: 30 });
  assert.deepEqual(args.modelAxes, [{ slotId: 'main.diffusion', modelAssetId: 'asset-1', expectedContentId: 'sha256:model-content' }]);
  assert.equal(args.displayName, 'Shared setup · Image recipe');
  assert.equal(args.provenance.source_profile_id, 'profile.shared-1');
  assert.equal(args.provenance.desktop_setup_task_id, taskId);
});
test('advanced edits update the unselected candidate under its revision condition', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const ports = createPorts(baseState(), calls);
  const taskId = await createAppTask(store);
  const created = await createRuntimeSetupCandidate(store, taskId, ports, { recipeId: 'image.recipe' });
  assert.equal(created.status, 'ok');

  const updated = await updateRuntimeSetupCandidate(store, taskId, ports, {
    options: { steps: 42 },
    axes: [{ slotId: 'main.diffusion', modelAssetId: 'asset-1', expectedContentId: 'sha256:model-content' }],
  });
  assert.equal(updated.status, 'ok');

  const prepareCalls = calls.filter((entry) => entry.method === 'loadouts.prepare');
  const updateCall = prepareCalls[prepareCalls.length - 1]?.args as {
    loadoutId?: string;
    options: unknown;
    modelAxes: unknown[];
    expectedLoadoutRevision?: string;
  };
  assert.equal(updateCall.loadoutId, 'loadout-1');
  assert.deepEqual(updateCall.options, { steps: 42 });
  assert.deepEqual(updateCall.modelAxes, [{ slotId: 'main.diffusion', modelAssetId: 'asset-1', expectedContentId: 'sha256:model-content' }]);
  assert.equal(updateCall.expectedLoadoutRevision, 'r1');
  // The candidate baseline advances to the committed revision.
  assert.equal(store.getTask(taskId)?.candidateRevisionBaseline, 'r2');
});

test('advanced edits on an externally modified candidate stop at needs-attention', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState();
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);
  const created = await createRuntimeSetupCandidate(store, taskId, ports, { recipeId: 'image.recipe' });
  assert.equal(created.status, 'ok');
  // An external edit advances the candidate revision behind the task's back.
  const candidateIndex = state.loadouts.findIndex((item) => item.loadoutId === 'loadout-1');
  if (candidateIndex >= 0) {
    state.loadouts[candidateIndex] = { ...state.loadouts[candidateIndex]!, revision: 'r-external' };
  }

  const updated = await updateRuntimeSetupCandidate(store, taskId, ports, { options: { steps: 42 } });
  assert.equal(updated.status, 'needs-attention');
  assert.equal(store.getTask(taskId)?.status, 'needs-attention');
  // No prepare/commit write happened after the drift was detected.
  const prepareCalls = calls.filter((entry) => entry.method === 'loadouts.prepare');
  assert.equal(prepareCalls.length, 1);
});

// ---------------------------------------------------------------------------
// F1: reviewed-plan comparison applies the same choices on both sides
// ---------------------------------------------------------------------------

type RecipeOffer = NimiLoadoutRecipe['slots'][number]['offers'][number];

function offer(offerRef: string, overrides?: { readonly installedModelAssetId?: string }): RecipeOffer {
  return {
    candidate: {
      offerRef,
      sourceLabel: 'model-index',
      title: `Model ${offerRef}`,
      description: '',
      categories: ['image'],
      variantLabel: offerRef,
      tags: [],
      verified: true,
      installed: Boolean(overrides?.installedModelAssetId),
      installable: true,
      totalSizeBytes: 1024,
    },
    applicability: 'supported',
    reasons: [],
    ...(overrides?.installedModelAssetId ? { installedModelAssetId: overrides.installedModelAssetId } : {}),
  } as RecipeOffer;
}

function recipeWithOffers(offers: readonly RecipeOffer[]): NimiLoadoutRecipe {
  const base = recipe();
  return {
    ...base,
    slots: [{ ...base.slots[0]!, offers: [...offers] }],
  };
}

function rebindPrepareArgs(calls: CallLog) {
  return calls
    .filter((entry) => entry.method === 'loadouts.prepare')
    .map((entry) => entry.args as {
      loadoutId?: string;
      modelAxes?: readonly { slotId: string; modelAssetId: string; expectedContentId: string }[];
    })
    .find((args) => args.loadoutId);
}

test('a reviewed plan with awaiting choices confirms once the same choices resolve both sides', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState({
    recipes: [recipeWithOffers([offer('offer:a'), offer('offer:b')])],
  });
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);
  const plan = await reachReview(store, taskId, ports);
  assert.equal(plan.awaitingChoice.length, 1);
  assert.deepEqual(plan.awaitingChoice[0]?.options.map((option) => option.offerRef), ['offer:a', 'offer:b']);

  const result = await runRuntimeSetupPreparation(store, taskId, ports, {
    mode: 'prepare-only',
    reviewedPlan: plan,
    choices: { 'main.diffusion': 'offer:b' },
  });
  assert.equal(result.status, 'ok');
  assert.deepEqual(
    calls.filter((entry) => entry.method === 'install.install').map((entry) => entry.args),
    ['plan-offer:b'],
  );
  assert.equal(store.getTask(taskId)?.status, 'prepared');
});

test('a choice referencing a nonexistent option is still rejected as choice-required', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const ports = createPorts(baseState({
    recipes: [recipeWithOffers([offer('offer:a'), offer('offer:b')])],
  }), calls);
  const taskId = await createAppTask(store);
  const plan = await reachReview(store, taskId, ports);

  const result = await runRuntimeSetupPreparation(store, taskId, ports, {
    mode: 'prepare-only',
    reviewedPlan: plan,
    choices: { 'main.diffusion': 'offer:ghost' },
  });
  assert.equal(result.status, 'blocked');
  if (result.status === 'blocked') {
    assert.equal(result.failure.reasonCode, 'RUNTIME_SETUP_CHOICE_REQUIRED');
  }
  assert.equal(calls.some((entry) => entry.method === 'install.install'), false);
});

test('a changed choice option set is reported as a plan change, not a missing choice', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState({
    recipes: [recipeWithOffers([offer('offer:a'), offer('offer:b')])],
  });
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);
  const plan = await reachReview(store, taskId, ports);
  // The option set changes between review and confirm.
  state.recipes = [recipeWithOffers([offer('offer:a')])];

  const result = await runRuntimeSetupPreparation(store, taskId, ports, {
    mode: 'prepare-only',
    reviewedPlan: plan,
    choices: { 'main.diffusion': 'offer:b' },
  });
  assert.equal(result.status, 'needs-attention');
  if (result.status === 'needs-attention') {
    assert.equal(result.failure.reasonCode, 'RUNTIME_SETUP_PLAN_CHANGED');
  }
  assert.equal(store.getTask(taskId)?.status, 'needs-attention');
  assert.equal(calls.some((entry) => entry.method === 'install.install'), false);
});

// ---------------------------------------------------------------------------
// F2: the environment plan is re-resolved after the rebind and its required
// jobs are awaited
// ---------------------------------------------------------------------------

test('the environment plan is re-resolved after the rebind commit and applied under the fresh plan id', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState();
  state.resolvePlan = (input) => {
    const candidate = state.loadouts.find((entry) => entry.loadoutId === input.candidateLoadoutId);
    return { ...state.plan, planId: `env-plan-${candidate?.revision ?? 'none'}` };
  };
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);
  const plan = await reachReview(store, taskId, ports);
  assert.equal(plan.environmentPlanId, 'env-plan-r1');

  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-only', reviewedPlan: plan });
  assert.equal(result.status, 'ok');
  // The rebind Commit rotated the candidate revision (r1 -> r2); Apply must
  // target the freshly resolved plan, never the stale reviewed plan id.
  const applyCall = calls.find((entry) => entry.method === 'environment.applyEnvironmentPlan');
  assert.equal((applyCall?.args as { expectedPlanId: string }).expectedPlanId, 'env-plan-r2');
  assert.equal(store.getTask(taskId)?.status, 'prepared');
});

test('preparation waits for required dependency jobs to finish before continuing to select', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState();
  state.envJobSequence = [[envJob('installing')], [envJob('ready_managed')]];
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);
  const plan = await reachReview(store, taskId, ports);

  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-and-use', reviewedPlan: plan });
  assert.equal(result.status, 'ok');
  const methods = calls.map((entry) => entry.method);
  const jobListings = methods.filter((method) => method === 'environment.listEnvironmentDependencyJobs');
  assert.equal(jobListings.length, 2);
  const selectIndex = methods.indexOf('loadouts.select');
  assert.ok(selectIndex > methods.lastIndexOf('environment.listEnvironmentDependencyJobs'));
  assert.equal(store.getTask(taskId)?.status, 'done');
});

test('a failed dependency job fails the preparation honestly with the runtime reason', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState({
    envJobs: [envJob('failed', { reasonCode: 'AI_LOCAL_DEPENDENCY_INSTALL_FAILED', failureDetail: 'disk full' })],
  });
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);
  const plan = await reachReview(store, taskId, ports);

  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-and-use', reviewedPlan: plan });
  assert.equal(result.status, 'failed');
  if (result.status === 'failed') {
    assert.equal(result.failure.stage, 'environment');
    assert.equal(result.failure.reasonCode, 'AI_LOCAL_DEPENDENCY_INSTALL_FAILED');
    assert.match(result.failure.message, /disk full/u);
    assert.match(result.failure.message, /python-runtime/u);
  }
  assert.equal(store.getTask(taskId)?.status, 'failed');
  assert.equal(calls.some((entry) => entry.method === 'loadouts.select'), false);
});

test('a new required dependency appearing after the rebind is a plan change and is never applied', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState();
  state.resolvePlan = (input) => {
    const candidate = state.loadouts.find((entry) => entry.loadoutId === input.candidateLoadoutId);
    if (candidate?.revision === 'r2') {
      return {
        ...state.plan,
        planId: 'env-plan-r2',
        dependencies: [
          ...state.plan.dependencies,
          {
            dependencyFamily: 'engine',
            dependencyId: 'engine-x',
            consumerScope: 'image.stablediffusion',
            required: true,
            state: 'needs_confirmation',
            sourceKind: 'managed',
            confirmationRequired: true,
            environmentKey: 'engine-x',
          },
        ] as unknown as NimiRuntimeLocalEnvironmentPlan['dependencies'],
      };
    }
    return state.plan;
  };
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);
  const plan = await reachReview(store, taskId, ports);

  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-only', reviewedPlan: plan });
  assert.equal(result.status, 'needs-attention');
  if (result.status === 'needs-attention') {
    assert.equal(result.failure.stage, 'environment');
    assert.equal(result.failure.reasonCode, 'RUNTIME_SETUP_PLAN_CHANGED');
  }
  assert.equal(store.getTask(taskId)?.status, 'needs-attention');
  assert.equal(calls.some((entry) => entry.method === 'environment.applyEnvironmentPlan'), false);
  assert.equal(calls.some((entry) => entry.method === 'loadouts.select'), false);
});

test('stopping during the dependency wait blocks the remaining writes', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState();
  state.envJobSequence = [[envJob('installing')], [envJob('ready_managed')]];
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);
  const plan = await reachReview(store, taskId, ports);
  let polls = 0;
  state.onListJobs = () => {
    polls += 1;
    if (polls === 1) stopRuntimeSetupTask(store, taskId);
  };

  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-and-use', reviewedPlan: plan });
  assert.equal(result.status, 'blocked');
  if (result.status === 'blocked') {
    assert.equal(result.failure.reasonCode, 'RUNTIME_SETUP_TASK_INACTIVE');
  }
  assert.equal(store.getTask(taskId)?.status, 'stopped');
  assert.equal(calls.some((entry) => entry.method === 'loadouts.select'), false);
  assert.equal(calls.some((entry) => entry.method === 'aiConfig.overwrite'), false);
});

// ---------------------------------------------------------------------------
// F3: stop review between Prepare and Commit, and terminal-state protection
// ---------------------------------------------------------------------------

test('a stop landing between Prepare and Commit blocks the commit', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const ports = createPorts(baseState(), calls);
  const taskId = await createAppTask(store);
  const plan = await reachReview(store, taskId, ports);
  const wrapped: RuntimeSetupRunnerPorts = {
    ...ports,
    loadouts: {
      ...ports.loadouts,
      prepare: async (input) => {
        const result = await ports.loadouts.prepare(input);
        // The stop lands while the rebind Prepare is in flight.
        if (input.loadoutId) stopRuntimeSetupTask(store, taskId);
        return result;
      },
    },
  };

  const result = await runRuntimeSetupPreparation(store, taskId, wrapped, { mode: 'prepare-and-use', reviewedPlan: plan });
  assert.equal(result.status, 'blocked');
  if (result.status === 'blocked') {
    assert.equal(result.failure.reasonCode, 'RUNTIME_SETUP_TASK_INACTIVE');
  }
  assert.equal(store.getTask(taskId)?.status, 'stopped');
  // Only the candidate-creation Commit ran; the rebind was never committed.
  assert.equal(calls.filter((entry) => entry.method === 'loadouts.commit').length, 1);
  assert.equal(calls.some((entry) => entry.method === 'environment.applyEnvironmentPlan'), false);
  assert.equal(calls.some((entry) => entry.method === 'loadouts.select'), false);
});

test('a stop landing during the Commit flight is not rewritten back to preparing', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const ports = createPorts(baseState(), calls);
  const taskId = await createAppTask(store);
  const plan = await reachReview(store, taskId, ports);
  const wrapped: RuntimeSetupRunnerPorts = {
    ...ports,
    loadouts: {
      ...ports.loadouts,
      commit: async (prepareId, confirmedMachineImpact) => {
        const committed = await ports.loadouts.commit(prepareId, confirmedMachineImpact);
        // The stop lands while the rebind Commit is in flight (the only
        // Commit inside runPreparation).
        stopRuntimeSetupTask(store, taskId);
        return committed;
      },
    },
  };

  const result = await runRuntimeSetupPreparation(store, taskId, wrapped, { mode: 'prepare-and-use', reviewedPlan: plan });
  assert.equal(result.status, 'blocked');
  const task = store.getTask(taskId);
  assert.equal(task?.status, 'stopped');
  // The post-Commit baseline bump must not land on a stopped task.
  assert.equal(task?.candidateRevisionBaseline, 'r1');
  assert.equal(calls.some((entry) => entry.method === 'environment.applyEnvironmentPlan'), false);
  assert.equal(calls.some((entry) => entry.method === 'loadouts.select'), false);
});

// ---------------------------------------------------------------------------
// F4: first-ever selection asserts expectNoPriorSelection
// ---------------------------------------------------------------------------

test('a first-ever selection asserts expectNoPriorSelection instead of an empty revision condition', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const ports = createPorts(baseState({ selectionRevisions: {} }), calls);
  const taskId = await createAppTask(store);
  const plan = await reachReview(store, taskId, ports);
  assert.equal(plan.selectionRevisionPresent, false);
  assert.equal(plan.selectionRevision, undefined);

  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-and-use', reviewedPlan: plan });
  assert.equal(result.status, 'ok');
  const selectCall = calls.find((entry) => entry.method === 'loadouts.select');
  assert.deepEqual((selectCall?.args as { conditions: unknown }).conditions, {
    expectNoPriorSelection: true,
    expectedCandidateRevision: 'r2',
  });
  assert.equal(store.getTask(taskId)?.status, 'done');
});

test('a declined first-ever selection shows the conflict without a blind retry', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const ports = createPorts(baseState({ selectionRevisions: { [`${CAPABILITY}:conflict`]: 'yes' } }), calls);
  const taskId = await createAppTask(store);
  const plan = await reachReview(store, taskId, ports);
  assert.equal(plan.selectionRevisionPresent, false);

  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-and-use', reviewedPlan: plan });
  assert.equal(result.status, 'needs-attention');
  if (result.status === 'needs-attention') {
    assert.equal(result.failure.stage, 'select');
    assert.equal(result.failure.reasonCode, 'AI_LOADOUT_CONDITION_CONFLICT');
  }
  const selectCalls = calls.filter((entry) => entry.method === 'loadouts.select');
  assert.equal(selectCalls.length, 1);
  assert.deepEqual((selectCalls[0]?.args as { conditions: unknown }).conditions, {
    expectNoPriorSelection: true,
    expectedCandidateRevision: 'r2',
  });
  assert.equal(calls.some((entry) => entry.method === 'aiConfig.overwrite'), false);
});

// ---------------------------------------------------------------------------
// F5: profile pending axes keep their declared content identity
// ---------------------------------------------------------------------------

const PENDING_CONTENT = 'sha256:pending-content';
const PENDING_HASH = `sha256:${'f'.repeat(64)}`;

function draftPendingAxis(store: RuntimeSetupTaskStore, taskId: string, pendingAxis: Record<string, unknown>): void {
  store.updateTask(taskId, () => ({
    draft: { recipeId: 'image.recipe', route: 'local', pendingAxes: [pendingAxis] as never },
  }));
}

test('a profile pending axis acquires exactly its declared content identity through the portable source plan', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const ports = createPorts(baseState(), calls);
  const taskId = await createAppTask(store);
  draftPendingAxis(store, taskId, {
    slotId: 'main.diffusion',
    contentId: PENDING_CONTENT,
    expectedHash: PENDING_HASH,
    source: { repo: 'example/pending', revision: 'main', file: 'model.gguf', sizeBytes: 2048 },
  });
  const created = await createRuntimeSetupCandidate(store, taskId, ports, { recipeId: 'image.recipe' });
  assert.equal(created.status, 'ok');
  const resolved = await resolveRuntimeSetupPreparation(store, taskId, ports);
  assert.equal(resolved.status, 'ok');
  const plan = resolved.status === 'ok' ? resolved.value : assert.fail('unreachable');
  assert.equal(plan.acquire.length, 1);
  assert.equal(plan.acquire[0]?.offer.expectedContentId, PENDING_CONTENT);
  assert.equal(plan.acquire[0]?.offer.portableSource?.repo, 'example/pending');
  assert.equal(plan.awaitingChoice.length, 0);

  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-only', reviewedPlan: plan });
  assert.equal(result.status, 'ok');
  const resolveCall = calls.find((entry) => entry.method === 'install.resolveInstallPlan');
  assert.deepEqual(resolveCall?.args, {
    source: 'huggingface',
    modelId: 'example/pending',
    repo: 'example/pending',
    revision: 'main',
    capabilities: [CAPABILITY],
    entry: 'model.gguf',
    files: ['model.gguf'],
    hashes: { 'model.gguf': 'f'.repeat(64) },
  });
  assert.equal(calls.some((entry) => entry.method === 'install.resolveOfferInstallPlan'), false);
  // The binding carries the declared content identity, never a substituted
  // recipe recommendation.
  assert.deepEqual(rebindPrepareArgs(calls)?.modelAxes, [
    { slotId: 'main.diffusion', modelAssetId: 'asset-1', expectedContentId: PENDING_CONTENT },
  ]);
  assert.equal(store.getTask(taskId)?.status, 'prepared');
});

test('a pending axis matching an installed offer rebinds it without a download', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState({
    recipes: [recipeWithOffers([offer('offer:installed', { installedModelAssetId: 'asset-1' })])],
  });
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);
  draftPendingAxis(store, taskId, {
    slotId: 'main.diffusion',
    contentId: 'sha256:model-content',
    expectedHash: PENDING_HASH,
    source: { repo: 'example/pending', revision: 'main', file: 'model.gguf', sizeBytes: 2048 },
  });
  const created = await createRuntimeSetupCandidate(store, taskId, ports, { recipeId: 'image.recipe' });
  assert.equal(created.status, 'ok');
  const resolved = await resolveRuntimeSetupPreparation(store, taskId, ports);
  assert.equal(resolved.status, 'ok');
  const plan = resolved.status === 'ok' ? resolved.value : assert.fail('unreachable');
  assert.equal(plan.acquire.length, 1);
  assert.equal(plan.acquire[0]?.offer.installedModelAssetId, 'asset-1');
  assert.equal(plan.acquire[0]?.offer.expectedContentId, 'sha256:model-content');

  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-only', reviewedPlan: plan });
  assert.equal(result.status, 'ok');
  assert.equal(calls.some((entry) => entry.method === 'install.install'), false);
  assert.equal(calls.some((entry) => entry.method === 'install.resolveOfferInstallPlan'), false);
  assert.equal(calls.some((entry) => entry.method === 'install.resolveInstallPlan'), false);
  assert.deepEqual(rebindPrepareArgs(calls)?.modelAxes, [
    { slotId: 'main.diffusion', modelAssetId: 'asset-1', expectedContentId: 'sha256:model-content' },
  ]);
});

test('a pending axis with no matching offer and no source is honestly unavailable', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const ports = createPorts(baseState(), calls);
  const taskId = await createAppTask(store);
  draftPendingAxis(store, taskId, {
    slotId: 'main.diffusion',
    contentId: 'sha256:ghost-content',
    expectedHash: PENDING_HASH,
  });
  const created = await createRuntimeSetupCandidate(store, taskId, ports, { recipeId: 'image.recipe' });
  assert.equal(created.status, 'ok');
  const resolved = await resolveRuntimeSetupPreparation(store, taskId, ports);
  assert.equal(resolved.status, 'ok');
  const plan = resolved.status === 'ok' ? resolved.value : assert.fail('unreachable');
  assert.equal(plan.acquire.length, 0);
  assert.equal(plan.unavailable.length, 1);
  assert.equal(plan.unavailable[0]?.reasonCode, 'AI_PROFILE_MODEL_SOURCE_REQUIRED');

  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-only', reviewedPlan: plan });
  assert.equal(result.status, 'blocked');
  if (result.status === 'blocked') {
    assert.equal(result.failure.reasonCode, 'RUNTIME_SETUP_SLOT_UNAVAILABLE');
  }
  assert.equal(calls.some((entry) => entry.method === 'install.install'), false);
});

test('a content mismatch on the declared identity is rejected at the Prepare boundary', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState();
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);
  draftPendingAxis(store, taskId, {
    slotId: 'main.diffusion',
    contentId: PENDING_CONTENT,
    expectedHash: PENDING_HASH,
    source: { repo: 'example/pending', revision: 'main', file: 'model.gguf', sizeBytes: 2048 },
  });
  const plan = await reachReview(store, taskId, ports);
  // The install returns different content than declared; the Runtime Prepare
  // boundary rejects the binding.
  state.prepareError = createNimiError({
    message: 'axis content does not match the declared identity',
    reasonCode: 'AI_LOADOUT_AXIS_CONTENT_MISMATCH',
    source: 'runtime',
  });

  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-only', reviewedPlan: plan });
  assert.equal(result.status, 'failed');
  if (result.status === 'failed') {
    assert.equal(result.failure.stage, 'prepare');
    assert.equal(result.failure.reasonCode, 'AI_LOADOUT_AXIS_CONTENT_MISMATCH');
  }
  assert.equal(store.getTask(taskId)?.status, 'failed');
  assert.equal(calls.some((entry) => entry.method === 'loadouts.select'), false);
});

// ---------------------------------------------------------------------------
// F6: the per-owner session save lane chains sequential commits
// ---------------------------------------------------------------------------

function prepareUsableTask(store: RuntimeSetupTaskStore, capability: string): string {
  const taskId = store.createTask({
    capabilityContract: capability,
    source: { kind: 'app', ownerAppId: 'app.chat', accountId: ACCOUNT, returnFocus: 'app:app.chat' },
  }).taskId;
  store.claimCapabilityUse(taskId, capability);
  store.updateTask(taskId, () => ({
    status: 'prepared',
    candidateLoadoutId: 'loadout-1',
    candidateRevisionBaseline: 'r2',
    selectionRevisionBaseline: 'sel-1',
    authorization: {
      scope: { items: [], usage: { selectOnMachine: true, saveOwnerRoute: true } },
      confirmedAt: '2026-09-18T00:00:00.000Z',
      mode: 'prepare-and-use',
    },
  }));
  return taskId;
}

test('same-owner capabilities advance only baselines replaced by their own successful save', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const ports = createPorts(baseState(), calls);
  const taskA = prepareUsableTask(store, CAPABILITY);
  const taskB = prepareUsableTask(store, 'text.embed');
  // B was reviewed before A's save landed: its per-task baseline is stale.
  store.updateTask(taskB, () => ({
    refs: { installPlanIds: [], transferIds: [], dependencyJobIds: [], aiConfigBaselineRevision: '7' },
  }));

  const resultA = await commitRuntimeSetupUse(store, taskA, ports);
  assert.equal(resultA.status, 'ok');
  const resultB = await commitRuntimeSetupUse(store, taskB, ports);
  assert.equal(resultB.status, 'ok');

  const overwrites = calls.filter((entry) => entry.method === 'aiConfig.overwrite');
  assert.equal(overwrites.length, 2);
  assert.equal((overwrites[0]?.args as { expectedRevision: string }).expectedRevision, '7');
  // The first save advanced B's matching baseline before its own fresh read.
  assert.equal((overwrites[1]?.args as { expectedRevision: string }).expectedRevision, '8');
  assert.equal(store.getTask(taskA)?.status, 'done');
  assert.equal(store.getTask(taskB)?.status, 'done');
});

test('an external owner write is not adopted into a pending task baseline', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState();
  const ports = createPorts(state, calls);
  const taskA = prepareUsableTask(store, CAPABILITY);
  const taskB = prepareUsableTask(store, 'text.embed');
  for (const taskId of [taskA, taskB]) {
    store.updateTask(taskId, (task) => ({ refs: { ...task.refs, aiConfigBaselineRevision: '7' } }));
  }

  const resultA = await commitRuntimeSetupUse(store, taskA, ports);
  assert.equal(resultA.status, 'ok');
  assert.equal(store.getTask(taskB)?.refs.aiConfigBaselineRevision, '8');

  // An external writer moves the owner revision behind the session's back.
  state.aiConfig = { config: state.aiConfig.config, revision: '100' };

  const resultB = await commitRuntimeSetupUse(store, taskB, ports);
  assert.equal(resultB.status, 'needs-attention');
  if (resultB.status === 'needs-attention') {
    assert.equal(resultB.failure.stage, 'save-route');
    assert.equal(resultB.failure.reasonCode, 'AI_CONFIG_REVISION_CONFLICT');
    assert.deepEqual(resultB.observed, { machineSelected: true, ownerSaved: false, latestRevision: '100', currentConfig: state.aiConfig.config });
  }
  // B's read already exposed the conflict: do not submit an unrelated revision.
  assert.equal(calls.filter((entry) => entry.method === 'aiConfig.overwrite').length, 1);
  assert.equal(store.getTask(taskB)?.refs.aiConfigBaselineRevision, '8');
  assert.equal(store.getTask(taskB)?.status, 'needs-attention');
});

// ---------------------------------------------------------------------------
// F7: a queued preferred variant outranks the current binding
// ---------------------------------------------------------------------------

test('a preferred installed variant replaces the current binding without a download', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const oldAsset = { ...INSTALLED_ASSET, modelAssetId: 'asset-old', contentId: 'sha256:old-content' } as NimiRuntimeModelAssetRecord;
  const newAsset = { ...INSTALLED_ASSET, modelAssetId: 'asset-new', contentId: 'sha256:new-content' } as NimiRuntimeModelAssetRecord;
  const state = baseState({
    assets: [oldAsset, newAsset],
    recipes: [recipeWithOffers([
      offer('offer:old', { installedModelAssetId: 'asset-old' }),
      offer('offer:new', { installedModelAssetId: 'asset-new' }),
    ])],
  });
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);
  const created = await createRuntimeSetupCandidate(store, taskId, ports, {
    recipeId: 'image.recipe',
    axes: [{ slotId: 'main.diffusion', modelAssetId: 'asset-old', expectedContentId: 'sha256:old-content' }],
  });
  assert.equal(created.status, 'ok');
  store.updateTask(taskId, () => ({
    draft: { recipeId: 'image.recipe', route: 'local', preferredOffers: { 'main.diffusion': 'offer:new' } },
  }));
  const resolved = await resolveRuntimeSetupPreparation(store, taskId, ports);
  assert.equal(resolved.status, 'ok');
  const plan = resolved.status === 'ok' ? resolved.value : assert.fail('unreachable');
  // The queued variant wins over the current binding: rebind, not reuse.
  assert.deepEqual(plan.reuse, []);
  assert.equal(plan.acquire.length, 1);
  assert.equal(plan.acquire[0]?.offer.offerRef, 'offer:new');
  assert.equal(plan.acquire[0]?.offer.installedModelAssetId, 'asset-new');

  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-only', reviewedPlan: plan });
  assert.equal(result.status, 'ok');
  // No download: an installed variant binds directly.
  assert.equal(calls.some((entry) => entry.method === 'install.install'), false);
  assert.equal(calls.some((entry) => entry.method === 'install.resolveOfferInstallPlan'), false);
  assert.deepEqual(rebindPrepareArgs(calls)?.modelAxes, [
    { slotId: 'main.diffusion', modelAssetId: 'asset-new', expectedContentId: 'sha256:new-content' },
  ]);
});

test('a preferred uninstalled variant is acquired and bound over the current binding', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const oldAsset = { ...INSTALLED_ASSET, modelAssetId: 'asset-old', contentId: 'sha256:old-content' } as NimiRuntimeModelAssetRecord;
  const state = baseState({
    assets: [oldAsset],
    installResult: { ...INSTALLED_ASSET, modelAssetId: 'asset-downloaded', contentId: 'sha256:downloaded-content' } as NimiRuntimeModelAssetRecord,
    recipes: [recipeWithOffers([
      offer('offer:old', { installedModelAssetId: 'asset-old' }),
      offer('offer:new'),
    ])],
  });
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);
  const created = await createRuntimeSetupCandidate(store, taskId, ports, {
    recipeId: 'image.recipe',
    axes: [{ slotId: 'main.diffusion', modelAssetId: 'asset-old', expectedContentId: 'sha256:old-content' }],
  });
  assert.equal(created.status, 'ok');
  store.updateTask(taskId, () => ({
    draft: { recipeId: 'image.recipe', route: 'local', preferredOffers: { 'main.diffusion': 'offer:new' } },
  }));
  const resolved = await resolveRuntimeSetupPreparation(store, taskId, ports);
  assert.equal(resolved.status, 'ok');
  const plan = resolved.status === 'ok' ? resolved.value : assert.fail('unreachable');
  assert.equal(plan.acquire.length, 1);
  assert.equal(plan.acquire[0]?.offer.offerRef, 'offer:new');
  assert.equal(plan.acquire[0]?.offer.installedModelAssetId, undefined);

  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-only', reviewedPlan: plan });
  assert.equal(result.status, 'ok');
  assert.deepEqual(
    calls.filter((entry) => entry.method === 'install.resolveOfferInstallPlan').map((entry) => entry.args),
    ['offer:new'],
  );
  assert.deepEqual(rebindPrepareArgs(calls)?.modelAxes, [
    { slotId: 'main.diffusion', modelAssetId: 'asset-downloaded', expectedContentId: 'sha256:downloaded-content' },
  ]);
});

test('a preferred offer equal to the current binding reuses it', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const oldAsset = { ...INSTALLED_ASSET, modelAssetId: 'asset-old', contentId: 'sha256:old-content' } as NimiRuntimeModelAssetRecord;
  const state = baseState({
    assets: [oldAsset],
    recipes: [recipeWithOffers([offer('offer:old', { installedModelAssetId: 'asset-old' })])],
  });
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);
  const created = await createRuntimeSetupCandidate(store, taskId, ports, {
    recipeId: 'image.recipe',
    axes: [{ slotId: 'main.diffusion', modelAssetId: 'asset-old', expectedContentId: 'sha256:old-content' }],
  });
  assert.equal(created.status, 'ok');
  store.updateTask(taskId, () => ({
    draft: { recipeId: 'image.recipe', route: 'local', preferredOffers: { 'main.diffusion': 'offer:old' } },
  }));
  const resolved = await resolveRuntimeSetupPreparation(store, taskId, ports);
  assert.equal(resolved.status, 'ok');
  const plan = resolved.status === 'ok' ? resolved.value : assert.fail('unreachable');
  assert.deepEqual(plan.reuse.map((item) => [item.slotId, item.modelAssetId]), [['main.diffusion', 'asset-old']]);
  assert.equal(plan.acquire.length, 0);
});

test('a superseding task during the dependency wait surfaces the lost claim', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState();
  state.envJobSequence = [[envJob('installing')], [envJob('ready_managed')]];
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);
  const plan = await reachReview(store, taskId, ports);
  state.onListJobs = () => {
    // A newer task takes over the capability's pending automatic use.
    const newer = store.createTask({
      capabilityContract: CAPABILITY,
      source: { kind: 'app', ownerAppId: 'app.chat', accountId: ACCOUNT },
    });
    store.claimCapabilityUse(newer.taskId, CAPABILITY);
  };

  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-and-use', reviewedPlan: plan });
  assert.equal(result.status, 'needs-attention');
  if (result.status === 'needs-attention') {
    assert.equal(result.failure.reasonCode, 'RUNTIME_SETUP_TASK_SUPERSEDED');
  }
  assert.equal(store.getTask(taskId)?.status, 'needs-attention');
  assert.equal(calls.some((entry) => entry.method === 'loadouts.select'), false);
});

function deferredSignal() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release: () => release() };
}

test('concurrent same-owner saves read serially and preserve both capability changes', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState();
  selectConfiguredModels(state);
  const basePorts = createPorts(state, calls);
  const owner = basePorts.aiConfigForSource({ kind: 'app', ownerAppId: 'app.chat', accountId: ACCOUNT })!;
  const entered = deferredSignal();
  const release = deferredSignal();
  let reads = 0;
  const ports: RuntimeSetupRunnerPorts = {
    ...basePorts,
    aiConfigForSource: () => ({
      ...owner,
      get: async () => {
        const snapshot = structuredClone(await owner.get());
        reads += 1;
        if (reads === 1) {
          entered.release();
          await release.promise;
        }
        return snapshot;
      },
    }),
  };
  const taskA = await createAppTask(store);
  const taskB = store.createTask({ capabilityContract: 'text.embed', source: store.getTask(taskA)!.source }).taskId;
  for (const taskId of [taskA, taskB]) {
    store.updateTask(taskId, (task) => ({ refs: { ...task.refs, aiConfigBaselineRevision: '7' } }));
  }
  const first = reuseRuntimeSetupCurrent(store, taskA, ports);
  await entered.promise;
  const second = reuseRuntimeSetupCurrent(store, taskB, ports);
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(reads, 1, 'the next save must not read while the prior read/write is pending');
  } finally {
    release.release();
  }
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map((result) => result.status), ['ok', 'ok']);
  assert.deepEqual(state.aiConfig.config?.capabilities.map((intent) => intent.capabilityContract).sort(), [CAPABILITY, 'text.embed', 'text.generate'].sort());
  assert.deepEqual(calls.filter((entry) => entry.method === 'aiConfig.overwrite').map((entry) => (entry.args as { expectedRevision: string }).expectedRevision), ['7', '8']);
});

test('stopping an owner save while it is queued prevents its read and write', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState();
  selectConfiguredModels(state);
  const basePorts = createPorts(state, calls);
  const owner = basePorts.aiConfigForSource({ kind: 'app', ownerAppId: 'app.chat', accountId: ACCOUNT })!;
  const entered = deferredSignal();
  const release = deferredSignal();
  const ports: RuntimeSetupRunnerPorts = {
    ...basePorts,
    aiConfigForSource: () => ({
      ...owner,
      get: async () => {
        const snapshot = await owner.get();
        entered.release();
        await release.promise;
        return snapshot;
      },
    }),
  };
  const taskA = await createAppTask(store);
  const taskB = store.createTask({ capabilityContract: 'text.embed', source: store.getTask(taskA)!.source }).taskId;
  const first = reuseRuntimeSetupCurrent(store, taskA, ports);
  await entered.promise;
  const second = reuseRuntimeSetupCurrent(store, taskB, ports);
  await new Promise<void>((resolve) => setImmediate(resolve));
  store.stopTask(taskB);
  release.release();
  assert.equal((await first).status, 'ok');
  assert.equal((await second).status, 'blocked');
  assert.equal(store.getTask(taskB)?.status, 'stopped');
  assert.equal(calls.filter((entry) => entry.method === 'aiConfig.get').length, 1);
  assert.equal(calls.filter((entry) => entry.method === 'aiConfig.overwrite').length, 1);
});

test('a fresh owner review after an external write saves without inheriting another task baseline', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState();
  selectConfiguredModels(state);
  const ports = createPorts(state, calls);
  const firstTask = await createAppTask(store);
  assert.equal((await reuseRuntimeSetupCurrent(store, firstTask, ports)).status, 'ok');
  state.aiConfig = { config: state.aiConfig.config, revision: '100' };
  const fresh = store.createTask({ capabilityContract: 'text.embed', source: store.getTask(firstTask)!.source });
  store.updateTask(fresh.taskId, (task) => ({ refs: { ...task.refs, aiConfigBaselineRevision: '100' } }));
  assert.equal((await reuseRuntimeSetupCurrent(store, fresh.taskId, ports)).status, 'ok');
  assert.equal(state.aiConfig.revision, '101');
  assert.deepEqual(state.aiConfig.config?.capabilities.map((intent) => intent.capabilityContract).sort(), [CAPABILITY, 'text.embed', 'text.generate'].sort());
});

test('Stop during post-commit environment resolution never dispatches Apply', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const state = baseState();
  const basePorts = createPorts(state, calls);
  const taskId = await createAppTask(store);
  let resolutions = 0;
  const ports: RuntimeSetupRunnerPorts = {
    ...basePorts,
    environment: {
      ...basePorts.environment,
      resolveEnvironmentPlan: async (input) => {
        const plan = await basePorts.environment.resolveEnvironmentPlan(input);
        resolutions += 1;
        if (resolutions === 3) store.stopTask(taskId);
        return plan;
      },
    },
  };
  const plan = await reachReview(store, taskId, ports);
  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-and-use', reviewedPlan: plan });
  assert.equal(result.status, 'blocked');
  assert.equal(store.getTask(taskId)?.status, 'stopped');
  assert.equal(calls.some((entry) => entry.method === 'environment.applyEnvironmentPlan'), false);
  assert.equal(calls.some((entry) => entry.method === 'loadouts.select'), false);
  assert.equal(calls.some((entry) => entry.method === 'aiConfig.overwrite'), false);
});

test('Stop during account lookup invalidates the pending write admission', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const basePorts = createPorts(baseState(), calls);
  const taskId = await createAppTask(store);
  const result = await reuseRuntimeSetupCurrent(store, taskId, {
    ...basePorts,
    account: { currentAccountId: async () => { store.stopTask(taskId); return ACCOUNT; } },
  });
  assert.equal(result.status, 'blocked');
  assert.equal(store.getTask(taskId)?.status, 'stopped');
  assert.deepEqual(calls, []);
});

test('a catalog multi-file profile keeps its complete template through acquisition and binding', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const bundle = { ...INSTALLED_ASSET, contentId: 'sha256:complete-bundle' };
  const state = baseState({ assets: [], installResult: bundle });
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);
  store.updateTask(taskId, () => ({ draft: { pendingAxes: [{
    slotId: 'main.diffusion', contentId: bundle.contentId,
    expectedHash: 'sha256:single-entry', templateId: 'complete-bundle-template',
    source: { repo: 'example/bundle', revision: 'fixed', file: 'model.safetensors' },
  }] } }));
  const plan = await reachReview(store, taskId, ports);
  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-only', reviewedPlan: plan });
  assert.equal(result.status, 'ok');
  assert.deepEqual(calls.filter((entry) => entry.method === 'install.resolveInstallPlan').map((entry) => entry.args), [{ templateId: 'complete-bundle-template' }]);
  assert.equal(calls.some((entry) => entry.method === 'install.resolveOfferInstallPlan'), false);
  const rebound = calls.find((entry) => entry.method === 'loadouts.prepare' && (entry.args as { loadoutId?: string }).loadoutId);
  assert.deepEqual((rebound?.args as { modelAxes: unknown }).modelAxes, [{ slotId: 'main.diffusion', modelAssetId: bundle.modelAssetId, expectedContentId: bundle.contentId }]);
});

test('an explicitly chosen optional-slot variant is acquired and replaces its old binding', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const optionalRecipe = recipe({
    slots: [{ ...recipe().slots[0]!, presence: 'optional-conditional', conditionalFeatures: ['input.image'] }],
  });
  const candidate = loadout({ loadoutId: 'optional-candidate', modelAxes: [{
    slotId: 'main.diffusion', modelAssetId: 'old-optional-asset', expectedContentId: 'sha256:old',
    presence: 'optional-conditional', resolution: 'configured', conditionalFeatures: ['input.image'],
    displayLabel: 'Optional input model', recipeCompatible: true, reasons: [],
  }] });
  const state = baseState({ recipes: [optionalRecipe], loadouts: [candidate] });
  const ports = createPorts(state, calls);
  const taskId = await createAppTask(store);
  store.updateTask(taskId, () => ({
    candidateLoadoutId: candidate.loadoutId, candidateRevisionBaseline: candidate.revision,
    draft: {
      preferredOffers: { 'main.diffusion': 'offer:main' },
      // An explicit replacement also outranks an older restored Profile intent.
      pendingAxes: [{ slotId: 'main.diffusion', contentId: 'sha256:old' }],
    },
  }));
  const reviewed = await resolveRuntimeSetupPreparation(store, taskId, ports);
  assert.equal(reviewed.status, 'ok');
  if (reviewed.status !== 'ok') return;
  assert.equal(reviewed.value.acquire[0]?.offer.offerRef, 'offer:main');
  assert.equal(reviewed.value.reuse.length, 0);
  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-only', reviewedPlan: reviewed.value });
  assert.equal(result.status, 'ok');
  const rebound = calls.find((entry) => entry.method === 'loadouts.prepare');
  assert.deepEqual((rebound?.args as { modelAxes: unknown }).modelAxes, [{ slotId: 'main.diffusion', modelAssetId: INSTALLED_ASSET.modelAssetId, expectedContentId: INSTALLED_ASSET.contentId }]);
});

test('a multi-capability owner save rechecks all participants after asynchronous admissions', async () => {
  const store = makeStore();
  const calls: CallLog = [];
  const basePorts = createPorts(baseState(), calls);
  const taskA = await createAppTask(store);
  const taskB = store.createTask({ capabilityContract: 'text.embed', source: store.getTask(taskA)!.source }).taskId;
  const owner = basePorts.aiConfigForSource(store.getTask(taskA)!.source)!;
  let snapshotRead = false;
  let checksAfterRead = 0;
  const ports: RuntimeSetupRunnerPorts = {
    ...basePorts,
    aiConfigForSource: () => ({
      ...owner,
      get: async () => { const snapshot = await owner.get(); snapshotRead = true; return snapshot; },
    }),
    account: {
      currentAccountId: async () => {
        if (snapshotRead && ++checksAfterRead === 2) store.stopTask(taskA);
        return ACCOUNT;
      },
    },
  };
  const result = await saveRuntimeSetupOwnerIntents(store, ports, {
    taskIds: [taskA, taskB],
    intents: [CAPABILITY, 'text.embed'].map((capabilityContract) => ({
      capabilityContract,
      intent: { capabilityContract, requiredFeatures: [], route: { oneofKind: 'local' as const, local: {} } },
    })),
  });
  assert.equal(result.status, 'blocked');
  assert.equal(store.getTask(taskA)?.status, 'stopped');
  assert.equal(calls.some((entry) => entry.method === 'aiConfig.overwrite'), false);
});

test('reuse keeps missing or unresolved models in setup without saving the app', async () => {
  for (const configured of ['missing', 'unresolved'] as const) {
    const store = makeStore();
    const calls: CallLog = [];
    const state = baseState();
    if (configured === 'unresolved') {
      state.loadouts = [loadout({ loadoutId: 'needs-preparation' })];
      state.selections = [{ capabilityContract: CAPABILITY, loadoutId: 'needs-preparation', effectiveDefaults: {} }];
    }
    const taskId = await createAppTask(store);
    const result = await reuseRuntimeSetupCurrent(store, taskId, createPorts(state, calls));
    assert.equal(result.status, 'needs-attention');
    assert.equal(store.getTask(taskId)?.status, 'draft');
    assert.equal(store.getTask(taskId)?.nextAction, 'choose-model');
    assert.equal(store.getTask(taskId)?.draft?.route, 'local');
    assert.deepEqual(calls.map((call) => call.method), ['loadouts.get']);
  }
});

for (const failurePoint of ['read', 'write', 'response-lost'] as const) {
  test(`partial completion after owner ${failurePoint} retries only the app save`, async () => {
    const store = makeStore();
    const calls: CallLog = [];
    const state = baseState();
    const basePorts = createPorts(state, calls);
    const taskId = await createAppTask(store);
    const owner = basePorts.aiConfigForSource(store.getTask(taskId)!.source)!;
    const plan = await reachReview(store, taskId, basePorts);
    let fail = true;
    const ports: RuntimeSetupRunnerPorts = {
      ...basePorts,
      aiConfigForSource: () => ({
        ...owner,
        get: async () => {
          if (fail && failurePoint === 'read' && calls.some((call) => call.method === 'loadouts.select')) throw new Error('owner read failed');
          return owner.get();
        },
        overwrite: async (input) => {
          if (fail && failurePoint === 'write') throw new Error('owner write failed');
          const result = await owner.overwrite(input);
          if (fail && failurePoint === 'response-lost') throw new Error('response lost after commit');
          return result;
        },
      }),
    };
    const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-and-use', reviewedPlan: plan });
    assert.equal(result.status, 'failed');
    assert.equal(store.getTask(taskId)?.failure?.machineSelected, true);
    assert.equal(store.getTask(taskId)?.failure?.ownerSaveState, failurePoint === 'read' ? 'not-saved' : 'unknown');
    assert.equal(calls.filter((call) => call.method === 'loadouts.select').length, 1);
    // The fake Select has accepted the prepared candidate, as Runtime does for
    // a configured model. Expose that current validation state to the retry.
    state.loadouts = state.loadouts.map((entry) => ({ ...entry, validationState: 'configured' }));
    const beforeRetry = calls.length;
    fail = false;
    assert.equal((await resumeRuntimeSetupOwnerRoute(store, taskId, ports)).status, 'ok');
    assert.equal(store.getTask(taskId)?.status, 'done');
    assert.equal(store.getTask(taskId)?.failure, undefined);
    const retriedCalls = calls.slice(beforeRetry).map((call) => call.method);
    assert.deepEqual(retriedCalls, failurePoint === 'response-lost'
      ? ['loadouts.get', 'aiConfig.get']
      : ['loadouts.get', 'aiConfig.get', 'aiConfig.overwrite']);
    assert.ok(state.aiConfig.config?.capabilities.some((entry) => entry.capabilityContract === 'text.generate'));
  });
}

for (const choice of ['recommended', 'manual', 'installed-recommendation'] as const) {
  test(`device recommendation marks the existing offer and permits ${choice} choice`, async () => {
    const store = makeStore();
    const calls: CallLog = [];
    const modelRecipe = recipe();
    const slot = modelRecipe.slots[0]!;
    const installed = choice === 'installed-recommendation';
    const state = baseState({ assets: installed ? [INSTALLED_ASSET] : [], recipes: [{ ...modelRecipe, slots: [{
      ...slot,
      offers: [
        { ...slot.offers[0]!, ...(installed ? { installedModelAssetId: 'other-asset' } : {}) },
        { ...slot.offers[0]!, candidate: { ...slot.offers[0]!.candidate, offerRef: 'offer:alternative', title: 'Recommended model' }, ...(installed ? { installedModelAssetId: INSTALLED_ASSET.modelAssetId } : {}) },
      ],
    }] }] });
    const basePorts = createPorts(state, calls);
    const ports: RuntimeSetupRunnerPorts = { ...basePorts, install: {
      ...basePorts.install,
      resolveOfferInstallPlan: async (ref) => ({
        ...await basePorts.install.resolveOfferInstallPlan(ref),
        templateId: ref === 'offer:alternative' ? 'variant:q8' : 'another-variant',
      }),
    } };
    const taskId = await createAppTask(store);
    const plan = await reachReview(store, taskId, ports);
    const options = plan.awaitingChoice[0]!.options;
    const recommended = options.find((option) => option.recommended)!;
    assert.equal(options.length, 2, 'recommendation must not duplicate an existing variant');
    assert.equal(recommended.offerRef, 'offer:alternative', 'recommendation is identified by Runtime, not array order');
    assert.equal(options[0]?.recommended, false);
    assert.equal(calls.some((call) => call.method === 'install.install'), false, 'review only resolves identity');
    const result = await runRuntimeSetupPreparation(store, taskId, ports, {
      mode: 'prepare-only', reviewedPlan: plan,
      choices: { 'main.diffusion': choice === 'manual' ? 'offer:main' : recommended.offerRef },
    });
    assert.equal(result.status, 'ok');
    if (installed) {
      assert.equal(recommended.installedModelAssetId, INSTALLED_ASSET.modelAssetId);
      assert.equal(calls.some((call) => call.method.startsWith('install.resolve') || call.method === 'install.install'), false);
    } else {
      assert.equal(calls.filter((call) => call.method === 'install.resolveOfferInstallPlan').at(-1)?.args, choice === 'manual' ? 'offer:main' : 'offer:alternative');
      assert.equal(calls.some((call) => call.method === 'install.resolveInstallPlan'), false);
    }
  });
}

test('shared environment preparation progress can reduce a later reviewed plan without another authorization', async () => {
    const store = makeStore();
    const calls: CallLog = [];
    const state = baseState();
  const ports = createPorts(state, calls);
    const taskId = await createAppTask(store);
    const plan = await reachReview(store, taskId, ports);
  state.plan = environmentPlan({
    planId: 'now-ready',
    dependencies: state.plan.dependencies.map((dependency) => ({ ...dependency, state: 'ready_managed' })),
  });
  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-only', reviewedPlan: plan });
    assert.equal(result.status, 'ok');
  assert.equal(
    calls.some((call) => call.method === 'environment.applyEnvironmentPlan'),
    false,
  );
});

test('a changed environment scope cannot be accepted as preparation progress', async () => {
    const store = makeStore();
    const calls: CallLog = [];
    const state = baseState();
  const ports = createPorts(state, calls);
    const taskId = await createAppTask(store);
    const plan = await reachReview(store, taskId, ports);
  state.plan = environmentPlan({
    planId: 'another-root',
    runtimeDataRoot: 'D:\\OtherRoot',
    dependencies: state.plan.dependencies.map((dependency) => ({ ...dependency, state: 'ready_managed' })),
  });
  const result = await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-only', reviewedPlan: plan });
    assert.equal(result.status, 'needs-attention');
  assert.equal(
    calls.some((call) => call.method === 'install.install'),
    false,
  );
});

for (const initiallyInstalled of [true, false]) {
  test(`Profile resource revalidation ${initiallyInstalled ? 'rejects a new download' : 'accepts newly reusable content'}`, async () => {
    const store = makeStore();
    const calls: CallLog = [];
    const state = baseState({ assets: initiallyInstalled ? [INSTALLED_ASSET] : [] });
    const ports = createPorts(state, calls);
    const taskId = await createAppTask(store);
    store.updateTask(taskId, () => ({ draft: { pendingAxes: [{
      slotId: 'main.diffusion',
      contentId: INSTALLED_ASSET.contentId,
      templateId: 'reviewed-template',
    }] } }));
    const plan = await reachReview(store, taskId, ports);
    assert.equal(Boolean(plan.acquire[0]?.offer.installedModelAssetId), initiallyInstalled);
    state.assets = initiallyInstalled ? [] : [INSTALLED_ASSET];
    calls.length = 0;
    const result = await runRuntimeSetupPreparation(store, taskId, ports, {
      mode: 'prepare-only', reviewedPlan: plan,
    });
    assert.equal(result.status, initiallyInstalled ? 'needs-attention' : 'ok');
    assert.equal(calls.some((call) => call.method === 'install.install'), false);
    if (initiallyInstalled) {
      assert.equal(calls.some((call) => call.method === 'loadouts.prepare'), false);
      assert.equal(calls.some((call) => call.method === 'environment.applyEnvironmentPlan'), false);
    }
  });
}

test('choosing a recipe binds its single installed offer without downloading it again', async () => {
    const store = makeStore();
    const calls: CallLog = [];
    const modelRecipe = recipe();
  const state = baseState({
    recipes: [
      {
        ...modelRecipe,
        slots: modelRecipe.slots.map((slot) => ({
          ...slot,
          offers: slot.offers.map((offer) => ({
            ...offer,
            installedModelAssetId: INSTALLED_ASSET.modelAssetId,
          })),
        })),
      },
    ],
  });
  const ports = createPorts(state, calls);
    const taskId = await createAppTask(store);
    const plan = await reachReview(store, taskId, ports);
  assert.equal(plan.reuse.length, 1);
  assert.equal(
    (await runRuntimeSetupPreparation(store, taskId, ports, { mode: 'prepare-only', reviewedPlan: plan }))
      .status,
    'ok',
  );
  const last = calls.filter((call) => call.method === 'loadouts.prepare').at(-1)!.args as {
    modelAxes: { modelAssetId: string }[];
  };
  assert.equal(last.modelAxes[0]!.modelAssetId, INSTALLED_ASSET.modelAssetId);
  assert.equal(
    calls.some((call) => call.method === 'install.install'),
    false,
  );
});
