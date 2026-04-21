import { create } from 'zustand';
import {
  loadSavedChats,
  loadSavedSnapshots,
  loadSavedTaxonomy,
  saveChats,
  saveSnapshots,
  saveTaxonomy,
  seededTaxonomyBySector,
  applyProposal,
} from '@renderer/data/taxonomy.js';
import type {
  AnalysisSnapshot,
  AnalystMessage,
  AuthStatus,
  AuthUser,
  DraftProposal,
  SectorChatState,
  TaxonomyOverlay,
  WindowKey,
} from '@renderer/data/types.js';
import type { RuntimeDefaults } from '@renderer/bridge';

const savedTaxonomy = loadSavedTaxonomy();
const savedChats = loadSavedChats() as Record<string, SectorChatState>;
const savedSnapshots = loadSavedSnapshots() as Record<string, AnalysisSnapshot[]>;

function buildDefaultChatState(): SectorChatState {
  return {
    messages: [],
    draftProposal: null,
    isStreaming: false,
    error: null,
  };
}

type AppStore = {
  auth: {
    status: AuthStatus;
    user: AuthUser | null;
    token: string;
    refreshToken: string;
  };
  bootstrapReady: boolean;
  bootstrapError: string | null;
  runtimeDefaults: RuntimeDefaults | null;
  activeWindow: WindowKey;
  taxonomyBySector: Record<string, TaxonomyOverlay>;
  chatsBySector: Record<string, SectorChatState>;
  snapshotsBySector: Record<string, AnalysisSnapshot[]>;
  setAuthSession: (user: AuthUser, token: string, refreshToken: string) => void;
  clearAuthSession: () => void;
  setBootstrapReady: (ready: boolean) => void;
  setBootstrapError: (error: string | null) => void;
  setRuntimeDefaults: (defaults: RuntimeDefaults) => void;
  setActiveWindow: (window: WindowKey) => void;
  ensureSectorTaxonomy: (sectorSlug: string) => void;
  upsertSectorMessage: (sectorSlug: string, message: AnalystMessage) => void;
  replaceSectorMessages: (sectorSlug: string, messages: AnalystMessage[]) => void;
  setSectorStreaming: (sectorSlug: string, isStreaming: boolean) => void;
  setSectorError: (sectorSlug: string, error: string | null) => void;
  setSectorDraftProposal: (sectorSlug: string, proposal: DraftProposal | null) => void;
  dismissSectorDraftProposal: (sectorSlug: string) => void;
  confirmSectorDraftProposal: (sectorSlug: string) => void;
  recordAnalysisSnapshot: (sectorSlug: string, snapshot: AnalysisSnapshot) => void;
};

export const useAppStore = create<AppStore>((set, get) => ({
  auth: {
    status: 'bootstrapping',
    user: null,
    token: '',
    refreshToken: '',
  },
  bootstrapReady: false,
  bootstrapError: null,
  runtimeDefaults: null,
  activeWindow: '48h',
  taxonomyBySector: {
    ...seededTaxonomyBySector,
    ...savedTaxonomy,
  },
  chatsBySector: savedChats,
  snapshotsBySector: savedSnapshots,
  setAuthSession(user, token, refreshToken) {
    set({
      auth: { status: 'authenticated', user, token, refreshToken },
    });
  },
  clearAuthSession() {
    set({
      auth: { status: 'anonymous', user: null, token: '', refreshToken: '' },
    });
  },
  setBootstrapReady(ready) {
    set({ bootstrapReady: ready });
  },
  setBootstrapError(error) {
    set({ bootstrapError: error });
  },
  setRuntimeDefaults(defaults) {
    set({ runtimeDefaults: defaults });
  },
  setActiveWindow(window) {
    set({ activeWindow: window });
  },
  ensureSectorTaxonomy(sectorSlug) {
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
  upsertSectorMessage(sectorSlug, message) {
    const current = get().chatsBySector[sectorSlug] ?? buildDefaultChatState();
    const existingIndex = current.messages.findIndex((item) => item.id === message.id);
    const messages = existingIndex === -1
      ? [...current.messages, message]
      : current.messages.map((item, index) => (index === existingIndex ? message : item));
    const nextChats = {
      ...get().chatsBySector,
      [sectorSlug]: {
        ...current,
        messages,
      },
    };
    saveChats(nextChats);
    set({ chatsBySector: nextChats });
  },
  replaceSectorMessages(sectorSlug, messages) {
    const current = get().chatsBySector[sectorSlug] ?? buildDefaultChatState();
    const nextChats = {
      ...get().chatsBySector,
      [sectorSlug]: {
        ...current,
        messages,
      },
    };
    saveChats(nextChats);
    set({ chatsBySector: nextChats });
  },
  setSectorStreaming(sectorSlug, isStreaming) {
    const current = get().chatsBySector[sectorSlug] ?? buildDefaultChatState();
    const nextChats = {
      ...get().chatsBySector,
      [sectorSlug]: {
        ...current,
        isStreaming,
      },
    };
    saveChats(nextChats);
    set({ chatsBySector: nextChats });
  },
  setSectorError(sectorSlug, error) {
    const current = get().chatsBySector[sectorSlug] ?? buildDefaultChatState();
    const nextChats = {
      ...get().chatsBySector,
      [sectorSlug]: {
        ...current,
        error,
      },
    };
    saveChats(nextChats);
    set({ chatsBySector: nextChats });
  },
  setSectorDraftProposal(sectorSlug, proposal) {
    const current = get().chatsBySector[sectorSlug] ?? buildDefaultChatState();
    const nextChats = {
      ...get().chatsBySector,
      [sectorSlug]: {
        ...current,
        draftProposal: proposal,
      },
    };
    saveChats(nextChats);
    set({ chatsBySector: nextChats });
  },
  dismissSectorDraftProposal(sectorSlug) {
    const current = get().chatsBySector[sectorSlug] ?? buildDefaultChatState();
    const nextChats = {
      ...get().chatsBySector,
      [sectorSlug]: {
        ...current,
        draftProposal: null,
      },
    };
    saveChats(nextChats);
    set({ chatsBySector: nextChats });
  },
  confirmSectorDraftProposal(sectorSlug) {
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
    const currentChat = get().chatsBySector[sectorSlug] ?? buildDefaultChatState();
    const nextChats = {
      ...get().chatsBySector,
      [sectorSlug]: {
        ...currentChat,
        draftProposal: null,
      },
    };
    saveTaxonomy(nextTaxonomy);
    saveChats(nextChats);
    set({
      taxonomyBySector: nextTaxonomy,
      chatsBySector: nextChats,
    });
  },
  recordAnalysisSnapshot(sectorSlug, snapshot) {
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
}));
