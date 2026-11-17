import {
  createNimiRuntimeLocalEnvironmentClient,
  type NimiLoadoutRecipe,
  type NimiMachineLoadouts,
  type NimiRuntimeLocalEnvironmentPlan,
} from '@nimiplatform/sdk/runtime';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { createRendererFlowId, logRendererEvent } from '@nimiplatform/kit/telemetry';
import { useUnobservedRuntimeRead } from './use-unobserved-runtime-read.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { useRuntimeSetupTasks, type RuntimeSetupTask } from './runtime-setup-task-store.js';
import { RUNTIME_MODEL_LIBRARY_KEY } from './use-runtime-model-library.js';
import { LOADOUT_ENVIRONMENT_KEY, loadoutPreparationStatus, matchesLoadoutEnvironment } from './runtime-local-model-status.js';

export const CAPABILITY_INVENTORY_KEY = ['runtime', 'capability-inventory'] as const;
const CAPABILITY_PRESENTATION_ORDER = [
  'text.generate',
  'image.generate',
  'audio.synthesize',
  'audio.transcribe',
  'video.generate',
  'music.generate',
  'music.transcribe',
  'audio.voice.convert',
  'voice.create',
  'audio.separate',
  'text.annotate',
  'text.decide',
  'image.face_swap',
  'video.face_swap',
  'image.upscale',
  'video.upscale',
  'vision.locate',
  'text.embed',
];
export type CapabilityPreparationState = 'unset' | 'preparing' | 'ready' | 'attention' | 'unknown';
export type CapabilityInventory = {
  readonly aggregate: NimiMachineLoadouts;
  readonly recipes: readonly NimiLoadoutRecipe[];
  readonly environments: Readonly<Record<string, NimiRuntimeLocalEnvironmentPlan | undefined>>;
};

// @nimi-authority: rule.nimi.desktop.ai-consumption.capability-workspace
export function capabilityPreparationState(input: {
  readonly capability: string;
  readonly inventory: CapabilityInventory | undefined;
  readonly tasks: readonly RuntimeSetupTask[];
  readonly unavailable?: boolean;
}): { state: CapabilityPreparationState; task?: RuntimeSetupTask; replacement: boolean; reason?: CapabilityAttentionReason } {
  // Only a setup the person confirmed is in flight for the capability. A draft
  // or review they left without confirming is not surfaced on the rail, the
  // detail page or the quick start.
  const latest = [...input.tasks].reverse().find((item) => (
    item.capabilityContract === input.capability && item.status !== 'draft' && item.status !== 'review'
  ));
  const task =
    latest && !['done', 'stopped'].includes(latest.status) && !latest.supersededBy ? latest : undefined;
  if (!input.inventory || input.unavailable) return { state: 'unknown', task, replacement: false };
  const selectedId = input.inventory.aggregate.selections.find(
    (item) => item.capabilityContract === input.capability,
  )?.loadoutId;
  const selected = input.inventory.aggregate.loadouts.find((item) => item.loadoutId === selectedId);
  const environment = input.inventory.environments[input.capability];
  const configured = selected?.validationState === 'configured';
  const preparation = selected ? loadoutPreparationStatus({
    loadout: selected,
    check: environment ? { kind: 'checked', plan: environment } : { kind: 'failed' },
    tasks: input.tasks,
  }) : undefined;
  // A replacement is an unfinished task that has actually chosen a different
  // loadout. A draft that has not picked anything yet is not a replacement,
  // so the rail keeps showing the current model alone.
  const replacement = !!task?.candidateLoadoutId && task.candidateLoadoutId !== selectedId;
  if (preparation?.state === 'ready') return { state: 'ready', task, replacement };
  if (task?.status === 'preparing' || task?.status === 'committing')
    return { state: 'preparing', task, replacement: false };
  if (task?.status === 'failed' || task?.status === 'needs-attention')
    return { state: 'attention', task, replacement: false, reason: 'setup-task' };
  if (!selectedId) return { state: 'unset', task, replacement: false };
  if (!selected || preparation?.state === 'unknown') return { state: 'unknown', task, replacement: false };
  // Attention always says why: the hover and accessible label carry it.
  const reason: CapabilityAttentionReason = !configured
    ? 'configuration'
    : environment?.state === 'unsupported' ? 'unsupported' : 'environment';
  return { state: 'attention', task, replacement: false, reason };
}

export type CapabilityAttentionReason = 'setup-task' | 'configuration' | 'unsupported' | 'environment';

/** The persistent Downloads owner observes setup changes once for all screens. */
export function useRuntimeCapabilityInvalidation() {
  const queryClient = useQueryClient();
  const tasks = useRuntimeSetupTasks();
  const revision = tasks.tasks
    .map((task) => `${task.taskId}:${task.status}:${task.candidateRevisionBaseline ?? ''}`)
    .join('|');
  const previousRevision = useRef(revision);
  useEffect(() => {
    if (previousRevision.current === revision) return;
    previousRevision.current = revision;
    logRendererEvent({ area: 'runtime-capability-inventory', message: 'action:capability-inventory:invalidate',
      details: { cause: 'setup-revision', taskCount: tasks.tasks.length, atUnixMs: Date.now() } });
    void queryClient.invalidateQueries({ queryKey: CAPABILITY_INVENTORY_KEY });
    void queryClient.invalidateQueries({ queryKey: RUNTIME_MODEL_LIBRARY_KEY });
    void queryClient.invalidateQueries({ queryKey: LOADOUT_ENVIRONMENT_KEY });
  }, [queryClient, revision]);
}

function selectedPlanTargets(aggregate: NimiMachineLoadouts | undefined) {
  if (!aggregate) return [];
  const loadouts = new Map(aggregate.loadouts.map(item => [item.loadoutId, item]));
  return aggregate.selections.flatMap(selection => {
    const loadout = loadouts.get(selection.loadoutId);
    return loadout?.revision && loadout.capabilityContract === selection.capabilityContract
      ? [{ capabilityContract: loadout.capabilityContract, loadoutId: loadout.loadoutId, revision: loadout.revision }]
      : [];
  }).sort((left, right) => left.capabilityContract.localeCompare(right.capabilityContract));
}

export function useCapabilityInventory(options: { readonly enabled?: boolean; readonly includePreparation?: boolean } = {}) {
  const sdk = useDesktopRendererSdk();
  const queryClient = useQueryClient();
  const tasks = useRuntimeSetupTasks();
  const enabled = options.enabled !== false;
  const query = useQuery({
    queryKey: CAPABILITY_INVENTORY_KEY,
    enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }): Promise<Omit<CapabilityInventory, 'environments'>> => {
      const flowId = createRendererFlowId('capability-inventory');
      const startedAt = performance.now();
      const current = () => queryClient.getQueryCache().find({ queryKey: CAPABILITY_INVENTORY_KEY, exact: true });
      const initial = current()?.state;
      const log = (event: 'start' | 'base-ready' | 'abort' | 'settled', outcome?: string) => {
        logRendererEvent({ area: 'runtime-capability-inventory', message: `phase:capability-inventory:${event}`, flowId,
          costMs: Math.max(0, performance.now() - startedAt),
          details: { atUnixMs: Date.now(), hasData: initial?.data !== undefined,
            dataAgeMs: initial?.dataUpdatedAt ? Math.max(0, Date.now() - initial.dataUpdatedAt) : null,
            fetchFailureCount: initial?.fetchFailureCount ?? 0, stage: 'base',
            active: current()?.isActive() ?? false, observerCount: current()?.getObserversCount() ?? 0,
            ...(outcome ? { outcome } : {}),
          },
        });
      };
      const onAbort = () => log('abort');
      let successful = false;
      log('start');
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        signal.throwIfAborted();
        const loadouts = sdk.machineProduct().local.loadouts;
        const [aggregate, recipes] = await Promise.all([loadouts.get({ signal }), loadouts.listRecipes('', { signal })]);
        signal.throwIfAborted();
        successful = true;
        log('base-ready');
        return { aggregate, recipes };
      } finally {
        signal.removeEventListener('abort', onAbort);
        log('settled', signal.aborted ? 'aborted' : successful ? 'success' : 'failed');
      }
    },
  });
  useUnobservedRuntimeRead(CAPABILITY_INVENTORY_KEY, enabled, query.fetchStatus);
  const targets = useMemo(() => selectedPlanTargets(query.data?.aggregate), [query.data?.aggregate]);
  const plansKey = useMemo(() => [...CAPABILITY_INVENTORY_KEY, 'plans', targets] as const, [targets]);
  const includePreparation = enabled && options.includePreparation !== false && targets.length > 0;
  const observePlans = includePreparation && !query.isError && !query.isFetching;
  const plans = useQuery({
    queryKey: plansKey,
    enabled: observePlans,
    staleTime: 15_000,
    queryFn: async ({ signal }): Promise<CapabilityInventory['environments']> => {
      const client = createNimiRuntimeLocalEnvironmentClient({ local: () => sdk.localEnvironmentRpc(), callOptions: { signal } });
      const hostProfile = await client.collectDeviceProfile().catch(() => undefined);
      signal.throwIfAborted();
      const observations = hostProfile ? await Promise.allSettled(targets.map(async target => {
        const plan = await client.resolveEnvironmentPlan({
          capabilityContract: target.capabilityContract, candidateLoadoutId: target.loadoutId, hostProfile,
        });
        return matchesLoadoutEnvironment(plan, target) ? plan : undefined;
      })) : [];
      signal.throwIfAborted();
      return Object.fromEntries(targets.map(({ capabilityContract }, index) => {
        const plan = observations[index];
        return [capabilityContract, plan?.status === 'fulfilled' ? plan.value : undefined];
      }));
    },
  });
  useUnobservedRuntimeRead(plansKey, observePlans, plans.fetchStatus);
  const data = useMemo(() => query.data ? { ...query.data, environments: plans.data ?? {} } : undefined, [query.data, plans.data]);
  const refetch = useCallback(async (...args: Parameters<typeof query.refetch>) => {
    logRendererEvent({ area: 'runtime-capability-inventory', message: 'action:capability-inventory:explicit-refetch',
      details: { atUnixMs: Date.now() } });
    const base = await query.refetch(...args);
    // Changed targets start their own fresh query. Only repeat the plans this
    // render owns when the base read returned the same target/revision set.
    if (observePlans && !base.isError && JSON.stringify(targets) === JSON.stringify(selectedPlanTargets(base.data?.aggregate))) {
      await queryClient.invalidateQueries({ queryKey: plansKey, exact: true });
    }
    return base;
  }, [query.refetch, queryClient, plansKey, observePlans, targets]);
  const capabilities = useMemo(
    () => [...new Set([
      ...(query.data?.recipes.map(recipe => recipe.capabilityContract) ?? []),
      ...(query.data?.aggregate.loadouts.map(loadout => loadout.capabilityContract) ?? []),
    ])].sort((left, right) => {
      const rank = (id: string) => {
        const index = CAPABILITY_PRESENTATION_ORDER.indexOf(id);
        return index < 0 ? CAPABILITY_PRESENTATION_ORDER.length : index;
      };
      return rank(left) - rank(right) || left.localeCompare(right);
    }),
    [query.data],
  );
  return {
    ...query, data, refetch, capabilities, tasks: tasks.tasks,
    isFetching: query.isFetching || plans.isFetching,
    preparationPending: includePreparation && plans.isPending,
  };
}
