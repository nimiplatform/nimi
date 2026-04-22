import { AvatarStage } from '@nimiplatform/nimi-kit/features/avatar';
import type { ChatAgentAvatarStageRenderModel } from './chat-agent-avatar-stage-model';
import {
  formatAvatarTransformCssValue,
  useChatAgentAvatarTransform,
} from './chat-agent-avatar-transform-store';

export type ChatAgentAvatarStageViewportProps = {
  stage: ChatAgentAvatarStageRenderModel;
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
        />
      </div>
    </div>
  );
}
