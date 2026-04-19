import { AvatarStage } from '@nimiplatform/nimi-kit/features/avatar';
import ChatAgentAvatarLive2dViewport from './chat-agent-avatar-live2d-viewport';
import type { ChatAgentAvatarLive2dDiagnostic } from './chat-agent-avatar-live2d-diagnostics';
import type { ChatAgentAvatarLive2dFramingIntent } from './chat-agent-avatar-live2d-framing';
import ChatAgentAvatarVrmViewport, {
  type ChatAgentAvatarVrmDiagnostic,
} from './chat-agent-avatar-vrm-viewport';
import type { ChatAgentAvatarVrmFramingIntent } from './chat-agent-avatar-vrm-framing';
import type { ChatAgentAvatarStageRenderModel } from './chat-agent-avatar-stage-model';
import { DESKTOP_AGENT_AVATAR_RENDERERS } from './chat-agent-avatar-renderers';
import {
  formatAvatarTransformCssValue,
  useChatAgentAvatarTransform,
} from './chat-agent-avatar-transform-store';

export type ChatAgentAvatarStageViewportProps = {
  stage: ChatAgentAvatarStageRenderModel;
  vrmFramingIntent?: ChatAgentAvatarVrmFramingIntent;
  live2dFramingIntent?: ChatAgentAvatarLive2dFramingIntent;
  onVrmLoadStateChange?: (status: 'idle' | 'loading' | 'ready' | 'error') => void;
  onVrmLoadErrorChange?: (error: string | null) => void;
  onVrmDiagnosticChange?: (diagnostic: ChatAgentAvatarVrmDiagnostic) => void;
  onLive2dLoadStateChange?: (status: 'loading' | 'ready' | 'error') => void;
  onLive2dLoadErrorChange?: (error: string | null) => void;
  onLive2dDiagnosticChange?: (diagnostic: ChatAgentAvatarLive2dDiagnostic) => void;
};

export function ChatAgentAvatarStageViewport(props: ChatAgentAvatarStageViewportProps) {
  const transform = useChatAgentAvatarTransform();
  // D-LLM-065 — wrap viewport in a transform container so script/debug overrides
  // can translate/scale/rotate the avatar without perturbing renderer internals.
  // Transform is surface-local transient; resets on surface teardown per D-LLM-057.
  const transformWrapperStyle = {
    transform: formatAvatarTransformCssValue(transform),
    transformOrigin: 'center center',
    willChange: 'transform',
    width: '100%',
    height: '100%',
  } as const;

  if (props.stage.snapshot.presentation.backendKind === 'vrm') {
    return (
      <div style={transformWrapperStyle} data-chat-agent-avatar-transform-wrapper="true">
        <ChatAgentAvatarVrmViewport
          input={props.stage.viewportInput}
          chrome="minimal"
          attentionState={props.stage.attentionState}
          framingIntent={props.vrmFramingIntent}
          onLoadStateChange={props.onVrmLoadStateChange}
          onLoadErrorChange={props.onVrmLoadErrorChange}
          onDiagnosticChange={props.onVrmDiagnosticChange}
        />
      </div>
    );
  }

  if (props.stage.snapshot.presentation.backendKind === 'live2d') {
    return (
      <div style={transformWrapperStyle} data-chat-agent-avatar-transform-wrapper="true">
        <ChatAgentAvatarLive2dViewport
          input={props.stage.viewportInput}
          chrome="minimal"
          framingIntent={props.live2dFramingIntent}
          onLoadStateChange={props.onLive2dLoadStateChange}
          onLoadErrorChange={props.onLive2dLoadErrorChange}
          onDiagnosticChange={props.onLive2dDiagnosticChange}
        />
      </div>
    );
  }

  return (
    <div style={transformWrapperStyle} data-chat-agent-avatar-transform-wrapper="true">
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
    </div>
  );
}
