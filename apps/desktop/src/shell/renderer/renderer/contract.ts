import type { NimiAIConfig } from '@nimiplatform/sdk/ai';
import type {
  AnyNimiCanonicalRendererHostBindingsV1,
  NimiRendererHostFacadeV1,
  NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';

import type { AppAttentionState } from '../app-shell/providers/app-attention-state.js';
import type { AuthStatus } from '../app-shell/providers/store-types.js';
import type { NimiProductControlRecordProjection } from '@nimiplatform/sdk/runtime';
import type { ChatThinkingPreference } from '../features/chat/chat-shared-thinking.js';
import type { DesktopRendererLifecyclePort } from './lifecycle-port.js';
import type { DesktopRendererSdkPort } from './sdk-port.js';
import type {
  LocalDevelopmentApproval,
  LocalDevelopmentDecision,
} from '../features/local-development/local-development-types.js';
import type { DeveloperModeProjection } from '../features/developer/developer-mode.js';
import type { QueryClient } from '@tanstack/react-query';
import type { DesktopRendererFirstRunPort } from './first-run-port.js';
import type { DesktopRendererSettingsPort } from './settings-port.js';
import type { DesktopRendererAuthPort } from './auth-port.js';
import type { DesktopRendererRuntimeConfigNavigationPort } from './runtime-config-navigation-port.js';

export type DesktopRendererInitialState = {
  readonly aiConfig: NimiAIConfig;
  readonly bootstrapError: string | null;
  readonly bootstrapReady: boolean;
  readonly chatThinkingPreference: ChatThinkingPreference;
  readonly development: boolean;
};

export interface DesktopRendererProjectionPort {
  initialState(): DesktopRendererInitialState;
  attention(): AppAttentionState;
  localDevelopmentAvailable(): boolean;
  loginMode(): 'desktop-browser' | 'embedded';
  developerModeEnabled(): boolean;
  viewportWidth(): number;
}

export interface DesktopRendererCommandPort {
  readonly auth: DesktopRendererAuthPort;
  readonly firstRun: DesktopRendererFirstRunPort;
  readonly runtimeConfigNavigation: DesktopRendererRuntimeConfigNavigationPort;
  readonly settings: DesktopRendererSettingsPort;
  commitAIConfig(config: NimiAIConfig): void;
  persistChatThinkingPreference(preference: ChatThinkingPreference): void;
  setActiveScopeForMode(mode: 'human' | 'ai' | 'agent' | 'group'): void;
  applyLocale(input: {
    readonly locale: 'en' | 'zh';
    readonly lang: string;
    readonly title: string;
  }): Promise<void> | void;
  reconcileLoginState(input: {
    readonly authStatus: AuthStatus;
  }): Promise<{ readonly clearAuthSession: boolean }>;
  checkDesktopUpdate(input?: {
    readonly autoDownload?: boolean;
    readonly silent?: boolean;
  }): Promise<void>;
  installDesktopUpdate(input?: { readonly silent?: boolean }): Promise<void>;
  restartDesktopUpdate(): Promise<void>;
  startWindowDrag(): Promise<void>;
  listLocalDevelopmentApprovals(): Promise<readonly LocalDevelopmentApproval[]>;
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
  subscribeWindowResize(listener: () => void): () => void;
  subscribeWindowKeyDown(listener: (event: KeyboardEvent) => void): () => void;
  subscribeDocumentMouseDown(listener: (event: MouseEvent) => void): () => void;
  subscribeAttention(listener: () => void): () => void;
  subscribeLocalDevelopmentApprovals(
    listener: (approval: LocalDevelopmentApproval) => void,
  ): Promise<() => void>;
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
