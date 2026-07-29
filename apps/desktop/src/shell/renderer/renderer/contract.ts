import type { NimiAIConfig } from '@nimiplatform/sdk/ai';
import type {
  AnyNimiCanonicalRendererHostBindingsV1,
  NimiRendererHostFacadeV1,
  NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';

import type { AppAttentionState } from '../app-shell/providers/app-attention-state.js';
import type { AuthStatus } from '../app-shell/providers/store-types.js';
import type {
  NimiConnectorAuthAcquisitionHost,
  NimiProductControlRecordProjection,
} from '@nimiplatform/sdk/runtime';
import type { ChatThinkingPreference } from '../features/chat/chat-shared-thinking.js';
import type { DesktopRendererLifecyclePort } from './lifecycle-port.js';
import type { DesktopRendererSdkPort } from './sdk-port.js';
import type {
  LocalDevelopmentApproval,
  LocalDevelopmentAuthorization,
  LocalDevelopmentDecision,
  LocalDevelopmentRun,
} from '../features/local-development/local-development-types.js';
import type { DeveloperModeProjection } from '../features/developer/developer-mode-types.js';
import type { QueryClient } from '@tanstack/react-query';
import type { DesktopRendererFirstRunPort } from './first-run-port.js';
import type { DesktopRendererSettingsPort } from './settings-port.js';
import type { DesktopRendererAuthPort } from './auth-port.js';
import type { DesktopRendererRuntimeConfigNavigationPort } from './runtime-config-navigation-port.js';
import type { DesktopRendererProfileLibraryPort } from './profile-library-port.js';
import type { RuntimeBridgeDaemonStatus } from '@nimiplatform/kit/shell/renderer/bridge';
import type { DesktopRendererWorldFollowPort } from './world-follow-port.js';
import type { DesktopRendererSupportRepairPort } from './support-repair-port.js';
import type { DesktopRendererSystemResourcesPort } from './system-resources-port.js';
import type { DesktopRendererVoiceCapturePort } from './voice-capture-port.js';
import type { DesktopRendererSupportLogsPort } from './support-logs-port.js';
import type { DesktopRendererLocalModelProgressPort } from './local-model-progress-port.js';
import type { DesktopRendererAvatarHandoffPort } from './avatar-handoff-port.js';
import type { DesktopRendererVirtualizationPort } from './virtualization-port.js';
import type {
  DesktopLocalAppPermissionOwnerPort,
  DesktopLocalAppPermissionRequest,
} from '../features/apps/local-app-permission-owner.js';

export type DesktopRendererInitialState = {
  readonly aiConfig: NimiAIConfig;
  readonly bootstrapError: string | null;
  readonly bootstrapReady: boolean;
  readonly chatThinkingPreference: ChatThinkingPreference;
  readonly development: boolean;
};

export type DesktopAuthEntryActionResult =
  | { readonly ok: true; readonly ecosystemRevision: number }
  | { readonly ok: false; readonly disposition: 'unsupported' | 'missing-target' | 'rejected' };

export interface DesktopRendererProjectionPort {
  initialState(): DesktopRendererInitialState;
  attention(): AppAttentionState;
  localDevelopmentAvailable(): boolean;
  loginMode(): 'desktop-browser' | 'embedded';
  developerModeEnabled(): boolean;
  viewportWidth(): number;
  documentVisible(): boolean;
  windowFocused(): boolean;
  titlebarDragEnabled(): boolean;
  menuBarShellEnabled(): boolean;
  walletCheckoutBaseUrl(): string;
  resourceBaseUrl(): string;
}

export interface DesktopRendererCommandPort {
  readonly auth: DesktopRendererAuthPort;
  readonly firstRun: DesktopRendererFirstRunPort;
  readonly runtimeConfigNavigation: DesktopRendererRuntimeConfigNavigationPort;
  readonly settings: DesktopRendererSettingsPort;
  readonly profileLibrary: DesktopRendererProfileLibraryPort;
  readonly worldFollow: DesktopRendererWorldFollowPort;
  readonly supportRepair: DesktopRendererSupportRepairPort;
  readonly supportLogs: DesktopRendererSupportLogsPort;
  readonly systemResources: DesktopRendererSystemResourcesPort;
  readonly voiceCapture: DesktopRendererVoiceCapturePort;
  readonly localModelProgress: DesktopRendererLocalModelProgressPort;
  readonly avatarHandoff: DesktopRendererAvatarHandoffPort;
  readonly virtualization: DesktopRendererVirtualizationPort;
  readonly localAppPermissions: Omit<DesktopLocalAppPermissionOwnerPort, 'subscribePending'>;
  readonly connectorAuth: Pick<
    NimiConnectorAuthAcquisitionHost,
    'proxyHttp' | 'oauthTokenExchange'
  >;
  readonly runtimeDaemon: {
    available(): boolean;
    status(): Promise<RuntimeBridgeDaemonStatus>;
    start(): Promise<RuntimeBridgeDaemonStatus>;
    restart(): Promise<RuntimeBridgeDaemonStatus>;
  };
  commitAIConfig(config: NimiAIConfig): void;
  persistChatThinkingPreference(preference: ChatThinkingPreference): void;
  setActiveScopeForMode(mode: 'human' | 'ai' | 'agent' | 'group'): void;
  reportAuthEntryAction(): Promise<DesktopAuthEntryActionResult>;
  applyLocale(input: {
    readonly locale: 'en' | 'zh';
    readonly lang: string;
    readonly title: string;
  }): Promise<void> | void;
  writeClipboardText(value: string): Promise<void>;
  openWalletCheckout(url: string): Promise<{ readonly opened: boolean; readonly reason?: string }>;
  exportProfileLibraryJson(input: {
    readonly filename: string;
    readonly content: string;
  }): void;
  exportRuntimeAuditJson(input: {
    readonly filename: string;
    readonly content: string;
  }): void;
  confirmRuntimeProfileInstall(message: string): boolean;
  pickLocalRuntimeAssetManifestPath(): Promise<string | null>;
  pickLocalRuntimeAssetFile(): Promise<string | null>;
  pickLocalRuntimeAssetDirectory(): Promise<string | null>;
  revealLocalRuntimeAssetsRootFolder(): Promise<void>;
  reconcileLoginState(input: {
    readonly authStatus: AuthStatus;
  }): Promise<{ readonly clearAuthSession: boolean }>;
  checkDesktopUpdate(input?: {
    readonly autoDownload?: boolean;
    readonly silent?: boolean;
  }): Promise<void>;
  installDesktopUpdate(input?: { readonly silent?: boolean }): Promise<void>;
  restartDesktopUpdate(): Promise<void>;
  reloadApplication(): void;
  startWindowDrag(): Promise<void>;
  listLocalDevelopmentApprovals(): Promise<readonly LocalDevelopmentApproval[]>;
  listLocalDevelopmentAuthorizations(): Promise<LocalDevelopmentAuthorization[]>;
  listLocalDevelopmentRuns(): Promise<LocalDevelopmentRun[]>;
  revokeLocalDevelopmentAuthorization(selector: string): Promise<LocalDevelopmentAuthorization>;
  decideLocalDevelopmentApproval(input: {
    readonly requestId: string;
    readonly decision: LocalDevelopmentDecision;
    readonly riskDisclosureAcknowledged: boolean;
  }): Promise<void>;
  refreshDeveloperMode(): Promise<DeveloperModeProjection>;
  setDeveloperMode(enabled: boolean): Promise<DeveloperModeProjection>;
}

export interface DesktopRendererEventPort {
  connectChatRealtimeSync(input: {
    readonly queryClient: QueryClient;
    readonly selectedChatId: string | null;
  }): () => void;
  subscribeWindowFocus(listener: (focused: boolean) => void): () => void;
  subscribeDocumentVisibility(listener: (visible: boolean) => void): () => void;
  subscribeWindowResize(listener: () => void): () => void;
  subscribeWindowKeyDown(listener: (event: KeyboardEvent) => void): () => void;
  subscribeDocumentMouseDown(listener: (event: MouseEvent) => void): () => void;
  subscribeDocumentClick(listener: (event: MouseEvent) => void): () => void;
  subscribeDocumentPointerDown(listener: (event: PointerEvent) => void, capture?: boolean): () => void;
  observeIntersection(
    target: Element,
    options: IntersectionObserverInit,
    listener: (isIntersecting: boolean) => void,
  ): () => void;
  subscribeAttention(listener: () => void): () => void;
  subscribeLocalDevelopmentApprovals(
    listener: (approval: LocalDevelopmentApproval) => void,
  ): Promise<() => void>;
  subscribeLocalAppPermissionRequests(input: {
    readonly onRequests: (requests: readonly DesktopLocalAppPermissionRequest[]) => void;
    readonly onError: (error: unknown) => void;
  }): Promise<() => void>;
  subscribeDeveloperMode(listener: (enabled: boolean) => void): () => void;
  subscribeProductControlRecord(
    listener: (result:
      | { readonly ok: true; readonly projection: NimiProductControlRecordProjection }
      | { readonly ok: false; readonly error: string }
    ) => void,
  ): () => void;
  connectDesktopOpenIntents(): () => void;
  connectLifecycle(lifecycle: DesktopRendererLifecyclePort): () => void;
}

export type DesktopRendererRouteView = {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly state: unknown;
  readonly key: string;
};

export interface DesktopRendererRoutePort {
  get(): DesktopRendererRouteView;
  subscribe(listener: () => void): () => void;
  navigate(input: {
    readonly to: string;
    readonly replace: boolean;
    readonly state?: unknown;
  }): void;
  go(delta: number): void;
}

export interface DesktopRendererClockView {
  now(): number;
  schedule(
    delayMs: number,
    listener: (result:
      | { readonly ok: true }
      | { readonly ok: false; readonly error: string }
    ) => void,
  ): () => void;
  animationFrame(
    listener: (result:
      | { readonly ok: true }
      | { readonly ok: false; readonly error: string }
    ) => void,
  ): () => void;
}

export type DesktopCanonicalRendererBindings = Omit<
  AnyNimiCanonicalRendererHostBindingsV1,
  'app' | 'clock' | 'kit' | 'route' | 'sdk'
> & {
  readonly kit: NimiRendererHostFacadeV1<NimiRendererHostMethodMap>;
  readonly sdk: DesktopRendererSdkPort;
  readonly app: {
    readonly projection: DesktopRendererProjectionPort;
    readonly commands: DesktopRendererCommandPort;
    readonly events: DesktopRendererEventPort;
  };
  readonly route: DesktopRendererRoutePort;
  readonly clock: DesktopRendererClockView;
};
