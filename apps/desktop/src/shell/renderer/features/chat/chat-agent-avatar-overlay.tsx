import { cn } from '@nimiplatform/nimi-kit/ui';
import type { CanonicalConversationAnchoredSurfacePlacement } from '@nimiplatform/nimi-kit/features/chat';
import type {
  ConversationCharacterData,
  ConversationTargetSummary,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import {
  ChatAgentAnchoredAvatarStage,
  type ChatAgentHandsFreeState,
} from './chat-agent-anchored-avatar-stage';

/**
 * App-wide transparent avatar overlay (D-LLM-065 Layer 2).
 *
 * The overlay is a large transparent canvas that spans most of the app area.
 * The character is drawn somewhere inside this canvas at a natural size
 * determined by the VRM/Live2D framing — because the canvas is much larger
 * than the character's rendered pixels, the character is never clipped by the
 * canvas edges.
 *
 * Placement store drives WHERE the large canvas itself is anchored in the app.
 * Default right-center: canvas occupies the right ~55% of the window, so the
 * character visually appears on the right side. Changing placement moves the
 * canvas to a different corner without affecting chat layout.
 */

export type ChatAgentAvatarOverlayProps = {
  selectedTarget: ConversationTargetSummary;
  characterData?: ConversationCharacterData | null;
  placement?: CanonicalConversationAnchoredSurfacePlacement;
  settingsActive: boolean;
  thinkingState?: 'on' | 'off' | 'unsupported';
  onThinkingToggle?: () => void;
  handsFreeState?: ChatAgentHandsFreeState;
};

/**
 * Canvas dimensions — sized to match a natural character footprint (roughly
 * portrait 1:2 aspect). Making the canvas bigger does NOT give the character
 * breathing room because the VRM/Live2D framing fits the character to the
 * canvas; it just makes the character bigger and more likely to spill over
 * the chat area. Keep the canvas compact so the character stays a moderate
 * visual size and lives inside the right-side gutter reserved by the chat
 * max-width.
 */
const CANVAS_WIDTH_CLASSNAME = 'w-[clamp(220px,19vw,280px)]';
const CANVAS_HEIGHT_CLASSNAME = 'h-[clamp(400px,56vh,520px)]';

/**
 * Resolve the anchor CSS for the canvas inside the full-app viewport. The
 * canvas is big; the anchor decides which half of the screen the character
 * visually lives in. Composer clearance is handled by the canvas's bottom
 * inset so feet never collide with the input pill.
 */
function resolveOverlayAnchorClassName(
  placement: CanonicalConversationAnchoredSurfacePlacement,
): string {
  switch (placement) {
    case 'left-center':
      return 'left-4 bottom-[clamp(140px,18vh,200px)]';
    case 'top-left':
      return 'left-4 top-4';
    case 'top-right':
      return 'right-4 top-4';
    case 'bottom-right':
      return 'right-4 bottom-[clamp(140px,18vh,200px)]';
    case 'bottom-center':
      return 'left-1/2 bottom-[clamp(140px,18vh,200px)] -translate-x-1/2';
    case 'center':
      return 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2';
    case 'right-center':
    default:
      return 'right-4 bottom-[clamp(140px,18vh,200px)]';
  }
}

export function ChatAgentAvatarOverlay(props: ChatAgentAvatarOverlayProps) {
  const placement = props.placement || 'right-center';
  const anchorClassName = resolveOverlayAnchorClassName(placement);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[2]"
      data-chat-agent-avatar-overlay="true"
      data-chat-agent-avatar-overlay-placement={placement}
    >
      <div
        className={cn(
          'pointer-events-auto absolute',
          CANVAS_WIDTH_CLASSNAME,
          CANVAS_HEIGHT_CLASSNAME,
          anchorClassName,
        )}
      >
        <ChatAgentAnchoredAvatarStage
          selectedTarget={props.selectedTarget}
          characterData={props.characterData}
          placement={placement}
          settingsActive={props.settingsActive}
          thinkingState={props.thinkingState}
          onThinkingToggle={props.onThinkingToggle}
          handsFreeState={props.handsFreeState}
        />
      </div>
    </div>
  );
}
