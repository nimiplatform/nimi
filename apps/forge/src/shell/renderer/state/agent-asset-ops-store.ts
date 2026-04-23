import { create } from 'zustand';

export type AgentAssetOpsFamily =
  | 'agent-avatar'
  | 'agent-cover'
  | 'agent-greeting-primary'
  | 'agent-voice-demo';
export type AgentAssetOpsLifecycle =
  | 'generated'
  | 'candidate'
  | 'approved'
  | 'rejected'
  | 'confirmed'
  | 'bound'
  | 'superseded';
export type AgentAssetOpsCandidateKind = 'resource' | 'text';
export type AgentAssetOpsCandidateOrigin =
  | 'image-studio'
  | 'library'
  | 'copy-generation'
  | 'voice-synthesis'
  | 'manual';

export type AgentAssetOpsCandidateRecord = {
  id: string;
  agentId: string;
  family: AgentAssetOpsFamily;
  kind: AgentAssetOpsCandidateKind;
  lifecycle: AgentAssetOpsLifecycle;
  resourceId: string | null;
  text: string | null;
  previewUrl: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  origin: AgentAssetOpsCandidateOrigin;
  createdAt: string;
  updatedAt: string;
};

type AgentAssetOpsProfileState = {
  candidates: AgentAssetOpsCandidateRecord[];
};

type AgentAssetOpsPersistedState = {
  version: 1;
  profiles: Record<string, AgentAssetOpsProfileState>;
};

type EnqueueAgentAssetCandidateInput = {
  userId?: string | null;
  agentId: string;
  family: AgentAssetOpsFamily;
  kind: AgentAssetOpsCandidateKind;
  lifecycle?: AgentAssetOpsLifecycle;
  resourceId?: string | null;
  text?: string | null;
  previewUrl?: string | null;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  origin?: AgentAssetOpsCandidateOrigin;
};

type TransitionAgentAssetCandidateInput = {
  userId?: string | null;
  candidateId: string;
  lifecycle: AgentAssetOpsLifecycle;
};

type MarkAgentAssetBoundInput = {
  userId?: string | null;
  agentId: string;
  family: AgentAssetOpsFamily;
  candidateId?: string | null;
  resourceId?: string | null;
  text?: string | null;
};

type AgentAssetOpsStore = {
  profiles: Record<string, AgentAssetOpsProfileState>;
  enqueueCandidate: (input: EnqueueAgentAssetCandidateInput) => AgentAssetOpsCandidateRecord;
  transitionCandidate: (input: TransitionAgentAssetCandidateInput) => AgentAssetOpsCandidateRecord | null;
  approveCandidate: (input: Omit<TransitionAgentAssetCandidateInput, 'lifecycle'>) => AgentAssetOpsCandidateRecord | null;
  rejectCandidate: (input: Omit<TransitionAgentAssetCandidateInput, 'lifecycle'>) => AgentAssetOpsCandidateRecord | null;
  moveCandidateToReview: (input: Omit<TransitionAgentAssetCandidateInput, 'lifecycle'>) => AgentAssetOpsCandidateRecord | null;
  confirmCandidate: (input: Omit<TransitionAgentAssetCandidateInput, 'lifecycle'>) => AgentAssetOpsCandidateRecord | null;
  markBound: (input: MarkAgentAssetBoundInput) => AgentAssetOpsCandidateRecord | null;
};

const STORAGE_KEY = 'nimi:forge:agent-asset-ops:v1';
const EMPTY_PROFILE: AgentAssetOpsProfileState = { candidates: [] };
const LIFECYCLE_VALUES = [
  'generated',
  'candidate',
  'approved',
  'rejected',
  'confirmed',
  'bound',
  'superseded',
] as const satisfies readonly AgentAssetOpsLifecycle[];
const FAMILY_VALUES = [
  'agent-avatar',
  'agent-cover',
  'agent-greeting-primary',
  'agent-voice-demo',
] as const satisfies readonly AgentAssetOpsFamily[];
const KIND_VALUES = ['resource', 'text'] as const satisfies readonly AgentAssetOpsCandidateKind[];
const ORIGIN_VALUES = [
  'image-studio',
  'library',
  'copy-generation',
  'voice-synthesis',
  'manual',
] as const satisfies readonly AgentAssetOpsCandidateOrigin[];

const ALLOWED_LIFECYCLE_TRANSITIONS: Record<AgentAssetOpsLifecycle, readonly AgentAssetOpsLifecycle[]> = {
  generated: ['candidate'],
  candidate: ['approved', 'rejected'],
  approved: ['rejected', 'confirmed'],
  rejected: ['candidate'],
  confirmed: ['bound', 'superseded'],
  bound: ['superseded'],
  superseded: ['candidate'],
};

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

function toNumberOrNull(value: unknown): number | null {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function normalizeLifecycle(value: unknown): AgentAssetOpsLifecycle {
  return LIFECYCLE_VALUES.find((entry) => entry === value) ?? 'candidate';
}

function normalizeFamily(value: unknown): AgentAssetOpsFamily | null {
  return FAMILY_VALUES.find((entry) => entry === value) ?? null;
}

function normalizeKind(value: unknown): AgentAssetOpsCandidateKind | null {
  return KIND_VALUES.find((entry) => entry === value) ?? null;
}

function normalizeOrigin(value: unknown): AgentAssetOpsCandidateOrigin {
  return ORIGIN_VALUES.find((entry) => entry === value) ?? 'manual';
}

function validateCandidateInput(input: EnqueueAgentAssetCandidateInput): void {
  const normalizedResourceId = String(input.resourceId || '').trim();
  const normalizedPreviewUrl = String(input.previewUrl || '').trim();
  const allowsResourceIdlessAvatar = input.family === 'agent-avatar' && Boolean(normalizedPreviewUrl);
  if (input.kind === 'resource' && !normalizedResourceId && !allowsResourceIdlessAvatar) {
    throw new Error('FORGE_AGENT_ASSET_OPS_RESOURCE_ID_REQUIRED');
  }
  if (input.kind === 'text' && !String(input.text || '').trim()) {
    throw new Error('FORGE_AGENT_ASSET_OPS_TEXT_REQUIRED');
  }
}

function normalizeCandidateRecord(value: unknown): AgentAssetOpsCandidateRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = toStringOrNull(value.id);
  const agentId = toStringOrNull(value.agentId);
  const family = normalizeFamily(value.family);
  const kind = normalizeKind(value.kind);
  if (!id || !agentId || !family || !kind) {
    return null;
  }
  const resourceId = toStringOrNull(value.resourceId);
  const text = toStringOrNull(value.text);
  const previewUrl = toStringOrNull(value.previewUrl);
  const allowsResourceIdlessAvatar = family === 'agent-avatar' && Boolean(previewUrl);
  if ((kind === 'resource' && !resourceId && !allowsResourceIdlessAvatar) || (kind === 'text' && !text)) {
    return null;
  }
  const createdAt = toStringOrNull(value.createdAt) ?? new Date(0).toISOString();
  const updatedAt = toStringOrNull(value.updatedAt) ?? createdAt;
  return {
    id,
    agentId,
    family,
    kind,
    lifecycle: normalizeLifecycle(value.lifecycle),
    resourceId,
    text,
    previewUrl,
    mimeType: toStringOrNull(value.mimeType),
    width: toNumberOrNull(value.width),
    height: toNumberOrNull(value.height),
    origin: normalizeOrigin(value.origin),
    createdAt,
    updatedAt,
  };
}

function normalizeProfileState(value: unknown): AgentAssetOpsProfileState {
  if (!isRecord(value)) {
    return { ...EMPTY_PROFILE };
  }
  const candidates = Array.isArray(value.candidates)
    ? value.candidates.map(normalizeCandidateRecord).filter((item): item is AgentAssetOpsCandidateRecord => item !== null)
    : [];
  return { candidates };
}

function readProfilesFromStorage(): Record<string, AgentAssetOpsProfileState> {
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
    return Object.entries(parsed.profiles).reduce<Record<string, AgentAssetOpsProfileState>>((acc, [profileId, profile]) => {
      acc[normalizeUserId(profileId)] = normalizeProfileState(profile);
      return acc;
    }, {});
  } catch {
    return {};
  }
}

function persistProfiles(profiles: Record<string, AgentAssetOpsProfileState>): void {
  const storage = getWindowStorage();
  if (!storage) {
    return;
  }
  const payload: AgentAssetOpsPersistedState = {
    version: 1,
    profiles,
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function getProfileCandidates(
  profiles: Record<string, AgentAssetOpsProfileState>,
  userId?: string | null,
): AgentAssetOpsCandidateRecord[] {
  return profiles[normalizeUserId(userId)]?.candidates ?? [];
}

function replaceProfileCandidates(
  profiles: Record<string, AgentAssetOpsProfileState>,
  userId: string | null | undefined,
  candidates: AgentAssetOpsCandidateRecord[],
): Record<string, AgentAssetOpsProfileState> {
  const profileId = normalizeUserId(userId);
  return {
    ...profiles,
    [profileId]: { candidates },
  };
}

function assertLifecycleTransition(from: AgentAssetOpsLifecycle, to: AgentAssetOpsLifecycle): void {
  if (!ALLOWED_LIFECYCLE_TRANSITIONS[from].includes(to)) {
    throw new Error(`FORGE_AGENT_ASSET_OPS_INVALID_LIFECYCLE:${from}->${to}`);
  }
}

function transitionLifecycle(
  profiles: Record<string, AgentAssetOpsProfileState>,
  input: TransitionAgentAssetCandidateInput,
): {
  profiles: Record<string, AgentAssetOpsProfileState>;
  candidate: AgentAssetOpsCandidateRecord | null;
} {
  const candidates = getProfileCandidates(profiles, input.userId);
  let nextCandidate: AgentAssetOpsCandidateRecord | null = null;
  const nextCandidates = candidates.map((candidate) => {
    if (candidate.id !== input.candidateId) {
      return candidate;
    }
    assertLifecycleTransition(candidate.lifecycle, input.lifecycle);
    nextCandidate = {
      ...candidate,
      lifecycle: input.lifecycle,
      updatedAt: new Date().toISOString(),
    };
    return nextCandidate;
  });
  return {
    profiles: replaceProfileCandidates(profiles, input.userId, nextCandidates),
    candidate: nextCandidate,
  };
}

export const useAgentAssetOpsStore = create<AgentAssetOpsStore>((set, get) => ({
  profiles: readProfilesFromStorage(),

  enqueueCandidate: (input) => {
    validateCandidateInput(input);
    const now = new Date().toISOString();
    const currentProfiles = get().profiles;
    const candidates = getProfileCandidates(currentProfiles, input.userId);
    const normalizedText = toStringOrNull(input.text);
    const normalizedResourceId = toStringOrNull(input.resourceId);
    const normalizedPreviewUrl = toStringOrNull(input.previewUrl);
    const existing = candidates.find((candidate) =>
      candidate.agentId === input.agentId
      && candidate.family === input.family
      && (
        (input.kind === 'resource'
          && candidate.kind === 'resource'
          && (
            candidate.resourceId === normalizedResourceId
            || (
              input.family === 'agent-avatar'
              && !normalizedResourceId
              && !candidate.resourceId
              && candidate.previewUrl === normalizedPreviewUrl
            )
          ))
        || (input.kind === 'text' && candidate.kind === 'text' && candidate.text === normalizedText)
      ),
    );
    const nextCandidate: AgentAssetOpsCandidateRecord = existing
      ? {
          ...existing,
          lifecycle: input.lifecycle ?? existing.lifecycle,
          previewUrl: input.previewUrl ?? existing.previewUrl,
          mimeType: input.mimeType ?? existing.mimeType,
          width: input.width ?? existing.width,
          height: input.height ?? existing.height,
          origin: input.origin ?? existing.origin,
          updatedAt: now,
        }
      : {
          id: crypto.randomUUID(),
          agentId: input.agentId,
          family: input.family,
          kind: input.kind,
          lifecycle: input.lifecycle ?? 'candidate',
          resourceId: input.kind === 'resource' ? normalizedResourceId : null,
          text: input.kind === 'text' ? normalizedText : null,
          previewUrl: normalizedPreviewUrl,
          mimeType: input.mimeType ?? null,
          width: input.width ?? null,
          height: input.height ?? null,
          origin: input.origin ?? 'manual',
          createdAt: now,
          updatedAt: now,
        };
    const nextCandidates = existing
      ? candidates.map((candidate) => (candidate.id === existing.id ? nextCandidate : candidate))
      : [nextCandidate, ...candidates];
    const nextProfiles = replaceProfileCandidates(currentProfiles, input.userId, nextCandidates);
    persistProfiles(nextProfiles);
    set({ profiles: nextProfiles });
    return nextCandidate;
  },

  transitionCandidate: (input) => {
    const result = transitionLifecycle(get().profiles, input);
    persistProfiles(result.profiles);
    set({ profiles: result.profiles });
    return result.candidate;
  },

  approveCandidate: (input) => get().transitionCandidate({ ...input, lifecycle: 'approved' }),

  rejectCandidate: (input) => get().transitionCandidate({ ...input, lifecycle: 'rejected' }),

  moveCandidateToReview: (input) => get().transitionCandidate({ ...input, lifecycle: 'candidate' }),

  confirmCandidate: (input) => {
    const currentProfiles = get().profiles;
    const candidates = getProfileCandidates(currentProfiles, input.userId);
    const target = candidates.find((candidate) => candidate.id === input.candidateId);
    if (!target) {
      return null;
    }
    if (target.lifecycle !== 'approved') {
      throw new Error(`FORGE_AGENT_ASSET_OPS_INVALID_LIFECYCLE:${target.lifecycle}->confirmed`);
    }
    const now = new Date().toISOString();
    const nextCandidates = candidates.map((candidate) => {
      if (candidate.id === input.candidateId) {
        return {
          ...candidate,
          lifecycle: 'confirmed' as const,
          updatedAt: now,
        };
      }
      if (
        candidate.agentId === target.agentId
        && candidate.family === target.family
        && (candidate.lifecycle === 'confirmed' || candidate.lifecycle === 'bound')
      ) {
        assertLifecycleTransition(candidate.lifecycle, 'superseded');
        return {
          ...candidate,
          lifecycle: 'superseded' as const,
          updatedAt: now,
        };
      }
      return candidate;
    });
    const nextProfiles = replaceProfileCandidates(currentProfiles, input.userId, nextCandidates);
    persistProfiles(nextProfiles);
    set({ profiles: nextProfiles });
    return nextCandidates.find((candidate) => candidate.id === input.candidateId) ?? null;
  },

  markBound: (input) => {
    const currentProfiles = get().profiles;
    const candidates = getProfileCandidates(currentProfiles, input.userId);
    const target = candidates.find((candidate) =>
      candidate.agentId === input.agentId
      && candidate.family === input.family
      && (
        (input.candidateId && candidate.id === input.candidateId)
        || (input.resourceId && candidate.resourceId === input.resourceId)
        || (input.text && candidate.text === input.text)
      ),
    );
    if (!target) {
      return null;
    }
    assertLifecycleTransition(target.lifecycle, 'bound');
    const now = new Date().toISOString();
    const nextCandidates = candidates.map((candidate) => {
      if (candidate.id === target.id) {
        return {
          ...candidate,
          lifecycle: 'bound' as const,
          updatedAt: now,
        };
      }
      if (
        candidate.agentId === input.agentId
        && candidate.family === input.family
        && (candidate.lifecycle === 'confirmed' || candidate.lifecycle === 'bound')
      ) {
        assertLifecycleTransition(candidate.lifecycle, 'superseded');
        return {
          ...candidate,
          lifecycle: 'superseded' as const,
          updatedAt: now,
        };
      }
      return candidate;
    });
    const nextProfiles = replaceProfileCandidates(currentProfiles, input.userId, nextCandidates);
    persistProfiles(nextProfiles);
    set({ profiles: nextProfiles });
    return nextCandidates.find((candidate) => candidate.id === target.id) ?? null;
  },
}));

export function selectAgentAssetOpsCandidates(
  profiles: Record<string, AgentAssetOpsProfileState>,
  input: {
    userId?: string | null;
    agentId: string;
  },
): AgentAssetOpsCandidateRecord[] {
  return getProfileCandidates(profiles, input.userId)
    .filter((candidate) => candidate.agentId === input.agentId);
}

export function queueAgentAssetCandidate(input: EnqueueAgentAssetCandidateInput): AgentAssetOpsCandidateRecord {
  return useAgentAssetOpsStore.getState().enqueueCandidate(input);
}
