import type { ReactNode } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import type { ConversationCharacterData, ConversationTargetSummary, ConversationViewMode } from '../types.js';
import { resolveConversationThemeBackgroundStyle } from './conversation-theme-background.js';

export const CANONICAL_STAGE_SURFACE_WIDTH_CLASS = 'max-w-[min(1240px,calc(100vw-520px))]';

export type CanonicalConversationAnchoredSurfacePlacement =
  | 'right-center'
  | 'left-center'
  | 'top-right'
  | 'top-left'
  | 'bottom-right'
  | 'bottom-center'
  | 'center';

export type CanonicalConversationAnchoredSurfaceConfig = {
  content: ReactNode;
  placement?: CanonicalConversationAnchoredSurfacePlacement;
  shellClassName?: string;
  reserveSpaceClassName?: string;
  visibleInModes?: readonly ConversationViewMode[];
};

function resolveAnchoredSurfacePlacementClass(
  placement: CanonicalConversationAnchoredSurfacePlacement,
): string {
  switch (placement) {
    case 'left-center':
      return 'left-6 top-6 bottom-6 flex items-center';
    case 'top-right':
      return 'right-6 top-6';
    case 'top-left':
      return 'left-6 top-6';
    case 'center':
      return 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2';
    case 'bottom-right':
      return 'right-6 bottom-4 flex items-end';
    case 'bottom-center':
      return 'left-1/2 bottom-4 flex -translate-x-1/2 items-end justify-center';
    case 'right-center':
    default:
      return 'right-6 top-6 bottom-6 flex items-center';
  }
}

export type CanonicalConversationPaneProps = {
  selectedTarget: ConversationTargetSummary;
  characterData?: ConversationCharacterData | null;
  chrome?: 'card' | 'transparent';
  viewMode: ConversationViewMode;
  onBackToTargets: () => void;
  onViewModeChange: (mode: ConversationViewMode) => void;
  onOpenSettings?: () => void;
  topContent?: ReactNode;
  stagePanel: ReactNode;
  transcript: ReactNode;
  anchoredSurface?: CanonicalConversationAnchoredSurfaceConfig;
  composer?: ReactNode;
};

export function CanonicalConversationPane(props: CanonicalConversationPaneProps) {
  const themeBackgroundStyle = props.chrome === 'transparent'
    ? { background: 'transparent' }
    : resolveConversationThemeBackgroundStyle({
      theme: props.characterData?.theme,
      fallbackBackground: 'linear-gradient(180deg, rgba(255,255,255,0.84), rgba(255,255,255,0.92))',
    });
  const anchoredSurfaceVisible = Boolean(
    props.anchoredSurface?.content
      && (props.anchoredSurface.visibleInModes?.includes(props.viewMode) ?? props.viewMode === 'chat'),
  );
  return (
    <section
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      data-canonical-conversation-pane="true"
      data-conversation-pane-chrome={props.chrome || 'card'}
      style={themeBackgroundStyle}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {props.topContent ? (
          <div className="shrink-0 px-6 pt-5">
            <div className="mx-auto w-full max-w-[min(1240px,calc(100vw-520px))]">
              {props.topContent}
            </div>
          </div>
        ) : null}
        <div key={props.viewMode} className="flex min-h-0 flex-1 flex-col animate-[conv-fade-in_280ms_ease-out]">
          {props.viewMode === 'stage' ? props.stagePanel : (
            <div className="relative min-h-0 flex-1" data-canonical-conversation-scene="true">
              <div
                className={cn(
                  'relative z-[1] min-h-0 flex-1',
                  anchoredSurfaceVisible ? props.anchoredSurface?.reserveSpaceClassName : null,
                )}
              >
                {props.transcript}
              </div>
              {anchoredSurfaceVisible ? (
                <div
                  className="pointer-events-none absolute inset-0 z-0"
                  data-canonical-anchored-surface="true"
                >
                  <div
                    className={cn(
                      'absolute',
                      resolveAnchoredSurfacePlacementClass(props.anchoredSurface?.placement || 'bottom-center'),
                      props.anchoredSurface?.shellClassName,
                    )}
                  >
                    <div className="pointer-events-auto max-h-full">
                      {props.anchoredSurface?.content}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
        {props.composer ? <div className="relative z-[2] shrink-0">{props.composer}</div> : null}
      </div>
    </section>
  );
}
