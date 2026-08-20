import type {
  NimiRealmCreatorEligibility,
  NimiRealmGroupChatListResult,
  NimiRealmNotificationListView,
  NimiRealmNotificationUnreadView,
  NimiRealmRequestDataExportOutput,
} from '@nimiplatform/sdk/realm';
import type { NimiPortableAppAIConfig } from '@nimiplatform/sdk/ai';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppArtifactImageMime,
  NimiLocalAppAssetsClient,
} from '@nimiplatform/sdk/app';
import type { RealmListChatsResultDto } from '@nimiplatform/kit/features/chat/realm';
import type {
  AnyNimiCanonicalRendererHostBindingsV1,
  NimiRendererHostFacadeV1,
  NimiRendererHostMethodMap,
  NimiRendererHostResult,
} from '@nimiplatform/kit/shell/renderer/host';

import type { RuntimePlatformProjection } from '../shell/auth/runtime-platform.js';
import type { StudioCapabilityRunInput, StudioCapabilityRunResult } from '../ai-studio-core/runtime-types.js';
import type { LabAIConfigSummary } from '../lab/lab-ai-config.js';
import type { LabImageHistoryRecord } from '../lab/lab-image-history.js';
import type {
  LabPromptDraftKey,
  LabPromptDraftLoadResult,
  LabPromptDraftSaveResult,
  LabPreferences,
} from '../lab/lab-preferences.js';
import type { LabConversationJourneyResult } from '../lab/local-app-conversation-journey.js';
import type { StudioRunHistory, StudioRunHistoryRecord } from '../ai-studio-core/index.js';
import type {
  ClaimWorldTourViewerLaunchInput,
  OpenWorldTourWindowInput,
  OpenWorldTourWindowResponse,
  ResolvedWorldTourFixture,
  ResolveWorldTourFixtureInput,
} from '../lab/world-tour/world-tour-shared.js';

export interface LabEcosystemReferenceProjection {
  readonly ecosystemRevision: number;
}

export interface LabPersonaReferenceProjection {
  readonly displayName: string;
  readonly userId: string;
  readonly role: string;
}

export interface LabRendererProjectionPort {
  runtimePlatform(): Promise<RuntimePlatformProjection>;
  aiConfigSummary(): Promise<LabAIConfigSummary>;
  runHistory(): Promise<StudioRunHistory>;
  imageHistory(): Promise<readonly LabImageHistoryRecord[]>;
  ecosystemReference(): LabEcosystemReferenceProjection | null;
  personaReference(): LabPersonaReferenceProjection | null;
  preferences(): LabPreferences;
  promptDraft(key: LabPromptDraftKey, enabled: boolean): LabPromptDraftLoadResult;
}

export interface LabRendererCommandPort {
  nextRunIdentity(): Promise<{ readonly runId: string; readonly createdAt: string }>;
  appendRunHistory(record: StudioRunHistoryRecord): Promise<StudioRunHistory>;
  removeRunHistory(recordId: string): Promise<StudioRunHistory>;
  clearRunHistory(input: { readonly capabilityId?: string }): Promise<StudioRunHistory>;
  appendImageHistory(record: LabImageHistoryRecord): Promise<readonly LabImageHistoryRecord[]>;
  removeImageHistory(runId: string): Promise<readonly LabImageHistoryRecord[]>;
  clearImageHistory(input: { readonly capabilityId?: string }): Promise<readonly LabImageHistoryRecord[]>;
  savePreferences(preferences: LabPreferences): Promise<void>;
  savePromptDraft(key: LabPromptDraftKey, prompt: string, enabled: boolean): Promise<LabPromptDraftSaveResult>;
  copyText(text: string): Promise<NimiRendererHostResult<{ readonly copied: boolean }>>;
  exportText(input: { readonly filename: string; readonly body: string }): Promise<NimiRendererHostResult<{ readonly filename: string }>>;
  exportArtifact(input: { readonly filename: string; readonly url: string }): Promise<NimiRendererHostResult<{ readonly filename: string }>>;
  resolveWorldTourFixture(input: ResolveWorldTourFixtureInput): Promise<ResolvedWorldTourFixture>;
  openWorldTourWindow(input: OpenWorldTourWindowInput): Promise<OpenWorldTourWindowResponse>;
  claimWorldTourViewerLaunch(input: ClaimWorldTourViewerLaunchInput): Promise<ResolvedWorldTourFixture>;
  saveWorldTourViewerPreset(input: { readonly manifestPath: string; readonly presetJson: string }): Promise<{ readonly manifestPath: string; readonly presetPath: string }>;
  localAppSessionStatus(): Promise<{ readonly state: string; readonly sessionBound: boolean }>;
  localAppConversationJourney(input: { readonly agentHandle: NimiLocalAppAgentHandle; readonly text: string }): Promise<LabConversationJourneyResult>;
  localAppConversationSnapshot(input: { readonly agentHandle: NimiLocalAppAgentHandle; readonly conversationAnchorId: string }): Promise<Readonly<Record<string, unknown>>>;
  localAppStorageRoundTrip(input: { readonly relativePath: string; readonly value: Readonly<Record<string, string | number>> }): Promise<{ readonly sizeBytes: number; readonly removed: boolean }>;
  runtimeLog(input: Readonly<Record<string, unknown>>): Promise<NimiRendererHostResult<{ readonly recorded: boolean }>>;
  rendererLog(input: Readonly<Record<string, unknown>>): Promise<NimiRendererHostResult<{ readonly recorded: boolean }>>;
}

export interface LabRendererEventPort {
  subscribe(eventType: string, listener: (payload: unknown) => void): () => void;
}

export interface LabRendererSdkPort {
  runCapability(input: StudioCapabilityRunInput): Promise<StudioCapabilityRunResult>;
  listLocalAppVoiceAssets(): Promise<readonly {
    readonly voiceAssetId: string;
    readonly creationSource: string;
    readonly status: string;
  }[]>;
  uploadLocalAppArtifact(input: {
    readonly bytes: Uint8Array;
    readonly mimeType: NimiLocalAppArtifactImageMime;
  }): Promise<{ readonly artifactId: string; readonly sizeBytes: number; readonly mimeType: NimiLocalAppArtifactImageMime }>;
  aiConfig: {
    get(): Promise<NimiPortableAppAIConfig | null>;
  };
  modelConfig: {
    localSelections(): Promise<readonly {
      readonly capabilityContract: string;
      readonly state: 'selected' | 'broken';
      readonly loadoutId: null;
      readonly displayName: string | null;
      readonly supportedFeatures: readonly string[];
      readonly reasons: readonly string[];
      readonly effectiveDefaults: Readonly<Record<string, string>> | null;
    }[]>;
  };
  storage: {
    readonly assets: NimiLocalAppAssetsClient;
  };
  settings: {
    notificationUnread(): Promise<NimiRealmNotificationUnreadView>;
    notifications(): Promise<NimiRealmNotificationListView>;
    requestDataExport(): Promise<NimiRealmRequestDataExportOutput>;
    creatorEligibility(): Promise<NimiRealmCreatorEligibility>;
    humanChats(): Promise<RealmListChatsResultDto>;
    groupChats(): Promise<NimiRealmGroupChatListResult>;
  };
}

export interface LabRendererRouteView {
  readonly pathname: string;
  readonly search: readonly { readonly key: string; readonly value: string }[];
  readonly fragment: string | null;
}

export interface LabRendererRoutePort {
  get(): LabRendererRouteView;
  subscribe(listener: () => void): () => void;
  navigate(next: LabRendererRouteView): Promise<void>;
}

export interface LabRendererClockView {
  now(): number;
}

export type LabCanonicalRendererBindings = Omit<
  AnyNimiCanonicalRendererHostBindingsV1,
  'app' | 'clock' | 'kit' | 'route' | 'sdk'
> & {
  readonly kit: NimiRendererHostFacadeV1<NimiRendererHostMethodMap>;
  readonly sdk: LabRendererSdkPort;
  readonly app: {
    readonly projection: LabRendererProjectionPort;
    readonly commands: LabRendererCommandPort;
    readonly events: LabRendererEventPort;
  };
  readonly route: LabRendererRoutePort;
  readonly clock: LabRendererClockView;
};
