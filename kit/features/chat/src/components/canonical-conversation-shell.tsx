import { useCallback, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import type {
  ConversationCanonicalMessage,
  ConversationCharacterData,
  ConversationSourceFilter,
  ConversationSourceKind,
  ConversationSetupAction,
  ConversationSetupState,
  ConversationTargetSummary,
  ConversationViewMode,
} from '../types.js';
import { ConversationAnimationStyles } from './conversation-animations.js';
import { CanonicalCharacterRail } from './canonical-character-rail.js';
import {
  CanonicalConversationPane,
  type CanonicalConversationAnchoredSurfaceConfig,
} from './canonical-conversation-pane.js';
import { CanonicalDrawerShell } from './canonical-drawer-shell.js';
import { CanonicalRightSidebar } from './canonical-right-sidebar.js';
import { CanonicalStagePanel, type CanonicalStagePanelProps } from './canonical-stage-panel.js';
import { CanonicalTargetPane } from './canonical-target-pane.js';
import { CanonicalTranscriptView, type CanonicalTranscriptViewProps } from './canonical-transcript-view.js';
import { ConversationSetupPanel } from './conversation-setup-panel.js';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveStageCardAnchorOffset(input: {
  avatarRect: { top: number; height: number };
  stageRect: { top: number; height: number };
}): number {
  const avatarCenter = input.avatarRect.top + (input.avatarRect.height / 2);
  const rawOffset = avatarCenter - input.stageRect.top;
  const stageHeight = Math.max(input.stageRect.height, 1);
  const safetyMargin = Math.min(160, Math.max(96, stageHeight * 0.18));
  const maxOffset = Math.max(safetyMargin, stageHeight - safetyMargin);
  return clamp(rawOffset, safetyMargin, maxOffset);
}

export type CanonicalConversationShellRenderContext = {
  avatarAnchorRef: MutableRefObject<HTMLButtonElement | null>;
  stageAnchorViewportRef: MutableRefObject<HTMLDivElement | null>;
  stageCardAnchorOffsetPx: number | null;
  onIntentOpenHistory: () => void;
};

export type CanonicalConversationShellProps = {
  className?: string;
  chrome?: 'card' | 'transparent';
  sourceFilter: ConversationSourceFilter;
  availableSources?: readonly ConversationSourceKind[];
  targets: readonly ConversationTargetSummary[];
  loadingTargets?: boolean;
  selectedTargetId: string | null;
  selectedTarget: ConversationTargetSummary | null;
  onSelectTarget: (targetId: string | null) => void;
  onSourceFilterChange?: (filter: ConversationSourceFilter) => void;
  viewMode: ConversationViewMode;
  onViewModeChange: (mode: ConversationViewMode) => void;
  setupState?: ConversationSetupState | null;
  setupDescription?: ReactNode;
  onSetupAction?: (action: ConversationSetupAction) => void;
  characterData?: ConversationCharacterData | null;
  messages?: readonly ConversationCanonicalMessage[];
  pendingFirstBeat?: boolean;
  transcriptProps?: Omit<CanonicalTranscriptViewProps, 'messages'>;
  stagePanelProps?: Omit<
    CanonicalStagePanelProps,
    'messages' | 'characterData' | 'anchorViewportRef' | 'cardAnchorOffsetPx' | 'onIntentOpenHistory'
  >;
  topContent?: ReactNode;
  composer?: ReactNode;
  settingsDrawer?: ReactNode;
  settingsDrawerTitle?: string;
  settingsDrawerSubtitle?: string | null;
  profileDrawer?: ReactNode;
  profileDrawerTitle?: string;
  profileDrawerSubtitle?: string | null;
  rightSidebar?: ReactNode;
  rightSidebarOverlayMenu?: ReactNode;
  settingsOpen?: boolean;
  onSettingsOpenChange?: (open: boolean) => void;
  profileOpen?: boolean;
  onProfileOpenChange?: (open: boolean) => void;
  rightSidebarOpen?: boolean;
  onRightSidebarOpenChange?: (open: boolean) => void;
  rightSidebarResetKey?: string;
  renderTargetMeta?: (target: ConversationTargetSummary) => ReactNode;
  auxiliaryOverlayContent?: ReactNode;
  /** When true, skip the built-in target pane and show an empty placeholder instead. */
  hideTargetPane?: boolean;
  /** When true, skip the built-in character rail on the left side. Use when avatar/presence affordances are rendered elsewhere. */
  hideCharacterRail?: boolean;
  /** Optional right panel content rendered between the conversation pane and any external sidebar. */
  rightPanel?: ReactNode;
  /** Optional anchored surface rendered inside the active conversation pane rather than as a separate sidebar. */
  conversationAnchoredSurface?: CanonicalConversationAnchoredSurfaceConfig;
  /** Optional scene background rendered beneath the shell UI layers. */
  sceneBackground?: ReactNode;
};

export function CanonicalConversationShell(props: CanonicalConversationShellProps) {
  const [internalSettingsOpen, setInternalSettingsOpen] = useState(false);
  const [internalProfileOpen, setInternalProfileOpen] = useState(false);
  const avatarAnchorRef = useRef<HTMLButtonElement | null>(null);
  const stageAnchorViewportRef = useRef<HTMLDivElement | null>(null);
  const [stageCardAnchorOffsetPx, setStageCardAnchorOffsetPx] = useState<number | null>(null);

  const settingsOpen = props.settingsOpen ?? internalSettingsOpen;
  const profileOpen = props.profileOpen ?? internalProfileOpen;
  const rightSidebarOpen = Boolean(props.rightSidebar && props.rightSidebarOpen);
  const overlayVisible = settingsOpen || profileOpen || rightSidebarOpen;
  const availableSources = useMemo<ConversationSourceKind[]>(
    () => props.availableSources && props.availableSources.length > 0
      ? [...props.availableSources]
      : ['ai', 'human', 'agent'],
    [props.availableSources],
  );
  const messages = props.messages || [];
  const shellRenderContext = useMemo<CanonicalConversationShellRenderContext>(() => ({
    avatarAnchorRef,
    stageAnchorViewportRef,
    stageCardAnchorOffsetPx,
    onIntentOpenHistory: () => props.onViewModeChange('chat'),
  }), [props.onViewModeChange, stageCardAnchorOffsetPx]);
  const setupBlocking = props.setupState && props.setupState.status !== 'ready';

  const setSettingsOpen = useCallback((open: boolean) => {
    setInternalSettingsOpen(open);
    props.onSettingsOpenChange?.(open);
  }, [props]);

  const setProfileOpen = useCallback((open: boolean) => {
    setInternalProfileOpen(open);
    props.onProfileOpenChange?.(open);
  }, [props]);

  const closeTransientPanels = useCallback(() => {
    setSettingsOpen(false);
    setProfileOpen(false);
    props.onRightSidebarOpenChange?.(false);
  }, [props, setProfileOpen, setSettingsOpen]);

  const syncStageCardAnchor = useCallback(() => {
    const avatarElement = avatarAnchorRef.current;
    const stageElement = stageAnchorViewportRef.current;
    if (!avatarElement || !stageElement) {
      return;
    }
    const nextOffset = resolveStageCardAnchorOffset({
      avatarRect: avatarElement.getBoundingClientRect(),
      stageRect: stageElement.getBoundingClientRect(),
    });
    setStageCardAnchorOffsetPx((previous) => {
      if (previous !== null && Math.abs(previous - nextOffset) < 0.5) {
        return previous;
      }
      return nextOffset;
    });
  }, []);

  useLayoutEffect(() => {
    if (!props.selectedTarget || props.viewMode !== 'stage') {
      setStageCardAnchorOffsetPx(null);
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }
    const avatarElement = avatarAnchorRef.current;
    const stageElement = stageAnchorViewportRef.current;
    if (!avatarElement || !stageElement) {
      return;
    }
    let frameId: number | null = null;
    const scheduleSync = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        syncStageCardAnchor();
      });
    };
    scheduleSync();
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
        scheduleSync();
      });
    resizeObserver?.observe(avatarElement);
    resizeObserver?.observe(stageElement);
    window.addEventListener('resize', scheduleSync);
    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleSync);
    };
  }, [props.selectedTarget, props.viewMode, syncStageCardAnchor]);

  return (
    <div
      className={cn(
        'conversation-root relative flex min-h-0 w-full flex-1 overflow-hidden',
        props.chrome === 'transparent'
          ? 'rounded-none bg-transparent'
          : 'rounded-2xl bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.14),_transparent_38%),linear-gradient(180deg,_rgba(248,250,252,0.98),_rgba(241,245,249,0.94))]',
        props.className,
      )}
      data-conversation-shell="canonical"
      data-conversation-shell-chrome={props.chrome || 'card'}
      data-ui-version="v5-room"
    >
      <ConversationAnimationStyles />
      {props.sceneBackground ? (
        <div
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
          data-conversation-scene-background="true"
        >
          {props.sceneBackground}
        </div>
      ) : null}
      <div className="relative z-[1] flex min-h-0 w-full min-w-0 flex-1">
        {setupBlocking ? (
          <>
            <div className="flex min-h-0 flex-1 items-center justify-center px-6">
              <ConversationSetupPanel
                state={props.setupState!}
                description={props.setupDescription}
                onAction={props.onSetupAction}
                className="w-full"
              />
            </div>
            {props.rightPanel ?? null}
          </>
        ) : !props.selectedTarget ? (
          props.hideTargetPane ? (
            <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-slate-400">
              Select a conversation from the sidebar
            </div>
          ) : (
            <CanonicalTargetPane
              targets={props.targets}
              loadingTargets={props.loadingTargets}
              sourceFilter={props.sourceFilter}
              availableSources={availableSources}
              onSourceFilterChange={props.onSourceFilterChange}
              onSelectTarget={props.onSelectTarget}
              renderTargetMeta={props.renderTargetMeta}
            />
          )
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-row">
            {props.hideCharacterRail ? null : (
              <CanonicalCharacterRail
                selectedTarget={props.selectedTarget}
                characterData={props.characterData}
                avatarAnchorRef={avatarAnchorRef}
                hideBackButton={props.hideTargetPane}
                onBackToTargets={() => {
                  props.onSelectTarget(null);
                  closeTransientPanels();
                }}
                onOpenProfile={props.profileDrawer ? () => {
                  setProfileOpen(true);
                  setSettingsOpen(false);
                } : undefined}
              />
            )}
            <CanonicalConversationPane
              selectedTarget={props.selectedTarget}
              characterData={props.characterData}
              chrome={props.chrome}
              viewMode={props.viewMode}
              onBackToTargets={() => {
                props.onSelectTarget(null);
                closeTransientPanels();
              }}
              onViewModeChange={props.onViewModeChange}
              onOpenSettings={props.settingsDrawer ? () => {
                setSettingsOpen(true);
                setProfileOpen(false);
              } : undefined}
              topContent={props.topContent}
              anchoredSurface={props.conversationAnchoredSurface}
              stagePanel={(
                <CanonicalStagePanel
                  {...props.stagePanelProps}
                  characterData={props.characterData}
                  messages={messages}
                  pendingFirstBeat={props.pendingFirstBeat}
                  anchorViewportRef={stageAnchorViewportRef}
                  cardAnchorOffsetPx={stageCardAnchorOffsetPx}
                  onIntentOpenHistory={shellRenderContext.onIntentOpenHistory}
                />
              )}
              transcript={(
                <CanonicalTranscriptView
                  messages={messages}
                  pendingFirstBeat={props.pendingFirstBeat}
                  /* Stage mode shelved — do not auto-switch back */
                  {...props.transcriptProps}
                />
              )}
              composer={props.composer}
            />
            {props.rightPanel ?? null}
          </div>
        )}
      </div>

      <button
        type="button"
        aria-label="Dismiss overlay"
        className={cn(
          'absolute inset-0 z-20 bg-slate-900/28 transition-opacity duration-200',
          overlayVisible ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        tabIndex={overlayVisible ? 0 : -1}
        onClick={closeTransientPanels}
      />

      {props.rightSidebar ? (
        <CanonicalRightSidebar
          open={rightSidebarOpen}
          content={props.rightSidebar}
          overlayMenu={props.rightSidebarOverlayMenu}
          resetKey={props.rightSidebarResetKey || (props.selectedTarget?.id || 'landing')}
          onClose={() => props.onRightSidebarOpenChange?.(false)}
        />
      ) : null}

      {props.settingsDrawer ? (
        <CanonicalDrawerShell
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          title={props.settingsDrawerTitle || 'Settings'}
          subtitle={props.settingsDrawerSubtitle ?? 'Global interaction preferences'}
        >
          {props.settingsDrawer}
        </CanonicalDrawerShell>
      ) : null}

      {props.profileDrawer ? (
        <CanonicalDrawerShell
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
          title={props.profileDrawerTitle || 'Profile'}
          subtitle={props.profileDrawerSubtitle ?? 'Relationship, memory, and target details.'}
          widthClassName="w-[380px] max-w-[94vw]"
        >
          {props.profileDrawer}
        </CanonicalDrawerShell>
      ) : null}

      {props.auxiliaryOverlayContent}
    </div>
  );
}
