import type { CSSProperties } from 'react';

/**
 * Canonical chat bubble geometry.
 *
 * The canonical message bubble family is the UI truth source for shared chat
 * bubbles; realm/app-AI/stream surfaces reuse these constants instead of
 * re-declaring corner radius, font size, or max-width values.
 */
export const CHAT_BUBBLE_CORNER_RADIUS_PX = 22;
export const CHAT_BUBBLE_DIRECTIONAL_CORNER_RADIUS_PX = 6;

/**
 * Border radius for a chat bubble. The small directional corner points at the
 * sender: bottom-right for the current user, bottom-left for the agent.
 * CSS border-radius order: top-left / top-right / bottom-right / bottom-left.
 */
export function chatBubbleShapeStyle(role: 'user' | 'agent'): CSSProperties {
  const radius = CHAT_BUBBLE_CORNER_RADIUS_PX;
  const directional = CHAT_BUBBLE_DIRECTIONAL_CORNER_RADIUS_PX;
  return role === 'user'
    ? { borderRadius: `${radius}px ${radius}px ${directional}px ${radius}px` }
    : { borderRadius: `${radius}px ${radius}px ${radius}px ${directional}px` };
}

export const CHAT_BUBBLE_TEXT_CLASSNAME = 'text-sm leading-[1.6]';
export const CHAT_BUBBLE_MAX_WIDTH_CLASSNAME = 'max-w-[72%]';
export const CHAT_BUBBLE_MEDIA_MAX_WIDTH_CLASSNAME = 'max-w-[78%]';
