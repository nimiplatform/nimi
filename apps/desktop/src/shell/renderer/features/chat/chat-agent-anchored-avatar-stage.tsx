import { useEffect, useMemo, useState } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import type { CanonicalConversationAnchoredSurfacePlacement } from '@nimiplatform/nimi-kit/features/chat';
import type { ConversationCharacterData, ConversationTargetSummary } from '@nimiplatform/nimi-kit/features/chat/headless';
import { ChatAgentAvatarStageViewport } from './chat-agent-avatar-stage-viewport';
import {
  resolveChatAgentAvatarAttentionStateFromAppAttention,
} from './chat-agent-avatar-attention-state';
import {
  CHAT_AGENT_AVATAR_SMOKE_OVERRIDE_EVENT,
  resolveChatAgentAvatarStageRenderModel,
  resolveChatAgentAvatarStageModel,
} from './chat-agent-avatar-stage-model';
import { resolveChatAgentAvatarStageLayoutContract } from './chat-agent-avatar-stage-layout';
import { useAppAttention } from '@renderer/app-shell/providers/app-attention-context';

export type ChatAgentHandsFreeState = {
  mode: 'push-to-talk' | 'hands-free';
  status: 'idle' | 'listening' | 'transcribing' | 'failed';
  disabled: boolean;
  onEnter: () => void;
  onExit: () => void;
};

export type ChatAgentAnchoredAvatarStageProps = {
  selectedTarget: ConversationTargetSummary;
  characterData?: ConversationCharacterData | null;
  placement?: CanonicalConversationAnchoredSurfacePlacement;
  settingsActive: boolean;
  thinkingState?: 'on' | 'off' | 'unsupported';
  onThinkingToggle?: () => void;
  handsFreeState?: ChatAgentHandsFreeState;
};

export function ChatAgentAnchoredAvatarStage(props: ChatAgentAnchoredAvatarStageProps) {
  const placement = props.placement || 'right-center';
  const bottomAnchored = placement === 'bottom-center' || placement === 'bottom-right';
  const layoutContract = resolveChatAgentAvatarStageLayoutContract(placement);
  const [, setSmokeOverrideVersion] = useState(0);
  const appAttention = useAppAttention();
  const attentionState = useMemo(
    () => resolveChatAgentAvatarAttentionStateFromAppAttention({
      attention: appAttention,
    }),
    [appAttention],
  );
  const stageModel = useMemo(
    () => resolveChatAgentAvatarStageModel({
      selectedTarget: props.selectedTarget,
      characterData: props.characterData,
      attentionState,
    }),
    [attentionState, props.characterData, props.selectedTarget],
  );
  const stageRenderModel = useMemo(
    () => resolveChatAgentAvatarStageRenderModel({ stageModel }),
    [stageModel],
  );

  useEffect(() => {
    const handleSmokeOverrideChange = () => {
      setSmokeOverrideVersion((current) => current + 1);
    };
    window.addEventListener(CHAT_AGENT_AVATAR_SMOKE_OVERRIDE_EVENT, handleSmokeOverrideChange);
    return () => {
      window.removeEventListener(CHAT_AGENT_AVATAR_SMOKE_OVERRIDE_EVENT, handleSmokeOverrideChange);
    };
  }, []);
  return (
    <div
      className={cn(
        'pointer-events-none relative flex items-end justify-center',
        layoutContract.stageSizeClassName,
      )}
      data-chat-agent-anchored-stage="true"
      data-chat-agent-stage-placement={placement}
      data-chat-agent-stage-layout={layoutContract.stageSizeClassName}
      data-chat-settings-active={props.settingsActive ? 'true' : 'false'}
    >
      <div
        className={cn(
          'relative h-full w-full',
          bottomAnchored ? 'overflow-hidden' : 'overflow-visible',
          bottomAnchored ? layoutContract.viewportSceneClassName : null,
        )}
        data-avatar-stage-viewport="true"
        data-avatar-stage-attention-enabled="true"
        data-avatar-stage-attention-active={attentionState.active ? 'true' : 'false'}
      >
        <ChatAgentAvatarStageViewport
          stage={stageRenderModel}
        />
      </div>
    </div>
  );
}
