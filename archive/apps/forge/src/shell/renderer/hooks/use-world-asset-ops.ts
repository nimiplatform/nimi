import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import {
  batchUpsertWorldResourceBindings,
  listWorldResourceBindings,
} from '@renderer/data/world-data-client.js';
import {
  selectWorldAssetOpsCandidates,
  useWorldAssetOpsStore,
  type WorldAssetOpsCandidateRecord,
  type WorldAssetOpsFamily,
  type WorldAssetOpsLifecycle,
} from '@renderer/state/world-asset-ops-store.js';
import {
  WORLD_DELIVERABLE_REGISTRY,
  type WorldDeliverableBindingPoint,
} from '@renderer/features/asset-ops/deliverable-registry.js';

export type {
  WorldAssetOpsCandidateRecord,
  WorldAssetOpsFamily,
  WorldAssetOpsLifecycle,
} from '@renderer/state/world-asset-ops-store.js';

type WorldResourceBindingsPayload = Awaited<ReturnType<typeof listWorldResourceBindings>>;
type WorldAssetFamilyCompletenessState = 'MISSING' | 'CONFIRMED' | 'BOUND';
type BindingRecord = {
  id: string | null;
  hostId: string | null;
  hostType: string | null;
  bindingPoint: string | null;
  bindingKind: string | null;
  objectId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  priority: number | null;
};

export type WorldAssetOpsCandidateView = Omit<WorldAssetOpsCandidateRecord, 'lifecycle' | 'origin'> & {
  localLifecycle: WorldAssetOpsLifecycle | null;
  effectiveLifecycle: WorldAssetOpsLifecycle;
  origin: WorldAssetOpsCandidateRecord['origin'] | 'binding';
  isSynthetic: boolean;
  isBound: boolean;
  bindingPoint: WorldDeliverableBindingPoint;
};

export type WorldAssetOpsLifecycleCounts = Record<WorldAssetOpsLifecycle, number>;

export type WorldAssetOpsFamilyState = {
  family: WorldAssetOpsFamily;
  label: string;
  bindingPoint: WorldDeliverableBindingPoint;
  completenessState: WorldAssetFamilyCompletenessState;
  currentBoundItem: WorldAssetOpsCandidateView | null;
  confirmedItem: WorldAssetOpsCandidateView | null;
  activeItem: WorldAssetOpsCandidateView | null;
  candidateList: WorldAssetOpsCandidateView[];
  counts: WorldAssetOpsLifecycleCounts;
};

export type WorldAssetOpsHubSummary = {
  worldId: string;
  familySummaries: WorldAssetOpsFamilyState[];
  familiesById: Record<WorldAssetOpsFamily, WorldAssetOpsFamilyState>;
  completeFamilyCount: number;
  boundFamilyCount: number;
};

const FAMILY_CONFIG = WORLD_DELIVERABLE_REGISTRY.reduce<Record<WorldAssetOpsFamily, {
  label: string;
  bindingPoint: WorldDeliverableBindingPoint;
}>>((acc, entry) => {
  acc[entry.family] = {
    label: `World ${entry.label}`,
    bindingPoint: entry.bindingPoint,
  };
  return acc;
}, {} as Record<WorldAssetOpsFamily, {
  label: string;
  bindingPoint: WorldDeliverableBindingPoint;
}>);

const LIFECYCLE_SORT_ORDER: Record<WorldAssetOpsLifecycle, number> = {
  bound: 0,
  confirmed: 1,
  approved: 2,
  candidate: 3,
  generated: 4,
  rejected: 5,
  superseded: 6,
};

const EMPTY_COUNTS: WorldAssetOpsLifecycleCounts = {
  generated: 0,
  candidate: 0,
  approved: 0,
  rejected: 0,
  confirmed: 0,
  bound: 0,
  superseded: 0,
};

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function toNumberOrNull(value: unknown): number | null {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function toObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toBindingRecordList(payload: WorldResourceBindingsPayload | undefined): BindingRecord[] {
  const root = toObjectRecord(payload);
  const items = Array.isArray(root?.items) ? root.items : [];
  return items
    .map((entry) => {
      const item = toObjectRecord(entry);
      if (!item) {
        return null;
      }
      return {
        id: toStringOrNull(item.id),
        hostId: toStringOrNull(item.hostId),
        hostType: toStringOrNull(item.hostType),
        bindingPoint: toStringOrNull(item.bindingPoint),
        bindingKind: toStringOrNull(item.bindingKind),
        objectId: toStringOrNull(item.objectId),
        createdAt: toStringOrNull(item.createdAt),
        updatedAt: toStringOrNull(item.updatedAt),
        priority: toNumberOrNull(item.priority),
      } satisfies BindingRecord;
    })
    .filter((item): item is BindingRecord => item !== null);
}

function compareBindingPriority(left: BindingRecord, right: BindingRecord): number {
  const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;
  return leftPriority - rightPriority
    || (right.updatedAt || '').localeCompare(left.updatedAt || '')
    || (right.createdAt || '').localeCompare(left.createdAt || '')
    || (right.id || '').localeCompare(left.id || '');
}

function findCurrentBinding(
  bindings: BindingRecord[],
  input: {
    worldId: string;
    bindingPoint: WorldDeliverableBindingPoint;
  },
): BindingRecord | null {
  return bindings
    .filter((item) =>
      item.hostId === input.worldId
      && item.hostType === 'WORLD'
      && item.bindingKind === 'PRESENTATION'
      && item.bindingPoint === input.bindingPoint,
    )
    .sort(compareBindingPriority)[0] ?? null;
}

function toEffectiveLifecycle(
  localLifecycle: WorldAssetOpsLifecycle,
  boundResourceId: string | null,
  resourceId: string,
): WorldAssetOpsLifecycle {
  if (boundResourceId && resourceId === boundResourceId) {
    return 'bound';
  }
  if (localLifecycle === 'bound') {
    return boundResourceId ? 'superseded' : 'confirmed';
  }
  if (boundResourceId && localLifecycle === 'confirmed') {
    return 'superseded';
  }
  return localLifecycle;
}

function compareCandidateViews(left: WorldAssetOpsCandidateView, right: WorldAssetOpsCandidateView): number {
  return LIFECYCLE_SORT_ORDER[left.effectiveLifecycle] - LIFECYCLE_SORT_ORDER[right.effectiveLifecycle]
    || (right.updatedAt || '').localeCompare(left.updatedAt || '')
    || right.id.localeCompare(left.id);
}

function buildFamilyState(
  worldId: string,
  family: WorldAssetOpsFamily,
  localCandidates: WorldAssetOpsCandidateRecord[],
  bindings: BindingRecord[],
): WorldAssetOpsFamilyState {
  const config = FAMILY_CONFIG[family];
  const binding = findCurrentBinding(bindings, {
    worldId,
    bindingPoint: config.bindingPoint,
  });
  const boundResourceId = binding?.objectId ?? null;
  const familyCandidates: WorldAssetOpsCandidateView[] = localCandidates
    .filter((candidate) => candidate.family === family)
    .map((candidate) => ({
      ...candidate,
      localLifecycle: candidate.lifecycle,
      effectiveLifecycle: toEffectiveLifecycle(candidate.lifecycle, boundResourceId, candidate.resourceId),
      origin: candidate.origin,
      isSynthetic: false,
      isBound: boundResourceId === candidate.resourceId,
      bindingPoint: config.bindingPoint,
    } satisfies WorldAssetOpsCandidateView));

  if (boundResourceId && !familyCandidates.some((candidate) => candidate.resourceId === boundResourceId)) {
    familyCandidates.unshift({
      id: `bound:${family}:${boundResourceId}`,
      worldId,
      family,
      resourceId: boundResourceId,
      localLifecycle: null,
      effectiveLifecycle: 'bound',
      previewUrl: null,
      mimeType: null,
      width: null,
      height: null,
      origin: 'binding',
      createdAt: binding?.createdAt ?? '',
      updatedAt: binding?.updatedAt ?? binding?.createdAt ?? '',
      isSynthetic: true,
      isBound: true,
      bindingPoint: config.bindingPoint,
    });
  }

  const candidateList = [...familyCandidates].sort(compareCandidateViews);
  const counts = candidateList.reduce<WorldAssetOpsLifecycleCounts>((acc, candidate) => {
    acc[candidate.effectiveLifecycle] += 1;
    return acc;
  }, { ...EMPTY_COUNTS });
  const currentBoundItem = candidateList.find((candidate) => candidate.effectiveLifecycle === 'bound') ?? null;
  const confirmedItem = candidateList.find((candidate) => candidate.effectiveLifecycle === 'confirmed') ?? null;
  const completenessState: WorldAssetFamilyCompletenessState = currentBoundItem
    ? 'BOUND'
    : confirmedItem
      ? 'CONFIRMED'
      : 'MISSING';

  return {
    family,
    label: config.label,
    bindingPoint: config.bindingPoint,
    completenessState,
    currentBoundItem,
    confirmedItem,
    activeItem: currentBoundItem ?? confirmedItem,
    candidateList,
    counts,
  };
}

export function useWorldAssetOps(worldId: string) {
  const queryClient = useQueryClient();
  const userId = useAppStore((state) => state.auth?.user?.id ?? '');
  const profiles = useWorldAssetOpsStore((state) => state.profiles);
  const addCandidate = useWorldAssetOpsStore((state) => state.enqueueCandidate);
  const moveCandidateToReview = useWorldAssetOpsStore((state) => state.moveCandidateToReview);
  const approve = useWorldAssetOpsStore((state) => state.approveCandidate);
  const reject = useWorldAssetOpsStore((state) => state.rejectCandidate);
  const confirm = useWorldAssetOpsStore((state) => state.confirmCandidate);
  const markBound = useWorldAssetOpsStore((state) => state.markBound);

  const localCandidates = useMemo(
    () => selectWorldAssetOpsCandidates(profiles, { userId, worldId }),
    [profiles, userId, worldId],
  );

  const bindingsQuery = useQuery({
    queryKey: ['forge', 'world', 'resource-bindings', worldId],
    enabled: Boolean(worldId),
    retry: false,
    queryFn: async () => await listWorldResourceBindings(worldId),
  });

  const familySummaries = useMemo(() => {
    const bindings = toBindingRecordList(bindingsQuery.data);
    return (Object.keys(FAMILY_CONFIG) as WorldAssetOpsFamily[]).map((family) =>
      buildFamilyState(worldId, family, localCandidates, bindings),
    );
  }, [bindingsQuery.data, localCandidates, worldId]);

  const familiesById = useMemo(
    () => familySummaries.reduce<Record<WorldAssetOpsFamily, WorldAssetOpsFamilyState>>((acc, family) => {
      acc[family.family] = family;
      return acc;
    }, {} as Record<WorldAssetOpsFamily, WorldAssetOpsFamilyState>),
    [familySummaries],
  );

  const summary = useMemo<WorldAssetOpsHubSummary>(() => ({
    worldId,
    familySummaries,
    familiesById,
    completeFamilyCount: familySummaries.filter((family) => family.completenessState !== 'MISSING').length,
    boundFamilyCount: familySummaries.filter((family) => family.completenessState === 'BOUND').length,
  }), [familiesById, familySummaries, worldId]);

  const bindConfirmedMutation = useMutation({
    mutationFn: async (input: { family: WorldAssetOpsFamily; candidateId?: string }) => {
      const family = familiesById[input.family];
      const target = input.candidateId
        ? family.candidateList.find((candidate) => candidate.id === input.candidateId)
        : family.confirmedItem;
      if (!target) {
        throw new Error('FORGE_WORLD_ASSET_OPS_CONFIRMED_CANDIDATE_REQUIRED');
      }
      if (target.effectiveLifecycle !== 'confirmed' && target.effectiveLifecycle !== 'bound') {
        throw new Error('FORGE_WORLD_ASSET_OPS_BIND_REQUIRES_CONFIRMED');
      }
      await batchUpsertWorldResourceBindings(worldId, {
        bindingUpserts: [{
          objectType: 'RESOURCE',
          objectId: target.resourceId,
          hostType: 'WORLD',
          hostId: worldId,
          bindingKind: 'PRESENTATION',
          bindingPoint: family.bindingPoint,
          priority: 0,
        }],
      });
      return {
        family: input.family,
        candidateId: target.id,
        resourceId: target.resourceId,
      };
    },
    onSuccess: async (result) => {
      markBound({
        userId,
        worldId,
        family: result.family,
        candidateId: result.candidateId,
        resourceId: result.resourceId,
      });
      await queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'resource-bindings', worldId] });
      await queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'detail', worldId] });
      await queryClient.invalidateQueries({ queryKey: ['forge', 'world'] });
    },
  });

  const addFromLibrary = useCallback((input: {
    family: WorldAssetOpsFamily;
    resourceId: string;
    previewUrl?: string | null;
    mimeType?: string | null;
    width?: number | null;
    height?: number | null;
  }) => addCandidate({
    userId,
    worldId,
    family: input.family,
    resourceId: input.resourceId,
    previewUrl: input.previewUrl,
    mimeType: input.mimeType,
    width: input.width,
    height: input.height,
    origin: 'library',
    lifecycle: 'candidate',
  }), [addCandidate, userId, worldId]);

  const reviewGeneratedCandidate = useCallback((candidateId: string) => {
    return moveCandidateToReview({ userId, candidateId });
  }, [moveCandidateToReview, userId]);

  const approveCandidate = useCallback((candidateId: string) => {
    return approve({ userId, candidateId });
  }, [approve, userId]);

  const rejectCandidate = useCallback((candidateId: string) => {
    return reject({ userId, candidateId });
  }, [reject, userId]);

  const confirmCandidate = useCallback((candidateId: string) => {
    return confirm({ userId, candidateId });
  }, [confirm, userId]);

  const bindConfirmed = useCallback(async (input: { family: WorldAssetOpsFamily; candidateId?: string }) => {
    return await bindConfirmedMutation.mutateAsync(input);
  }, [bindConfirmedMutation]);

  const getFamilyState = useCallback((family: WorldAssetOpsFamily) => familiesById[family], [familiesById]);

  return {
    userId,
    worldId,
    bindingsQuery,
    summary,
    familySummaries,
    familiesById,
    getFamilyState,
    addFromLibrary,
    reviewGeneratedCandidate,
    approveCandidate,
    rejectCandidate,
    confirmCandidate,
    bindConfirmed,
    bindConfirmedMutation,
  };
}
