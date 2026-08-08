import type {
  NimiRealmCreatorEligibility,
  NimiRealmGroupChatListResult,
  NimiRealmNotificationListView,
  NimiRealmNotificationUnreadView,
  NimiRealmRequestDataExportOutput,
} from '@nimiplatform/sdk/realm';
import type {
  NimiPortableAppAIConfig,
  NimiPortableAppAIConfigIntent,
} from '@nimiplatform/sdk/ai';
import type { NimiLocalAppAgentHandle, NimiLocalAppArtifactImageMime } from '@nimiplatform/sdk/app';
import type { RealmListChatsResultDto } from '@nimiplatform/kit/features/chat/realm';
import type {
  AnyNimiCanonicalRendererHostBindingsV1,
  NimiRendererHostFacadeV1,
  NimiRendererHostMethodMap,
  NimiRendererHostResult,
} from '@nimiplatform/kit/shell/renderer/host';

import type { RuntimePlatformProjection } from '../shell/auth/runtime-platform.js';
import type { TesterAIConfigSummary } from '../tester/tester-ai-config.js';
import type { TesterImageHistoryRecord } from '../tester/tester-image-history.js';
import type {
  TesterPromptDraftKey,
  TesterPromptDraftLoadResult,
  TesterPromptDraftSaveResult,
  TesterPreferences,
} from '../tester/tester-preferences.js';
import type { TesterConversationJourneyResult } from '../tester/local-app-conversation-journey.js';
import type { TesterCapabilityRunInput, TesterCapabilityRunResult } from '../tester/tester-runtime.js';
import type { TesterRunHistory, TesterRunHistoryRecord } from '../tester/tester-history.js';
import type {
  ClaimWorldTourViewerLaunchInput,
  OpenWorldTourWindowInput,
  OpenWorldTourWindowResponse,
  ResolvedWorldTourFixture,
  ResolveWorldTourFixtureInput,
} from '../tester/world-tour/world-tour-shared.js';

export interface TesterEcosystemReferenceProjection {
  readonly ecosystemRevision: number;
}

export interface TesterPersonaReferenceProjection {
  readonly displayName: string;
  readonly userId: string;
  readonly role: string;
}

export interface TesterRendererProjectionPort {
  runtimePlatform(): Promise<RuntimePlatformProjection>;
  aiConfigSummary(): Promise<TesterAIConfigSummary>;
  runHistory(): Promise<TesterRunHistory>;
  imageHistory(): Promise<readonly TesterImageHistoryRecord[]>;
  ecosystemReference(): TesterEcosystemReferenceProjection | null;
  personaReference(): TesterPersonaReferenceProjection | null;
  preferences(): TesterPreferences;
  promptDraft(key: TesterPromptDraftKey, enabled: boolean): TesterPromptDraftLoadResult;
}

export interface TesterRendererCommandPort {
  nextRunIdentity(): Promise<{ readonly runId: string; readonly createdAt: string }>;
  appendRunHistory(record: TesterRunHistoryRecord): Promise<TesterRunHistory>;
  removeRunHistory(recordId: string): Promise<TesterRunHistory>;
  clearRunHistory(input: { readonly capabilityId?: string }): Promise<TesterRunHistory>;
  appendImageHistory(record: TesterImageHistoryRecord): Promise<readonly TesterImageHistoryRecord[]>;
  savePreferences(preferences: TesterPreferences): Promise<void>;
  savePromptDraft(key: TesterPromptDraftKey, prompt: string, enabled: boolean): Promise<TesterPromptDraftSaveResult>;
  copyText(text: string): Promise<NimiRendererHostResult<{ readonly copied: boolean }>>;
  exportText(input: { readonly filename: string; readonly body: string }): Promise<NimiRendererHostResult<{ readonly filename: string }>>;
  exportArtifact(input: { readonly filename: string; readonly url: string }): Promise<NimiRendererHostResult<{ readonly filename: string }>>;
  resolveWorldTourFixture(input: ResolveWorldTourFixtureInput): Promise<ResolvedWorldTourFixture>;
  openWorldTourWindow(input: OpenWorldTourWindowInput): Promise<OpenWorldTourWindowResponse>;
  claimWorldTourViewerLaunch(input: ClaimWorldTourViewerLaunchInput): Promise<ResolvedWorldTourFixture>;
  saveWorldTourViewerPreset(input: { readonly manifestPath: string; readonly presetJson: string }): Promise<{ readonly manifestPath: string; readonly presetPath: string }>;
  localAppSessionStatus(): Promise<{ readonly state: string; readonly sessionBound: boolean }>;
  localAppConversationJourney(input: { readonly agentHandle: NimiLocalAppAgentHandle; readonly text: string }): Promise<TesterConversationJourneyResult>;
  localAppConversationSnapshot(input: { readonly agentHandle: NimiLocalAppAgentHandle; readonly conversationAnchorId: string }): Promise<Readonly<Record<string, unknown>>>;
  localAppStorageRoundTrip(input: { readonly relativePath: string; readonly value: Readonly<Record<string, string | number>> }): Promise<{ readonly sizeBytes: number; readonly removed: boolean }>;
  runtimeLog(input: Readonly<Record<string, unknown>>): Promise<NimiRendererHostResult<{ readonly recorded: boolean }>>;
  rendererLog(input: Readonly<Record<string, unknown>>): Promise<NimiRendererHostResult<{ readonly recorded: boolean }>>;
}

export interface TesterRendererEventPort {
  subscribe(eventType: string, listener: (payload: unknown) => void): () => void;
}

export interface TesterRendererSdkPort {
  runCapability(input: TesterCapabilityRunInput): Promise<TesterCapabilityRunResult>;
  listLocalAppVoiceAssets(): Promise<readonly {
    readonly voiceAssetId: string;
    readonly workflowType: string;
    readonly status: string;
  }[]>;
  uploadLocalAppArtifact(input: {
    readonly bytes: Uint8Array;
    readonly mimeType: NimiLocalAppArtifactImageMime;
  }): Promise<{ readonly artifactId: string; readonly sizeBytes: number; readonly mimeType: NimiLocalAppArtifactImageMime }>;
  aiConfig: {
    get(): Promise<NimiPortableAppAIConfig | null>;
    overwrite(
      capabilities: readonly NimiPortableAppAIConfigIntent[],
    ): Promise<NimiPortableAppAIConfig>;
  };
  modelConfig: {
    localSelections(): Promise<readonly {
      readonly capabilityContract: string;
      readonly state: 'selected' | 'broken';
      readonly configurationId: null;
      readonly displayName: string | null;
      readonly supportedFeatures: readonly string[];
      readonly reasons: readonly string[];
      readonly effectiveDefaults: Readonly<Record<string, string>> | null;
    }[]>;
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

export interface TesterRendererRouteView {
  readonly pathname: string;
  readonly search: readonly { readonly key: string; readonly value: string }[];
  readonly fragment: string | null;
}

export interface TesterRendererRoutePort {
  get(): TesterRendererRouteView;
  subscribe(listener: () => void): () => void;
  navigate(next: TesterRendererRouteView): Promise<void>;
}

export interface TesterRendererClockView {
  now(): number;
}

export type TesterCanonicalRendererBindings = Omit<
  AnyNimiCanonicalRendererHostBindingsV1,
  'app' | 'clock' | 'kit' | 'route' | 'sdk'
> & {
  readonly kit: NimiRendererHostFacadeV1<NimiRendererHostMethodMap>;
  readonly sdk: TesterRendererSdkPort;
  readonly app: {
    readonly projection: TesterRendererProjectionPort;
    readonly commands: TesterRendererCommandPort;
    readonly events: TesterRendererEventPort;
  };
  readonly route: TesterRendererRoutePort;
  readonly clock: TesterRendererClockView;
};
