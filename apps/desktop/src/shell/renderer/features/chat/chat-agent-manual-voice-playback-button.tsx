import { LocalAppConversationVoiceButton } from '@nimiplatform/kit/features/chat/ui';
import type { ComponentProps } from 'react';
import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import type { ReportAgentConversationHostError } from './chat-agent-shell-adapter-host-feedback';

export function AgentManualVoicePlaybackButton(props: Omit<ComponentProps<typeof LocalAppConversationVoiceButton>, 'agentHandle' | 'conversation' | 'onError'> & {
  activeTarget: AgentLocalTargetSnapshot | null;
  reportHostError?: ReportAgentConversationHostError;
}) {
  const sdk = useDesktopRendererSdk();
  return <LocalAppConversationVoiceButton {...props} agentHandle={props.activeTarget?.agentHandle ?? null}
    conversation={() => sdk.conversation()}
    onError={error => props.reportHostError?.(error, { action: 'render-runtime-agent-manual-voice', extra: {
      conversationAnchorId: props.activeConversationAnchorId, messageId: props.message.id,
    } })} />;
}
