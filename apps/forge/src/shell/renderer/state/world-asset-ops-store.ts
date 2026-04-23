import { create } from 'zustand';

export type WorldAssetOpsFamily =
  | 'world-icon'
  | 'world-cover'
  | 'world-background'
  | 'world-scene';
export type WorldAssetOpsLifecycle =
  | 'generated'
  | 'candidate'
  | 'approved'
  | 'rejected'
  | 'confirmed'
  | 'bound'
  | 'superseded';
export type WorldAssetOpsCandidateOrigin = 'image-studio' | 'library';

export type WorldAssetOpsCandidateRecord = {
  id: string;
  worldId: string;
  family: WorldAssetOpsFamily;
  resourceId: string;
  lifecycle: WorldAssetOpsLifecycle;
  previewUrl: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  origin: WorldAssetOpsCandidateOrigin;
  createdAt: string;
  updatedAt: string;
};

type WorldAssetOpsProfileState = {
  candidates: WorldAssetOpsCandidateRecord[];
};

type WorldAssetOpsPersistedState = {
  version: 1;
  profiles: Record<string, WorldAssetOpsProfileState>;
};

type EnqueueWorldAssetCandidateInput = {
  userId?: string | null;
  worldId: string;
  family: WorldAssetOpsFamily;
  resourceId: string;
  lifecycle?: WorldAssetOpsLifecycle;
  previewUrl?: string | null;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  origin?: WorldAssetOpsCandidateOrigin;
};

type TransitionWorldAssetCandidateInput = {
  userId?: string | null;
  candidateId: string;
  lifecycle: WorldAssetOpsLifecycle;
};

type MarkWorldAssetBoundInput = {
  userId?: string | null;
  worldId: string;
  family: WorldAssetOpsFamily;
  candidateId?: string | null;
  resourceId?: string | null;
};

type WorldAssetOpsStore = {
  profiles: Record<string, WorldAssetOpsProfileState>;
  enqueueCandidate: (input: EnqueueWorldAssetCandidateInput) => WorldAssetOpsCandidateRecord;
  transitionCandidate: (input: TransitionWorldAssetCandidateInput) => WorldAssetOpsCandidateRecord | null;
  approveCandidate: (input: Omit<TransitionWorldAssetCandidateInput, 'lifecycle'>) => WorldAssetOpsCandidateRecord | null;
  rejectCandidate: (input: Omit<TransitionWorldAssetCandidateInput, 'lifecycle'>) => WorldAssetOpsCandidateRecord | null;
  moveCandidateToReview: (input: Omit<TransitionWorldAssetCandidateInput, 'lifecycle'>) => WorldAssetOpsCandidateRecord | null;
  confirmCandidate: (input: Omit<TransitionWorldAssetCandidateInput, 'lifecycle'>) => WorldAssetOpsCandidateRecord | null;
  markBound: (input: MarkWorldAssetBoundInput) => WorldAssetOpsCandidateRecord | null;
};

const STORAGE_KEY = 'nimi:forge:world-asset-ops:v1';
const EMPTY_PROFILE: WorldAssetOpsProfileState = { candidates: [] };
const LIFECYCLE_VALUES = [
  'generated',
  'candidate',
  'approved',
  'rejected',
  'confirmed',
  'bound',
  'superseded',
] as const satisfies readonly WorldAssetOpsLifecycle[];
const FAMILY_VALUES = [
  'world-icon',
  'world-cover',
  'world-background',
  'world-scene',
] as const satisfies readonly WorldAssetOpsFamily[];
const ORIGIN_VALUES = ['image-studio', 'library'] as const satisfies readonly WorldAssetOpsCandidateOrigin[];

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

function normalizeLifecycle(value: unknown): WorldAssetOpsLifecycle {
  return LIFECYCLE_VALUES.find((entry) => entry === value) ?? 'candidate';
}

function normalizeFamily(value: unknown): WorldAssetOpsFamily | null {
  return FAMILY_VALUES.find((entry) => entry === value) ?? null;
}

function normalizeOrigin(value: unknown): WorldAssetOpsCandidateOrigin {
  return ORIGIN_VALUES.find((entry) => entry === value) ?? 'library';
}

function canTransitionLifecycle(
  current: WorldAssetOpsLifecycle,
  next: WorldAssetOpsLifecycle,
): boolean {
  if (current === next) {
    return true;
  }
  switch (current) {
    case 'generated':
      return next === 'candidate';
    case 'candidate':
      return next === 'approved' || next === 'rejected';
    case 'approved':
      return next === 'rejected' || next === 'confirmed';
    case 'rejected':
      return next === 'candidate';
    case 'confirmed':
      return next === 'bound';
    case 'bound':
      return next === 'superseded';
    case 'superseded':
      return next === 'candidate';
  }
}

function normalizeCandidateRecord(value: unknown): WorldAssetOpsCandidateRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = toStringOrNull(value.id);
  const worldId = toStringOrNull(value.worldId);
  const family = normalizeFamily(value.family);
  const resourceId = toStringOrNull(value.resourceId);
  if (!id || !worldId || !family || !resourceId) {
    return null;
  }
  const createdAt = toStringOrNull(value.createdAt) ?? new Date(0).toISOString();
  const updatedAt = toStringOrNull(value.updatedAt) ?? createdAt;
  return {
    id,
    worldId,
    family,
    resourceId,
    lifecycle: normalizeLifecycle(value.lifecycle),
    previewUrl: toStringOrNull(value.previewUrl),
    mimeType: toStringOrNull(value.mimeType),
    width: toNumberOrNull(value.width),
    height: toNumberOrNull(value.height),
    origin: normalizeOrigin(value.origin),
    createdAt,
    updatedAt,
  };
}

function normalizeProfileState(value: unknown): WorldAssetOpsProfileState {
  if (!isRecord(value)) {
    return { ...EMPTY_PROFILE };
  }
  const candidates = Array.isArray(value.candidates)
    ? value.candidates.map(normalizeCandidateRecord).filter((item): item is WorldAssetOpsCandidateRecord => item !== null)
    : [];
  return { candidates };
}

function readProfilesFromStorage(): Record<string, WorldAssetOpsProfileState> {
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
    return Object.entries(parsed.profiles).reduce<Record<string, WorldAssetOpsProfileState>>((acc, [profileId, profile]) => {
      const normalizedProfileId = normalizeUserId(profileId);
      acc[normalizedProfileId] = normalizeProfileState(profile);
      return acc;
    }, {});
  } catch {
    return {};
  }
}

function persistProfiles(profiles: Record<string, WorldAssetOpsProfileState>): void {
  const storage = getWindowStorage();
  if (!storage) {
    return;
  }
  const payload: WorldAssetOpsPersistedState = {
    version: 1,
    profiles,
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function getProfileCandidates(
  profiles: Record<string, WorldAssetOpsProfileState>,
  userId?: string | null,
): WorldAssetOpsCandidateRecord[] {
  return profiles[normalizeUserId(userId)]?.candidates ?? [];
}

function replaceProfileCandidates(
  profiles: Record<string, WorldAssetOpsProfileState>,
  userId: string | null | undefined,
  candidates: WorldAssetOpsCandidateRecord[],
): Record<string, WorldAssetOpsProfileState> {
  const profileId = normalizeUserId(userId);
  return {
    ...profiles,
    [profileId]: { candidates },
  };
}

function transitionLifecycle(
  profiles: Record<string, WorldAssetOpsProfileState>,
  input: TransitionWorldAssetCandidateInput,
): {
  profiles: Record<string, WorldAssetOpsProfileState>;
  candidate: WorldAssetOpsCandidateRecord | null;
} {
  const candidates = getProfileCandidates(profiles, input.userId);
  let nextCandidate: WorldAssetOpsCandidateRecord | null = null;
  const nextCandidates = candidates.map((candidate) => {
    if (candidate.id !== input.candidateId) {
      return candidate;
    }
    if (!canTransitionLifecycle(candidate.lifecycle, input.lifecycle)) {
      return candidate;
    }
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

export const useWorldAssetOpsStore = create<WorldAssetOpsStore>((set, get) => ({
  profiles: readProfilesFromStorage(),

  enqueueCandidate: (input) => {
    const now = new Date().toISOString();
    const currentProfiles = get().profiles;
    const candidates = getProfileCandidates(currentProfiles, input.userId);
    const existing = candidates.find((candidate) =>
      candidate.worldId === input.worldId
      && candidate.family === input.family
      && candidate.resourceId === input.resourceId,
    );
    const nextCandidate: WorldAssetOpsCandidateRecord = existing
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
          worldId: input.worldId,
          family: input.family,
          resourceId: input.resourceId,
          lifecycle: input.lifecycle ?? 'candidate',
          previewUrl: input.previewUrl ?? null,
          mimeType: input.mimeType ?? null,
          width: input.width ?? null,
          height: input.height ?? null,
          origin: input.origin ?? 'library',
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
    if (!target || target.lifecycle !== 'approved') {
      return null;
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
        candidate.worldId === target.worldId
        && candidate.family === target.family
        && (candidate.lifecycle === 'confirmed' || candidate.lifecycle === 'bound')
      ) {
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
      candidate.worldId === input.worldId
      && candidate.family === input.family
      && (
        (input.candidateId && candidate.id === input.candidateId)
        || (input.resourceId && candidate.resourceId === input.resourceId)
      ),
    );
    if (!target || (target.lifecycle !== 'confirmed' && target.lifecycle !== 'bound')) {
      return null;
    }
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
        candidate.worldId === input.worldId
        && candidate.family === input.family
        && (candidate.lifecycle === 'confirmed' || candidate.lifecycle === 'bound')
      ) {
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

export function selectWorldAssetOpsCandidates(
  profiles: Record<string, WorldAssetOpsProfileState>,
  input: {
    userId?: string | null;
    worldId: string;
  },
): WorldAssetOpsCandidateRecord[] {
  return getProfileCandidates(profiles, input.userId)
    .filter((candidate) => candidate.worldId === input.worldId);
}

export function queueWorldAssetCandidate(input: EnqueueWorldAssetCandidateInput): WorldAssetOpsCandidateRecord {
  return useWorldAssetOpsStore.getState().enqueueCandidate(input);
}
