import type { SharedAIConfigService } from '@nimiplatform/kit/features/model-config/headless';
import type { RouteModelPickerDataProvider } from '@nimiplatform/kit/features/model-picker/runtime';
import type {
  NimiRealmCreatorEligibility,
  NimiRealmGroupChatListResult,
  NimiRealmNotificationListView,
  NimiRealmNotificationUnreadView,
  NimiRealmRequestDataExportOutput,
} from '@nimiplatform/sdk/realm';
import type { NimiAIScopeRef } from '@nimiplatform/sdk/ai';
import type { NimiAIConfig } from '@nimiplatform/sdk/ai';
import type { PermissionID } from '@nimiplatform/sdk/app';
import type { RealmListChatsResultDto } from '@nimiplatform/kit/features/chat/realm';
import type {
  AnyNimiCanonicalRendererHostBindingsV1,
  NimiRendererHostFacadeV1,
  NimiRendererHostMethodMap,
  NimiRendererHostResult,
} from '@nimiplatform/kit/shell/renderer/host';

import type { RuntimePlatformProjection } from '../shell/auth/runtime-platform.js';
import type { TesterAIConfigSummary } from '../tester/tester-ai-config.js';
import type { TesterAIProfileImportResult } from '../tester/tester-ai-config-store.js';
import type { TesterArtifactSaveResult } from '../tester/tester-artifact-storage.js';
import type { TesterImageHistoryRecord } from '../tester/tester-image-history.js';
import type {
  TesterPromptDraftKey,
  TesterPromptDraftLoadResult,
  TesterPromptDraftSaveResult,
  TesterPreferences,
} from '../tester/tester-preferences.js';
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
  ecosystemReference(): TesterEcosystemReferenceProjection | null;
  personaReference(): TesterPersonaReferenceProjection | null;
  preferences(): TesterPreferences;
  promptDraft(key: TesterPromptDraftKey, enabled: boolean): TesterPromptDraftLoadResult;
}

export interface TesterRendererCommandPort {
  nextRunIdentity(): Promise<{ readonly runId: string; readonly createdAt: string }>;
  appendRunHistory(record: TesterRunHistoryRecord): Promise<TesterRunHistory>;
  appendImageHistory(record: TesterImageHistoryRecord): Promise<readonly TesterImageHistoryRecord[]>;
  saveArtifact(input: { readonly filename: string; readonly mimeType?: string; readonly dataUrl: string }): Promise<TesterArtifactSaveResult>;
  savePromptDraft(key: TesterPromptDraftKey, prompt: string, enabled: boolean): Promise<TesterPromptDraftSaveResult>;
  copyText(text: string): Promise<NimiRendererHostResult<{ readonly copied: boolean }>>;
  exportText(input: { readonly filename: string; readonly body: string }): Promise<NimiRendererHostResult<{ readonly filename: string }>>;
  exportArtifact(input: { readonly filename: string; readonly url: string }): Promise<NimiRendererHostResult<{ readonly filename: string }>>;
  resolveWorldTourFixture(input: ResolveWorldTourFixtureInput): Promise<ResolvedWorldTourFixture>;
  openWorldTourWindow(input: OpenWorldTourWindowInput): Promise<OpenWorldTourWindowResponse>;
  claimWorldTourViewerLaunch(input: ClaimWorldTourViewerLaunchInput): Promise<ResolvedWorldTourFixture>;
  saveWorldTourViewerPreset(input: { readonly manifestPath: string; readonly presetJson: string }): Promise<{ readonly manifestPath: string; readonly presetPath: string }>;
  localAppSessionStatus(): Promise<{ readonly state: string; readonly sessionBound: boolean }>;
  localAppPermissionStatus(permissionId: PermissionID): Promise<{ readonly posture: string; readonly canRequest: boolean; readonly detail?: string }>;
  localAppPermissionRequest(input: { readonly permissionId: PermissionID; readonly reason: string }): Promise<{ readonly posture: string }>;
  localAppStorageRoundTrip(input: { readonly relativePath: string; readonly value: Readonly<Record<string, string | number>> }): Promise<{ readonly sizeBytes: number; readonly removed: boolean }>;
  runtimeLog(input: Readonly<Record<string, unknown>>): Promise<NimiRendererHostResult<{ readonly recorded: boolean }>>;
  rendererLog(input: Readonly<Record<string, unknown>>): Promise<NimiRendererHostResult<{ readonly recorded: boolean }>>;
}

export interface TesterRendererEventPort {
  subscribe(eventType: string, listener: (payload: unknown) => void): () => void;
}

export interface TesterRendererSdkPort {
  runCapability(input: TesterCapabilityRunInput): Promise<TesterCapabilityRunResult>;
  aiConfig: {
    readonly service: SharedAIConfigService;
    readonly scopeRef: NimiAIScopeRef;
    requireAdmission(): Promise<NimiAIConfig>;
    importProfileJson(rawJson: string): TesterAIProfileImportResult;
    modelPickerProvider(capability: string): RouteModelPickerDataProvider;
    modelPickerProviderCache(capability: string): RouteModelPickerDataProvider | null;
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
