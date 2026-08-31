import type {
  AnyNimiCanonicalRendererHostBindingsV1,
  NimiRendererHostFacadeV1,
  NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';

import type { AppAttentionState } from '../app-shell/providers/app-attention-state.js';
import type { AuthStatus } from '../app-shell/providers/store-types.js';
import type {
  NimiManagedConnectorCredentialAcquisitionHost,
  NimiProductControlRecordProjection,
} from '@nimiplatform/sdk/runtime';
import type { ChatThinkingPreference } from '../features/chat/chat-shared-thinking.js';
import type { DesktopRendererLifecyclePort } from './lifecycle-port.js';
import type { DesktopRendererSdkPort } from './sdk-port.js';
import type {
  LocalDevelopmentRegistration,
  LocalDevelopmentRun,
} from '../features/local-development/local-development-types.js';
import type { DeveloperModeProjection } from '../features/developer/developer-mode-types.js';
import type { QueryClient } from '@tanstack/react-query';
import type { DesktopRendererFirstRunPort } from './first-run-port.js';
import type { DesktopRendererSettingsPort } from './settings-port.js';
import type { DesktopRendererAuthPort } from './auth-port.js';
import type { DesktopRendererRuntimeConfigNavigationPort } from './runtime-config-navigation-port.js';
import type { RuntimeBridgeDaemonStatus } from '@nimiplatform/kit/shell/renderer/bridge';
import type { DesktopRendererWorldFollowPort } from './world-follow-port.js';
import type { DesktopRendererSupportRepairPort } from './support-repair-port.js';
import type { DesktopRendererSystemResourcesPort } from './system-resources-port.js';
import type { DesktopRendererVoiceCapturePort } from './voice-capture-port.js';
import type { DesktopRendererSupportLogsPort } from './support-logs-port.js';
import type { DesktopRendererLocalModelProgressPort } from './local-model-progress-port.js';
import type { DesktopRendererAvatarHandoffPort } from './avatar-handoff-port.js';
import type { DesktopRendererVirtualizationPort } from './virtualization-port.js';
import type { DesktopOpenIntentStore } from '../infra/desktop-open/desktop-open-intent-navigation.js';

export type DesktopRendererInitialState = {
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
  developerModeEnabled(): boolean;
  viewportWidth(): number;
  viewportHeight(): number;
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
  readonly worldFollow: DesktopRendererWorldFollowPort;
  readonly supportRepair: DesktopRendererSupportRepairPort;
  readonly supportLogs: DesktopRendererSupportLogsPort;
  readonly systemResources: DesktopRendererSystemResourcesPort;
  readonly voiceCapture: DesktopRendererVoiceCapturePort;
  readonly localModelProgress: DesktopRendererLocalModelProgressPort;
  readonly avatarHandoff: DesktopRendererAvatarHandoffPort;
  readonly virtualization: DesktopRendererVirtualizationPort;
  readonly connectorAuth: NimiManagedConnectorCredentialAcquisitionHost;
  readonly runtimeDaemon: {
    available(): boolean;
    status(): Promise<RuntimeBridgeDaemonStatus>;
    start(): Promise<RuntimeBridgeDaemonStatus>;
    restart(): Promise<RuntimeBridgeDaemonStatus>;
  };
  persistChatThinkingPreference(preference: ChatThinkingPreference): void;
  reportAuthEntryAction(): Promise<DesktopAuthEntryActionResult>;
  applyLocale(input: {
    readonly locale: 'en' | 'zh';
    readonly lang: string;
    readonly title: string;
  }): Promise<void> | void;
  writeClipboardText(value: string): Promise<void>;
  openAccountManagement(): Promise<void>;
  openWalletCheckout(url: string): Promise<{ readonly opened: boolean; readonly reason?: string }>;
  exportRuntimeAuditJson(input: {
    readonly filename: string;
    readonly content: string;
  }): void;
  pickLocalRuntimeAssetFile(): Promise<string | null>;
  pickLocalRuntimeAssetDirectory(): Promise<string | null>;
  revealLocalRuntimeAssetsRootFolder(): Promise<void>;
  reconcileLoginState(input: {
    readonly authStatus: AuthStatus;
  }): Promise<{ readonly clearAuthSession: boolean }>;
  reloadApplication(): void;
  startWindowDrag(): Promise<void>;
  listLocalDevelopmentRegistrations(): Promise<LocalDevelopmentRegistration[]>;
  listLocalDevelopmentRuns(): Promise<LocalDevelopmentRun[]>;
  startLocalDevelopmentRegistration(selector: string): Promise<LocalDevelopmentRun>;
  stopLocalDevelopmentRun(selector: string): Promise<void>;
  removeLocalDevelopmentRegistration(selector: string): Promise<void>;
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
  subscribeDeveloperMode(listener: (enabled: boolean) => void): () => void;
  subscribeProductControlRecord(
    listener: (result:
      | { readonly ok: true; readonly projection: NimiProductControlRecordProjection }
      | { readonly ok: false; readonly error: string }
    ) => void,
  ): () => void;
  connectDesktopOpenIntents(store: DesktopOpenIntentStore): () => void;
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
