import {
  AvatarStage,
  type AvatarStageSnapshot,
} from '@nimiplatform/nimi-kit/features/avatar';
import type { AvatarVrmViewportRenderInput } from '@nimiplatform/nimi-kit/features/avatar/vrm';
import ChatAgentAvatarLive2dViewport, {
  type ChatAgentAvatarLive2dDiagnostic,
} from './chat-agent-avatar-live2d-viewport';
import type { ChatAgentAvatarPointerInteractionState } from './chat-agent-avatar-pointer-interaction';
import ChatAgentAvatarVrmViewport from './chat-agent-avatar-vrm-viewport';
import { DESKTOP_AGENT_AVATAR_RENDERERS } from './chat-agent-avatar-renderers';

export type ChatAgentAvatarStageViewportProps = {
  snapshot: AvatarStageSnapshot;
  label: string;
  imageUrl?: string | null;
  fallbackLabel?: string | null;
  viewportInput: AvatarVrmViewportRenderInput;
  pointerInteraction?: ChatAgentAvatarPointerInteractionState | null;
  onLive2dLoadStateChange?: (status: 'loading' | 'ready' | 'error') => void;
  onLive2dLoadErrorChange?: (error: string | null) => void;
  onLive2dDiagnosticChange?: (diagnostic: ChatAgentAvatarLive2dDiagnostic) => void;
};

export function ChatAgentAvatarStageViewport(props: ChatAgentAvatarStageViewportProps) {
  if (props.snapshot.presentation.backendKind === 'vrm') {
    return (
      <ChatAgentAvatarVrmViewport
        input={props.viewportInput}
        chrome="minimal"
        pointerInteraction={props.pointerInteraction}
      />
    );
  }

  if (props.snapshot.presentation.backendKind === 'live2d') {
    return (
      <ChatAgentAvatarLive2dViewport
        input={props.viewportInput}
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
        snapshot={props.snapshot}
        label={props.label}
        imageUrl={props.imageUrl}
        fallbackLabel={props.fallbackLabel}
        showStatusBadge={false}
        size="lg"
        renderers={DESKTOP_AGENT_AVATAR_RENDERERS}
      />
    </div>
  );
}
