import type {
  AnyNimiCanonicalRendererHostBindingsV1,
  NimiRendererHostFacadeV1,
  NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';
import type { AgentCenterSession } from '@nimiplatform/kit/features/agent-center';

import type { ZhiyuRuntimeAgentChatTurnInput, ZhiyuRuntimeAgentChatTurnResult } from '../shell/agent-chat/runtime-agent-turn-adapter.js';
import type { ZhiyuVoiceCaptureEvidence } from '../shell/agent-chat/voice-capture-evidence.js';
import type { ZhiyuAgentAIConfigRouteEvidenceInput } from '../shell/agent-chat/agent-ai-config.js';
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
  agentCenterSession(evidence: ZhiyuEvidence): AgentCenterSession | null;
  loadHome(input: { readonly selectedAgentHandle: string | null }): Promise<ZhiyuHomeProjection>;
  loadAgentInventory(): Promise<ZhiyuEvidence['inventory']>;
  loadExecutionRoute(input: ZhiyuAgentAIConfigRouteEvidenceInput): Promise<ZhiyuEvidence['route']>;
  projectTurnReadiness(
    conversation: ZhiyuEvidence['conversation'],
    inventory: ZhiyuEvidence['inventory'],
  ): ZhiyuEvidence['turn'];
  hydrateConversation(input: {
    readonly ownerUserId: string;
    readonly runtimeSourceRef: string;
    readonly localAgentRef: string;
    readonly conversationAnchorId: string;
    readonly currentSource: ZhiyuEvidence['source'];
    readonly currentChat: ZhiyuEvidence['chat'];
  }): Promise<Pick<ZhiyuEvidence, 'source' | 'chat'>>;
  loadSourceContext(input: {
    readonly ownerUserId: string;
    readonly runtimeSourceRef: string;
    readonly localAgentRef: string;
    readonly conversationAnchorId: string;
  }): Promise<ZhiyuEvidence['source']>;
}

export interface ZhiyuVoiceCaptureControllerPort {
  start(): Promise<ZhiyuVoiceCaptureEvidence>;
  stop(): Promise<ZhiyuVoiceCaptureEvidence>;
}

export interface ZhiyuRendererCommandPort {
  allocateTurnRequestId(): Promise<string>;
  runTurn(input: ZhiyuRuntimeAgentChatTurnInput): Promise<ZhiyuRuntimeAgentChatTurnResult>;
  createVoiceCapture(input: {
    readonly readiness: ZhiyuVoiceCaptureEvidence;
    readonly agentId: string;
    readonly ownerUserId: string;
    readonly onStateChange: (state: ZhiyuVoiceCaptureEvidence) => void;
  }): ZhiyuVoiceCaptureControllerPort;
  runVoicePlayback(evidence: ZhiyuEvidence): Promise<ZhiyuEvidence['companion']>;
  requestAgentInteractionPermission(): Promise<ZhiyuEvidence['inventory']>;
  openDesktopAgentConfig(): Promise<void>;
  openDesktopSelectPartner(): Promise<ZhiyuDesktopOpenActionResult>;
  launchAvatar(input: {
    readonly evidence: ZhiyuEvidence;
    readonly action: ZhiyuAvatarLaunchAction;
  }): Promise<ZhiyuAvatarLaunchResult>;
}

export interface ZhiyuRendererEventPort {
  onProjectionChanged?(projection: ZhiyuEvidence): void;
  subscribeExecutionRoute(input: {
    readonly routeInput: ZhiyuAgentAIConfigRouteEvidenceInput;
    readonly onRoute: (route: ZhiyuEvidence['route']) => void;
  }): () => void;
  subscribeCompanion(input: {
    readonly ownerUserId: string;
    readonly runtimeSourceRef: string;
    readonly localAgentRef: string;
    readonly conversationAnchorId: string;
    readonly onCompanion: (companion: ZhiyuEvidence['companion']) => void;
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
