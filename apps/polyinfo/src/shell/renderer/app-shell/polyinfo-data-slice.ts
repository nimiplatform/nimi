import {
  applyProposal,
  buildDefaultSectorChatState,
  loadLastActiveSectorId,
  loadSavedChats,
  loadSavedCustomSectors,
  loadSavedImportedEvents,
  loadSavedSnapshots,
  loadSavedTaxonomy,
  saveChats,
  saveCustomSectors,
  saveImportedEvents,
  saveLastActiveSectorId,
  saveSnapshots,
  saveTaxonomy,
  seededTaxonomyBySector,
} from '@renderer/data/taxonomy.js';
import type { AppStoreSet, AppStoreState } from './store-types.js';

const savedTaxonomy = loadSavedTaxonomy();
const savedChats = loadSavedChats();
const savedSnapshots = loadSavedSnapshots();
const savedCustomSectors = loadSavedCustomSectors();
const savedImportedEvents = loadSavedImportedEvents();
const savedLastActiveSectorId = loadLastActiveSectorId();

type PolyinfoDataSlice = Pick<AppStoreState,
  'activeWindow'
  | 'taxonomyBySector'
  | 'chatsBySector'
  | 'snapshotsBySector'
  | 'customSectors'
  | 'importedEventsBySector'
  | 'lastActiveSectorId'
  | 'setActiveWindow'
  | 'setLastActiveSectorId'
  | 'ensureSectorTaxonomy'
  | 'ensureSectorThread'
  | 'addCustomSector'
  | 'renameCustomSector'
  | 'deleteCustomSector'
  | 'addNarrativeRecord'
  | 'removeNarrativeRecord'
  | 'addCoreVariableRecord'
  | 'removeCoreVariableRecord'
  | 'upsertImportedEvent'
  | 'removeImportedEvent'
  | 'setSectorDraftText'
  | 'upsertSectorMessage'
  | 'replaceSectorMessages'
  | 'setSectorStreaming'
  | 'setSectorError'
  | 'setSectorDraftProposal'
  | 'dismissSectorDraftProposal'
  | 'confirmSectorDraftProposal'
  | 'resetSectorConversation'
  | 'recordAnalysisSnapshot'
>;

function persistTaxonomy(value: Record<string, AppStoreState['taxonomyBySector'][string]>) {
  saveTaxonomy(value);
  return value;
}

function persistChats(value: Record<string, AppStoreState['chatsBySector'][string]>) {
  saveChats(value);
  return value;
}

function persistSnapshots(value: Record<string, AppStoreState['snapshotsBySector'][string]>) {
  saveSnapshots(value);
  return value;
}

function persistCustomSectors(value: Record<string, AppStoreState['customSectors'][string]>) {
  saveCustomSectors(value);
  return value;
}

function persistImportedEvents(value: Record<string, AppStoreState['importedEventsBySector'][string]>) {
  saveImportedEvents(value);
  return value;
}

export function createPolyinfoDataSlice(set: AppStoreSet, get: () => AppStoreState): PolyinfoDataSlice {
  return {
    activeWindow: '48h',
    taxonomyBySector: {
      ...seededTaxonomyBySector,
      ...savedTaxonomy,
    },
    chatsBySector: savedChats,
    snapshotsBySector: savedSnapshots,
    customSectors: savedCustomSectors,
    importedEventsBySector: savedImportedEvents,
    lastActiveSectorId: savedLastActiveSectorId,
    setActiveWindow: (window) => set({ activeWindow: window }),
    setLastActiveSectorId: (sectorId) => {
      saveLastActiveSectorId(sectorId);
      set({ lastActiveSectorId: sectorId });
    },
    ensureSectorTaxonomy: (sectorSlug) => {
      const existing = get().taxonomyBySector[sectorSlug];
      if (existing) {
        return;
      }
      const nextTaxonomy = persistTaxonomy({
        ...get().taxonomyBySector,
        [sectorSlug]: seededTaxonomyBySector[sectorSlug] ?? {
          narratives: [],
          coreVariables: [],
        },
      });
      set({ taxonomyBySector: nextTaxonomy });
    },
    ensureSectorThread: (sectorSlug, title) => {
      const current = get().chatsBySector[sectorSlug];
      if (current) {
        if (title && current.title !== title) {
          const nextChats = persistChats({
            ...get().chatsBySector,
            [sectorSlug]: {
              ...current,
              title,
              updatedAt: Date.now(),
            },
          });
          set({ chatsBySector: nextChats });
        }
        return;
      }
      const nextChats = persistChats({
        ...get().chatsBySector,
        [sectorSlug]: buildDefaultSectorChatState(sectorSlug, title),
      });
      set({ chatsBySector: nextChats });
    },
    addCustomSector: (title) => {
      const now = Date.now();
      const normalizedTitle = title.trim() || 'New Workspace';
      const sectorId = `custom-${now}`;
      const nextCustomSectors = persistCustomSectors({
        ...get().customSectors,
        [sectorId]: {
          id: sectorId,
          title: normalizedTitle,
          createdAt: now,
          updatedAt: now,
        },
      });
      const nextTaxonomy = persistTaxonomy({
        ...get().taxonomyBySector,
        [sectorId]: {
          narratives: [],
          coreVariables: [],
        },
      });
      const nextImportedEvents = persistImportedEvents({
        ...get().importedEventsBySector,
        [sectorId]: [],
      });
      saveLastActiveSectorId(sectorId);
      set({
        customSectors: nextCustomSectors,
        taxonomyBySector: nextTaxonomy,
        importedEventsBySector: nextImportedEvents,
        lastActiveSectorId: sectorId,
      });
      return sectorId;
    },
    renameCustomSector: (sectorId, title) => {
      const current = get().customSectors[sectorId];
      if (!current) {
        return;
      }
      const normalizedTitle = title.trim();
      if (!normalizedTitle) {
        return;
      }
      const nextCustomSectors = persistCustomSectors({
        ...get().customSectors,
        [sectorId]: {
          ...current,
          title: normalizedTitle,
          updatedAt: Date.now(),
        },
      });
      set({ customSectors: nextCustomSectors });
    },
    deleteCustomSector: (sectorId) => {
      if (!get().customSectors[sectorId]) {
        return;
      }
      const nextCustomSectors = { ...get().customSectors };
      const nextTaxonomy = { ...get().taxonomyBySector };
      const nextChats = { ...get().chatsBySector };
      const nextSnapshots = { ...get().snapshotsBySector };
      const nextImportedEvents = { ...get().importedEventsBySector };
      delete nextCustomSectors[sectorId];
      delete nextTaxonomy[sectorId];
      delete nextChats[sectorId];
      delete nextSnapshots[sectorId];
      delete nextImportedEvents[sectorId];
      saveCustomSectors(nextCustomSectors);
      saveTaxonomy(nextTaxonomy);
      saveChats(nextChats);
      saveSnapshots(nextSnapshots);
      saveImportedEvents(nextImportedEvents);
      const nextLastActiveSectorId = get().lastActiveSectorId === sectorId ? null : get().lastActiveSectorId;
      saveLastActiveSectorId(nextLastActiveSectorId);
      set({
        customSectors: nextCustomSectors,
        taxonomyBySector: nextTaxonomy,
        chatsBySector: nextChats,
        snapshotsBySector: nextSnapshots,
        importedEventsBySector: nextImportedEvents,
        lastActiveSectorId: nextLastActiveSectorId,
      });
    },
    addNarrativeRecord: (sectorId, input) => {
      const currentOverlay = get().taxonomyBySector[sectorId] ?? { narratives: [], coreVariables: [] };
      const nextTaxonomy = persistTaxonomy({
        ...get().taxonomyBySector,
        [sectorId]: {
          ...currentOverlay,
          narratives: [
            ...currentOverlay.narratives,
            {
              id: `narrative-${Date.now()}`,
              title: input.title.trim(),
              definition: input.definition.trim(),
              confirmationState: 'confirmed',
            },
          ],
        },
      });
      set({ taxonomyBySector: nextTaxonomy });
    },
    removeNarrativeRecord: (sectorId, recordId) => {
      const currentOverlay = get().taxonomyBySector[sectorId];
      if (!currentOverlay) {
        return;
      }
      const nextTaxonomy = persistTaxonomy({
        ...get().taxonomyBySector,
        [sectorId]: {
          ...currentOverlay,
          narratives: currentOverlay.narratives.filter((record) => record.id !== recordId),
        },
      });
      set({ taxonomyBySector: nextTaxonomy });
    },
    addCoreVariableRecord: (sectorId, input) => {
      const currentOverlay = get().taxonomyBySector[sectorId] ?? { narratives: [], coreVariables: [] };
      const nextTaxonomy = persistTaxonomy({
        ...get().taxonomyBySector,
        [sectorId]: {
          ...currentOverlay,
          coreVariables: [
            ...currentOverlay.coreVariables,
            {
              id: `core-variable-${Date.now()}`,
              title: input.title.trim(),
              definition: input.definition.trim(),
              confirmationState: 'confirmed',
            },
          ],
        },
      });
      set({ taxonomyBySector: nextTaxonomy });
    },
    removeCoreVariableRecord: (sectorId, recordId) => {
      const currentOverlay = get().taxonomyBySector[sectorId];
      if (!currentOverlay) {
        return;
      }
      const nextTaxonomy = persistTaxonomy({
        ...get().taxonomyBySector,
        [sectorId]: {
          ...currentOverlay,
          coreVariables: currentOverlay.coreVariables.filter((record) => record.id !== recordId),
        },
      });
      set({ taxonomyBySector: nextTaxonomy });
    },
    upsertImportedEvent: (sectorId, eventRecord) => {
      const currentEvents = get().importedEventsBySector[sectorId] ?? [];
      const existingIndex = currentEvents.findIndex((item) =>
        item.id === eventRecord.id || item.sourceEventId === eventRecord.sourceEventId,
      );
      const nextSectorEvents = existingIndex === -1
        ? [eventRecord, ...currentEvents]
        : currentEvents.map((item, index) => (index === existingIndex ? eventRecord : item));
      const nextImportedEvents = persistImportedEvents({
        ...get().importedEventsBySector,
        [sectorId]: nextSectorEvents.sort((left, right) => right.updatedAt - left.updatedAt),
      });
      set({ importedEventsBySector: nextImportedEvents });
    },
    removeImportedEvent: (sectorId, eventId) => {
      const currentEvents = get().importedEventsBySector[sectorId] ?? [];
      const nextImportedEvents = persistImportedEvents({
        ...get().importedEventsBySector,
        [sectorId]: currentEvents.filter((item) => item.id !== eventId),
      });
      set({ importedEventsBySector: nextImportedEvents });
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
      persistChats(nextChats);
      set({ chatsBySector: nextChats });
    },
    upsertSectorMessage: (sectorSlug, message) => {
      const current = get().chatsBySector[sectorSlug] ?? buildDefaultSectorChatState(sectorSlug);
      const existingIndex = current.messages.findIndex((item) => item.id === message.id);
      const messages = existingIndex === -1
        ? [...current.messages, message]
        : current.messages.map((item, index) => (index === existingIndex ? message : item));
      const nextChats = persistChats({
        ...get().chatsBySector,
        [sectorSlug]: {
          ...current,
          messages,
          updatedAt: Date.now(),
        },
      });
      set({ chatsBySector: nextChats });
    },
    replaceSectorMessages: (sectorSlug, messages) => {
      const current = get().chatsBySector[sectorSlug] ?? buildDefaultSectorChatState(sectorSlug);
      const nextChats = persistChats({
        ...get().chatsBySector,
        [sectorSlug]: {
          ...current,
          messages,
          updatedAt: Date.now(),
        },
      });
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
      persistChats(nextChats);
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
      persistChats(nextChats);
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
      persistChats(nextChats);
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
      persistChats(nextChats);
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
      };
      const nextTaxonomy = persistTaxonomy({
        ...get().taxonomyBySector,
        [sectorSlug]: applyProposal(currentOverlay, proposal),
      });
      const currentChat = get().chatsBySector[sectorSlug] ?? buildDefaultSectorChatState(sectorSlug);
      const nextChats = persistChats({
        ...get().chatsBySector,
        [sectorSlug]: {
          ...currentChat,
          draftProposal: null,
          updatedAt: Date.now(),
        },
      });
      set({
        taxonomyBySector: nextTaxonomy,
        chatsBySector: nextChats,
      });
    },
    resetSectorConversation: (sectorSlug) => {
      const current = get().chatsBySector[sectorSlug];
      const base = buildDefaultSectorChatState(
        sectorSlug,
        current?.title || sectorSlug,
      );
      const nextChats = persistChats({
        ...get().chatsBySector,
        [sectorSlug]: {
          ...base,
          threadId: current?.threadId || base.threadId,
          createdAt: current?.createdAt || base.createdAt,
        },
      });
      set({ chatsBySector: nextChats });
    },
    recordAnalysisSnapshot: (sectorSlug, snapshot) => {
      const current = get().snapshotsBySector[sectorSlug] ?? [];
      const existingIndex = current.findIndex((item) => item.id === snapshot.id);
      const nextSectorSnapshots = existingIndex === -1
        ? [snapshot, ...current]
        : current.map((item, index) => (index === existingIndex ? snapshot : item));
      const nextSnapshots = persistSnapshots({
        ...get().snapshotsBySector,
        [sectorSlug]: nextSectorSnapshots
          .sort((left, right) => right.createdAt - left.createdAt)
          .slice(0, 50),
      });
      set({ snapshotsBySector: nextSnapshots });
    },
  };
}
