import type { RuntimeDefaults } from '@renderer/bridge';
import type {
  AnalysisSnapshot,
  AnalystMessage,
  AuthUser,
  CoreVariableRecord,
  CustomSectorRecord,
  DraftProposal,
  ImportedEventRecord,
  NarrativeRecord,
  SectorChatState,
  TaxonomyOverlay,
  WindowKey,
} from '@renderer/data/types.js';
import type { AIConfig } from '@nimiplatform/sdk/mod';

export type AuthStatus = 'bootstrapping' | 'authenticated' | 'anonymous';

export type AppStoreState = {
  auth: {
    status: AuthStatus;
    user: AuthUser | null;
    token: string;
    refreshToken: string;
  };
  bootstrapReady: boolean;
  bootstrapError: string | null;
  runtimeDefaults: RuntimeDefaults | null;
  aiConfig: AIConfig;
  activeWindow: WindowKey;
  taxonomyBySector: Record<string, TaxonomyOverlay>;
  chatsBySector: Record<string, SectorChatState>;
  snapshotsBySector: Record<string, AnalysisSnapshot[]>;
  customSectors: Record<string, CustomSectorRecord>;
  importedEventsBySector: Record<string, ImportedEventRecord[]>;
  lastActiveSectorId: string | null;
  setAuthBootstrapping: () => void;
  setAuthSession: (user: AuthUser, token: string, refreshToken?: string) => void;
  clearAuthSession: () => void;
  setBootstrapReady: (ready: boolean) => void;
  setBootstrapError: (error: string | null) => void;
  setRuntimeDefaults: (defaults: RuntimeDefaults) => void;
  setAIConfig: (config: AIConfig) => void;
  setActiveWindow: (window: WindowKey) => void;
  setLastActiveSectorId: (sectorId: string | null) => void;
  ensureSectorTaxonomy: (sectorSlug: string) => void;
  ensureSectorThread: (sectorSlug: string, title?: string) => void;
  addCustomSector: (title: string) => string;
  renameCustomSector: (sectorId: string, title: string) => void;
  deleteCustomSector: (sectorId: string) => void;
  addNarrativeRecord: (sectorId: string, input: Pick<NarrativeRecord, 'title' | 'definition'>) => void;
  removeNarrativeRecord: (sectorId: string, recordId: string) => void;
  addCoreVariableRecord: (sectorId: string, input: Pick<CoreVariableRecord, 'title' | 'definition'>) => void;
  removeCoreVariableRecord: (sectorId: string, recordId: string) => void;
  upsertImportedEvent: (sectorId: string, eventRecord: ImportedEventRecord) => void;
  removeImportedEvent: (sectorId: string, eventId: string) => void;
  setSectorDraftText: (sectorSlug: string, value: string) => void;
  upsertSectorMessage: (sectorSlug: string, message: AnalystMessage) => void;
  replaceSectorMessages: (sectorSlug: string, messages: AnalystMessage[]) => void;
  setSectorStreaming: (sectorSlug: string, isStreaming: boolean) => void;
  setSectorError: (sectorSlug: string, error: string | null) => void;
  setSectorDraftProposal: (sectorSlug: string, proposal: DraftProposal | null) => void;
  dismissSectorDraftProposal: (sectorSlug: string) => void;
  confirmSectorDraftProposal: (sectorSlug: string) => void;
  resetSectorConversation: (sectorSlug: string) => void;
  recordAnalysisSnapshot: (sectorSlug: string, snapshot: AnalysisSnapshot) => void;
};

export type AppStoreSet = (
  updater: Partial<AppStoreState> | ((state: AppStoreState) => Partial<AppStoreState>),
) => void;
