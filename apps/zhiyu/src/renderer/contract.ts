import type {
  AnyNimiCanonicalRendererHostBindingsV1,
  NimiRendererHostFacadeV1,
  NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';
import type { AgentCenterHostMechanics } from '@nimiplatform/kit/features/agent-center';
import type {
  NimiLocalAppAgentConfigureClient,
  NimiLocalAppAgentHandle,
} from '@nimiplatform/sdk/app';

import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import type { LocalAppConversationObservation } from '@nimiplatform/kit/features/chat/headless';
import type { ZhiyuAvatarLaunchAction } from '../shell/avatar/avatar-launch.js';
import type { ZhiyuAvatarLaunchResult } from '../shell/avatar/avatar-launch-handoff.js';
import type { ZhiyuDesktopOpenActionResult } from '../shell/desktop-open/desktop-open-action.js';
import type {
  ZhiyuResourcePackPlacementAck,
  ZhiyuResourcePackPlacementRequest,
} from '../production/resource-pack-placement-bridge.js';
import type { ZhiyuResourcePackPlacementTarget } from '../production/resource-pack-placement-destination.js';
import type { ZhiyuEvidence } from '../shell/app/evidence.js';

export type ZhiyuHomeProjection = Pick<
  ZhiyuEvidence,
  | 'runtime'
  | 'auth'
  | 'source'
  | 'inventory'
  | 'localAgent'
  | 'conversation'
  | 'companion'
  | 'delegation'
  | 'proposal'
  | 'avatar'
>;

export type ZhiyuAgentCenterBinding = Readonly<{
  agentHandle: NimiLocalAppAgentHandle;
  client: NimiLocalAppAgentConfigureClient;
  hostMechanics: AgentCenterHostMechanics | null;
}>;

export interface ZhiyuRendererProjectionPort {
  agentCenterBinding(
    agentHandle: NimiLocalAppAgentHandle | null,
  ): ZhiyuAgentCenterBinding | null;
  loadHome(input: {
    readonly selectedAgentHandle: NimiLocalAppAgentHandle | null;
    readonly previousConversationAnchorId: string | null;
    readonly isCurrent: () => boolean;
  }): Promise<ZhiyuHomeProjection>;
  loadAgentInventory(): Promise<ZhiyuEvidence['inventory']>;
  projectTurnReadiness(
    conversation: ZhiyuEvidence['conversation'],
    inventory: ZhiyuEvidence['inventory'],
  ): ZhiyuEvidence['turn'];
  resolveResourcePackPlacementTarget?(input: {
    readonly agentHandle: string;
    readonly isCurrent: () => boolean;
  }): Promise<ZhiyuResourcePackPlacementTarget>;
}

export interface ZhiyuRendererCommandPort {
  allocateTurnRequestId(): Promise<string>;
  conversation(): NimiLocalAppClient['conversation'];
  draftClient(): Pick<NimiLocalAppClient, 'agents' | 'storage'>;
  transcribeVoice(input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly conversationAnchorId: string;
    readonly requestId: string;
    readonly mimeType: string;
    readonly audioBytes: Uint8Array;
  }, options?: { readonly signal?: AbortSignal }): Promise<{ readonly text: string }>;
  openDesktopRuntimeSettings(): Promise<void>;
  openDesktopSelectPartner(): Promise<ZhiyuDesktopOpenActionResult>;
  launchAvatar(input: {
    readonly evidence: ZhiyuEvidence;
    readonly action: ZhiyuAvatarLaunchAction;
  }): Promise<ZhiyuAvatarLaunchResult>;
  acknowledgeResourcePackPlacement?(ack: ZhiyuResourcePackPlacementAck): void;
}

export interface ZhiyuRendererEventPort {
  onProjectionChanged?(projection: ZhiyuEvidence): void;
  subscribeConversation(input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly conversationAnchorId: string;
    readonly onChat: (chat: ZhiyuEvidence['chat']) => void;
    readonly onStatus?: (status: 'loading' | 'ready' | 'error', error?: unknown) => void;
  }): LocalAppConversationObservation;
  subscribeResourcePackPlacement?(
    listener: (request: ZhiyuResourcePackPlacementRequest) => void,
  ): () => void;
}

export interface ZhiyuRendererRoutePort {
  get(): { readonly pathname: string };
  subscribe(listener: () => void): () => void;
}

export interface ZhiyuRendererClockView {
  now(): number;
}

export type ZhiyuCanonicalRendererBindings = Omit<
  AnyNimiCanonicalRendererHostBindingsV1,
  'app' | 'clock' | 'kit' | 'route' | 'sdk'
> & {
  readonly kit: NimiRendererHostFacadeV1<NimiRendererHostMethodMap>;
  readonly sdk: Record<string, never>;
  readonly app: {
    readonly projection: ZhiyuRendererProjectionPort;
    readonly commands: ZhiyuRendererCommandPort;
    readonly events: ZhiyuRendererEventPort;
  };
  readonly route: ZhiyuRendererRoutePort;
  readonly clock: ZhiyuRendererClockView;
};
