import type { DraftProposal, TaxonomyOverlay } from './types.js';

const TAXONOMY_STORAGE_KEY = 'nimi:polyinfo:taxonomy:v1';
const CHAT_STORAGE_KEY = 'nimi:polyinfo:chat:v1';
const SNAPSHOT_STORAGE_KEY = 'nimi:polyinfo:snapshots:v1';

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

export function loadSavedChats(): Record<string, unknown> {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, unknown>;
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

export function loadSavedSnapshots(): Record<string, unknown> {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, unknown>;
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
