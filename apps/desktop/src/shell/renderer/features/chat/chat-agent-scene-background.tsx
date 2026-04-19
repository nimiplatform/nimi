import { cn } from '@nimiplatform/nimi-kit/ui';
import type { ConversationCharacterData } from '@nimiplatform/nimi-kit/features/chat/headless';

export type ChatAgentSceneBackgroundProps = {
  characterData?: ConversationCharacterData | null;
};

/**
 * Chat surface background — Layer 0 (app-native glass) + Layer 1 (optional
 * in-app imported backdrop mask) of the D-LLM-065 four-layer stack.
 *
 * Avatar (Layer 2) is rendered as an independent absolute-positioned overlay
 * via `ChatAgentAvatarOverlay`, not here. The scene background stays purely
 * decorative and does not participate in the chat shell's flex layout or
 * reshape transcript width.
 */
export function ChatAgentSceneBackground(props: ChatAgentSceneBackgroundProps) {
  const backdropImageUrl = props.characterData?.theme?.appBackdropImageUrl;

  return (
    <div
      className="absolute inset-0"
      data-chat-agent-scene-background="true"
    >
      {/* Layer 0 — app-native glass base */}
      <div
        className="chat-agent-layer-glass absolute inset-0"
        data-chat-agent-scene-layer="glass"
        style={{ zIndex: 0 }}
      />

      {/* Layer 1 — optional in-app backdrop mask image (per-agent import); transparent when absent */}
      <div
        className={cn('chat-agent-layer-mask absolute inset-0')}
        data-chat-agent-scene-layer="mask"
        data-chat-agent-scene-mask-active={backdropImageUrl ? 'true' : 'false'}
        style={{
          zIndex: 1,
          backgroundImage: backdropImageUrl ? `url(${backdropImageUrl})` : undefined,
        }}
      />
    </div>
  );
}
