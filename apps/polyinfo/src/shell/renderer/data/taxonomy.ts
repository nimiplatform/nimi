import type {
  AnalysisSnapshot,
  AnalystMessage,
  AnalystRuntimeSettings,
  DraftProposal,
  SectorChatState,
  TaxonomyOverlay,
} from './types.js';

const TAXONOMY_STORAGE_KEY = 'nimi:polyinfo:taxonomy:v1';
const CHAT_STORAGE_KEY = 'nimi:polyinfo:chat:v1';
const SNAPSHOT_STORAGE_KEY = 'nimi:polyinfo:snapshots:v1';
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
    marketMappingOverrides: {},
  },
};

export function loadSavedTaxonomy(): Record<string, TaxonomyOverlay> {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(TAXONOMY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, TaxonomyOverlay>;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export function saveTaxonomy(value: Record<string, TaxonomyOverlay>): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(TAXONOMY_STORAGE_KEY, JSON.stringify(value));
}

export function loadSavedChats(): Record<string, SectorChatState> {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return {};
    return migrateSavedChats(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return {};
  }
}

export function saveChats(value: Record<string, unknown>): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(value));
}

export function loadSavedSnapshots(): Record<string, AnalysisSnapshot[]> {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
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
  } catch {
    return {};
  }
}

export function saveSnapshots(value: Record<string, unknown>): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(value));
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
    || record.entityType === 'market-mapping'
    || record.entityType === 'narrative'
    ? record.entityType
    : null;
  const action = record.action === 'create'
    || record.action === 'update'
    || record.action === 'deactivate'
    || record.action === 'remap-market'
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
    marketId: record.marketId ? String(record.marketId) : undefined,
    narrativeId: record.narrativeId ? String(record.narrativeId) : undefined,
    coreVariableIds: Array.isArray(record.coreVariableIds)
      ? record.coreVariableIds.map((item) => String(item || '').trim()).filter(Boolean)
      : undefined,
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

export function applyProposal(overlay: TaxonomyOverlay, proposal: DraftProposal): TaxonomyOverlay {
  if (proposal.entityType === 'market-mapping' && proposal.action === 'remap-market' && proposal.marketId) {
    const nextMappingOverrides = {
      ...overlay.marketMappingOverrides,
      [proposal.marketId]: {
        narrativeId: proposal.narrativeId,
        coreVariableIds: proposal.coreVariableIds ?? [],
      },
    };

    return {
      ...overlay,
      marketMappingOverrides: nextMappingOverrides,
    };
  }

  if (proposal.entityType === 'narrative' && proposal.action === 'create') {
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
    const narratives = overlay.narratives.filter((record) => record.id !== proposal.recordId);
    const marketMappingOverrides = Object.fromEntries(
      Object.entries(overlay.marketMappingOverrides).map(([marketId, mapping]) => [
        marketId,
        mapping.narrativeId === proposal.recordId ? { ...mapping, narrativeId: undefined } : mapping,
      ]),
    );
    return {
      ...overlay,
      narratives,
      marketMappingOverrides,
    };
  }

  if (proposal.entityType === 'core-variable' && proposal.action === 'update' && proposal.recordId) {
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
    const coreVariables = overlay.coreVariables.filter((record) => record.id !== proposal.recordId);
    const marketMappingOverrides = Object.fromEntries(
      Object.entries(overlay.marketMappingOverrides).map(([marketId, mapping]) => [
        marketId,
        {
          ...mapping,
          coreVariableIds: (mapping.coreVariableIds ?? []).filter((id) => id !== proposal.recordId),
        },
      ]),
    );
    return {
      ...overlay,
      coreVariables,
      marketMappingOverrides,
    };
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
