import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { CAPABILITY_MAP, useAiConfigStore } from '@renderer/state/ai-config-store.js';
import {
  getAgent,
  updateAgent,
  type ForgeAgentDetailResponse,
} from '@renderer/data/agent-data-client.js';
import {
  designCustomVoiceAsset,
  generateAgentCopyCompletion,
  listDesignedVoiceAssets,
  synthesizeVoiceDemo,
  type DesignedVoiceAsset,
} from '@renderer/data/enrichment-client.js';
import {
  batchUpsertWorldResourceBindings,
  listWorldResourceBindings,
} from '@renderer/data/world-data-client.js';
import {
  selectAgentAssetOpsCandidates,
  useAgentAssetOpsStore,
  type AgentAssetOpsCandidateKind,
  type AgentAssetOpsCandidateOrigin,
  type AgentAssetOpsCandidateRecord,
  type AgentAssetOpsFamily,
  type AgentAssetOpsLifecycle,
} from '@renderer/state/agent-asset-ops-store.js';
export type {
  AgentAssetOpsCandidateKind,
  AgentAssetOpsCandidateOrigin,
  AgentAssetOpsCandidateRecord,
  AgentAssetOpsFamily,
  AgentAssetOpsLifecycle,
} from '@renderer/state/agent-asset-ops-store.js';
type AgentDetailPayload = Awaited<ReturnType<typeof getAgent>>;
type WorldResourceBindingsPayload = Awaited<ReturnType<typeof listWorldResourceBindings>>;
type AgentAssetBindingPoint = 'AGENT_PORTRAIT' | 'AGENT_VOICE_SAMPLE' | 'AGENT_AVATAR' | 'AGENT_GREETING_PRIMARY';
type AgentAssetFamilyCompletenessState = 'MISSING' | 'CONFIRMED' | 'BOUND';
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
export type AgentAssetOpsCandidateView = Omit<AgentAssetOpsCandidateRecord, 'lifecycle' | 'origin'> & {
  localLifecycle: AgentAssetOpsLifecycle | null;
  effectiveLifecycle: AgentAssetOpsLifecycle;
  origin: AgentAssetOpsCandidateRecord['origin'] | 'binding';
  isSynthetic: boolean;
  isBound: boolean;
  bindingPoint: AgentAssetBindingPoint;
};
export type AgentAssetOpsLifecycleCounts = Record<AgentAssetOpsLifecycle, number>;
export type AgentAssetOpsFamilyState = {
  family: AgentAssetOpsFamily;
  label: string;
  kind: AgentAssetOpsCandidateKind;
  bindingPoint: AgentAssetBindingPoint;
  completenessState: AgentAssetFamilyCompletenessState;
  currentBoundItem: AgentAssetOpsCandidateView | null;
  confirmedItem: AgentAssetOpsCandidateView | null;
  activeItem: AgentAssetOpsCandidateView | null;
  candidateList: AgentAssetOpsCandidateView[];
  counts: AgentAssetOpsLifecycleCounts;
  bindSupport: {
    supported: boolean;
    reason: string | null;
  };
};
export type AgentAssetOpsHubSummary = {
  agentId: string;
  familySummaries: AgentAssetOpsFamilyState[];
  familiesById: Record<AgentAssetOpsFamily, AgentAssetOpsFamilyState>;
  completeFamilyCount: number;
  boundFamilyCount: number;
};
type UseAgentAssetOpsOptions = {
  worldName?: string;
  worldDescription?: string;
};
type AgentCustomVoiceSupport = {
  supported: boolean;
  reason: string | null;
};
type DirectFieldAdoptableFamily = 'agent-avatar' | 'agent-greeting-primary';
const FAMILY_CONFIG: Record<
  AgentAssetOpsFamily,
  {
    label: string;
    kind: AgentAssetOpsCandidateKind;
    bindingPoint: AgentAssetBindingPoint;
  }
> = {
  'agent-avatar': {
    label: 'Agent Avatar',
    kind: 'resource',
    bindingPoint: 'AGENT_AVATAR',
  },
  'agent-cover': {
    label: 'Agent Cover',
    kind: 'resource',
    bindingPoint: 'AGENT_PORTRAIT',
  },
  'agent-greeting-primary': {
    label: 'Primary Greeting',
    kind: 'text',
    bindingPoint: 'AGENT_GREETING_PRIMARY',
  },
  'agent-voice-demo': {
    label: 'Voice Demo',
    kind: 'resource',
    bindingPoint: 'AGENT_VOICE_SAMPLE',
  },
};
const LIFECYCLE_SORT_ORDER: Record<AgentAssetOpsLifecycle, number> = {
  bound: 0,
  confirmed: 1,
  approved: 2,
  candidate: 3,
  generated: 4,
  rejected: 5,
  superseded: 6,
};
const EMPTY_COUNTS: AgentAssetOpsLifecycleCounts = {
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
function findBinding(
  bindings: BindingRecord[],
  input: {
    agentId: string;
    bindingPoint: 'AGENT_PORTRAIT' | 'AGENT_VOICE_SAMPLE';
  },
): BindingRecord | null {
  return bindings
    .filter((item) =>
      item.hostId === input.agentId
      && item.hostType === 'AGENT'
      && item.bindingKind === 'PRESENTATION'
      && item.bindingPoint === input.bindingPoint,
    )
    .sort(compareBindingPriority)[0] ?? null;
}
function resolveBindSupport(
  family: AgentAssetOpsFamily,
  agent: AgentDetailPayload | undefined,
): {
  supported: boolean;
  reason: string | null;
} {
  if (!agent) {
    return { supported: false, reason: 'Agent detail is unavailable.' };
  }
  switch (family) {
    case 'agent-avatar':
      return { supported: true, reason: null };
    case 'agent-greeting-primary':
      return { supported: true, reason: null };
    case 'agent-cover':
      return agent.worldId
        ? { supported: true, reason: null }
        : { supported: false, reason: 'Agent cover bind requires a world-owned agent.' };
    case 'agent-voice-demo':
      return agent.worldId
        ? { supported: true, reason: null }
        : { supported: false, reason: 'Voice demo bind requires a world-owned agent.' };
  }
}
function toDirectFieldEffectiveLifecycle(
  localLifecycle: AgentAssetOpsLifecycle,
  currentValue: string | null,
  candidateValue: string | null,
): AgentAssetOpsLifecycle {
  if (localLifecycle === 'bound') {
    return currentValue && candidateValue && currentValue === candidateValue ? 'bound' : currentValue ? 'superseded' : 'confirmed';
  }
  if (currentValue && localLifecycle === 'confirmed') {
    return candidateValue && currentValue === candidateValue ? 'confirmed' : 'superseded';
  }
  return localLifecycle;
}
function toBindingEffectiveLifecycle(
  localLifecycle: AgentAssetOpsLifecycle,
  boundResourceId: string | null,
  resourceId: string | null,
): AgentAssetOpsLifecycle {
  if (boundResourceId && resourceId && boundResourceId === resourceId) {
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
function compareCandidateViews(left: AgentAssetOpsCandidateView, right: AgentAssetOpsCandidateView): number {
  return LIFECYCLE_SORT_ORDER[left.effectiveLifecycle] - LIFECYCLE_SORT_ORDER[right.effectiveLifecycle]
    || (right.updatedAt || '').localeCompare(left.updatedAt || '')
    || right.id.localeCompare(left.id);
}
function buildFamilyState(
  family: AgentAssetOpsFamily,
  agent: AgentDetailPayload | undefined,
  localCandidates: AgentAssetOpsCandidateRecord[],
  bindings: BindingRecord[],
): AgentAssetOpsFamilyState {
  const config = FAMILY_CONFIG[family];
  const bindSupport = resolveBindSupport(family, agent);
  const currentAvatar = family === 'agent-avatar' ? toStringOrNull(agent?.avatarUrl) : null;
  const currentGreeting = family === 'agent-greeting-primary' ? toStringOrNull(agent?.greeting) : null;
  const currentBinding = family === 'agent-cover' || family === 'agent-voice-demo'
    ? findBinding(bindings, {
        agentId: agent?.id ?? '',
        bindingPoint: config.bindingPoint as 'AGENT_PORTRAIT' | 'AGENT_VOICE_SAMPLE',
      })
    : null;
  const boundResourceId = currentBinding?.objectId ?? null;
  const familyCandidates: AgentAssetOpsCandidateView[] = localCandidates
    .filter((candidate) => candidate.family === family)
    .map((candidate) => ({
      ...candidate,
      localLifecycle: candidate.lifecycle,
      effectiveLifecycle:
        family === 'agent-avatar'
          ? toDirectFieldEffectiveLifecycle(candidate.lifecycle, currentAvatar, candidate.previewUrl)
          : family === 'agent-greeting-primary'
            ? toDirectFieldEffectiveLifecycle(candidate.lifecycle, currentGreeting, candidate.text)
            : toBindingEffectiveLifecycle(candidate.lifecycle, boundResourceId, candidate.resourceId),
      origin: candidate.origin,
      isSynthetic: false,
      isBound:
        family === 'agent-avatar'
          ? Boolean(currentAvatar && candidate.previewUrl && currentAvatar === candidate.previewUrl)
          : family === 'agent-greeting-primary'
            ? Boolean(currentGreeting && candidate.text && currentGreeting === candidate.text)
            : Boolean(boundResourceId && candidate.resourceId && boundResourceId === candidate.resourceId),
      bindingPoint: config.bindingPoint,
    }));
  if (family === 'agent-avatar' && currentAvatar && !familyCandidates.some((candidate) => candidate.previewUrl === currentAvatar)) {
    familyCandidates.unshift({
      id: `bound:${family}:${currentAvatar}`,
      agentId: agent?.id ?? '',
      family,
      kind: 'resource',
      resourceId: null,
      text: null,
      previewUrl: currentAvatar,
      mimeType: null,
      width: null,
      height: null,
      localLifecycle: null,
      effectiveLifecycle: 'bound',
      origin: 'binding',
      createdAt: agent?.updatedAt ?? '',
      updatedAt: agent?.updatedAt ?? '',
      isSynthetic: true,
      isBound: true,
      bindingPoint: config.bindingPoint,
    });
  }
  if (family === 'agent-greeting-primary' && currentGreeting && !familyCandidates.some((candidate) => candidate.text === currentGreeting)) {
    familyCandidates.unshift({
      id: `bound:${family}:${currentGreeting}`,
      agentId: agent?.id ?? '',
      family,
      kind: 'text',
      resourceId: null,
      text: currentGreeting,
      previewUrl: null,
      mimeType: null,
      width: null,
      height: null,
      localLifecycle: null,
      effectiveLifecycle: 'bound',
      origin: 'binding',
      createdAt: agent?.updatedAt ?? '',
      updatedAt: agent?.updatedAt ?? '',
      isSynthetic: true,
      isBound: true,
      bindingPoint: config.bindingPoint,
    });
  }
  if ((family === 'agent-cover' || family === 'agent-voice-demo') && boundResourceId && !familyCandidates.some((candidate) => candidate.resourceId === boundResourceId)) {
    familyCandidates.unshift({
      id: `bound:${family}:${boundResourceId}`,
      agentId: agent?.id ?? '',
      family,
      kind: 'resource',
      resourceId: boundResourceId,
      text: null,
      previewUrl: null,
      mimeType: null,
      width: null,
      height: null,
      localLifecycle: null,
      effectiveLifecycle: 'bound',
      origin: 'binding',
      createdAt: currentBinding?.createdAt ?? '',
      updatedAt: currentBinding?.updatedAt ?? currentBinding?.createdAt ?? '',
      isSynthetic: true,
      isBound: true,
      bindingPoint: config.bindingPoint,
    });
  }
  const candidateList = [...familyCandidates].sort(compareCandidateViews);
  const counts = candidateList.reduce<AgentAssetOpsLifecycleCounts>((acc, candidate) => {
    acc[candidate.effectiveLifecycle] += 1;
    return acc;
  }, { ...EMPTY_COUNTS });
  const currentBoundItem = candidateList.find((candidate) => candidate.effectiveLifecycle === 'bound') ?? null;
  const confirmedItem = candidateList.find((candidate) => candidate.effectiveLifecycle === 'confirmed') ?? null;
  const completenessState: AgentAssetFamilyCompletenessState = currentBoundItem
    ? 'BOUND'
    : confirmedItem
      ? 'CONFIRMED'
      : 'MISSING';
  return {
    family,
    label: config.label,
    kind: config.kind,
    bindingPoint: config.bindingPoint,
    completenessState,
    currentBoundItem,
    confirmedItem,
    activeItem: currentBoundItem ?? confirmedItem,
    candidateList,
    counts,
    bindSupport,
  };
}
export function useAgentAssetOps(agentId: string, options: UseAgentAssetOpsOptions = {}) {
  const queryClient = useQueryClient();
  const userId = useAppStore((state) => state.auth?.user?.id ?? '');
  const customVoiceBinding = useAiConfigStore((state) =>
    state.aiConfig.capabilities.selectedBindings['voice_workflow.tts_t2v'],
  );
  const ttsBinding = useAiConfigStore((state) =>
    state.aiConfig.capabilities.selectedBindings[CAPABILITY_MAP.tts],
  );
  const profiles = useAgentAssetOpsStore((state) => state.profiles);
  const addCandidate = useAgentAssetOpsStore((state) => state.enqueueCandidate);
  const moveCandidateToReview = useAgentAssetOpsStore((state) => state.moveCandidateToReview);
  const approve = useAgentAssetOpsStore((state) => state.approveCandidate);
  const reject = useAgentAssetOpsStore((state) => state.rejectCandidate);
  const confirm = useAgentAssetOpsStore((state) => state.confirmCandidate);
  const markBound = useAgentAssetOpsStore((state) => state.markBound);
  const agentQuery = useQuery({
    queryKey: ['forge', 'agents', 'detail', agentId],
    enabled: Boolean(agentId),
    retry: false,
    queryFn: async (): Promise<ForgeAgentDetailResponse> => await getAgent(agentId),
  });
  const worldId = agentQuery.data?.worldId ?? '';
  const bindingsQuery = useQuery({
    queryKey: ['forge', 'world', 'resource-bindings', worldId],
    enabled: Boolean(worldId),
    retry: false,
    queryFn: async () => await listWorldResourceBindings(worldId),
  });
  const localCandidates = useMemo(
    () => selectAgentAssetOpsCandidates(profiles, { userId, agentId }),
    [profiles, userId, agentId],
  );
  const familySummaries = useMemo(() => {
    const bindings = toBindingRecordList(bindingsQuery.data);
    return (Object.keys(FAMILY_CONFIG) as AgentAssetOpsFamily[]).map((family) =>
      buildFamilyState(family, agentQuery.data, localCandidates, bindings),
    );
  }, [agentQuery.data, bindingsQuery.data, localCandidates]);
  const familiesById = useMemo(
    () => familySummaries.reduce<Record<AgentAssetOpsFamily, AgentAssetOpsFamilyState>>((acc, family) => {
      acc[family.family] = family;
      return acc;
    }, {} as Record<AgentAssetOpsFamily, AgentAssetOpsFamilyState>),
    [familySummaries],
  );
  const summary = useMemo<AgentAssetOpsHubSummary>(() => ({
    agentId,
    familySummaries,
    familiesById,
    completeFamilyCount: familySummaries.filter((family) => family.completenessState !== 'MISSING').length,
    boundFamilyCount: familySummaries.filter((family) => family.completenessState === 'BOUND').length,
  }), [agentId, familiesById, familySummaries]);
  const customVoiceSupport = useMemo<AgentCustomVoiceSupport>(() => {
    const customVoiceModel = String(customVoiceBinding?.model || '').trim();
    if (!customVoiceModel) {
      return {
        supported: false,
        reason: 'Custom voice design requires an independent voice-design route binding.',
      };
    }
    const ttsModel = String(ttsBinding?.model || '').trim();
    if (!ttsModel) {
      return {
        supported: false,
        reason: 'Voice demo synthesis requires a speech synthesis binding before designed voices can be used here.',
      };
    }
    return {
      supported: true,
      reason: null,
    };
  }, [customVoiceBinding?.model, ttsBinding?.model]);
  const designedVoiceAssetsQuery = useQuery({
    queryKey: [
      'forge',
      'agents',
      'voice-design-assets',
      userId,
      String(customVoiceBinding?.source || ''),
      String(customVoiceBinding?.connectorId || ''),
      String(customVoiceBinding?.model || ''),
      String(ttsBinding?.model || ''),
    ],
    enabled: customVoiceSupport.supported && Boolean(userId),
    retry: false,
    queryFn: async (): Promise<DesignedVoiceAsset[]> =>
      await listDesignedVoiceAssets({
        subjectUserId: userId,
        targetModelId: String(ttsBinding?.model || '').trim() || undefined,
      }),
  });
  const bindConfirmedMutation = useMutation({
    mutationFn: async (input: { family: AgentAssetOpsFamily; candidateId?: string }) => {
      const family = familiesById[input.family];
      const target = input.candidateId
        ? family.candidateList.find((candidate) => candidate.id === input.candidateId)
        : family.confirmedItem;
      if (!target) {
        throw new Error('FORGE_AGENT_ASSET_OPS_CONFIRMED_CANDIDATE_REQUIRED');
      }
      if (target.effectiveLifecycle !== 'confirmed' && target.effectiveLifecycle !== 'bound') {
        throw new Error('FORGE_AGENT_ASSET_OPS_BIND_REQUIRES_CONFIRMED');
      }
      if (!family.bindSupport.supported) {
        throw new Error(family.bindSupport.reason || 'FORGE_AGENT_ASSET_OPS_BIND_UNAVAILABLE');
      }
      switch (input.family) {
        case 'agent-avatar': {
          if (!target.previewUrl) {
            throw new Error('FORGE_AGENT_ASSET_OPS_AVATAR_PREVIEW_URL_REQUIRED');
          }
          await updateAgent(agentId, { avatarUrl: target.previewUrl });
          return {
            family: input.family,
            candidateId: target.id,
            resourceId: target.resourceId,
            text: null,
          };
        }
        case 'agent-cover': {
          if (!worldId || !target.resourceId) {
            throw new Error('FORGE_AGENT_ASSET_OPS_COVER_BIND_UNAVAILABLE');
          }
          await batchUpsertWorldResourceBindings(worldId, {
            bindingUpserts: [{
              objectType: 'RESOURCE',
              objectId: target.resourceId,
              hostType: 'AGENT',
              hostId: agentId,
              bindingKind: 'PRESENTATION',
              bindingPoint: 'AGENT_PORTRAIT',
              priority: 0,
            }],
          });
          return {
            family: input.family,
            candidateId: target.id,
            resourceId: target.resourceId,
            text: null,
          };
        }
        case 'agent-greeting-primary': {
          if (!target.text) {
            throw new Error('FORGE_AGENT_ASSET_OPS_GREETING_TEXT_REQUIRED');
          }
          await updateAgent(agentId, { greeting: target.text } as never);
          return {
            family: input.family,
            candidateId: target.id,
            resourceId: null,
            text: target.text,
          };
        }
        case 'agent-voice-demo': {
          if (!worldId || !target.resourceId) {
            throw new Error('FORGE_AGENT_ASSET_OPS_VOICE_DEMO_BIND_UNAVAILABLE');
          }
          await batchUpsertWorldResourceBindings(worldId, {
            bindingUpserts: [{
              objectType: 'RESOURCE',
              objectId: target.resourceId,
              hostType: 'AGENT',
              hostId: agentId,
              bindingKind: 'PRESENTATION',
              bindingPoint: 'AGENT_VOICE_SAMPLE',
              priority: 0,
            }],
          });
          return {
            family: input.family,
            candidateId: target.id,
            resourceId: target.resourceId,
            text: null,
          };
        }
      }
    },
    onSuccess: async (result) => {
      markBound({
        userId,
        agentId,
        family: result.family,
        candidateId: result.candidateId,
        resourceId: result.resourceId,
        text: result.text,
      });
      await queryClient.invalidateQueries({ queryKey: ['forge', 'agents', 'detail', agentId] });
      await queryClient.invalidateQueries({ queryKey: ['forge', 'agents', 'list'] });
      if (worldId) {
        await queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'resource-bindings', worldId] });
        await queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'agents-roster', worldId] });
      }
    },
  });
  const generateGreetingCandidateMutation = useMutation({
    mutationFn: async (input: { worldName?: string; worldDescription?: string } = {}) => {
      const agent = agentQuery.data;
      if (!agent) {
        throw new Error('FORGE_AGENT_ASSET_OPS_AGENT_DETAIL_REQUIRED');
      }
      const completion = await generateAgentCopyCompletion({
        worldName: input.worldName ?? options.worldName ?? '',
        worldDescription: input.worldDescription ?? options.worldDescription ?? '',
        displayName: agent.displayName,
        concept: agent.concept,
        description: agent.description ?? '',
        scenario: agent.scenario ?? '',
        greeting: agent.greeting ?? '',
      });
      const queuedCandidate = addCandidate({
        userId,
        agentId,
        family: 'agent-greeting-primary',
        kind: 'text',
        text: completion.greeting,
        origin: 'copy-generation',
        lifecycle: 'generated',
      });
      return {
        completion,
        queuedCandidate,
      };
    },
  });
  const generateVoiceDemoCandidateMutation = useMutation({
    mutationFn: async (input: { text?: string; voice?: string; language?: string; voiceAssetId?: string } = {}) => {
      const family = familiesById['agent-greeting-primary'];
      const sourceText = String(
        input.text
        || family.confirmedItem?.text
        || family.currentBoundItem?.text
        || '',
      ).trim();
      if (!sourceText) {
        throw new Error('FORGE_AGENT_ASSET_OPS_VOICE_TEXT_REQUIRED');
      }
      const uploaded = await synthesizeVoiceDemo({
        text: sourceText,
        voice: input.voice,
        language: input.language,
        voiceAssetId: input.voiceAssetId,
      });
      const queuedCandidate = addCandidate({
        userId,
        agentId,
        family: 'agent-voice-demo',
        kind: 'resource',
        resourceId: uploaded.resourceId,
        previewUrl: uploaded.url,
        mimeType: uploaded.mimeType,
        origin: 'voice-synthesis',
        lifecycle: 'generated',
      });
      return {
        sourceText,
        voiceAssetId: input.voiceAssetId ? String(input.voiceAssetId).trim() || null : null,
        uploaded,
        queuedCandidate,
      };
    },
  });
  const designCustomVoiceMutation = useMutation({
    mutationFn: async (input: {
      instructionText: string;
      previewText: string;
      language?: string;
      preferredName?: string;
    }) => {
      if (!customVoiceSupport.supported) {
        throw new Error(customVoiceSupport.reason || 'FORGE_AGENT_ASSET_OPS_CUSTOM_VOICE_UNAVAILABLE');
      }
      return await designCustomVoiceAsset({
        instructionText: input.instructionText,
        previewText: input.previewText,
        language: input.language,
        preferredName: input.preferredName,
        targetModelId: String(ttsBinding?.model || '').trim() || undefined,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['forge', 'agents', 'voice-design-assets'],
      });
    },
  });
  const addResourceCandidate = useCallback((input: {
    family: 'agent-avatar' | 'agent-cover' | 'agent-voice-demo';
    resourceId: string;
    previewUrl?: string | null;
    mimeType?: string | null;
    width?: number | null;
    height?: number | null;
    origin?: AgentAssetOpsCandidateOrigin;
  }) => addCandidate({
    userId,
    agentId,
    family: input.family,
    kind: 'resource',
    resourceId: input.resourceId,
    previewUrl: input.previewUrl,
    mimeType: input.mimeType,
    width: input.width,
    height: input.height,
    origin: input.origin ?? 'library',
    lifecycle: 'candidate',
  }), [addCandidate, userId, agentId]);
  const addTextCandidate = useCallback((input: {
    family: 'agent-greeting-primary';
    text: string;
    origin?: AgentAssetOpsCandidateOrigin;
    lifecycle?: AgentAssetOpsLifecycle;
  }) => addCandidate({
    userId,
    agentId,
    family: input.family,
    kind: 'text',
    text: input.text,
    origin: input.origin ?? 'manual',
    lifecycle: input.lifecycle ?? 'candidate',
  }), [addCandidate, userId, agentId]);
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
  const bindConfirmed = useCallback(async (input: { family: AgentAssetOpsFamily; candidateId?: string }) => {
    return await bindConfirmedMutation.mutateAsync(input);
  }, [bindConfirmedMutation]);
  const adoptCurrentFieldCandidate = useCallback((family: DirectFieldAdoptableFamily) => {
    const familyState = familiesById[family];
    const currentItem = familyState?.currentBoundItem;
    if (!currentItem || !currentItem.isSynthetic) {
      throw new Error('FORGE_AGENT_ASSET_OPS_ADOPTABLE_CURRENT_REQUIRED');
    }
    if (family === 'agent-avatar') {
      if (!currentItem.previewUrl) {
        throw new Error('FORGE_AGENT_ASSET_OPS_AVATAR_PREVIEW_URL_REQUIRED');
      }
      return addCandidate({
        userId,
        agentId,
        family,
        kind: 'resource',
        resourceId: currentItem.resourceId,
        previewUrl: currentItem.previewUrl,
        mimeType: currentItem.mimeType,
        width: currentItem.width,
        height: currentItem.height,
        origin: 'manual',
        lifecycle: 'confirmed',
      });
    }
    if (!currentItem.text) {
      throw new Error('FORGE_AGENT_ASSET_OPS_GREETING_TEXT_REQUIRED');
    }
    return addCandidate({
      userId,
      agentId,
      family,
      kind: 'text',
      text: currentItem.text,
      origin: 'manual',
      lifecycle: 'confirmed',
    });
  }, [addCandidate, agentId, familiesById, userId]);
  const getFamilyState = useCallback((family: AgentAssetOpsFamily) => familiesById[family], [familiesById]);
  return {
    userId,
    agentId,
    worldId,
    agentQuery,
    bindingsQuery,
    summary,
    familySummaries,
    familiesById,
    getFamilyState,
    addResourceCandidate,
    addTextCandidate,
    adoptCurrentFieldCandidate,
    reviewGeneratedCandidate,
    approveCandidate,
    rejectCandidate,
    confirmCandidate,
    bindConfirmed,
    bindConfirmedMutation,
    generateGreetingCandidateMutation,
    generateVoiceDemoCandidateMutation,
    customVoiceSupport,
    designedVoiceAssetsQuery,
    designCustomVoiceMutation,
  };
}
