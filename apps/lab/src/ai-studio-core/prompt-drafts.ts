export const STUDIO_PROMPT_DRAFTS_SCHEMA_VERSION = 1;

export type StudioPromptDraftKey = {
  readonly surfaceId: string;
  readonly capabilityId: string;
  readonly scenarioId: string;
};

export type StudioPromptDraftStore = {
  readonly schemaVersion: typeof STUDIO_PROMPT_DRAFTS_SCHEMA_VERSION;
  readonly drafts: Readonly<Record<string, string>>;
};

export function createEmptyStudioPromptDraftStore(): StudioPromptDraftStore {
  return { schemaVersion: STUDIO_PROMPT_DRAFTS_SCHEMA_VERSION, drafts: {} };
}

export function studioPromptDraftId(key: StudioPromptDraftKey): string {
  return `${key.surfaceId}:${key.capabilityId}:${key.scenarioId}`;
}

export function parseStudioPromptDraftStore(value: unknown): StudioPromptDraftStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Stored prompt draft schema is invalid.');
  }
  const parsed = value as Partial<StudioPromptDraftStore>;
  if (
    parsed.schemaVersion !== STUDIO_PROMPT_DRAFTS_SCHEMA_VERSION
    || !parsed.drafts
    || typeof parsed.drafts !== 'object'
    || Array.isArray(parsed.drafts)
  ) {
    throw new Error('Stored prompt draft schema is invalid.');
  }
  for (const [draftId, prompt] of Object.entries(parsed.drafts)) {
    if (!draftId || typeof prompt !== 'string') {
      throw new Error('Stored prompt draft entry is invalid.');
    }
  }
  return {
    schemaVersion: STUDIO_PROMPT_DRAFTS_SCHEMA_VERSION,
    drafts: { ...parsed.drafts },
  };
}

export function readStudioPromptDraft(
  store: StudioPromptDraftStore,
  key: StudioPromptDraftKey,
  enabled: boolean,
): string | null {
  if (!enabled) return null;
  return store.drafts[studioPromptDraftId(key)] ?? null;
}

export function updateStudioPromptDraftStore(
  store: StudioPromptDraftStore,
  key: StudioPromptDraftKey,
  prompt: string,
  enabled: boolean,
): StudioPromptDraftStore {
  if (!enabled) return store;
  return {
    schemaVersion: STUDIO_PROMPT_DRAFTS_SCHEMA_VERSION,
    drafts: {
      ...store.drafts,
      [studioPromptDraftId(key)]: prompt,
    },
  };
}
