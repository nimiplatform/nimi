import {
  isNimiRuntimeLocalEnvironmentDependencyReadyState,
  type NimiLoadoutRecipe,
  type NimiMachineLoadouts,
  type NimiRuntimeLocalEnvironmentPlan,
} from '@nimiplatform/sdk/runtime';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
import { useRuntimeSetupTasks, type RuntimeSetupTask } from './runtime-setup-task-store.js';
import { RUNTIME_MODEL_LIBRARY_KEY } from './use-runtime-model-library.js';

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
  'image.face_swap',
  'video.face_swap',
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
}): { state: CapabilityPreparationState; task?: RuntimeSetupTask; replacement: boolean } {
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
  const ready =
    configured &&
    environment &&
    environment.state !== 'unsupported' &&
    environment.dependencies.every(
      (item) => !item.required || isNimiRuntimeLocalEnvironmentDependencyReadyState(item.state),
    );
  // A replacement is an unfinished task that has actually chosen a different
  // loadout. A draft that has not picked anything yet is not a replacement,
  // so the rail keeps showing the current model alone.
  const replacement = !!task?.candidateLoadoutId && task.candidateLoadoutId !== selectedId;
  if (ready) return { state: 'ready', task, replacement };
  if (task?.status === 'preparing' || task?.status === 'committing')
    return { state: 'preparing', task, replacement: false };
  if (task?.status === 'failed' || task?.status === 'needs-attention')
    return { state: 'attention', task, replacement: false };
  if (!selectedId) return { state: 'unset', task, replacement: false };
  if (configured && !environment) return { state: 'unknown', task, replacement: false };
  return { state: 'attention', task, replacement: false };
}

export function useCapabilityInventory() {
  const sdk = useDesktopRendererSdk();
  const environment = useRuntimeConfigLocalEnvironmentClient();
  const queryClient = useQueryClient();
  const tasks = useRuntimeSetupTasks();
  const revision = tasks.tasks
    .map((task) => `${task.taskId}:${task.status}:${task.candidateRevisionBaseline ?? ''}`)
    .join('|');
  const query = useQuery({
    queryKey: CAPABILITY_INVENTORY_KEY,
    queryFn: async (): Promise<CapabilityInventory> => {
      const loadouts = sdk.machineProduct().local.loadouts;
      const [aggregate, recipes] = await Promise.all([loadouts.get(), loadouts.listRecipes()]);
      const capabilities = [...new Set(aggregate.selections.map((item) => item.capabilityContract))];
      const plans = await Promise.allSettled(
        capabilities.map((capabilityContract) => environment.resolveEnvironmentPlan({ capabilityContract })),
      );
      return {
        aggregate,
        recipes,
        environments: Object.fromEntries(
          capabilities.map((capability, index) => {
            const plan = plans[index]!;
            return [capability, plan.status === 'fulfilled' ? plan.value : undefined];
          }),
        ),
      };
    },
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: CAPABILITY_INVENTORY_KEY });
    void queryClient.invalidateQueries({ queryKey: RUNTIME_MODEL_LIBRARY_KEY });
  }, [queryClient, revision]);
  const capabilities = useMemo(
    () =>
      [
        ...new Set([
          ...(query.data?.recipes.map((recipe) => recipe.capabilityContract) ?? []),
          ...(query.data?.aggregate.loadouts.map((loadout) => loadout.capabilityContract) ?? []),
        ]),
      ].sort((left, right) => {
        const rank = (id: string) => {
          const index = CAPABILITY_PRESENTATION_ORDER.indexOf(id);
          return index < 0 ? CAPABILITY_PRESENTATION_ORDER.length : index;
        };
        return rank(left) - rank(right) || left.localeCompare(right);
      }),
    [query.data],
  );
  return { ...query, capabilities, tasks: tasks.tasks };
}
