import type { CanonicalConversationAnchoredSurfacePlacement } from '@nimiplatform/nimi-kit/features/chat';

/**
 * Chat-agent transcript / composer layout contract.
 *
 * Under D-LLM-065, the avatar is rendered as an app-wide absolute overlay and
 * does not carve transcript width. Every placement returns the same
 * transcript / composer sizing so the chat domain occupies the full middle
 * area, with a modest `max-w` + `mx-auto` centering for readability. Only
 * `scenePlacementClassName` / `sceneShellClassName` / stage size remain
 * placement-dependent because they are consumed by the overlay component.
 */

export const CHAT_AGENT_TRANSCRIPT_BOTTOM_RESERVE_CLASS = 'pb-[clamp(140px,16vh,200px)]';

export type ChatAgentAvatarStageLayoutContract = {
  stageSizeClassName: string;
  anchoredShellClassName: string;
  reserveSpaceClassName?: string;
  viewportSceneClassName: string;
  scenePlacementClassName: string;
  sceneShellClassName: string;
  transcriptWidthClassName: string;
  transcriptWidthPositionClassName: string;
  transcriptScrollViewportWidthClassName: string;
  transcriptScrollViewportPositionClassName: string;
  transcriptContentBottomReserveClassName?: string;
  composerWidthClassName: string;
  composerWidthPositionClassName: string;
};

/**
 * Transcript width budget — placement-agnostic.
 *
 * Chat is `mx-auto` centered. Max-width is sized so that at typical viewport
 * widths (1000-1600px) there are ~320px quiet gutters on both sides, enough
 * to host the avatar overlay canvas (`w-[clamp(220px,19vw,280px)]` + a
 * 16-40px margin) without ever overlapping transcript content, regardless
 * of which placement (left/right/center) the avatar takes.
 */
const UNIFORM_TRANSCRIPT_WIDTH = 'max-w-[min(680px,calc(100vw-680px))]';
const UNIFORM_COMPOSER_WIDTH = 'max-w-[min(680px,calc(100vw-680px))]';
const UNIFORM_CENTER_POSITION = 'mx-auto';

export function resolveChatAgentAvatarStageLayoutContract(
  placement: CanonicalConversationAnchoredSurfacePlacement,
): ChatAgentAvatarStageLayoutContract {
  const base = {
    transcriptWidthClassName: UNIFORM_TRANSCRIPT_WIDTH,
    transcriptWidthPositionClassName: UNIFORM_CENTER_POSITION,
    transcriptScrollViewportWidthClassName: UNIFORM_TRANSCRIPT_WIDTH,
    transcriptScrollViewportPositionClassName: UNIFORM_CENTER_POSITION,
    transcriptContentBottomReserveClassName: CHAT_AGENT_TRANSCRIPT_BOTTOM_RESERVE_CLASS,
    composerWidthClassName: UNIFORM_COMPOSER_WIDTH,
    composerWidthPositionClassName: UNIFORM_CENTER_POSITION,
  };

  switch (placement) {
    case 'left-center':
      return {
        ...base,
        stageSizeClassName: 'h-full w-full',
        anchoredShellClassName: 'h-full w-full',
        viewportSceneClassName: '',
        scenePlacementClassName: 'flex h-full w-full items-center justify-start',
        sceneShellClassName: 'h-full w-full',
      };
    case 'top-left':
      return {
        ...base,
        stageSizeClassName: 'h-full w-full',
        anchoredShellClassName: 'h-full w-full',
        viewportSceneClassName: '',
        scenePlacementClassName: 'flex h-full w-full items-start justify-start',
        sceneShellClassName: 'h-full w-full',
      };
    case 'top-right':
      return {
        ...base,
        stageSizeClassName: 'h-full w-full',
        anchoredShellClassName: 'h-full w-full',
        viewportSceneClassName: '',
        scenePlacementClassName: 'flex h-full w-full items-start justify-end',
        sceneShellClassName: 'h-full w-full',
      };
    case 'bottom-right':
      return {
        ...base,
        stageSizeClassName: 'h-full w-full',
        anchoredShellClassName: 'h-full w-full',
        viewportSceneClassName: '',
        scenePlacementClassName: 'flex h-full w-full items-end justify-end',
        sceneShellClassName: 'h-full w-full',
      };
    case 'bottom-center':
      return {
        ...base,
        stageSizeClassName: 'h-full w-full',
        anchoredShellClassName: 'h-full w-full',
        viewportSceneClassName: '',
        scenePlacementClassName: 'flex h-full w-full items-end justify-center',
        sceneShellClassName: 'h-full w-full',
      };
    case 'center':
      return {
        ...base,
        stageSizeClassName: 'h-full w-full',
        anchoredShellClassName: 'h-full w-full',
        viewportSceneClassName: '',
        scenePlacementClassName: 'flex h-full w-full items-center justify-center',
        sceneShellClassName: 'h-full w-full',
      };
    case 'right-center':
    default:
      return {
        ...base,
        stageSizeClassName: 'h-full w-full',
        anchoredShellClassName: 'h-full w-full',
        viewportSceneClassName: '',
        scenePlacementClassName: 'flex h-full w-full items-center justify-end',
        sceneShellClassName: 'h-full w-full',
      };
  }
}
