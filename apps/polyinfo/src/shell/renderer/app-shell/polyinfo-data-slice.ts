import {
  applyProposal,
  buildDefaultSectorChatState,
  loadSavedChats,
  loadSavedSnapshots,
  loadSavedTaxonomy,
  saveChats,
  saveSnapshots,
  saveTaxonomy,
  seededTaxonomyBySector,
} from '@renderer/data/taxonomy.js';
import type { AppStoreSet, AppStoreState } from './store-types.js';

const savedTaxonomy = loadSavedTaxonomy();
const savedChats = loadSavedChats();
const savedSnapshots = loadSavedSnapshots();

type PolyinfoDataSlice = Pick<AppStoreState,
  'activeWindow'
  | 'taxonomyBySector'
  | 'chatsBySector'
  | 'snapshotsBySector'
  | 'setActiveWindow'
  | 'ensureSectorTaxonomy'
  | 'ensureSectorThread'
  | 'setSectorDraftText'
  | 'upsertSectorMessage'
  | 'replaceSectorMessages'
  | 'setSectorStreaming'
  | 'setSectorError'
  | 'setSectorDraftProposal'
  | 'dismissSectorDraftProposal'
  | 'confirmSectorDraftProposal'
  | 'recordAnalysisSnapshot'
>;

export function createPolyinfoDataSlice(set: AppStoreSet, get: () => AppStoreState): PolyinfoDataSlice {
  return {
    activeWindow: '48h',
    taxonomyBySector: {
      ...seededTaxonomyBySector,
      ...savedTaxonomy,
    },
    chatsBySector: savedChats,
    snapshotsBySector: savedSnapshots,
    setActiveWindow: (window) => set({ activeWindow: window }),
    ensureSectorTaxonomy: (sectorSlug) => {
      const existing = get().taxonomyBySector[sectorSlug];
      if (existing) {
        return;
      }
      const nextTaxonomy = {
        ...get().taxonomyBySector,
        [sectorSlug]: seededTaxonomyBySector[sectorSlug] ?? {
          narratives: [],
          coreVariables: [],
          marketMappingOverrides: {},
        },
      };
      saveTaxonomy(nextTaxonomy);
      set({ taxonomyBySector: nextTaxonomy });
    },
    ensureSectorThread: (sectorSlug, title) => {
      const current = get().chatsBySector[sectorSlug];
      if (current) {
        if (title && current.title !== title) {
          const nextChats = {
            ...get().chatsBySector,
            [sectorSlug]: {
              ...current,
              title,
              updatedAt: Date.now(),
            },
          };
          saveChats(nextChats);
          set({ chatsBySector: nextChats });
        }
        return;
      }
      const nextChats = {
        ...get().chatsBySector,
        [sectorSlug]: buildDefaultSectorChatState(sectorSlug, title),
      };
      saveChats(nextChats);
      set({ chatsBySector: nextChats });
    },
    setSectorDraftText: (sectorSlug, value) => {
      const current = get().chatsBySector[sectorSlug] ?? buildDefaultSectorChatState(sectorSlug);
      const nextChats = {
        ...get().chatsBySector,
        [sectorSlug]: {
          ...current,
          draftText: value,
          updatedAt: Date.now(),
        },
      };
      saveChats(nextChats);
      set({ chatsBySector: nextChats });
    },
    upsertSectorMessage: (sectorSlug, message) => {
      const current = get().chatsBySector[sectorSlug] ?? buildDefaultSectorChatState(sectorSlug);
      const existingIndex = current.messages.findIndex((item) => item.id === message.id);
      const messages = existingIndex === -1
        ? [...current.messages, message]
        : current.messages.map((item, index) => (index === existingIndex ? message : item));
      const nextChats = {
        ...get().chatsBySector,
        [sectorSlug]: {
          ...current,
          messages,
          updatedAt: Date.now(),
        },
      };
      saveChats(nextChats);
      set({ chatsBySector: nextChats });
    },
    replaceSectorMessages: (sectorSlug, messages) => {
      const current = get().chatsBySector[sectorSlug] ?? buildDefaultSectorChatState(sectorSlug);
      const nextChats = {
        ...get().chatsBySector,
        [sectorSlug]: {
          ...current,
          messages,
          updatedAt: Date.now(),
        },
      };
      saveChats(nextChats);
      set({ chatsBySector: nextChats });
    },
    setSectorStreaming: (sectorSlug, isStreaming) => {
      const current = get().chatsBySector[sectorSlug] ?? buildDefaultSectorChatState(sectorSlug);
      const nextChats = {
        ...get().chatsBySector,
        [sectorSlug]: {
          ...current,
          isStreaming,
          updatedAt: Date.now(),
        },
      };
      saveChats(nextChats);
      set({ chatsBySector: nextChats });
    },
    setSectorError: (sectorSlug, error) => {
      const current = get().chatsBySector[sectorSlug] ?? buildDefaultSectorChatState(sectorSlug);
      const nextChats = {
        ...get().chatsBySector,
        [sectorSlug]: {
          ...current,
          error,
          updatedAt: Date.now(),
        },
      };
      saveChats(nextChats);
      set({ chatsBySector: nextChats });
    },
    setSectorDraftProposal: (sectorSlug, proposal) => {
      const current = get().chatsBySector[sectorSlug] ?? buildDefaultSectorChatState(sectorSlug);
      const nextChats = {
        ...get().chatsBySector,
        [sectorSlug]: {
          ...current,
          draftProposal: proposal,
          updatedAt: Date.now(),
        },
      };
      saveChats(nextChats);
      set({ chatsBySector: nextChats });
    },
    dismissSectorDraftProposal: (sectorSlug) => {
      const current = get().chatsBySector[sectorSlug] ?? buildDefaultSectorChatState(sectorSlug);
      const nextChats = {
        ...get().chatsBySector,
        [sectorSlug]: {
          ...current,
          draftProposal: null,
          updatedAt: Date.now(),
        },
      };
      saveChats(nextChats);
      set({ chatsBySector: nextChats });
    },
    confirmSectorDraftProposal: (sectorSlug) => {
      const proposal = get().chatsBySector[sectorSlug]?.draftProposal;
      if (!proposal) {
        return;
      }
      const currentOverlay = get().taxonomyBySector[sectorSlug] ?? {
        narratives: [],
        coreVariables: [],
        marketMappingOverrides: {},
      };
      const nextOverlay = applyProposal(currentOverlay, proposal);
      const nextTaxonomy = {
        ...get().taxonomyBySector,
        [sectorSlug]: nextOverlay,
      };
      const currentChat = get().chatsBySector[sectorSlug] ?? buildDefaultSectorChatState(sectorSlug);
      const nextChats = {
        ...get().chatsBySector,
        [sectorSlug]: {
          ...currentChat,
          draftProposal: null,
          updatedAt: Date.now(),
        },
      };
      saveTaxonomy(nextTaxonomy);
      saveChats(nextChats);
      set({
        taxonomyBySector: nextTaxonomy,
        chatsBySector: nextChats,
      });
    },
    recordAnalysisSnapshot: (sectorSlug, snapshot) => {
      const current = get().snapshotsBySector[sectorSlug] ?? [];
      const existingIndex = current.findIndex((item) => item.id === snapshot.id);
      const nextSectorSnapshots = existingIndex === -1
        ? [snapshot, ...current]
        : current.map((item, index) => (index === existingIndex ? snapshot : item));
      const nextSnapshots = {
        ...get().snapshotsBySector,
        [sectorSlug]: nextSectorSnapshots
          .sort((left, right) => right.createdAt - left.createdAt)
          .slice(0, 50),
      };
      saveSnapshots(nextSnapshots);
      set({ snapshotsBySector: nextSnapshots });
    },
  };
}
