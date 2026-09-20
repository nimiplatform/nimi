import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
import { Globe2, Lightbulb, SlidersHorizontal, UserRound, X } from 'lucide-react';
import type { HeroDemoZhiyuMessageSeed, HeroDemoZhiyuPartner, HeroDemoZhiyuPreview } from '../content/landing-content.js';
import {
  createDemoZhiyuAgentCenterSession,
  createDemoZhiyuAgentClient,
  type DemoZhiyuAgentCenterSession,
  type DemoZhiyuAgentClient,
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

const ZHIYU_USER_NAME = '你';
// Paced like a local model reply so the streaming state (status bubble,
// 停止回复, disabled composer) is actually observable.
const STREAM_TICK_MS = 110;
const STREAM_CHARS_PER_TICK = 2;
const STREAM_LEAD_MS = 700;
const VOICE_TRANSCRIBE_MS = 900;
const NOTICE_MS = 6_000;

function partnerInitial(name: string): string {
  const firstLetter = name.match(/[A-Za-z]/u)?.[0];
  if (firstLetter) return firstLetter.toUpperCase();
  return Array.from(name.trim())[0] || '本';
}

function formatZhiyuTranscriptDateLabel(
  copy: HeroDemoZhiyuPreview['copy'],
): ({ date, diffDays }: { date: Date; diffDays: number }) => string {
  const formatter = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' });
  return ({ date, diffDays }) => {
    if (diffDays === 0) return copy.dateLabels.today;
    if (diffDays === 1) return copy.dateLabels.yesterday;
    return formatter.format(date);
  };
}

function materializePartnerMessages(
  partners: ReadonlyArray<HeroDemoZhiyuPartner>,
  now: number,
): Record<string, ConversationCanonicalMessage[]> {
  const result: Record<string, ConversationCanonicalMessage[]> = {};
  for (const partner of partners) {
    result[partner.id] = partner.messages.map((seed) => ({
      ...buildMessage(partner, seed.role, seed.text, now - seed.minutesAgo * 60_000, 'complete', seedMedia(seed)),
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
    return { kind: 'voice', metadata: { voiceUrl: seed.voiceUrl, voiceTranscript: seed.voiceTranscript } };
  }
  if (seed.kind === 'image') {
    return { kind: 'image', metadata: { mediaUrl: seed.mediaUrl, ...(seed.caption ? { caption: seed.caption } : {}) } };
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
    ...(media.metadata ? { metadata: media.metadata } : {}),
    senderName: role === 'user' ? ZHIYU_USER_NAME : partner.name,
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
}: {
  partners: ReadonlyArray<HeroDemoZhiyuPartner>;
  copy: HeroDemoZhiyuPreview['copy'];
  currentPartnerId: string | null;
  onOpenCurrentAgent: () => void;
  onSelectPartner: (partnerId: string) => void;
}) {
  return (
    <section className="zhiyu-agent-rail" data-zhiyu-region="presence" aria-label={copy.railLabel}>
      <div className="zhiyu-agent-rail__logo" aria-label="Nimi" data-zhiyu-desktop-logo-image="nimi">
        <img src="/logo.svg" alt="" aria-hidden="true" />
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
              <button
                type="button"
                className={`zhiyu-agent-rail__agent${isCurrent ? ' is-active' : ''}`}
                aria-label={`${isCurrent ? copy.currentPartnerAriaPrefix : copy.selectPartnerAriaPrefix}${partner.name}`}
                aria-pressed={isCurrent}
                title={partner.name}
                data-zhiyu-local-agent-candidate="true"
                data-zhiyu-local-agent-candidate-active={String(isCurrent)}
                data-zhiyu-agent-handle={partner.id}
                onClick={() => {
                  if (isCurrent) {
                    onOpenCurrentAgent();
                    return;
                  }
                  onSelectPartner(partner.id);
                }}
              >
                {partner.avatarUrl ? (
                  <img src={partner.avatarUrl} alt="" aria-hidden="true" />
                ) : partnerInitial(partner.name)}
              </button>
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
  const i18n = useMemo(() => {
    const overrides: Partial<Record<AgentCenterTranslationKey, string>> = {
      'AgentCenter.chrome.title': copy.panelTitle,
      'AgentCenter.chrome.eyebrow': copy.panelEyebrow,
      'AgentCenter.chrome.closeLabel': copy.panelCloseLabel,
      'AgentCenter.chrome.navLabel': copy.panelNavLabel,
      'AgentCenter.chrome.projectionLoadFailed': copy.panelLoadFailed,
    };
    return createAgentCenterI18n({
      language: 'zh',
      t(key) {
        return overrides[key as AgentCenterTranslationKey] || key;
      },
    });
  }, [copy]);
  const worldLabel: string | null = null;
  return (
    <aside
      className="zhiyu-agent-center mr-2 my-12 flex h-[calc(100cqh-96px)] min-h-0 w-[min(500px,calc(100cqw-96px))] max-w-full shrink-0 flex-col gap-2 [grid-area:side] max-[980px]:my-0 max-[980px]:mr-0 max-[980px]:h-auto max-[980px]:min-h-[min(640px,calc(100cqh-20px))] max-[980px]:w-full"
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
            <span className="rounded-full bg-violet-500/10 px-2 py-px text-[10px] font-semibold text-violet-700" data-zhiyu-agent-center-state-chip="mood">
              {partner.hostMoodLabel}
            </span>
          ) : null}
          {partner.hostActivityLabel ? (
            <span className="rounded-full bg-sky-500/10 px-2 py-px text-[10px] font-semibold text-sky-700" data-zhiyu-agent-center-state-chip="activity">
              {partner.hostActivityLabel}
            </span>
          ) : null}
          {worldLabel ? (
            <span className="inline-flex min-w-0 items-center gap-1 text-[10.5px] text-[var(--nimi-text-secondary)]" data-zhiyu-agent-center-world-name={worldLabel}>
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
          avatarUrl: null,
          avatarFallback: partnerInitial(partner.name),
        }}
        onSectionChange={onActiveTabChange}
        placementActions={{
          close: onClose,
          openRuntimeSettings: onOpenRuntimeSettings,
          launchAvatar: onAvatarLaunch,
        }}
        session={session}
      />
    </aside>
  );
}

/* ------------------------------------------------------------------------ */
/* Composer pieces (mirror ZhiyuAgentChatPieces)                             */
/* ------------------------------------------------------------------------ */

function ComposerAvatarButton({
  partner,
  copy,
  onOpenSettings,
}: {
  partner: HeroDemoZhiyuPartner;
  copy: HeroDemoZhiyuPreview['copy'];
  onOpenSettings: () => void;
}) {
  const label = `${copy.avatarAriaPrefix}${partner.name}`;
  return (
    <button
      type="button"
      className="zhiyu-home__composer-avatar"
      aria-label={label}
      title={label}
      onClick={onOpenSettings}
    >
      {partner.avatarUrl ? (
        <img src={partner.avatarUrl} alt="" aria-hidden="true" />
      ) : partnerInitial(partner.name)}
    </button>
  );
}

function ComposerModeTools({
  copy,
  avatarReady,
  onAvatarLaunch,
  onOpenAppearance,
  onOpenBehavior,
}: {
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
  copy,
  open,
  onToggleAgentPanel,
}: {
  copy: HeroDemoZhiyuPreview['copy'];
  open: boolean;
  onToggleAgentPanel: () => void;
}) {
  return (
    <button
      type="button"
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

export function DemoZhiyuPreview({ content }: { content: HeroDemoZhiyuPreview }) {
  const { copy } = content;
  const [activePartnerId, setActivePartnerId] = useState<string | null>(content.partners[0]?.id ?? null);
  const [localMessages, setLocalMessages] = useState<Readonly<Record<string, readonly ConversationCanonicalMessage[]>>>({});
  const [stream, setStream] = useState<{ partnerId: string; partial: string; reasoning: string | null } | null>(null);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<readonly BrowserDataUrlAttachment[]>([]);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>('closed');
  const [activeAgentTab, setActiveAgentTab] = useState<AgentCenterSectionId>('overview');
  const [notice, setNotice] = useState<string | null>(null);
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const [voicePlayingMessageId, setVoicePlayingMessageId] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replyCursorRef = useRef<Record<string, number>>({});
  const agentClientsRef = useRef(new Map<string, DemoZhiyuAgentClient>());
  const transcriptViewportRef = useRef<HTMLDivElement>(null);

  const activePartner = content.partners.find((partner) => partner.id === activePartnerId) ?? null;
  const baseMessages = useMemo(() => materializePartnerMessages(content.partners, Date.now()), [content]);
  const formatDateLabel = useMemo(() => formatZhiyuTranscriptDateLabel(copy), [copy]);

  // One mock Runtime client per partner for the lifetime of the preview, so
  // settings the visitor changes survive switching partners back and forth.
  const agentClient = useMemo(() => {
    if (!activePartner) return null;
    const existing = agentClientsRef.current.get(activePartner.id);
    if (existing) return existing;
    const created = createDemoZhiyuAgentClient(activePartner, content);
    agentClientsRef.current.set(activePartner.id, created);
    return created;
  }, [activePartner, content]);
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
    return () => {
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
  const resourcePack = useSyncExternalStore(
    agentCenter?.resourcePackController.subscribe ?? subscribeNoop,
    agentCenter?.resourcePackController.getSnapshot ?? readNoSnapshot,
    readNoSnapshot,
  );
  const committedAppearance = agentCenterSnapshot?.phase === 'ready' ? agentCenterSnapshot.state.appearance : null;
  const avatarReady = committedAppearance
    ? Boolean(committedAppearance.avatarAssetRef && (committedAppearance.backendKind === 'live2d' || committedAppearance.backendKind === 'vrm'))
    : Boolean(activePartner?.appearance.avatarAssetRef);

  const clearStreamTimer = useCallback(() => {
    if (streamTimerRef.current !== null) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
  }, []);
  const stopVoicePlayback = useCallback(() => {
    voiceAudioRef.current?.pause();
    voiceAudioRef.current = null;
    setVoicePlayingMessageId(null);
  }, []);
  // Mirrors ZhiyuAgentChatSurface.playVoiceMessage: one <audio> at a time,
  // tapping the playing bubble pauses it.
  const playVoiceMessage = useCallback((message: ConversationCanonicalMessage) => {
    const voiceUrl = typeof message.metadata?.voiceUrl === 'string' ? message.metadata.voiceUrl : '';
    if (!voiceUrl) return;
    if (voicePlayingMessageId === message.id) {
      stopVoicePlayback();
      return;
    }
    voiceAudioRef.current?.pause();
    const audio = new Audio(voiceUrl);
    voiceAudioRef.current = audio;
    setVoicePlayingMessageId(message.id);
    const clear = () => {
      if (voiceAudioRef.current === audio) voiceAudioRef.current = null;
      setVoicePlayingMessageId((current) => (current === message.id ? null : current));
    };
    audio.addEventListener('ended', clear, { once: true });
    audio.addEventListener('error', clear, { once: true });
    void audio.play().catch(clear);
  }, [stopVoicePlayback, voicePlayingMessageId]);
  useEffect(() => () => {
    clearStreamTimer();
    voiceAudioRef.current?.pause();
    voiceAudioRef.current = null;
    if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
  }, [clearStreamTimer]);

  const appendMessage = useCallback((partnerId: string, message: ConversationCanonicalMessage) => {
    setLocalMessages((prev) => ({
      ...prev,
      [partnerId]: [...(prev[partnerId] ?? []), message],
    }));
  }, []);

  const finishStream = useCallback((partner: HeroDemoZhiyuPartner, text: string, status: ConversationCanonicalMessage['status']) => {
    clearStreamTimer();
    setStream(null);
    if (text.trim().length > 0) {
      appendMessage(partner.id, buildMessage(partner, 'assistant', text, Date.now(), status));
    }
  }, [appendMessage, clearStreamTimer]);

  const startStream = useCallback((partner: HeroDemoZhiyuPartner) => {
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
      setStream({ partnerId: partner.id, partial: reply.slice(0, offset), reasoning: partner.reasoning });
      streamTimerRef.current = setTimeout(tick, STREAM_TICK_MS);
    };
    streamTimerRef.current = setTimeout(tick, STREAM_LEAD_MS);
  }, [clearStreamTimer, finishStream]);

  const attachmentAdapter = useMemo(() => createBrowserDataUrlAttachmentAdapter({
    accept: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    maxAttachments: 1,
    idPrefix: 'zhiyu-conversation-image',
  }), []);

  const composerAdapter = useMemo<ChatComposerAdapter<BrowserDataUrlAttachment>>(() => ({
    submit: ({ text, attachments: submitted }) => {
      if (!activePartner) return;
      const attachment = submitted[0];
      const body = text.trim();
      if (!body && !attachment) return;
      const stamp = Date.now();
      appendMessage(activePartner.id, attachment
        ? buildMessage(activePartner, 'user', body || attachment.name, stamp, 'complete', {
          kind: 'image',
          metadata: {
            mediaUrl: attachment.dataUrl,
            attachmentName: attachment.name,
            attachmentMimeType: attachment.mimeType,
            ...(body ? { caption: body } : {}),
          },
        })
        : buildMessage(activePartner, 'user', body, stamp));
      setDraft('');
      setAttachments([]);
      agentClient?.noteConversationTurn();
      startStream(activePartner);
    },
  }), [activePartner, agentClient, appendMessage, startStream]);

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
        setDraft((current) => (current.trim() ? `${current.trimEnd()} ${content.demo.voiceTranscriptSample}` : content.demo.voiceTranscriptSample));
        setVoiceStatus('idle');
      }, VOICE_TRANSCRIBE_MS);
    }
  }, [content.demo.voiceTranscriptSample, voiceStatus]);
  const voiceState = useMemo(() => ({ status: voiceStatus, onToggle: toggleVoice, onCancel: stopVoice }), [stopVoice, toggleVoice, voiceStatus]);

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => {
      noticeTimerRef.current = null;
      setNotice(null);
    }, NOTICE_MS);
  }, []);

  const handleSelectPartner = (partnerId: string) => {
    if (partnerId === activePartnerId) return;
    if (stream && activePartner) finishStream(activePartner, stream.partial, 'canceled');
    stopVoice();
    stopVoicePlayback();
    setDraft('');
    setAttachments([]);
    setActiveAgentTab('overview');
    setActivePartnerId(partnerId);
  };
  const openAgentSection = (section: AgentCenterSectionId) => {
    setRightPanelMode('agent');
    setActiveAgentTab(section);
  };

  const messages = activePartner
    ? [...(baseMessages[activePartner.id] ?? []), ...(localMessages[activePartner.id] ?? [])]
    : [];
  const streamingHere = stream !== null && stream.partnerId === activePartnerId;
  const chatState = streamingHere ? 'streaming' : messages.length > 0 ? 'completed' : 'idle';
  const composerState = streamingHere ? 'submitting' : 'ready';

  useLayoutEffect(() => {
    const root = transcriptViewportRef.current?.querySelector<HTMLElement>('[data-canonical-transcript-root="true"]');
    if (!root) return;
    root.scrollTop = root.scrollHeight;
  }, [messages.length, stream?.partial, activePartnerId]);

  const chatFooter: ReactNode = streamingHere && stream ? (
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
        onClick={() => { if (activePartner) finishStream(activePartner, stream.partial, 'canceled'); }}
      >
        <X size={16} aria-hidden="true" />
        <span>{copy.stopLabel}</span>
      </button>
    </div>
  ) : null;

  return (
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
        <div className="zhiyu-agent-chat__workspace" data-zhiyu-product-shell="workspace" data-zhiyu-primary-ui="true">
          <div
            className={`zhiyu-agent-chat__layout${rightPanelMode === 'closed' ? ' is-side-closed' : ''}`}
            data-zhiyu-side-panel-state={rightPanelMode}
            data-zhiyu-relationship-rail-state={content.partners.length > 0 ? 'available' : 'empty'}
          >
            <DemoPresenceRail
              partners={content.partners}
              copy={copy}
              currentPartnerId={activePartnerId}
              onOpenCurrentAgent={() => openAgentSection('overview')}
              onSelectPartner={handleSelectPartner}
            />

            <section
              className="zhiyu-chat-canvas"
              data-zhiyu-region="conversation"
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
                  <button type="button" onClick={() => setNotice(null)}>{content.demo.noticeDismissLabel}</button>
                </div>
              ) : null}
              <div
                className="zhiyu-chat-canvas__shell"
                data-zhiyu-agent-chat-state={chatState}
                data-zhiyu-agent-chat-ready={String(!streamingHere)}
                data-zhiyu-agent-chat-message-count={String(messages.length)}
              >
                <div ref={transcriptViewportRef} className="zhiyu-chat-canvas__transcript">
                  <CanonicalTranscriptView
                    messages={messages}
                    activeConversationId={activePartner ? `zhiyu-${activePartner.id}` : null}
                    agentName={activePartner?.name}
                    copy={copy.chat}
                    voicePlayingMessageId={voicePlayingMessageId}
                    onPlayVoiceMessage={playVoiceMessage}
                    formatDateLabel={formatDateLabel}
                    emptyEyebrow={copy.emptyEyebrow}
                    emptyTitle={copy.emptyTitle}
                    emptyDescription={copy.emptyDescription}
                    footerContent={(
                      <>
                        {chatFooter}
                        <span data-zhiyu-transcript-end="true" aria-hidden="true" className="block h-px w-full" />
                      </>
                    )}
                    widthClassName="w-full max-w-none"
                    widthPositionClassName="mx-0"
                    scrollViewportWidthClassName="w-full"
                    contentPaddingBottomClassName="pb-[clamp(160px,18vh,220px)]"
                    disableRpContent
                  />
                </div>
              </div>
              <div className="zhiyu-chat-canvas__overlay">
                <div className="zhiyu-chat-canvas__overlay-inner">
                  <div
                    className="zhiyu-chat-canvas__composer"
                    data-zhiyu-composer-state={composerState}
                    data-zhiyu-submit-enabled={String(!streamingHere)}
                  >
                    {activePartner ? (
                      <CanonicalComposer
                        adapter={composerAdapter}
                        attachmentAdapter={attachmentAdapter}
                        attachments={attachments}
                        onAttachmentsChange={setAttachments}
                        attachLabel={copy.attachLabel}
                        voiceState={voiceState}
                        text={draft}
                        onTextChange={setDraft}
                        disabled={streamingHere}
                        placeholder={copy.composerPlaceholder}
                        runtimeHint={streamingHere ? copy.streamingHint : null}
                        sendHint={streamingHere ? copy.streamingSendHint : undefined}
                        sendLabel={copy.sendLabel}
                        layout="stacked"
                        leadingSlot={(
                          <ComposerAvatarButton
                            partner={activePartner}
                            copy={copy}
                            onOpenSettings={() => openAgentSection('appearance')}
                          />
                        )}
                        toolbarSlot={(
                          <ComposerModeTools
                            copy={copy}
                            avatarReady={avatarReady}
                            onAvatarLaunch={() => showNotice(content.demo.avatarLaunchNotice)}
                            onOpenAppearance={() => openAgentSection('appearance')}
                            onOpenBehavior={() => openAgentSection('behavior')}
                          />
                        )}
                        trailingSlot={(
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
                        )}
                        className="zhiyu-chat-canvas__canonical-composer"
                      />
                    ) : null}
                  </div>
                  <div className="zhiyu-chat-canvas__status">
                    <span className="zhiyu-chat-canvas__labeled-chip" data-zhiyu-labeled-chip="conversation">
                      <span className="zhiyu-chat-canvas__chip-label">{copy.sessionChipLabel}</span>
                      <StatusBadge tone="success" shape="dot">{copy.readyChipLabel}</StatusBadge>
                    </span>
                    <span className="zhiyu-chat-canvas__labeled-chip" data-zhiyu-labeled-chip="chat">
                      <span className="zhiyu-chat-canvas__chip-label">{copy.replyChipLabel}</span>
                      <StatusBadge tone={streamingHere ? 'warning' : messages.length > 0 ? 'success' : 'neutral'} shape="dot">
                        {streamingHere ? copy.streamingChipLabel : messages.length > 0 ? copy.readyChipLabel : copy.idleChipLabel}
                      </StatusBadge>
                    </span>
                    <span className="zhiyu-chat-canvas__labeled-chip" data-zhiyu-region="companion">
                      <span className="zhiyu-chat-canvas__chip-label">{copy.rapportChipLabel}</span>
                      <StatusBadge tone={activePartner?.hostMoodLabel ? 'success' : 'neutral'} shape="dot">
                        {activePartner?.moodLabel ?? ''}
                      </StatusBadge>
                    </span>
                  </div>
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
  );
}
