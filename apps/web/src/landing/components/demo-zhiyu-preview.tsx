import { useDemoZhiyuPlayback } from './demo-zhiyu-playback.js';
import { useHeroDemoSession } from './hero-demo-context.js';
import type { NimiLocalAppConversationQuote } from '@nimiplatform/sdk/app';
import type {
  ConversationPositionRequest,
  ConversationReadPosition,
} from '@nimiplatform/kit/features/chat/runtime';
import { DemoZhiyuPartnerCard } from './demo-zhiyu-partner-card.js';
import { reduceZhiyuDemoNavigation } from '../content/zhiyu-demo-navigation.js';
import type { PreviewTranslate } from '../i18n/preview-messages.js';
import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useReducer,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { StatusBadge } from '@nimiplatform/kit/ui';
import {
  createBrowserDataUrlAttachmentAdapter,
  type BrowserDataUrlAttachment,
  type ChatComposerAdapter,
} from '@nimiplatform/kit/features/chat/headless';
import {
  LocalAppConversationPlayer,
  resolveChatCopy,
  AgentIntroduction,
  getMessageInteractionCopy,
  CanonicalComposer,
  CanonicalTranscriptView,
  ChatStreamStatus,
} from '@nimiplatform/kit/features/chat/ui';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat/types';
import {
  AgentCenter,
  createAgentCenterI18n,
  type AgentCenterSectionId,
  type AgentCenterSession,
  type AgentCenterTranslationKey,
} from '@nimiplatform/kit/features/agent-center';
import {
  ArrowLeft,
  ArrowRight,
  PanelLeft,
  Globe2,
  Lightbulb,
  SlidersHorizontal,
  UserRound,
  X,
} from 'lucide-react';
import type {
  HeroDemoZhiyuMessageSeed,
  HeroDemoZhiyuPartner,
  HeroDemoZhiyuPreview,
} from '../content/landing-content.js';
import {
  createDemoZhiyuAgentCenterSession,
  createDemoZhiyuAgentClient,
  type DemoZhiyuAgentCenterSession,
} from './demo-zhiyu-agent-center.js';

/**
 * Interactive replica of the Zhiyu shell (apps/zhiyu/src/shell/agent-chat).
 *
 * It composes the same kit surfaces the app composes — canonical transcript,
 * canonical composer, stream status, and the kit Agent Center — under the
 * same class names and data attributes, so the preview and the app render
 * through one stylesheet port (demo-zhiyu.css) and can be compared element
 * by element. Runtime is replaced by mock data from the landing content and
 * the in-memory Agent Center client; no product session is ever started.
 */

type RightPanelMode = 'closed' | 'agent';
type VoiceStatus = 'idle' | 'recording' | 'transcribing';

const ZHIYU_USER_NAME = (t: PreviewTranslate) => t('zhiyu.workspace.you');
// Paced like a local model reply so the streaming state (status bubble,
// 停止回复, disabled composer) is actually observable.
const STREAM_TICK_MS = 110;
const STREAM_CHARS_PER_TICK = 2;
const STREAM_LEAD_MS = 700;
const VOICE_TRANSCRIBE_MS = 900;
const NOTICE_MS = 6_000;

function partnerInitial(name: string, t: PreviewTranslate): string {
  const firstLetter = name.match(/[A-Za-z]/u)?.[0];
  if (firstLetter) return firstLetter.toUpperCase();
  return Array.from(name.trim())[0] || t('zhiyu.partnerInitial.local');
}

function formatZhiyuTranscriptDateLabel(
  copy: HeroDemoZhiyuPreview['copy'],
  locale: string,
): ({ date, diffDays }: { date: Date; diffDays: number }) => string {
  const formatter = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' });
  return ({ date, diffDays }) => {
    if (diffDays === 0) return copy.dateLabels.today;
    if (diffDays === 1) return copy.dateLabels.yesterday;
    return formatter.format(date);
  };
}

function materializePartnerMessages(
  partners: ReadonlyArray<HeroDemoZhiyuPartner>,
  now: number,
  t: PreviewTranslate,
): Record<string, ConversationCanonicalMessage[]> {
  const result: Record<string, ConversationCanonicalMessage[]> = {};
  for (const partner of partners) {
    result[partner.id] = partner.messages.map((seed) => ({
      ...buildMessage(
        partner,
        seed.role,
        seed.text,
        now - seed.minutesAgo * 60_000,
        'complete',
        seedMedia(seed),
        t,
      ),
      id: seed.id,
    }));
  }
  return result;
}

type MessageMedia = {
  kind: NonNullable<ConversationCanonicalMessage['kind']>;
  metadata?: Record<string, unknown>;
};

// Seeds map onto the same metadata keys the kit transcript reads for the
// real shell: voice bubbles play `voiceUrl`, image cards show `mediaUrl`.
function seedMedia(seed: HeroDemoZhiyuMessageSeed): MessageMedia {
  if (seed.kind === 'voice') {
    return {
      kind: 'voice',
      metadata: { voiceUrl: seed.voiceUrl, voiceTranscript: seed.voiceTranscript },
    };
  }
  if (seed.kind === 'image') {
    return {
      kind: 'image',
      metadata: { mediaUrl: seed.mediaUrl, ...(seed.caption ? { caption: seed.caption } : {}) },
    };
  }
  return { kind: 'text' };
}

function buildMessage(
  partner: HeroDemoZhiyuPartner,
  role: 'user' | 'assistant',
  text: string,
  stamp: number,
  status: ConversationCanonicalMessage['status'] = 'complete',
  media: MessageMedia = { kind: 'text' },
  t: PreviewTranslate,
): ConversationCanonicalMessage {
  return {
    id: `zhiyu-local-${partner.id}-${stamp}-${role}`,
    sessionId: `zhiyu-${partner.id}`,
    targetId: partner.id,
    source: 'agent',
    role,
    text,
    createdAt: new Date(stamp).toISOString(),
    status,
    kind: media.kind,
    metadata: {
      canonicalMessageCommitted: true,
      canonicalTurnStatus: status === 'canceled' ? 'interrupted' : 'completed',
      ...(status === 'canceled' ? { canonicalPartial: true } : {}),
      ...media.metadata,
    },
    senderName: role === 'user' ? ZHIYU_USER_NAME(t) : partner.name,
    senderAvatarUrl: role === 'user' ? null : partner.avatarUrl,
    senderKind: role === 'user' ? 'human' : 'agent',
  };
}

/* ------------------------------------------------------------------------ */
/* Presence rail (mirrors ZhiyuAgentPanel.DesktopPresenceRail)               */
/* ------------------------------------------------------------------------ */

function DemoPresenceRail({
  partners,
  copy,
  currentPartnerId,
  onOpenCurrentAgent,
  onSelectPartner,
  onOpenPartner,
}: {
  partners: ReadonlyArray<HeroDemoZhiyuPartner>;
  copy: HeroDemoZhiyuPreview['copy'];
  currentPartnerId: string | null;
  onOpenCurrentAgent: () => void;
  onSelectPartner: (partnerId: string) => void;
  onOpenPartner: (partnerId: string, section: 'overview' | 'cognition') => void;
}) {
  const { t } = useAppPreviewLocale();
  return (
    <section className="zhiyu-agent-rail" data-zhiyu-region="presence" aria-label={copy.railLabel}>
      <div
        className="zhiyu-agent-rail__logo"
        aria-label={t('zhiyu.appName')}
        data-zhiyu-desktop-logo-image="zhiyu"
      >
        <img src="/demo/zhiyu/logo.png" alt={''} aria-hidden="true" />
      </div>
      <div
        className="zhiyu-agent-rail__agents"
        data-zhiyu-region="relationship-rail"
        data-zhiyu-relationship-rail-density="desktop"
        data-zhiyu-relationship-rail-source="desktop-chat-relationship-rail"
        data-zhiyu-relationship-rail-empty={String(partners.length === 0)}
      >
        {partners.length > 0 ? <div className="zhiyu-agent-rail__separator" aria-hidden="true" /> : null}
        {partners.map((partner) => {
          const isCurrent = partner.id === currentPartnerId;
          return (
            <div key={partner.id} className="zhiyu-agent-rail__agent-row" data-zhiyu-local-agent-row="true">
              <span
                className={`zhiyu-agent-rail__agent-indicator${isCurrent ? ' is-active' : ''}`}
                aria-hidden="true"
              />
              <DemoZhiyuPartnerCard
                partner={partner}
                placement="rail"
                onOpen={(section) => onOpenPartner(partner.id, section)}
                onSelect={() => (isCurrent ? onOpenCurrentAgent() : onSelectPartner(partner.id))}
              >
                <button
                  type="button"
                  className={`zhiyu-agent-rail__agent${isCurrent ? ' is-active' : ''}`}
                  aria-label={`${isCurrent ? copy.currentPartnerAriaPrefix : copy.selectPartnerAriaPrefix}${partner.name}`}
                  aria-pressed={isCurrent}
                  title={partner.name}
                  data-zhiyu-local-agent-candidate="true"
                  data-zhiyu-local-agent-candidate-active={String(isCurrent)}
                  data-zhiyu-agent-handle={partner.id}
                >
                  {partner.avatarUrl ? (
                    <img src={partner.avatarUrl} alt={''} aria-hidden="true" />
                  ) : (
                    partnerInitial(partner.name, t)
                  )}
                </button>
              </DemoZhiyuPartnerCard>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Right panel (mirrors ZhiyuAgentRightPanel.RightAgentPanel)                */
/* ------------------------------------------------------------------------ */

function DemoAgentPanel({
  partner,
  copy,
  session,
  activeTab,
  onActiveTabChange,
  onClose,
  onOpenRuntimeSettings,
  onAvatarLaunch,
}: {
  partner: HeroDemoZhiyuPartner;
  copy: HeroDemoZhiyuPreview['copy'];
  session: AgentCenterSession;
  activeTab: AgentCenterSectionId;
  onActiveTabChange: (tab: AgentCenterSectionId) => void;
  onClose: () => void;
  onOpenRuntimeSettings: () => void;
  onAvatarLaunch: () => void;
}) {
  const { previewLocale, t } = useAppPreviewLocale();
  const i18n = useMemo(() => {
    const overrides: Partial<Record<AgentCenterTranslationKey, string>> = {
      'AgentCenter.chrome.title': copy.panelTitle,
      'AgentCenter.chrome.eyebrow': copy.panelEyebrow,
      'AgentCenter.chrome.closeLabel': copy.panelCloseLabel,
      'AgentCenter.chrome.navLabel': copy.panelNavLabel,
      'AgentCenter.chrome.projectionLoadFailed': copy.panelLoadFailed,
    };
    return createAgentCenterI18n({
      language: previewLocale,
      t(key) {
        return overrides[key as AgentCenterTranslationKey] || key;
      },
    });
  }, [copy, t, previewLocale]);
  const worldLabel: string | null = null;
  return (
    <aside
      className="zhiyu-agent-center mr-3 my-6 flex h-[calc(100cqh-48px)] min-h-0 w-[min(460px,calc(100cqw-96px))] max-w-full shrink-0 flex-col gap-2 [grid-area:side]"
      data-zhiyu-region="agent-panel"
      data-zhiyu-agent-center-placement="kit"
      data-zhiyu-agent-panel-mode="agent"
      data-zhiyu-agent-center-side-sheet="desktop"
      data-zhiyu-agent-panel-tab={activeTab}
      aria-label={copy.panelAriaLabel}
    >
      {partner.hostMoodLabel || partner.hostActivityLabel || worldLabel ? (
        <div
          className="flex min-w-0 shrink-0 flex-wrap items-center gap-1.5 px-1"
          data-zhiyu-agent-center-host-context="true"
        >
          {partner.hostMoodLabel ? (
            <span
              className="rounded-full bg-violet-500/10 px-2 py-px text-[10px] font-semibold text-violet-700"
              data-zhiyu-agent-center-state-chip="mood"
            >
              {partner.hostMoodLabel}
            </span>
          ) : null}
          {partner.hostActivityLabel ? (
            <span
              className="rounded-full bg-sky-500/10 px-2 py-px text-[10px] font-semibold text-sky-700"
              data-zhiyu-agent-center-state-chip="activity"
            >
              {partner.hostActivityLabel}
            </span>
          ) : null}
          {worldLabel ? (
            <span
              className="inline-flex min-w-0 items-center gap-1 text-[10.5px] text-[var(--nimi-text-secondary)]"
              data-zhiyu-agent-center-world-name={worldLabel}
            >
              <Globe2 aria-hidden="true" size={12} />
              <span className="truncate">{worldLabel}</span>
            </span>
          ) : null}
        </div>
      ) : null}
      <AgentCenter
        activeSection={activeTab}
        chrome="standalone"
        i18n={i18n}
        identity={{
          displayName: partner.name,
          avatarUrl: partner.avatarUrl,
          avatarFallback: partnerInitial(partner.name, t),
        }}
        onSectionChange={onActiveTabChange}
        placementActions={{
          close: onClose,
          openRuntimeSettings: onOpenRuntimeSettings,
          launchAvatar: onAvatarLaunch,
        }}
        session={session}
        showResourcePack
      />
    </aside>
  );
}

/* ------------------------------------------------------------------------ */
/* Composer pieces (mirror ZhiyuAgentChatPieces)                             */
/* ------------------------------------------------------------------------ */

function ComposerModeTools({
  disabled = false,
  copy,
  avatarReady,
  onAvatarLaunch,
  onOpenAppearance,
  onOpenBehavior,
}: {
  disabled?: boolean;
  copy: HeroDemoZhiyuPreview['copy'];
  avatarReady: boolean;
  onAvatarLaunch: () => void;
  onOpenAppearance: () => void;
  onOpenBehavior: () => void;
}) {
  const avatarLabel = avatarReady ? copy.avatarLaunchLabel : copy.avatarConfigureLabel;
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-label={avatarLabel}
        title={avatarLabel}
        data-zhiyu-composer-tool="avatar"
        data-zhiyu-avatar-launch-entry={avatarReady ? 'ready' : 'blocked'}
        onClick={avatarReady ? onAvatarLaunch : onOpenAppearance}
      >
        <UserRound size={16} aria-hidden="true" />
      </button>
      <span
        aria-hidden="true"
        data-zhiyu-composer-toolbar-divider="true"
        className="mx-0.5 h-4 w-px bg-[var(--nimi-border-subtle)]"
      />
      <button
        type="button"
        disabled={disabled}
        aria-label={copy.proactiveLabel}
        title={copy.proactiveLabel}
        data-zhiyu-composer-tool="proactive"
        onClick={onOpenBehavior}
      >
        <Lightbulb size={16} aria-hidden="true" />
      </button>
    </>
  );
}

function ComposerAgentCenterButton({
  disabled = false,
  copy,
  open,
  onToggleAgentPanel,
}: {
  disabled?: boolean;
  copy: HeroDemoZhiyuPreview['copy'];
  open: boolean;
  onToggleAgentPanel: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={copy.agentCenterLabel}
      aria-pressed={open}
      title={open ? copy.agentCenterCloseLabel : copy.agentCenterLabel}
      data-nimi-semantic-id="zhiyu-primary-action"
      data-zhiyu-composer-tool="agent"
      data-zhiyu-composer-agent-center-state={open ? 'open' : 'closed'}
      onClick={onToggleAgentPanel}
    >
      <SlidersHorizontal size={16} aria-hidden="true" />
    </button>
  );
}

/* ------------------------------------------------------------------------ */
/* Preview                                                                   */
/* ------------------------------------------------------------------------ */

export function DemoZhiyuPreview({ content, initialPartnerId = null, initialPanel, guiding = false }: {
  content: HeroDemoZhiyuPreview; initialPartnerId?: string | null; initialPanel?: AgentCenterSectionId; guiding?: boolean;
}) {
  const { previewLang, t } = useAppPreviewLocale();
  const { copy } = content;
  const messageCopy = useMemo(
    () => resolveChatCopy({ ...getMessageInteractionCopy(previewLang), ...copy.chat }),
    [copy.chat, previewLang],
  );
  const [navigation, dispatch] = useReducer(reduceZhiyuDemoNavigation, {
    entries: [{ partnerId: initialPartnerId, panel: initialPanel }],
    index: 0,
  });
  const destination = navigation.entries[navigation.index]!;
  useEffect(() => {
    if (guiding) dispatch({ type: 'push', destination: { partnerId: initialPartnerId, panel: initialPanel } });
  }, [guiding, initialPartnerId, initialPanel]);
  const activePartnerId = destination.partnerId;
  const rightPanelMode: RightPanelMode = destination.panel ? 'agent' : 'closed';
  const activeAgentTab = destination.panel ?? 'overview';
  const navigate = (partnerId: string | null, panel?: AgentCenterSectionId) =>
    dispatch({ type: 'push', destination: { partnerId, panel } });
  const setActiveAgentTab = (panel: AgentCenterSectionId) => navigate(activePartnerId, panel);
  const setRightPanelMode = (mode: RightPanelMode) =>
    navigate(activePartnerId, mode === 'closed' ? undefined : 'overview');
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const { localMessages, appendPartnerMessage: appendMessage, agentClients } = useHeroDemoSession();
  const [stream, setStream] = useState<{
    partnerId: string;
    partial: string;
    reasoning: string | null;
  } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draft = activePartnerId ? (drafts[activePartnerId] ?? '') : '';
  const setDraft = (value: string | ((previous: string) => string)) => {
    if (activePartnerId)
      setDrafts((previous) => ({
        ...previous,
        [activePartnerId]: typeof value === 'function' ? value(previous[activePartnerId] ?? '') : value,
      }));
  };
  const [attachmentDrafts, setAttachmentDrafts] = useState<
    Record<string, readonly BrowserDataUrlAttachment[]>
  >({});
  const attachments = activePartnerId ? (attachmentDrafts[activePartnerId] ?? []) : [];
  const setAttachments = (value: readonly BrowserDataUrlAttachment[]) => {
    if (activePartnerId) setAttachmentDrafts((previous) => ({ ...previous, [activePartnerId]: value }));
  };

  const [quotes, setQuotes] = useState<Record<string, NimiLocalAppConversationQuote | undefined>>({});
  const quote = activePartnerId ? quotes[activePartnerId] : undefined;
  const setQuote = (value: NimiLocalAppConversationQuote | undefined) => {
    if (activePartnerId) setQuotes((previous) => ({ ...previous, [activePartnerId]: value }));
  };
  const readPosition = useRef<ConversationReadPosition | null>(null);
  const [returnPosition, setReturnPosition] = useState<ConversationReadPosition | null>(null);
  const [positionRequest, setPositionRequest] = useState<ConversationPositionRequest | null>(null);
  const positionKey = useRef(0);
  const locate = (messageId: string, quoted?: NimiLocalAppConversationQuote) => {
    setReturnPosition(readPosition.current);
    setPositionRequest({ messageId, offset: 0, requestKey: ++positionKey.current, quote: quoted });
  };
  const composerRootRef = useRef<HTMLDivElement>(null);
  const [composerInset, setComposerInset] = useState<number>();
  useLayoutEffect(() => {
    const node = composerRootRef.current;
    if (!node) return;
    const measure = () => setComposerInset(Math.ceil(node.getBoundingClientRect().height) + 24);
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(node);
    return () => observer.disconnect();
  }, [activePartnerId]);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replyCursorRef = useRef<Record<string, number>>({});
  const transcriptViewportRef = useRef<HTMLDivElement>(null);

  const activePartner = content.partners.find((partner) => partner.id === activePartnerId) ?? null;
  const baseMessages = useMemo(() => materializePartnerMessages(content.partners, Date.now(), t), [content]);
  const formatDateLabel = useMemo(
    () => formatZhiyuTranscriptDateLabel(copy, previewLang),
    [copy, previewLang],
  );

  // Home and Zhiyu resolve the same visitor-session Local Agent state.
  const agentClient = useMemo(() => activePartner
    ? agentClients.get(activePartner.id, () => createDemoZhiyuAgentClient(activePartner, content)) : null,
  [activePartner, content, agentClients]);
  // The kit session is created and disposed inside one effect: disposal is
  // permanent, and an effect pair (unlike a memo) survives StrictMode's
  // mount → cleanup → mount replay with a fresh session.
  const [agentCenter, setAgentCenter] = useState<DemoZhiyuAgentCenterSession | null>(null);
  useEffect(() => {
    if (!agentClient) {
      setAgentCenter(null);
      return undefined;
    }
    const created = createDemoZhiyuAgentCenterSession(agentClient);
    setAgentCenter(created);
    const unsubscribe = agentClient.subscribeChanges(() => { void created.session.refresh(); });
    return () => {
      unsubscribe();
      created.session.dispose();
      setAgentCenter((current) => (current === created ? null : current));
    };
  }, [agentClient]);
  const session = agentCenter?.session ?? null;

  const subscribeNoop = useCallback(() => () => undefined, []);
  const readNoSnapshot = useCallback(() => null, []);
  const agentCenterSnapshot = useSyncExternalStore(
    session?.subscribe ?? subscribeNoop,
    session?.getSnapshot ?? readNoSnapshot,
    readNoSnapshot,
  );
  const previewRoot = useRef<HTMLDivElement>(null);
  const centerPhase = agentCenterSnapshot?.phase;
  useLayoutEffect(() => {
    if (initialPanel !== 'cognition' || activeAgentTab !== 'cognition' || centerPhase !== 'ready') return;
    const memory = previewRoot.current?.querySelector<HTMLElement>('[data-agent-center-cognition-memory]');
    const scrollport = memory?.closest<HTMLElement>('[role="tabpanel"]');
    if (!memory || !scrollport) return;
    // The memory entry starts at the memory controls within the Agent Center.
    const bounds = scrollport.getBoundingClientRect();
    if (bounds.height > 0) {
      const scale = bounds.height / scrollport.offsetHeight;
      scrollport.scrollTop += (memory.getBoundingClientRect().top - bounds.top) / scale;
    }
  }, [initialPanel, activeAgentTab, centerPhase, session]);
  const resourcePack = useSyncExternalStore(
    agentCenter?.resourcePackController.subscribe ?? subscribeNoop,
    agentCenter?.resourcePackController.getSnapshot ?? readNoSnapshot,
    readNoSnapshot,
  );
  const committedAppearance =
    agentCenterSnapshot?.phase === 'ready' ? agentCenterSnapshot.state.appearance : null;
  const avatarReady = committedAppearance
    ? Boolean(
        committedAppearance.avatarAssetRef &&
          (committedAppearance.backendKind === 'live2d' || committedAppearance.backendKind === 'vrm'),
      )
    : Boolean(activePartner?.appearance.avatarAssetRef);

  const clearStreamTimer = useCallback(() => {
    if (streamTimerRef.current !== null) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
  }, []);
  useEffect(
    () => () => {
      clearStreamTimer();
      if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current);
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    },
    [clearStreamTimer],
  );

  const finishStream = useCallback(
    (partner: HeroDemoZhiyuPartner, text: string, status: ConversationCanonicalMessage['status']) => {
      clearStreamTimer();
      setStream(null);
      if (text.trim().length > 0) {
        appendMessage(partner.id, buildMessage(partner, 'assistant', text, Date.now(), status, undefined, t));
      }
    },
    [appendMessage, clearStreamTimer],
  );

  const startStream = useCallback(
    (partner: HeroDemoZhiyuPartner) => {
      const cursor = replyCursorRef.current[partner.id] ?? 0;
      const reply = partner.replies[cursor % Math.max(partner.replies.length, 1)] ?? '';
      replyCursorRef.current[partner.id] = cursor + 1;
      clearStreamTimer();
      setStream({ partnerId: partner.id, partial: '', reasoning: partner.reasoning });
      let offset = 0;
      const tick = () => {
        offset += STREAM_CHARS_PER_TICK;
        if (offset >= reply.length) {
          finishStream(partner, reply, 'complete');
          return;
        }
        setStream({
          partnerId: partner.id,
          partial: reply.slice(0, offset),
          reasoning: partner.reasoning,
        });
        streamTimerRef.current = setTimeout(tick, STREAM_TICK_MS);
      };
      streamTimerRef.current = setTimeout(tick, STREAM_LEAD_MS);
    },
    [clearStreamTimer, finishStream],
  );

  useEffect(() => {
    if (stream && stream.partnerId !== activePartnerId) {
      const previous = content.partners.find((partner) => partner.id === stream.partnerId);
      if (previous) finishStream(previous, stream.partial, 'canceled');
    }
  }, [activePartnerId, stream, content.partners, finishStream]);

  const attachmentAdapter = useMemo(
    () =>
      createBrowserDataUrlAttachmentAdapter({
        accept: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
        maxAttachments: 1,
        idPrefix: 'zhiyu-conversation-image',
      }),
    [],
  );

  const composerAdapter = useMemo<ChatComposerAdapter<BrowserDataUrlAttachment>>(
    () => ({
      submit: ({ text, attachments: submitted }) => {
        if (!activePartner) return;
        const attachment = submitted[0];
        const body = text.trim();
        if (!body && !attachment) return;
        const stamp = Date.now();
        appendMessage(
          activePartner.id,
          attachment
            ? buildMessage(
                activePartner,
                'user',
                body || attachment.name,
                stamp,
                'complete',
                {
                  kind: 'image',
                  metadata: {
                    ...(quote ? { canonicalQuote: quote } : {}),
                    mediaUrl: attachment.dataUrl,
                    attachmentName: attachment.name,
                    attachmentMimeType: attachment.mimeType,
                    ...(body ? { caption: body } : {}),
                  },
                },
                t,
              )
            : buildMessage(
                activePartner,
                'user',
                body,
                stamp,
                undefined,
                quote ? { kind: 'text', metadata: { canonicalQuote: quote } } : undefined,
                t,
              ),
        );
        setDraft('');
        setAttachments([]);
        setQuote(undefined);
        agentClient?.noteConversationTurn();
        startStream(activePartner);
      },
    }),
    [activePartner, agentClient, appendMessage, startStream, quote],
  );

  const stopVoice = useCallback(() => {
    if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current);
    voiceTimerRef.current = null;
    setVoiceStatus('idle');
  }, []);
  const toggleVoice = useCallback(() => {
    if (voiceStatus === 'idle') {
      setVoiceStatus('recording');
      return;
    }
    if (voiceStatus === 'recording') {
      setVoiceStatus('transcribing');
      voiceTimerRef.current = setTimeout(() => {
        voiceTimerRef.current = null;
        setDraft((current) =>
          current.trim()
            ? `${current.trimEnd()} ${content.demo.voiceTranscriptSample}`
            : content.demo.voiceTranscriptSample,
        );
        setVoiceStatus('idle');
      }, VOICE_TRANSCRIBE_MS);
    }
  }, [content.demo.voiceTranscriptSample, voiceStatus]);
  const voiceState = useMemo(
    () => ({ status: voiceStatus, onToggle: toggleVoice, onCancel: stopVoice }),
    [stopVoice, toggleVoice, voiceStatus],
  );

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => {
      noticeTimerRef.current = null;
      setNotice(null);
    }, NOTICE_MS);
  }, []);

  const playback = useDemoZhiyuPlayback(activePartnerId, () =>
    showNotice(t('zhiyu.current.existingVoiceOnly')),
  );
  const stopVoicePlayback = playback.stop;
  const voicePlayingMessageId = playback.state.status === 'playing' ? playback.state.messageId : null;
  const playVoiceMessage = (message: ConversationCanonicalMessage) => {
    if (playback.state.messageId === message.id && playback.state.status === 'playing') playback.pause();
    else if (playback.state.messageId === message.id && playback.state.status === 'paused')
      void playback.resume();
    else void playback.play(message);
  };
  useEffect(() => {
    setPositionRequest(null);
    setReturnPosition(null);
    readPosition.current = null;
    stopVoice();
  }, [activePartnerId, stopVoice]);
  const handleSelectPartner = (partnerId: string, panel?: AgentCenterSectionId) => {
    if (partnerId === activePartnerId) { if (panel) navigate(partnerId, panel); return; }
    if (stream && activePartner) finishStream(activePartner, stream.partial, 'canceled');
    stopVoice();
    stopVoicePlayback();
    navigate(partnerId, panel);
  };
  const openAgentSection = (section: AgentCenterSectionId) => {
    if (activePartnerId) navigate(activePartnerId, section);
  };

  const messages = activePartner
    ? [...(baseMessages[activePartner.id] ?? []), ...(localMessages[activePartner.id] ?? [])]
    : [];
  const streamingHere = stream !== null && stream.partnerId === activePartnerId;
  const chatState = streamingHere ? 'streaming' : messages.length > 0 ? 'completed' : 'idle';
  const composerState = streamingHere ? 'submitting' : 'ready';

  const chatFooter: ReactNode =
    streamingHere && stream ? (
      <div className="zhiyu-chat-canvas__stream-footer" data-zhiyu-agent-chat-stop-state="available">
        <ChatStreamStatus
          mode="streaming"
          partialText={stream.partial || copy.streamingPlaceholder}
          reasoningText={stream.reasoning}
          reasoningLabel={copy.reasoningLabel}
        />
        <button
          type="button"
          className="zhiyu-chat-canvas__stop-button"
          data-zhiyu-chat-stop-action="true"
          data-zhiyu-agent-chat-stop-state="available"
          aria-label={copy.stopAriaLabel}
          onClick={() => {
            if (activePartner) finishStream(activePartner, stream.partial, 'canceled');
          }}
        >
          <X size={16} aria-hidden="true" />
          <span>{copy.stopLabel}</span>
        </button>
      </div>
    ) : null;

  return (
    <div className="demo-zhiyu-preview" ref={previewRoot}>
      <header className="demo-zhiyu-chrome">
        <button
          type="button"
          aria-label={t('zhiyu.current.back')}
          disabled={navigation.index === 0}
          onClick={() => dispatch({ type: 'go', delta: -1 })}
        >
          <ArrowLeft size={17} />
        </button>
        <button
          type="button"
          aria-label={t('zhiyu.current.forward')}
          disabled={navigation.index === navigation.entries.length - 1}
          onClick={() => dispatch({ type: 'go', delta: 1 })}
        >
          <ArrowRight size={17} />
        </button>
        <button
          type="button"
          aria-label={t('zhiyu.current.toggleRail')}
          aria-pressed={sidebarVisible}
          onClick={() => setSidebarVisible(!sidebarVisible)}
        >
          <PanelLeft size={17} />
        </button>
      </header>
      <div
        className="nimi-ui-module--zhiyu h-full"
        data-demo-zhiyu-root="true"
        data-demo-owns-scroll="true"
        data-demo-interactive="true"
      >
        <main
          className="zhiyu-agent-chat"
          aria-label={content.appName}
          data-zhiyu-screen="home"
          data-zhiyu-agent-chat-shell="primary"
        >
          <div
            className="zhiyu-agent-chat__workspace"
            data-zhiyu-product-shell="workspace"
            data-zhiyu-primary-ui="true"
          >
            <div
              className={`zhiyu-agent-chat__layout${rightPanelMode === 'closed' ? ' is-side-closed' : ''}`}
              data-zhiyu-side-panel-state={rightPanelMode}
              data-zhiyu-rail-visible={sidebarVisible}
              data-zhiyu-relationship-rail-state={content.partners.length > 0 ? 'available' : 'empty'}
            >
              {sidebarVisible && (
                <DemoPresenceRail
                  partners={content.partners}
                  copy={copy}
                  currentPartnerId={activePartnerId}
                  onOpenCurrentAgent={() => openAgentSection('overview')}
                  onSelectPartner={handleSelectPartner}
                  onOpenPartner={handleSelectPartner}
                />
              )}

              <section
                className="zhiyu-chat-canvas"
                data-zhiyu-region="conversation"
                data-choosing-partner={activePartner ? undefined : ''}
                data-zhiyu-resource-pack-surface="true"
                data-zhiyu-resource-pack-effective-source={resourcePack?.effectiveSource ?? 'default'}
                data-zhiyu-resource-pack-phase={resourcePack?.phase ?? 'default'}
              >
                <div
                  aria-hidden="true"
                  className="zhiyu-resource-pack-surface__visual"
                  data-nimi-pack-zone="surface"
                  data-zhiyu-resource-pack-guard="decorative-only"
                />
                {notice ? (
                  <div className="demo-zhiyu-notice" role="status" data-demo-zhiyu-notice="true">
                    <span>{notice}</span>
                    <button type="button" onClick={() => setNotice(null)}>
                      {content.demo.noticeDismissLabel}
                    </button>
                  </div>
                ) : null}
                <div
                  className="zhiyu-chat-canvas__shell"
                  data-zhiyu-agent-chat-state={chatState}
                  data-zhiyu-agent-chat-ready={String(!streamingHere)}
                  data-zhiyu-agent-chat-message-count={String(messages.length)}
                >
                  <div ref={transcriptViewportRef} className="zhiyu-chat-canvas__transcript" data-tour-anchor="partner-chat">
                    <CanonicalTranscriptView
                      messages={messages.map((message) =>
                        message.role === 'user'
                          ? { ...message, senderName: t('zhiyu.zhiyuChatCanvas.you') }
                          : message,
                      )}
                      activeConversationId={activePartner ? `zhiyu-${activePartner.id}` : null}
                      agentName={activePartner?.name}
                      copy={messageCopy}
                      messageActions={{
                        scopeKey: activePartnerId ?? 'none',
                        playback,
                        onQuote: (message, selection) => {
                          const text = selection?.text ?? message.text;
                          setQuote({
                            sourceMessageId: message.id,
                            format: 'nimi.quote-text.v1',
                            startByte: selection?.startByte ?? 0,
                            endByte: selection?.endByte ?? new TextEncoder().encode(message.text).byteLength,
                            sourceRole: message.role === 'user' ? 'user' : 'assistant',
                            sourcePartial: message.metadata?.canonicalPartial === true,
                            text,
                          });
                          composerRootRef.current?.querySelector('textarea')?.focus();
                        },
                        onLocateMessage: locate,
                        onReturnToComposer: () => composerRootRef.current?.querySelector('textarea')?.focus(),
                        onOpenVoiceSettings: () => openAgentSection('appearance'),
                      }}
                      positionRequest={positionRequest}
                      onPositionChange={(position) => {
                        readPosition.current = position;
                      }}
                      onUserNavigate={() => setPositionRequest(null)}
                      bannerContent={
                        returnPosition ? (
                          <div className="demo-zhiyu-reading">
                            <button
                              type="button"
                              onClick={() => {
                                setPositionRequest({ ...returnPosition, requestKey: ++positionKey.current });
                                setReturnPosition(null);
                              }}
                            >
                              {t('zhiyu.current.returnReading')}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPositionRequest({
                                  messageId: null,
                                  offset: 0,
                                  requestKey: ++positionKey.current,
                                });
                                setReturnPosition(null);
                              }}
                            >
                              {t('zhiyu.current.returnLatest')}
                            </button>
                          </div>
                        ) : undefined
                      }
                      voicePlayingMessageId={voicePlayingMessageId}
                      onPlayVoiceMessage={playVoiceMessage}
                      formatDateLabel={formatDateLabel}
                      emptyEyebrow={activePartner ? '' : copy.emptyEyebrow}
                      emptyTitle={activePartner ? '' : t('zhiyu.current.selectTitle')}
                      emptyDescription={activePartner ? '' : t('zhiyu.current.selectBody')}
                      emptyStateContent={
                        activePartner ? (
                          <AgentIntroduction
                            displayName={activePartner.name}
                            avatarUrl={activePartner.avatarUrl}
                            introduction={activePartner.introduction ?? null}
                            locale={previewLang}
                            questionsEnabled={!streamingHere}
                            onPrefill={setDraft}
                            imageMaxSize="clamp(180px, calc(100cqh - 590px), 420px)"
                          />
                        ) : undefined
                      }
                      footerContent={
                        <>
                          {chatFooter}
                          <span
                            data-zhiyu-transcript-end="true"
                            aria-hidden="true"
                            className="block h-px w-full"
                          />
                        </>
                      }
                      widthClassName="w-full max-w-none"
                      widthPositionClassName="mx-0"
                      scrollViewportWidthClassName="w-full"
                      contentPaddingBottomClassName={activePartner && messages.length === 0 ? 'pb-[120px]' : 'pb-[clamp(160px,18vh,220px)]'}
                      contentBottomInsetPx={activePartner ? composerInset : undefined}
                      disableRpContent
                    />
                  </div>
                </div>
                <div className="zhiyu-chat-canvas__overlay">
                  <div className="zhiyu-chat-canvas__overlay-inner">
                    <div
                      ref={composerRootRef}
                      className="zhiyu-chat-canvas__composer"
                      data-zhiyu-composer-state={composerState}
                      data-zhiyu-submit-enabled={String(!streamingHere)}
                    >
                      <LocalAppConversationPlayer
                        playback={playback}
                        copy={messageCopy}
                        onLocateMessage={locate}
                        onOpenSettings={() => openAgentSection('appearance')}
                        className="zhiyu-chat-canvas__message-player mb-2"
                      />
                      {activePartner ? (
                        <CanonicalComposer
                          copy={messageCopy}
                          quoteSlot={
                            quote ? (
                              <div data-canonical-quote-draft className="demo-zhiyu-quote">
                                <div>
                                  <small>
                                    {quote.sourceRole === 'user'
                                      ? messageCopy.bubbleUserLabel
                                      : messageCopy.bubbleAssistantLabel}
                                  </small>
                                  <details>
                                    <summary>{quote.text}</summary>
                                    <p>{quote.text}</p>
                                  </details>
                                </div>
                                <button
                                  type="button"
                                  aria-label={messageCopy.quoteCancelLabel}
                                  onClick={() => setQuote(undefined)}
                                >
                                  <X size={16} />
                                </button>
                              </div>
                            ) : undefined
                          }
                          adapter={composerAdapter}
                          attachmentAdapter={attachmentAdapter}
                          attachments={attachments}
                          onAttachmentsChange={setAttachments}
                          attachLabel={copy.attachLabel}
                          voiceState={voiceState}
                          text={draft}
                          onTextChange={(value) => setDraft(value)}
                          disabled={streamingHere}
                          placeholder={copy.composerPlaceholder}
                          runtimeHint={streamingHere ? copy.streamingHint : null}
                          sendHint={streamingHere ? copy.streamingSendHint : undefined}
                          sendLabel={copy.sendLabel}
                          layout="stacked"
                          leadingSlot={
                            <DemoZhiyuPartnerCard
                              partner={activePartner}
                              placement="composer"
                              onOpen={openAgentSection}
                            >
                              <button
                                type="button"
                                className="zhiyu-home__composer-avatar"
                                aria-label={`${copy.avatarAriaPrefix}${activePartner.name}`}
                              >
                                <img src={activePartner.avatarUrl ?? undefined} alt="" />
                              </button>
                            </DemoZhiyuPartnerCard>
                          }
                          toolbarSlot={
                            <ComposerModeTools
                              copy={copy}
                              avatarReady={avatarReady}
                              onAvatarLaunch={() => showNotice(content.demo.avatarLaunchNotice)}
                              onOpenAppearance={() => openAgentSection('appearance')}
                              onOpenBehavior={() => openAgentSection('behavior')}
                            />
                          }
                          trailingSlot={
                            <ComposerAgentCenterButton
                              copy={copy}
                              open={rightPanelMode === 'agent'}
                              onToggleAgentPanel={() => {
                                if (rightPanelMode === 'agent') {
                                  setRightPanelMode('closed');
                                  return;
                                }
                                openAgentSection('overview');
                              }}
                            />
                          }
                          className="zhiyu-chat-canvas__canonical-composer"
                        />
                      ) : (
                        <CanonicalComposer
                          adapter={composerAdapter}
                          disabled
                          layout="stacked"
                          copy={messageCopy}
                          placeholder={t('zhiyu.current.selectPlaceholder')}
                          sendLabel={copy.sendLabel}
                          className="zhiyu-chat-canvas__canonical-composer"
                          voiceState={voiceState}
                          attachmentAdapter={attachmentAdapter}
                          attachLabel={copy.attachLabel}
                          leadingSlot={
                            <button
                              type="button"
                              className="zhiyu-home__composer-avatar"
                              aria-label={t('zhiyu.current.selectTitle')}
                              onClick={() => setSidebarVisible(true)}
                            >
                              <UserRound size={18} />
                            </button>
                          }
                          toolbarSlot={
                            <ComposerModeTools
                              disabled
                              copy={copy}
                              avatarReady={false}
                              onAvatarLaunch={() => showNotice(content.demo.avatarLaunchNotice)}
                              onOpenAppearance={() => setSidebarVisible(true)}
                              onOpenBehavior={() => setSidebarVisible(true)}
                            />
                          }
                          trailingSlot={
                            <ComposerAgentCenterButton
                              disabled
                              copy={copy}
                              open={false}
                              onToggleAgentPanel={() => setSidebarVisible(true)}
                            />
                          }
                        />
                      )}
                    </div>
                    {activePartner && (
                      <div className="zhiyu-chat-canvas__status">
                        <span
                          className="zhiyu-chat-canvas__labeled-chip"
                          data-zhiyu-labeled-chip="conversation"
                        >
                          <span className="zhiyu-chat-canvas__chip-label">{copy.sessionChipLabel}</span>
                          <StatusBadge tone="success" shape="dot">
                            {copy.readyChipLabel}
                          </StatusBadge>
                        </span>
                        <span className="zhiyu-chat-canvas__labeled-chip" data-zhiyu-labeled-chip="chat">
                          <span className="zhiyu-chat-canvas__chip-label">{copy.replyChipLabel}</span>
                          <StatusBadge
                            tone={streamingHere ? 'warning' : messages.length > 0 ? 'success' : 'neutral'}
                            shape="dot"
                          >
                            {streamingHere
                              ? copy.streamingChipLabel
                              : messages.length > 0
                                ? copy.readyChipLabel
                                : copy.idleChipLabel}
                          </StatusBadge>
                        </span>
                        <span className="zhiyu-chat-canvas__labeled-chip" data-zhiyu-region="companion">
                          <span className="zhiyu-chat-canvas__chip-label">{copy.rapportChipLabel}</span>
                          <StatusBadge
                            tone={activePartner?.hostMoodLabel ? 'success' : 'neutral'}
                            shape="dot"
                          >
                            {activePartner?.moodLabel ?? ''}
                          </StatusBadge>
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {rightPanelMode !== 'closed' && activePartner && session ? (
                <DemoAgentPanel
                  partner={activePartner}
                  copy={copy}
                  session={session}
                  activeTab={activeAgentTab}
                  onActiveTabChange={setActiveAgentTab}
                  onClose={() => setRightPanelMode('closed')}
                  onOpenRuntimeSettings={() => showNotice(content.demo.runtimeSettingsNotice)}
                  onAvatarLaunch={() => showNotice(content.demo.avatarLaunchNotice)}
                />
              ) : null}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
