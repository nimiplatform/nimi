import type {
  AnyNimiCanonicalRendererHostBindingsV1,
  NimiRendererHostFacadeV1,
  NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';
import type { AgentCenterSession } from '@nimiplatform/kit/features/agent-center';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';

import type { ZhiyuRuntimeAgentChatTurnInput, ZhiyuRuntimeAgentChatTurnResult } from '../shell/agent-chat/runtime-agent-turn-adapter.js';
import type { ZhiyuAvatarLaunchAction } from '../shell/avatar/avatar-launch.js';
import type { ZhiyuAvatarLaunchResult } from '../shell/avatar/avatar-launch-handoff.js';
import type { ZhiyuDesktopOpenActionResult } from '../shell/desktop-open/desktop-open-action.js';
import type { ZhiyuEvidence } from '../shell/app/evidence.js';

export type ZhiyuHomeProjection = Pick<
  ZhiyuEvidence,
  | 'runtime'
  | 'auth'
  | 'source'
  | 'inventory'
  | 'localAgent'
  | 'conversation'
  | 'memory'
  | 'companion'
  | 'delegation'
  | 'proposal'
  | 'avatar'
>;

export interface ZhiyuRendererProjectionPort {
  agentCenterSession(
    agentHandle: NimiLocalAppAgentHandle | null,
  ): AgentCenterSession | null;
  loadHome(input: { readonly selectedAgentHandle: NimiLocalAppAgentHandle | null }): Promise<ZhiyuHomeProjection>;
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
  }): Promise<{ readonly text: string }>;
  openDesktopRuntimeSettings(): Promise<void>;
  openDesktopSelectPartner(): Promise<ZhiyuDesktopOpenActionResult>;
  launchAvatar(input: {
    readonly evidence: ZhiyuEvidence;
    readonly action: ZhiyuAvatarLaunchAction;
  }): Promise<ZhiyuAvatarLaunchResult>;
}

export interface ZhiyuRendererEventPort {
  onProjectionChanged?(projection: ZhiyuEvidence): void;
  subscribeConversation(input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly conversationAnchorId: string;
    readonly onChat: (chat: ZhiyuEvidence['chat']) => void;
  }): () => void;
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
