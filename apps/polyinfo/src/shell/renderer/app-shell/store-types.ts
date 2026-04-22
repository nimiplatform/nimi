import type { RuntimeDefaults } from '@renderer/bridge';
import type {
  AnalysisSnapshot,
  AnalystMessage,
  AuthUser,
  DraftProposal,
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
  setAuthBootstrapping: () => void;
  setAuthSession: (user: AuthUser, token: string, refreshToken?: string) => void;
  clearAuthSession: () => void;
  setBootstrapReady: (ready: boolean) => void;
  setBootstrapError: (error: string | null) => void;
  setRuntimeDefaults: (defaults: RuntimeDefaults) => void;
  setAIConfig: (config: AIConfig) => void;
  setActiveWindow: (window: WindowKey) => void;
  ensureSectorTaxonomy: (sectorSlug: string) => void;
  ensureSectorThread: (sectorSlug: string, title?: string) => void;
  setSectorDraftText: (sectorSlug: string, value: string) => void;
  upsertSectorMessage: (sectorSlug: string, message: AnalystMessage) => void;
  replaceSectorMessages: (sectorSlug: string, messages: AnalystMessage[]) => void;
  setSectorStreaming: (sectorSlug: string, isStreaming: boolean) => void;
  setSectorError: (sectorSlug: string, error: string | null) => void;
  setSectorDraftProposal: (sectorSlug: string, proposal: DraftProposal | null) => void;
  dismissSectorDraftProposal: (sectorSlug: string) => void;
  confirmSectorDraftProposal: (sectorSlug: string) => void;
  recordAnalysisSnapshot: (sectorSlug: string, snapshot: AnalysisSnapshot) => void;
};

export type AppStoreSet = (
  updater: Partial<AppStoreState> | ((state: AppStoreState) => Partial<AppStoreState>),
) => void;
