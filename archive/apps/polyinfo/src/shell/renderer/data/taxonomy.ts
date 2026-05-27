import type {
  AnalysisSnapshot,
  AnalystMessage,
  AnalystRuntimeSettings,
  CoreVariableRecord,
  CustomSectorRecord,
  DraftProposal,
  ImportedEventCachedPayload,
  ImportedEventRecord,
  ImportedEventStaleState,
  NarrativeRecord,
  SectorChatState,
  TaxonomyOverlay,
} from './types.js';

const TAXONOMY_STORAGE_KEY = 'nimi:polyinfo:taxonomy:v1';
const CHAT_STORAGE_KEY = 'nimi:polyinfo:chat:v1';
const SNAPSHOT_STORAGE_KEY = 'nimi:polyinfo:snapshots:v1';
const CUSTOM_SECTORS_STORAGE_KEY = 'nimi:polyinfo:custom-sectors:v1';
const IMPORTED_EVENTS_STORAGE_KEY = 'nimi:polyinfo:imported-events:v1';
const LAST_ACTIVE_SECTOR_STORAGE_KEY = 'nimi:polyinfo:last-active-sector:v1';
export const LEGACY_ANALYST_RUNTIME_STORAGE_KEY = 'nimi:polyinfo:analyst-runtime:v1';

export const seededTaxonomyBySector: Record<string, TaxonomyOverlay> = {
  iran: {
    narratives: [
      {
        id: 'short-contact',
        title: '短期接触',
        definition: '观察短时间内是否出现外交会面、公开接触或初步互动。',
        keywords: ['meeting', 'talks', 'negotiation', 'diplomatic', 'conference', 'contact'],
        confirmationState: 'confirmed',
      },
      {
        id: 'mid-agreement',
        title: '中期协议形成',
        definition: '观察月内是否出现可被市场视为正式协议的结果。',
        keywords: ['agreement', 'deal', 'accord', 'signed', 'by april', 'by may'],
        confirmationState: 'confirmed',
      },
      {
        id: 'war-endpath',
        title: '战争收束路径',
        definition: '观察市场是否在押战争进入可持续收束轨道，而不是单次战术缓和。',
        keywords: ['peace', 'war ends', 'ceasefire', 'permanent peace', 'end the war'],
        confirmationState: 'confirmed',
      },
    ],
    coreVariables: [
      {
        id: 'cv-short-negotiation',
        title: '短期谈判是否降温',
        definition: '衡量未来几天内市场对立即谈判推进的信念是在走弱还是回暖。',
        keywords: ['meeting', 'talks', 'negotiation', 'diplomatic', 'conference', 'contact'],
        confirmationState: 'confirmed',
      },
      {
        id: 'cv-war-endpath',
        title: '战争是否进入结束路径',
        definition: '衡量市场是否开始从更高层面押注冲突走向结束。',
        keywords: ['peace', 'war ends', 'ceasefire', 'agreement', 'deal'],
        confirmationState: 'confirmed',
      },
    ],
  },
};

function loadJsonRecord<T>(storageKey: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return fallback;
    }
    return (JSON.parse(raw) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJsonRecord(storageKey: string, value: unknown): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(storageKey, JSON.stringify(value));
}

function normalizeNarrativeRecord(value: unknown): NarrativeRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = String(record.id || '').trim();
  const title = String(record.title || '').trim();
  const definition = String(record.definition || '').trim();
  if (!id || !title || !definition) {
    return null;
  }
  return {
    id,
    title,
    definition,
    keywords: Array.isArray(record.keywords)
      ? record.keywords.map((item) => String(item || '').trim()).filter(Boolean)
      : undefined,
    confirmationState: record.confirmationState === 'proposed' ? 'proposed' : 'confirmed',
  };
}

function normalizeCoreVariableRecord(value: unknown): CoreVariableRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = String(record.id || '').trim();
  const title = String(record.title || '').trim();
  const definition = String(record.definition || '').trim();
  if (!id || !title || !definition) {
    return null;
  }
  return {
    id,
    title,
    definition,
    keywords: Array.isArray(record.keywords)
      ? record.keywords.map((item) => String(item || '').trim()).filter(Boolean)
      : undefined,
    confirmationState: record.confirmationState === 'proposed' ? 'proposed' : 'confirmed',
  };
}

function normalizeTaxonomyOverlay(value: unknown): TaxonomyOverlay | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const narratives = Array.isArray(record.narratives)
    ? record.narratives.map((item) => normalizeNarrativeRecord(item)).filter((item): item is NarrativeRecord => item !== null)
    : [];
  const coreVariables = Array.isArray(record.coreVariables)
    ? record.coreVariables.map((item) => normalizeCoreVariableRecord(item)).filter((item): item is CoreVariableRecord => item !== null)
    : [];
  return {
    narratives,
    coreVariables,
  };
}

export function loadSavedTaxonomy(): Record<string, TaxonomyOverlay> {
  const raw = loadJsonRecord<Record<string, unknown>>(TAXONOMY_STORAGE_KEY, {});
  return Object.fromEntries(
    Object.entries(raw).map(([sectorId, value]) => {
      const overlay = normalizeTaxonomyOverlay(value) ?? { narratives: [], coreVariables: [] };
      return [sectorId, overlay];
    }),
  );
}

export function saveTaxonomy(value: Record<string, TaxonomyOverlay>): void {
  saveJsonRecord(TAXONOMY_STORAGE_KEY, value);
}

export function loadSavedChats(): Record<string, SectorChatState> {
  const raw = loadJsonRecord<Record<string, unknown>>(CHAT_STORAGE_KEY, {});
  return migrateSavedChats(raw);
}

export function saveChats(value: Record<string, unknown>): void {
  saveJsonRecord(CHAT_STORAGE_KEY, value);
}

export function loadSavedSnapshots(): Record<string, AnalysisSnapshot[]> {
  const parsed = loadJsonRecord<Record<string, unknown>>(SNAPSHOT_STORAGE_KEY, {});
  return Object.fromEntries(Object.entries(parsed).map(([sectorSlug, value]) => {
    const snapshots = Array.isArray(value)
      ? value
        .map((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return null;
          }
          const record = item as Record<string, unknown>;
          const id = String(record.id || '').trim();
          const sector = String(record.sectorSlug || sectorSlug).trim();
          if (!id || !sector) {
            return null;
          }
          return {
            id,
            sectorSlug: sector,
            sectorLabel: String(record.sectorLabel || sector),
            window: record.window === '24h' || record.window === '7d' ? record.window : '48h',
            createdAt: Number(record.createdAt) || Date.now(),
            headline: String(record.headline || ''),
            summary: String(record.summary || ''),
            messageId: String(record.messageId || id),
          } satisfies AnalysisSnapshot;
        })
        .filter((item): item is AnalysisSnapshot => item !== null)
      : [];
    return [sectorSlug, snapshots];
  }));
}

export function saveSnapshots(value: Record<string, unknown>): void {
  saveJsonRecord(SNAPSHOT_STORAGE_KEY, value);
}

function normalizeCustomSectorRecord(value: unknown): CustomSectorRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = String(record.id || '').trim();
  const title = String(record.title || '').trim();
  if (!id || !title) {
    return null;
  }
  const createdAt = Number(record.createdAt) || Date.now();
  const updatedAt = Number(record.updatedAt) || createdAt;
  return {
    id,
    title,
    createdAt,
    updatedAt,
  };
}

export function loadSavedCustomSectors(): Record<string, CustomSectorRecord> {
  const raw = loadJsonRecord<Record<string, unknown>>(CUSTOM_SECTORS_STORAGE_KEY, {});
  return Object.fromEntries(
    Object.entries(raw)
      .map(([sectorId, value]) => [sectorId, normalizeCustomSectorRecord(value)] as const)
      .filter((entry): entry is [string, CustomSectorRecord] => entry[1] !== null),
  );
}

export function saveCustomSectors(value: Record<string, CustomSectorRecord>): void {
  saveJsonRecord(CUSTOM_SECTORS_STORAGE_KEY, value);
}

function normalizeImportedEventCachedPayload(value: unknown): ImportedEventCachedPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const sourceEventId = String(record.sourceEventId || '').trim();
  const slug = String(record.slug || '').trim();
  const title = String(record.title || '').trim();
  const markets = Array.isArray(record.markets) ? record.markets : [];
  if (!sourceEventId || !slug || !title || markets.length === 0) {
    return null;
  }
  return {
    sourceEventId,
    slug,
    title,
    description: record.description ? String(record.description) : undefined,
    endDate: record.endDate ? String(record.endDate) : undefined,
    markets: markets as ImportedEventCachedPayload['markets'],
  };
}

function normalizeImportedEventStaleState(value: unknown): ImportedEventStaleState {
  return value === 'closed' || value === 'missing' || value === 'error' ? value : 'active';
}

function normalizeImportedEventRecord(value: unknown): ImportedEventRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = String(record.id || '').trim();
  const sectorId = String(record.sectorId || '').trim();
  const sourceUrl = String(record.sourceUrl || '').trim();
  const sourceEventId = String(record.sourceEventId || '').trim();
  const title = String(record.title || '').trim();
  const cachedEventPayload = normalizeImportedEventCachedPayload(record.cachedEventPayload);
  if (!id || !sectorId || !sourceUrl || !sourceEventId || !title || !cachedEventPayload) {
    return null;
  }
  const createdAt = Number(record.createdAt) || Date.now();
  const updatedAt = Number(record.updatedAt) || createdAt;
  const lastValidatedAt = Number(record.lastValidatedAt);
  return {
    id,
    sectorId,
    sourceUrl,
    sourceEventId,
    title,
    cachedEventPayload,
    lastValidatedAt: Number.isFinite(lastValidatedAt) && lastValidatedAt > 0 ? lastValidatedAt : null,
    staleState: normalizeImportedEventStaleState(record.staleState),
    staleReason: record.staleReason ? String(record.staleReason) : undefined,
    createdAt,
    updatedAt,
  };
}

export function loadSavedImportedEvents(): Record<string, ImportedEventRecord[]> {
  const raw = loadJsonRecord<Record<string, unknown>>(IMPORTED_EVENTS_STORAGE_KEY, {});
  return Object.fromEntries(
    Object.entries(raw).map(([sectorId, value]) => {
      const events = Array.isArray(value)
        ? value.map((item) => normalizeImportedEventRecord(item)).filter((item): item is ImportedEventRecord => item !== null)
        : [];
      return [sectorId, events];
    }),
  );
}

export function saveImportedEvents(value: Record<string, ImportedEventRecord[]>): void {
  saveJsonRecord(IMPORTED_EVENTS_STORAGE_KEY, value);
}

export function loadLastActiveSectorId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = window.localStorage.getItem(LAST_ACTIVE_SECTOR_STORAGE_KEY);
  const sectorId = String(raw || '').trim();
  return sectorId || null;
}

export function saveLastActiveSectorId(value: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (!value) {
    window.localStorage.removeItem(LAST_ACTIVE_SECTOR_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(LAST_ACTIVE_SECTOR_STORAGE_KEY, value);
}

export function loadSavedAnalystRuntimeSettings(): AnalystRuntimeSettings | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(LEGACY_ANALYST_RUNTIME_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AnalystRuntimeSettings> & { model?: string };
    const route = parsed?.route === 'cloud' ? 'cloud' : 'local';
    const legacyModel = String(parsed?.model || '').trim();
    return {
      route,
      localModel: String(parsed?.localModel || legacyModel || '').trim() || 'auto',
      cloudConnectorId: String(parsed?.cloudConnectorId || '').trim(),
      cloudModel: String(parsed?.cloudModel || legacyModel || '').trim() || 'auto',
    };
  } catch {
    return null;
  }
}

export function clearLegacyAnalystRuntimeSettings(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(LEGACY_ANALYST_RUNTIME_STORAGE_KEY);
}

export function buildDefaultSectorChatState(sectorSlug = '', title?: string): SectorChatState {
  const now = Date.now();
  const normalizedSlug = String(sectorSlug || '').trim() || 'default';
  return {
    threadId: `sector-thread:${normalizedSlug}`,
    title: title || normalizedSlug,
    draftText: '',
    createdAt: now,
    updatedAt: now,
    messages: [],
    draftProposal: null,
    isStreaming: false,
    error: null,
  };
}

function normalizeMessageList(value: unknown): AnalystMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const messages: Array<AnalystMessage | null> = value
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null;
      }
      const record = item as Record<string, unknown>;
      const id = String(record.id || '').trim();
      const role: AnalystMessage['role'] = record.role === 'assistant' ? 'assistant' : 'user';
      if (!id) {
        return null;
      }
      const rawStatus = record.status;
      const status: AnalystMessage['status'] =
        rawStatus === 'streaming' || rawStatus === 'error' ? rawStatus : 'complete';
      return {
        id,
        role,
        content: String(record.content || ''),
        createdAt: Number(record.createdAt) || Date.now(),
        status,
        error: record.error ? String(record.error) : undefined,
      } satisfies AnalystMessage;
    });
  return messages.filter((item): item is AnalystMessage => item !== null);
}

function normalizeDraftProposal(value: unknown): DraftProposal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = String(record.id || '').trim();
  const title = String(record.title || '').trim();
  if (!id || !title) {
    return null;
  }
  const entityType = record.entityType === 'core-variable'
    || record.entityType === 'narrative'
    ? record.entityType
    : null;
  const action = record.action === 'create'
    || record.action === 'update'
    || record.action === 'deactivate'
    ? record.action
    : null;
  if (!entityType || !action) {
    return null;
  }
  return {
    id,
    entityType,
    action,
    title,
    definition: record.definition ? String(record.definition) : undefined,
    keywords: Array.isArray(record.keywords)
      ? record.keywords.map((item) => String(item || '').trim()).filter(Boolean)
      : undefined,
    recordId: record.recordId ? String(record.recordId) : undefined,
    note: record.note ? String(record.note) : undefined,
  };
}

function migrateSavedChats(value: Record<string, unknown>): Record<string, SectorChatState> {
  return Object.fromEntries(Object.entries(value || {}).map(([sectorSlug, rawState]) => {
    const base = buildDefaultSectorChatState(sectorSlug);
    if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
      return [sectorSlug, base];
    }
    const record = rawState as Record<string, unknown>;
    const messages = normalizeMessageList(record.messages);
    const createdAt = Number(record.createdAt) || messages[0]?.createdAt || base.createdAt;
    const updatedAt = Number(record.updatedAt) || messages[messages.length - 1]?.createdAt || createdAt;
    return [sectorSlug, {
      threadId: String(record.threadId || '').trim() || base.threadId,
      title: String(record.title || '').trim() || base.title,
      draftText: String(record.draftText || ''),
      createdAt,
      updatedAt,
      messages,
      draftProposal: normalizeDraftProposal(record.draftProposal),
      isStreaming: Boolean(record.isStreaming),
      error: record.error ? String(record.error) : null,
    } satisfies SectorChatState];
  }));
}

function hasCompleteDraftDefinition(proposal: DraftProposal): proposal is DraftProposal & { definition: string } {
  return Boolean(proposal.title.trim() && proposal.definition?.trim());
}

function hasTargetRecord(proposal: DraftProposal): proposal is DraftProposal & { recordId: string } {
  return Boolean(proposal.recordId?.trim());
}

export function applyProposal(overlay: TaxonomyOverlay, proposal: DraftProposal): TaxonomyOverlay {
  if (proposal.entityType === 'narrative' && proposal.action === 'create') {
    if (!hasCompleteDraftDefinition(proposal)) {
      return overlay;
    }
    return {
      ...overlay,
      narratives: [
        ...overlay.narratives,
        {
          id: `narrative-${Date.now()}`,
          title: proposal.title,
          definition: proposal.definition || '',
          keywords: proposal.keywords,
          confirmationState: 'confirmed',
        },
      ],
    };
  }

  if (proposal.entityType === 'narrative' && proposal.action === 'update' && proposal.recordId) {
    if (!proposal.title.trim()) {
      return overlay;
    }
    return {
      ...overlay,
      narratives: overlay.narratives.map((record) => (
        record.id === proposal.recordId
          ? {
            ...record,
            title: proposal.title,
            definition: proposal.definition || record.definition,
            keywords: proposal.keywords ?? record.keywords,
          }
          : record
      )),
    };
  }

  if (proposal.entityType === 'narrative' && proposal.action === 'deactivate' && proposal.recordId) {
    return {
      ...overlay,
      narratives: overlay.narratives.filter((record) => record.id !== proposal.recordId),
    };
  }

  if (proposal.entityType === 'core-variable' && proposal.action === 'update' && proposal.recordId) {
    if (!proposal.title.trim()) {
      return overlay;
    }
    return {
      ...overlay,
      coreVariables: overlay.coreVariables.map((record) => (
        record.id === proposal.recordId
          ? {
            ...record,
            title: proposal.title,
            definition: proposal.definition || record.definition,
            keywords: proposal.keywords ?? record.keywords,
          }
          : record
      )),
    };
  }

  if (proposal.entityType === 'core-variable' && proposal.action === 'deactivate' && proposal.recordId) {
    return {
      ...overlay,
      coreVariables: overlay.coreVariables.filter((record) => record.id !== proposal.recordId),
    };
  }

  if (proposal.entityType !== 'core-variable' || proposal.action !== 'create') {
    return overlay;
  }
  if (!hasCompleteDraftDefinition(proposal) || hasTargetRecord(proposal)) {
    return overlay;
  }
  return {
    ...overlay,
    coreVariables: [
      ...overlay.coreVariables,
      {
        id: `core-variable-${Date.now()}`,
        title: proposal.title,
        definition: proposal.definition || '',
        keywords: proposal.keywords,
        confirmationState: 'confirmed',
      },
    ],
  };
}
