import { useState, useCallback, type ReactNode } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import {
  hasConversationSetupBlockingState,
  type ConversationModeAvailability,
  type ConversationSetupAction,
  type ConversationSetupState,
  type ConversationShellViewModel,
  type ConversationThreadSummary,
  type ConversationCharacterData,
} from '../headless.js';
import { ConversationComposerShell } from './conversation-composer-shell.js';
import { ConversationModeSwitcher } from './conversation-mode-switcher.js';
import { ConversationSetupPanel } from './conversation-setup-panel.js';
import { ConversationSidebarShell } from './conversation-sidebar-shell.js';
import { ConversationStageLayout } from './conversation-stage-layout.js';
import { ConversationTranscriptShell } from './conversation-transcript-shell.js';

/** Icon: clock/chat history (16×16). */
const ICON_HISTORY = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 4.5V8l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Icon: monitor/stage (16×16). */
const ICON_STAGE = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="2" y="3" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M6 14h4M8 11v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/** Icon: gear/settings (16×16). */
const ICON_SETTINGS = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M6.86 2.07a1.2 1.2 0 0 1 2.28 0l.18.56a1.2 1.2 0 0 0 1.5.72l.54-.2a1.2 1.2 0 0 1 1.6 1.14l-.02.58a1.2 1.2 0 0 0 1.04 1.22l.57.08a1.2 1.2 0 0 1 .57 2.17l-.46.36a1.2 1.2 0 0 0-.33 1.55l.28.5a1.2 1.2 0 0 1-.97 1.78l-.58.02a1.2 1.2 0 0 0-1.12 1.14l-.04.58a1.2 1.2 0 0 1-1.97.68l-.4-.42a1.2 1.2 0 0 0-1.58-.1l-.44.38a1.2 1.2 0 0 1-2-.6l-.1-.57a1.2 1.2 0 0 0-1.1-1l-.58-.04a1.2 1.2 0 0 1-.78-2.06l.4-.42a1.2 1.2 0 0 0 .05-1.6l-.38-.44a1.2 1.2 0 0 1 .56-1.97l.56-.13a1.2 1.2 0 0 0 .93-1.14v-.58a1.2 1.2 0 0 1 1.72-.96l.52.25a1.2 1.2 0 0 0 1.53-.44l.3-.48Z" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

/** Icon: thinking/brain (16×16). */
const ICON_THINKING = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M5.5 13.5V12a3.5 3.5 0 0 1-1.73-6.55A4 4 0 0 1 11.5 4a3.5 3.5 0 0 1 .77 6.91V13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6.5 9.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0Z" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="8" cy="5.5" r="0.75" fill="currentColor" />
  </svg>
);

/** Circular icon button matching local-chat `.lc-btn-secondary` style. */
function HeaderIconButton(props: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      onClick={props.disabled ? undefined : props.onClick}
      disabled={props.disabled}
      className={cn(
        'inline-flex h-10 w-10 items-center justify-center rounded-full',
        'shadow-[0_2px_8px_rgba(15,23,42,0.05)]',
        'transition-all duration-150',
        'active:scale-[0.985]',
        props.active
          ? 'border border-emerald-400 bg-emerald-500 text-white shadow-[0_4px_12px_rgba(16,185,129,0.2)]'
          : 'border border-slate-200/80 bg-white/90 text-slate-700',
        props.disabled
          ? 'cursor-not-allowed opacity-50'
          : 'hover:-translate-y-px hover:border-emerald-300 hover:text-teal-700 hover:shadow-[0_8px_18px_rgba(15,23,42,0.08)]',
        props.active && !props.disabled
          ? 'hover:bg-emerald-600 hover:text-white hover:border-emerald-500'
          : '',
      )}
    >
      {props.icon}
    </button>
  );
}

export type ConversationShellProps = {
  viewModel: ConversationShellViewModel;
  /** Character data for the left rail. */
  characterData?: ConversationCharacterData | null;
  /** Content rendered inside the settings drawer. */
  settingsContent?: ReactNode;
  /** Extra header content (left side of header bar). */
  headerContent?: ReactNode;
  transcriptLayout?: 'shell' | 'passthrough';
  onModeChange?: (mode: ConversationModeAvailability['mode']) => void;
  onSelectThread?: (threadId: string) => void;
  onSetupAction?: (action: ConversationSetupAction) => void;
  renderTranscript?: (
    thread: ConversationThreadSummary,
    viewModel: ConversationShellViewModel,
  ) => ReactNode;
  renderComposer?: (
    thread: ConversationThreadSummary,
    viewModel: ConversationShellViewModel,
  ) => ReactNode;
  renderTargetRail?: (
    thread: ConversationThreadSummary | null,
    viewModel: ConversationShellViewModel,
  ) => ReactNode;
  renderEmptyState?: (viewModel: ConversationShellViewModel) => ReactNode;
  renderSetupDescription?: (
    setupState: ConversationSetupState,
    viewModel: ConversationShellViewModel,
  ) => ReactNode;
  renderThreadMeta?: (thread: ConversationThreadSummary) => ReactNode;
  /** Thinking toggle state: 'on' = active, 'off' = inactive, 'unsupported' = disabled. */
  thinkingState?: 'on' | 'off' | 'unsupported';
  onThinkingToggle?: () => void;
  className?: string;

  /* ── legacy compat ── */
  sidebarHeader?: ReactNode;
  sidebarFooter?: ReactNode;
};

function defaultEmptyState(): ReactNode {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 text-center">
      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-600/70">
        This Moment
      </div>
      <p className="text-sm text-slate-500">
        The current turn plays here first.
      </p>
    </div>
  );
}

function renderTranscriptSurface(input: {
  viewModel: ConversationShellViewModel;
  renderTranscript?: ConversationShellProps['renderTranscript'];
  renderComposer?: ConversationShellProps['renderComposer'];
  renderEmptyState?: ConversationShellProps['renderEmptyState'];
  renderSetupDescription?: ConversationShellProps['renderSetupDescription'];
  onSetupAction?: ConversationShellProps['onSetupAction'];
  headerActions: ReactNode;
  headerContent?: ReactNode;
  transcriptLayout: NonNullable<ConversationShellProps['transcriptLayout']>;
}): ReactNode {
  const { viewModel } = input;
  if (hasConversationSetupBlockingState(viewModel.setupState)) {
    return (
      <ConversationTranscriptShell
        headerActions={input.headerActions}
        header={input.headerContent}
        transcript={(
          <div className="flex min-h-[320px] items-center justify-center">
            <ConversationSetupPanel
              state={viewModel.setupState}
              description={input.renderSetupDescription?.(viewModel.setupState, viewModel)}
              onAction={input.onSetupAction}
            />
          </div>
        )}
      />
    );
  }

  // Composer rendering: show whenever setup is ready, even before a thread exists.
  // Single-session modes auto-create threads, but the composer should be visible immediately.
  const isSetupReady = viewModel.setupState.status === 'ready';
  const composerThread = viewModel.selectedThread || (isSetupReady
    ? { id: '__pending__', mode: viewModel.activeMode, title: '', previewText: '', createdAt: '', updatedAt: '', unreadCount: 0, status: 'active' as const }
    : null);
  const composer = isSetupReady && composerThread && input.renderComposer
    ? input.renderComposer(composerThread, viewModel)
    : null;
  const composerSlot = composer
    ? <ConversationComposerShell>{composer}</ConversationComposerShell>
    : null;

  if (!viewModel.selectedThread) {
    return (
      <ConversationTranscriptShell
        headerActions={input.headerActions}
        header={input.headerContent}
        transcript={input.renderEmptyState?.(viewModel) || defaultEmptyState()}
        composer={composerSlot}
      />
    );
  }

  const transcript = input.renderTranscript?.(viewModel.selectedThread, viewModel) || null;
  if (input.transcriptLayout === 'passthrough') {
    return transcript;
  }

  return (
    <ConversationTranscriptShell
      headerActions={input.headerActions}
      header={input.headerContent}
      transcript={transcript}
      composer={composerSlot}
    />
  );
}

export function ConversationShell({
  viewModel,
  characterData,
  settingsContent,
  headerContent,
  transcriptLayout = 'shell',
  thinkingState,
  onThinkingToggle,
  onModeChange,
  onSetupAction,
  renderTranscript,
  renderComposer,
  renderEmptyState,
  renderSetupDescription,
  className,
}: ConversationShellProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'stage' | 'chat'>('stage');

  const handleSettingsToggle = useCallback(() => {
    setSettingsOpen((prev) => !prev);
  }, []);

  const handleViewModeToggle = useCallback(() => {
    setViewMode((prev) => (prev === 'stage' ? 'chat' : 'stage'));
  }, []);

  // Augment viewModel with viewMode
  const augmentedViewModel = { ...viewModel, viewMode };

  // Build header action buttons (right side)
  const headerActions = (
    <>
      {viewModel.modes.length > 1 ? (
        <ConversationModeSwitcher
          activeMode={viewModel.activeMode}
          onModeChange={onModeChange}
          modes={viewModel.modes.map((mode) => ({
            mode: mode.mode,
            label: mode.label,
            disabled: !mode.enabled,
            countBadge: mode.badge,
          }))}
        />
      ) : null}
      <HeaderIconButton
        icon={viewMode === 'stage' ? ICON_HISTORY : ICON_STAGE}
        label={viewMode === 'stage' ? 'History' : 'Stage'}
        onClick={handleViewModeToggle}
      />
      {thinkingState ? (
        <HeaderIconButton
          icon={ICON_THINKING}
          label="Thinking"
          active={thinkingState === 'on'}
          disabled={thinkingState === 'unsupported'}
          onClick={onThinkingToggle}
        />
      ) : null}
      {settingsContent ? (
        <HeaderIconButton icon={ICON_SETTINGS} label="Settings" onClick={handleSettingsToggle} />
      ) : null}
    </>
  );

  return (
    <ConversationStageLayout
      className={className}
      settingsOpen={settingsOpen}
      onSettingsOpenChange={setSettingsOpen}
      characterRail={
        characterData ? (
          <ConversationSidebarShell
            avatarUrl={characterData.avatarUrl}
            avatarFallback={characterData.avatarFallback}
            name={characterData.name}
            handle={characterData.handle}
            bio={characterData.bio}
            badges={characterData.badges}
          />
        ) : (
          <ConversationSidebarShell name="" avatarFallback="?" />
        )
      }
      transcript={renderTranscriptSurface({
        viewModel: augmentedViewModel,
        renderTranscript,
        renderComposer,
        renderEmptyState,
        renderSetupDescription,
        onSetupAction,
        headerActions,
        headerContent,
        transcriptLayout,
      })}
      settingsDrawer={settingsContent}
    />
  );
}
