import { AvatarStage } from '@nimiplatform/nimi-kit/features/avatar';
import ChatAgentAvatarLive2dViewport from './chat-agent-avatar-live2d-viewport';
import type { ChatAgentAvatarLive2dDiagnostic } from './chat-agent-avatar-live2d-diagnostics';
import ChatAgentAvatarVrmViewport, {
  type ChatAgentAvatarVrmDiagnostic,
} from './chat-agent-avatar-vrm-viewport';
import type { ChatAgentAvatarStageRenderModel } from './chat-agent-live-avatar-rail-model';
import { DESKTOP_AGENT_AVATAR_RENDERERS } from './chat-agent-avatar-renderers';

export type ChatAgentAvatarStageViewportProps = {
  stage: ChatAgentAvatarStageRenderModel;
  onVrmLoadStateChange?: (status: 'idle' | 'loading' | 'ready' | 'error') => void;
  onVrmLoadErrorChange?: (error: string | null) => void;
  onVrmDiagnosticChange?: (diagnostic: ChatAgentAvatarVrmDiagnostic) => void;
  onLive2dLoadStateChange?: (status: 'loading' | 'ready' | 'error') => void;
  onLive2dLoadErrorChange?: (error: string | null) => void;
  onLive2dDiagnosticChange?: (diagnostic: ChatAgentAvatarLive2dDiagnostic) => void;
};

export function ChatAgentAvatarStageViewport(props: ChatAgentAvatarStageViewportProps) {
  if (props.stage.snapshot.presentation.backendKind === 'vrm') {
    return (
        <ChatAgentAvatarVrmViewport
          input={props.stage.viewportInput}
          chrome="minimal"
          attentionState={props.stage.attentionState}
          onLoadStateChange={props.onVrmLoadStateChange}
          onLoadErrorChange={props.onVrmLoadErrorChange}
          onDiagnosticChange={props.onVrmDiagnosticChange}
      />
    );
  }

  if (props.stage.snapshot.presentation.backendKind === 'live2d') {
    return (
      <ChatAgentAvatarLive2dViewport
        input={props.stage.viewportInput}
        chrome="minimal"
        onLoadStateChange={props.onLive2dLoadStateChange}
        onLoadErrorChange={props.onLive2dLoadErrorChange}
        onDiagnosticChange={props.onLive2dDiagnosticChange}
      />
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center">
      <AvatarStage
        snapshot={props.stage.snapshot}
        label={props.stage.label}
        imageUrl={props.stage.imageUrl}
        fallbackLabel={props.stage.fallbackLabel}
        showStatusBadge={false}
        size="lg"
        renderers={DESKTOP_AGENT_AVATAR_RENDERERS}
      />
    </div>
  );
}
