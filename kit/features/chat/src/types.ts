import type { ReactNode } from 'react';
import type { AvatarPresentationProfile } from '@nimiplatform/nimi-kit/features/avatar/headless';

export const CONVERSATION_MODES = ['ai', 'human', 'agent', 'group'] as const;
export type ConversationMode = (typeof CONVERSATION_MODES)[number];
export type ConversationSourceKind = ConversationMode;
export type ConversationSourceFilter = 'all' | ConversationSourceKind;
export type ConversationThreadStatus = 'active' | 'archived' | 'deleted';
export type ConversationMessageStatus = 'pending' | 'streaming' | 'complete' | 'error' | 'canceled';
export type ConversationMessageRole = 'user' | 'assistant' | 'human' | 'agent' | 'system' | 'tool';
export type ConversationSetupAction =
  | {
    kind: 'open-settings';
    targetId: 'runtime-overview' | 'runtime-local' | 'runtime-cloud';
    returnToMode?: ConversationMode;
  }
  | {
    kind: 'sign-in';
    returnToMode?: ConversationMode;
  };
export type ConversationSetupIssueCode =
  | 'ai-route-readiness-unavailable'
  | 'ai-local-route-unavailable'
  | 'ai-cloud-route-unavailable'
  | 'ai-no-chat-route'
  | 'ai-thread-route-unavailable'
  | 'human-auth-required'
  | 'agent-contract-unavailable';

export type ConversationSetupIssue = {
  code: ConversationSetupIssueCode;
  routeKind?: 'local' | 'cloud';
  detail?: string | null;
};

export type ConversationSetupState =
  | {
    mode: ConversationMode;
    status: 'ready';
    issues: readonly ConversationSetupIssue[];
    primaryAction: null;
  }
  | {
    mode: ConversationMode;
    status: 'setup-required' | 'unavailable';
    issues: readonly ConversationSetupIssue[];
    primaryAction: ConversationSetupAction | null;
  };

export type ConversationThreadSummary = {
  id: string;
  mode: ConversationMode;
  title: string;
  previewText: string;
  createdAt: string;
  updatedAt: string;
  unreadCount: number;
  status: ConversationThreadStatus;
  pinned?: boolean;
  targetId?: string | null;
  targetLabel?: string | null;
};

export type ConversationModeAvailability = {
  mode: ConversationMode;
  label: string;
  enabled: boolean;
  badge?: string | number | null;
  disabledReason?: string | null;
};

export type ConversationViewMode = 'stage' | 'chat';

export type ConversationShellViewModel = {
  activeMode: ConversationMode;
  modes: readonly ConversationModeAvailability[];
  setupState: ConversationSetupState;
  threads: readonly ConversationThreadSummary[];
  activeThreadId: string | null;
  selectedThread: ConversationThreadSummary | null;
  canCompose: boolean;
  composerPlaceholder: string | null;
  /** Current view mode — 'stage' shows the spotlight turn, 'chat' shows the full transcript. */
  viewMode?: ConversationViewMode;
};

export type ConversationMessageViewModel = {
  id: string;
  threadId: string;
  role: ConversationMessageRole;
  text: string;
  createdAt: string;
  updatedAt?: string;
  status?: ConversationMessageStatus;
  error?: string | null;
  metadata?: Record<string, unknown>;
};

export type ChatComposerSubmitInput<TAttachment = never> = {
  text: string;
  attachments: readonly TAttachment[];
};

export type ChatComposerState<TAttachment = never> = {
  text: string;
  attachments: readonly TAttachment[];
  canSubmit: boolean;
  isSubmitting: boolean;
  error: string | null;
};

export interface ChatComposerAdapter<TAttachment = never> {
  submit: (input: ChatComposerSubmitInput<TAttachment>) => Promise<void> | void;
}

export interface ConversationThreadAdapter {
  listThreads: () =>
    | Promise<readonly ConversationThreadSummary[]>
    | readonly ConversationThreadSummary[];
  listMessages: (threadId: string) =>
    | Promise<readonly ConversationMessageViewModel[]>
    | readonly ConversationMessageViewModel[];
}

export interface ConversationComposerAdapter<TAttachment = never> extends ChatComposerAdapter<TAttachment> {
  canSubmit?: (input: ChatComposerSubmitInput<TAttachment>) => boolean;
  disabled?: boolean;
  disabledReason?: string | null;
  placeholder?: string;
}

export interface ConversationShellAdapter<TAttachment = never> {
  mode: ConversationMode;
  setupState: ConversationSetupState;
  threadAdapter: ConversationThreadAdapter;
  composerAdapter: ConversationComposerAdapter<TAttachment> | null;
}

export interface AttachmentAdapter<TAttachment = unknown> {
  openPicker: () => Promise<readonly TAttachment[] | null | undefined> | readonly TAttachment[] | null | undefined;
  mergeAttachments?: (
    current: readonly TAttachment[],
    incoming: readonly TAttachment[],
  ) => readonly TAttachment[];
  getKey?: (attachment: TAttachment, index: number) => string;
  getLabel?: (attachment: TAttachment, index: number) => string;
  getSecondaryLabel?: (attachment: TAttachment, index: number) => string | undefined;
  getPreviewUrl?: (attachment: TAttachment, index: number) => string | undefined;
  getKind?: (attachment: TAttachment, index: number) => 'image' | 'video' | 'file' | string | undefined;
}

// ---------------------------------------------------------------------------
// Composer voice / media extensibility
// ---------------------------------------------------------------------------

/**
 * Voice input state machine for the composer.
 * When provided, the voice button becomes interactive instead of a disabled placeholder.
 */
export type ChatComposerVoiceState = {
  status: 'idle' | 'recording' | 'transcribing' | 'failed';
  onToggle: () => void;
  onCancel?: () => void;
};

/**
 * A quick-action entry for media prompt injection or generation triggers.
 * Rendered as pill buttons above (or beside) the composer input row.
 */
export type ChatComposerMediaAction = {
  kind: string;
  label: string;
  onAction: () => void;
};

// ---------------------------------------------------------------------------
// Composer attachment slots
// ---------------------------------------------------------------------------

export type ChatComposerAttachmentsSlotProps<TAttachment = never> = {
  attachments: readonly TAttachment[];
  removeAttachment: (index: number) => void;
  openAttachmentPicker: () => Promise<void>;
};

export type ChatComposerAttachmentsSlot<TAttachment = never> =
  | ReactNode
  | ((props: ChatComposerAttachmentsSlotProps<TAttachment>) => ReactNode);

export type ConversationCharacterData = {
  avatarUrl?: string | null;
  avatarPresentationProfile?: AvatarPresentationProfile | null;
  avatarFallback?: string;
  name: string;
  handle?: string | null;
  bio?: string | null;
  theme?: ConversationPresenceTheme | null;
  presenceLabel?: string | null;
  presenceBusy?: boolean;
  interactionState?: ConversationInteractionStateSummary | null;
  relationshipState?: ConversationRelationshipState | null;
  badges?: readonly ConversationCharacterBadge[];
};

export type ConversationInteractionPhase =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'painting'
  | 'filming'
  | 'speaking'
  | 'loading';

export type ConversationInteractionStateSummary = {
  phase?: ConversationInteractionPhase | null;
  busy?: boolean;
  label?: string | null;
  emotion?: 'neutral' | 'joy' | 'focus' | 'calm' | 'playful' | 'concerned' | 'surprised' | null;
  amplitude?: number | null;
  visemeId?: string | null;
};

export type ConversationPresenceTheme = {
  roomSurface?: string;
  roomAura?: string;
  accentSoft?: string;
  accentStrong?: string;
  border?: string;
  text?: string;
};

export type ConversationRelationshipState =
  | 'new'
  | 'friendly'
  | 'warm'
  | 'intimate';

export type ConversationCharacterBadge = {
  label: string;
  variant: 'default' | 'online' | 'busy' | 'warm' | 'new';
  pulse?: boolean;
};

export type ConversationTargetSummary = {
  id: string;
  source: ConversationSourceKind;
  canonicalSessionId: string;
  title: string;
  handle?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  avatarFallback?: string | null;
  previewText?: string | null;
  updatedAt?: string | null;
  unreadCount?: number;
  status?: ConversationThreadStatus;
  isOnline?: boolean | null;
  metadata?: Record<string, unknown>;
};

export type ConversationCanonicalSession = {
  id: string;
  source: ConversationSourceKind;
  targetId: string;
  title: string;
  subtitle?: string | null;
};

export type ConversationCapabilityState = {
  supported: boolean;
  active?: boolean;
  reason?: string | null;
};

export type ConversationCanonicalMessageKind =
  | 'text'
  | 'voice'
  | 'image'
  | 'image-pending'
  | 'video'
  | 'video-pending'
  | 'gift'
  | 'system'
  | 'streaming';

export type ConversationCanonicalMessage = {
  id: string;
  sessionId: string;
  targetId: string;
  source: ConversationSourceKind;
  role: ConversationMessageRole;
  text: string;
  createdAt: string;
  updatedAt?: string;
  status?: ConversationMessageStatus;
  error?: string | null;
  kind?: ConversationCanonicalMessageKind;
  senderName?: string | null;
  senderAvatarUrl?: string | null;
  senderHandle?: string | null;
  senderKind?: 'ai' | 'human' | 'agent' | 'system' | null;
  metadata?: Record<string, unknown>;
};

export type CanonicalMessageRenderContext = {
  groupIndex: number;
  indexInGroup: number;
  groupSize: number;
  position: 'single' | 'start' | 'middle' | 'end';
  isCurrentUser: boolean;
  isFocusedAssistantGroup: boolean;
  displayContext: 'transcript' | 'stage';
};

export type CanonicalMessageContentSlot = (
  message: ConversationCanonicalMessage,
  context: CanonicalMessageRenderContext,
) => ReactNode;

export type CanonicalMessageAccessorySlot = (
  message: ConversationCanonicalMessage,
  context: CanonicalMessageRenderContext,
) => ReactNode;

export type CanonicalMessageAvatarSlot = (
  message: ConversationCanonicalMessage,
  context: CanonicalMessageRenderContext,
) => ReactNode;

export type CanonicalTranscriptGroup = {
  groupIndex: number;
  role: ConversationCanonicalMessage['role'];
  focused: boolean;
  messages: readonly ConversationCanonicalMessage[];
};

export type CanonicalRuntimeInspectPanelKey =
  | 'chat'
  | 'voice'
  | 'media'
  | 'diagnostics';

export type CanonicalRuntimeInspectStatusChip = {
  label: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
};

export type CanonicalRuntimeInspectSectionData = {
  key: CanonicalRuntimeInspectPanelKey;
  title: string;
  hint?: string | null;
  summary?: ReactNode;
  content?: ReactNode;
  disabledReason?: string | null;
};

export type CanonicalRuntimeInspectPanelState = {
  openPanel: CanonicalRuntimeInspectPanelKey | null;
};

export type CanonicalRuntimeInspectProps = {
  title?: string;
  subtitle?: string | null;
  statusTitle?: string;
  statusHint?: string | null;
  statusSummary?: ReactNode;
  statusChips?: readonly CanonicalRuntimeInspectStatusChip[];
  openPanel: CanonicalRuntimeInspectPanelKey | null;
  onOpenPanel: (panel: CanonicalRuntimeInspectPanelKey) => void;
  onClosePanel: () => void;
  sections: readonly CanonicalRuntimeInspectSectionData[];
};

export interface ConversationSourceAdapter<TAttachment = never> {
  source: ConversationSourceKind;
  listTargets: (
    filter?: ConversationSourceFilter,
  ) => Promise<readonly ConversationTargetSummary[]> | readonly ConversationTargetSummary[];
  selectTarget: (targetId: string | null) => Promise<void> | void;
  getCanonicalSession: (
    targetId: string,
  ) => Promise<ConversationCanonicalSession | null> | ConversationCanonicalSession | null;
  listMessages: (
    targetId: string,
  ) => Promise<readonly ConversationCanonicalMessage[]> | readonly ConversationCanonicalMessage[];
  sendTurn: (
    targetId: string,
    input: ChatComposerSubmitInput<TAttachment>,
  ) => Promise<void> | void;
  resolveTargetProfile?: (targetId: string) => Promise<unknown> | unknown;
  resolveSettingsState?: (targetId: string) => Promise<unknown> | unknown;
  resolveCapabilities?: (
    targetId: string,
  ) => Promise<Record<string, ConversationCapabilityState>> | Record<string, ConversationCapabilityState>;
  readViewMode?: (
    viewerId: string,
    source: ConversationSourceKind,
    targetId: string,
  ) => Promise<ConversationViewMode> | ConversationViewMode;
  writeViewMode?: (
    viewerId: string,
    source: ConversationSourceKind,
    targetId: string,
    mode: ConversationViewMode,
  ) => Promise<void> | void;
}
