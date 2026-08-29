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

import type { ZhiyuRuntimeAgentChatTurnInput, ZhiyuRuntimeAgentChatTurnResult } from '../shell/agent-chat/runtime-agent-turn-adapter.js';
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
  hydrateConversation(input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly conversationAnchorId: string;
    readonly currentSource: ZhiyuEvidence['source'];
    readonly currentChat: ZhiyuEvidence['chat'];
  }): Promise<Pick<ZhiyuEvidence, 'source' | 'chat'>>;
  resolveResourcePackPlacementTarget?(input: {
    readonly agentHandle: string;
    readonly isCurrent: () => boolean;
  }): Promise<ZhiyuResourcePackPlacementTarget>;
}

export interface ZhiyuRendererCommandPort {
  allocateTurnRequestId(): Promise<string>;
  runTurn(input: ZhiyuRuntimeAgentChatTurnInput): Promise<ZhiyuRuntimeAgentChatTurnResult>;
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
	readonly currentSource: ZhiyuEvidence['source'];
	readonly currentChat: ZhiyuEvidence['chat'];
    readonly onChat: (chat: ZhiyuEvidence['chat']) => void;
  }): () => void;
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
