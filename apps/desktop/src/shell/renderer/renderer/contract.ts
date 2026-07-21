import type { NimiAIConfig } from '@nimiplatform/sdk/ai';
import type {
  AnyNimiCanonicalRendererHostBindingsV1,
  NimiRendererHostFacadeV1,
  NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';

import type { AppAttentionState } from '../app-shell/providers/app-attention-state.js';
import type { ChatThinkingPreference } from '../features/chat/chat-shared-thinking.js';

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
}

export interface DesktopRendererCommandPort {
  commitAIConfig(config: NimiAIConfig): void;
  persistChatThinkingPreference(preference: ChatThinkingPreference): void;
  setActiveScopeForMode(mode: 'human' | 'ai' | 'agent' | 'group'): void;
  applyLocale(input: {
    readonly locale: 'en' | 'zh';
    readonly lang: string;
    readonly title: string;
  }): Promise<void> | void;
}

export interface DesktopRendererEventPort {
  subscribeAttention(listener: () => void): () => void;
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
}

export type DesktopCanonicalRendererBindings = Omit<
  AnyNimiCanonicalRendererHostBindingsV1,
  'app' | 'clock' | 'kit' | 'route' | 'sdk'
> & {
  readonly kit: NimiRendererHostFacadeV1<NimiRendererHostMethodMap>;
  readonly sdk: Record<string, never>;
  readonly app: {
    readonly projection: DesktopRendererProjectionPort;
    readonly commands: DesktopRendererCommandPort;
    readonly events: DesktopRendererEventPort;
  };
  readonly route: DesktopRendererRoutePort;
  readonly clock: DesktopRendererClockView;
};
