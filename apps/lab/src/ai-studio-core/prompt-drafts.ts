export const STUDIO_PROMPT_DRAFTS_SCHEMA_VERSION = 1;

export type StudioPromptDraftKey = {
  readonly surfaceId: string;
  readonly capabilityId: string;
  readonly scenarioId: string;
};

type DraftStorage = {
  readJson(path: string): Promise<{ readonly value: unknown }>;
  writeJson(path: string, value: { schemaVersion: number; prompt: string }): Promise<unknown>;
};

/** The captured App client resolves the current account and registered subject.
 * Browser storage never supplies an identity or an unowned previous draft. */
export function createStudioPromptDraftRepository(storage: DraftStorage) {
  const cache = new Map<string, string>();
  let saving: Promise<unknown> = Promise.resolve();
  async function path(key: StudioPromptDraftKey) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([key.surfaceId, key.capabilityId, key.scenarioId])));
    return `studio/prompt-drafts/${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}.json`;
  }
  return {
    async load(key: StudioPromptDraftKey, enabled: boolean): Promise<{ prompt: string | null }> {
      const id = studioPromptDraftId(key);
      if (cache.has(id)) return { prompt: cache.get(id)! };
      if (!enabled) return { prompt: null };
      let value: unknown;
      try { value = (await storage.readJson(await path(key))).value; }
      catch (error) {
        const code = (error as { reasonCode?: string; code?: string } | null)?.reasonCode
          ?? (error as { code?: string } | null)?.code;
        if (code === 'APP_STORAGE_ENTRY_NOT_FOUND' || code === 'not-found') return { prompt: cache.get(id) ?? null };
        throw error;
      }
      const draft = value as { schemaVersion?: unknown; prompt?: unknown } | null;
      if (!draft || draft.schemaVersion !== 1 || typeof draft.prompt !== 'string') throw new Error('Stored prompt draft is invalid.');
      return { prompt: cache.get(id) ?? draft.prompt };
    },
    save(key: StudioPromptDraftKey, prompt: string, enabled: boolean): Promise<void> {
      cache.set(studioPromptDraftId(key), prompt);
      if (!enabled) return Promise.resolve();
      const write = async () => { await storage.writeJson(await path(key), { schemaVersion: 1, prompt }); };
      const next = saving.then(write, write);
      saving = next;
      return next;
    },
  };
}

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
