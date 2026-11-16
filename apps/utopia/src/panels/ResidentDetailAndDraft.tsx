import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
  type SetStateAction,
} from 'react';
import {
  createAppConversationEntrySession,
  createBrowserAppConversationHostPort,
  type AppConversationEntrySession,
  type AppConversationEntryState,
} from '@nimiplatform/kit/features/chat/headless';
import { Button, InlineAlert, StatusBadge, TextareaField, Toggle } from '@nimiplatform/kit/ui';
import type { NimiLocalAppClient } from '@nimiplatform/sdk';
import type {
  NimiUtopiaResident,
  NimiUtopiaSnapshot,
  NimiUtopiaUpdateIntent,
} from '@nimiplatform/sdk/app';
import { CompanionAvatar, type CompanionPresenceTone } from '../components/CompanionAvatar.js';
import { HandDrawnChibiActorFigure, HandDrawnChibiMedallion } from '../components/HandDrawnChibi.js';
import { PauseWaveIcon, PlayWaveIcon } from '../components/UtopiaIcons.js';
import {
  buildContextualIcebreakers,
  loadCompanionIntroduction,
  resolveResidentPresence,
  type CompanionIntroSummary,
} from '../domain/agent-profiles.js';
import {
  CHIBI_CLOAK_OPTIONS,
  CHIBI_EYE_OPTIONS,
  CHIBI_HAIR_COLOR_OPTIONS,
  CHIBI_HAIR_STYLE_OPTIONS,
  CHIBI_HEADWEAR_OPTIONS,
  CHIBI_SKIN_OPTIONS,
  describeChibiAppearanceSummary,
  hasCustomChibiAppearance,
  randomizeChibiAppearance,
  resolveChibiAppearance,
  type ChibiAppearance,
  type ChibiWardrobeMap,
} from '../domain/chibi-wardrobe.js';
import {
  describeResidentFrame,
  describeSolitudeConsequence,
} from '../domain/visit-journal.js';
import { MAX_UTOPIA_ZHIYU_DRAFT_CHARS } from '../domain/desktop-open.js';

// @nimi-authority: rule.nimi.runtime.agent-service.canonical-agent-conversation-authority

export type LocalChatDraftState = Readonly<{
  readonly agentHandle: NimiUtopiaResident['agentHandle'];
  readonly displayName: string;
  readonly text: string;
  readonly sessionMounted: boolean;
  readonly sendOperation: DraftSendOperation | null;
  readonly sendError: string | null;
}>;

export function createZeroSideEffectDraftState(
  resident: Pick<NimiUtopiaResident, 'agentHandle' | 'displayName'>,
  initialText = '',
): LocalChatDraftState {
  // Pure value object: constructs zero network/RPC/conversation sessions.
  return Object.freeze({
    agentHandle: resident.agentHandle,
    displayName: resident.displayName,
    text: initialText,
    sessionMounted: false,
    sendOperation: null,
    sendError: null,
  });
}

export function editZeroSideEffectDraftText(
  draft: LocalChatDraftState,
  nextText: string,
): LocalChatDraftState {
  return Object.freeze({
    ...draft,
    text: nextText,
  });
}

export function activateFormalSessionFromDraft(
  draft: LocalChatDraftState,
  mode: 'expand-history' | 'send-now',
  residents: readonly Pick<NimiUtopiaResident, 'agentHandle'>[],
): { readonly next: LocalChatDraftState | null; readonly error: string | null } {
  const stillPresent = residents.some((r) => r.agentHandle === draft.agentHandle);
  if (!stillPresent) {
    return {
      next: null,
      error: `伙伴「${draft.displayName}」当前已不在洞天居民列中，无法建立正式会话。`,
    };
  }
  const trimmed = draft.text.trim();
  if (mode === 'send-now' && !trimmed) {
    return {
      next: draft,
      error: '请先输入要发送的消息内容。',
    };
  }
  return {
    next: Object.freeze({
      ...draft,
      sessionMounted: true,
      sendOperation: mode === 'send-now' ? createDraftSendOperation(trimmed) : null,
    }),
    error: null,
  };
}

// The parent-held draft owns the operation, independently of the panel's lifetime.
// A remount observes the same outcome; only a new explicit send creates a request.
export type DraftSendOperation = Readonly<{
  requestId: string;
  text: string;
  send: (session: AppConversationEntrySession) => Promise<boolean>;
}>;

export function createDraftSendOperation(text: string): DraftSendOperation {
  const requestId = `utopia-${globalThis.crypto.randomUUID()}`;
  let outcome: Promise<boolean> | undefined;
  return Object.freeze({
    requestId,
    text,
    send(session: AppConversationEntrySession) {
      outcome ??= Promise.resolve()
        .then(() => session.send({
          requestId,
          parts: [{ kind: 'text', text }],
        }))
        .then(() => true, () => false);
      return outcome;
    },
  });
}

export function settleDraftSend(draft: LocalChatDraftState, operation: DraftSendOperation, committed: boolean): LocalChatDraftState {
  if (draft.sendOperation !== operation) return draft;
  return Object.freeze({
    ...draft,
    text: committed && draft.text.trim() === operation.text ? '' : draft.text,
    sendOperation: null,
    sendError: committed ? null : '消息未获确认，草稿已保留，请核对后重试。',
  });
}

export type ConversationSessionFactory = () => AppConversationEntrySession;

type MountedConversation = {
  session: AppConversationEntrySession;
  active: boolean;
  pending?: Promise<boolean>;
};

function LazyMountedFormalConversation(props: {
  readonly agentHandle: NimiUtopiaResident['agentHandle'];
  readonly displayName: string;
  readonly avatarUrl?: string | null;
  readonly draftText: string;
  readonly sendOperation: DraftSendOperation | null;
  readonly deliveryError: string | null;
  readonly handoffBusy?: boolean;
  readonly draftOverZhiyuLimit?: boolean;
  readonly draftCharCount?: number;
  readonly onDraftTextChange: (next: string) => void;
  readonly onDraftStateChange: Dispatch<SetStateAction<LocalChatDraftState | null>>;
  readonly onConversationAnchorChange?: (anchorId: string | null) => void;
  readonly onOpenInZhiyu?: () => void;
  readonly onClose: () => void;
  readonly createSession: ConversationSessionFactory;
}) {
  const {
    agentHandle,
    displayName,
    avatarUrl,
    draftText,
    sendOperation,
    deliveryError,
    handoffBusy = false,
    draftOverZhiyuLimit = false,
    draftCharCount = 0,
    onDraftTextChange,
    onDraftStateChange,
    onConversationAnchorChange,
    onOpenInZhiyu,
    onClose,
    createSession,
  } = props;
  const [mounted, setMounted] = useState<MountedConversation | null>(null);
  const [state, setState] = useState<AppConversationEntryState | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const listRef = useRef<HTMLOListElement | null>(null);
  const sending = sendOperation !== null;

  useEffect(() => {
    // Allocate in setup so StrictMode's cleanup/setup never reuses a disposed session.
    const session = createSession();
    const owner: MountedConversation = { session, active: true };
    setMounted(null);
    setSendError(null);
    setState(session.getState());
    const unsubscribe = session.observe(setState);

    const failSessionSetup = (rawError?: string | null) => {
      if (!owner.active) return;
      const message = rawError?.trim() || '暂时无法连接正式对话通道，请确认 Nimi Home 已登录。';
      setMounted(null);
      setSendError(message);
      onDraftStateChange((current) => {
        if (!current || current.agentHandle !== agentHandle || !current.sendOperation) {
          return current;
        }
        return Object.freeze({
          ...settleDraftSend(current, current.sendOperation, false),
          sendError: message,
        });
      });
    };

    void (async () => {
      try {
        await session.loadReferences();
        if (!owner.active) return;
        const afterLoad = session.getState();
        if (afterLoad.status === 'failed' || afterLoad.status === 'stale') {
          failSessionSetup(afterLoad.error);
          return;
        }
        await session.selectReference(agentHandle);
        if (!owner.active) return;
        const afterSelect = session.getState();
        if (afterSelect.status !== 'ready') {
          failSessionSetup(afterSelect.error);
          return;
        }
        setSendError(null);
        setMounted(owner);
      } catch (err) {
        failSessionSetup(err instanceof Error ? err.message : null);
      }
    })();
    return () => {
      owner.active = false;
      unsubscribe();
      // Disposing while send is unresolved would mask a successfully committed turn.
      // The request owns this session until its outcome is known, even off-screen.
      if (owner.pending) void owner.pending.then(() => session.dispose());
      else void session.dispose();
    };
  }, [createSession, agentHandle, retryNonce, onDraftStateChange]);

  useEffect(() => {
    if (!sendOperation) return;
    if (state?.status === 'failed' || state?.status === 'stale') {
      if (!mounted?.pending) {
        const message = state.error?.trim() || '正式对话通道未就绪，草稿已保留，请重试连接。';
        setSendError(message);
        onDraftStateChange((current) => {
          if (!current || current.agentHandle !== agentHandle || current.sendOperation !== sendOperation) {
            return current;
          }
          return Object.freeze({
            ...settleDraftSend(current, sendOperation, false),
            sendError: message,
          });
        });
      }
      return;
    }
    if (!mounted?.active || state?.status !== 'ready') return;
    setSendError(null);
    mounted.pending = sendOperation.send(mounted.session);
    void mounted.pending.then((committed) => {
      // Always settle the parent-held operation, including while the panel is absent.
      onDraftStateChange((current) => (current ? settleDraftSend(current, sendOperation, committed) : current));
    });
  }, [mounted, state?.status, state?.error, agentHandle, sendOperation, onDraftStateChange]);

  useEffect(() => {
    onConversationAnchorChange?.(state?.conversationAnchorId ?? null);
  }, [state?.conversationAnchorId, onConversationAnchorChange]);

  useEffect(() => () => {
    onConversationAnchorChange?.(null);
  }, [onConversationAnchorChange]);

  useEffect(() => {
    const el = listRef.current;
    if (el && typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [state?.messages.length, state?.activeTurnId]);

  const triggerManualSend = () => {
    const text = draftText.trim();
    if (!text || sending || !mounted?.active || state?.status !== 'ready' || Boolean(state?.activeTurnId)) return;
    const operation = createDraftSendOperation(text);
    onDraftStateChange((current) => (current?.agentHandle === agentHandle && !current.sendOperation
      ? Object.freeze({ ...current, sendOperation: operation, sendError: null })
      : current));
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    triggerManualSend();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      triggerManualSend();
    }
  };

  const sessionBroken = state?.status === 'failed' || state?.status === 'stale' || (!mounted && Boolean(sendError));
  const statusFooterLabel = state?.activeTurnId
    ? '对方正在组织回应…'
    : state?.status === 'ready'
      ? '正式对话已连接'
      : (sessionBroken || Boolean(deliveryError))
        ? '对话未就绪，可点击上方重试'
        : '正在连接正式对话…';

  return (
    <div className="utopia-formal-chat-box" aria-label={`与 ${displayName} 的门前便签搭话`}>
      <div className="utopia-section-header">
        <strong>门前便签 · 仅显近况</strong>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {onOpenInZhiyu && (
            <Button
              type="button"
              tone="secondary"
              size="sm"
              disabled={handoffBusy || draftOverZhiyuLimit}
              title={draftOverZhiyuLimit ? `当前便签已达 ${draftCharCount} 字，超过织羽交接上限（${MAX_UTOPIA_ZHIYU_DRAFT_CHARS} 字）` : undefined}
              onClick={onOpenInZhiyu}
            >
              {handoffBusy ? '唤起织羽中…' : '去织羽深聊'}
            </Button>
          )}
          <Button tone="ghost" size="sm" onClick={onClose}>
            收回便签
          </Button>
        </div>
      </div>

      {(state?.error || sendError || deliveryError || sessionBroken) && (
        <InlineAlert tone="warning">
          <span>{sendError || deliveryError || state?.error || '正式对话通道未就绪，请重试连接。'}</span>
          {sessionBroken && (
            <Button
              type="button"
              tone="secondary"
              size="sm"
              onClick={() => setRetryNonce((n) => n + 1)}
            >
              重试连接
            </Button>
          )}
        </InlineAlert>
      )}

      <ol ref={listRef} className="utopia-chat-message-list" aria-live="polite">
        {(state?.messages.length ?? 0) === 0 ? (
          <li className="utopia-empty-hint">
            {state?.status === 'ready'
              ? '已递开门扉，留一句简短问候吧；长谈或语音图片可点「去织羽深聊」。'
              : sessionBroken
                ? '暂未连接便签通道，可点击上方「重试连接」。'
                : '正在连接门前便签通道…'}
          </li>
        ) : (
          state!.messages.slice(-3).map((msg) => (
            <li key={msg.id} className={`utopia-chat-msg is-${msg.role}`}>
              {msg.role !== 'user' && (
                <CompanionAvatar
                  displayName={displayName}
                  agentHandle={agentHandle}
                  avatarUrl={avatarUrl}
                  size="xs"
                />
              )}
              <div className="utopia-chat-bubble">
                <span className="utopia-chat-role">{msg.role === 'user' ? '你' : displayName}</span>
                <p>{msg.text}</p>
              </div>
            </li>
          ))
        )}
      </ol>

      <form onSubmit={handleSubmit} className="utopia-chat-form">
        <TextareaField
          id="utopia-formal-chat-input"
          aria-label={`发送给 ${displayName} 的消息`}
          rows={2}
          value={draftText}
          placeholder={`再给 ${displayName} 递一句简短话语…（长谈可点上方去织羽深聊）`}
          onKeyDown={handleKeyDown}
          onChange={(e) => onDraftTextChange(e.currentTarget.value)}
        />
        {draftOverZhiyuLimit && (
          <p className="utopia-causal-note" role="alert">
            当前草稿已达 {draftCharCount} 字，超过织羽交接上限（{MAX_UTOPIA_ZHIYU_DRAFT_CHARS} 字），请精简后再交接至织羽。
          </p>
        )}
        <div className="utopia-draft-actions">
          <span className="utopia-muted-caption">
            {statusFooterLabel}
          </span>
          <Button
            type="submit"
            tone="primary"
            size="sm"
            disabled={sending || !draftText.trim() || state?.status !== 'ready' || Boolean(state?.activeTurnId)}
          >
            {sending ? '发送中…' : '递句话'}
          </Button>
        </div>
      </form>
    </div>
  );
}

export type ChibiAppearanceUpdater =
  | ChibiAppearance
  | null
  | ((current: ChibiAppearance) => ChibiAppearance);

function ChibiWardrobeEditor(props: {
  readonly displayName: string;
  readonly appearance: ChibiAppearance;
  readonly isCustomized: boolean;
  readonly presenceTone?: CompanionPresenceTone;
  readonly onPatch: (patch: Partial<ChibiAppearance>) => void;
  readonly onReset: () => void;
}) {
  const {
    displayName,
    appearance,
    isCustomized,
    presenceTone,
    onPatch,
    onReset,
  } = props;

  return (
    <div className="utopia-wardrobe-editor" role="region" aria-label={`${displayName} 的洞天手绘小人装扮工坊`}>
      <div className="utopia-wardrobe-stage-row">
        <div className="utopia-wardrobe-pedestal" aria-hidden="true">
          <HandDrawnChibiActorFigure
            appearance={appearance}
            facing="right"
            presenceTone={presenceTone}
          />
          <span className="utopia-wardrobe-pedestal-disc" />
        </div>
        <div className="utopia-wardrobe-stage-copy">
          <strong>手绘小人装扮工坊</strong>
          <small>地图小人独立采用纯手绘形象，点选下方配饰与色彩实时同步到画卷。</small>
          {isCustomized && (
            <div className="utopia-wardrobe-stage-actions">
              <button
                type="button"
                className="utopia-wardrobe-action-btn"
                onClick={onReset}
              >
                恢复默认形象
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="utopia-wardrobe-field">
        <span className="utopia-wardrobe-label">头饰</span>
        <div className="utopia-wardrobe-pills" role="group" aria-label="手绘头饰选择">
          {CHIBI_HEADWEAR_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={appearance.headwear === opt.value}
              className={`utopia-wardrobe-pill ${appearance.headwear === opt.value ? 'is-active' : ''}`}
              onClick={() => onPatch({ headwear: opt.value })}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="utopia-wardrobe-field">
        <span className="utopia-wardrobe-label">发型</span>
        <div className="utopia-wardrobe-pills" role="group" aria-label="手绘发型选择">
          {CHIBI_HAIR_STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={appearance.hairStyle === opt.value}
              className={`utopia-wardrobe-pill ${appearance.hairStyle === opt.value ? 'is-active' : ''}`}
              onClick={() => onPatch({ hairStyle: opt.value })}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="utopia-wardrobe-field">
        <span className="utopia-wardrobe-label">神态</span>
        <div className="utopia-wardrobe-pills" role="group" aria-label="手绘神态选择">
          {CHIBI_EYE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={appearance.eyes === opt.value}
              className={`utopia-wardrobe-pill ${appearance.eyes === opt.value ? 'is-active' : ''}`}
              onClick={() => onPatch({ eyes: opt.value })}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="utopia-wardrobe-field">
        <span className="utopia-wardrobe-label">发色</span>
        <div className="utopia-wardrobe-swatches" role="group" aria-label="手绘发色选择">
          {CHIBI_HAIR_COLOR_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              title={`发色：${opt.label}`}
              aria-label={`发色：${opt.label}`}
              aria-pressed={appearance.hairColor === opt.value}
              className={`utopia-wardrobe-swatch ${appearance.hairColor === opt.value ? 'is-active' : ''}`}
              style={{ '--swatch-color': opt.fill } as CSSProperties}
              onClick={() => onPatch({ hairColor: opt.value })}
            />
          ))}
        </div>
      </div>

      <div className="utopia-wardrobe-field">
        <span className="utopia-wardrobe-label">面庞</span>
        <div className="utopia-wardrobe-swatches" role="group" aria-label="手绘面庞色选择">
          {CHIBI_SKIN_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              title={`面庞：${opt.label}`}
              aria-label={`面庞：${opt.label}`}
              aria-pressed={appearance.skinTone === opt.value}
              className={`utopia-wardrobe-swatch ${appearance.skinTone === opt.value ? 'is-active' : ''}`}
              style={{ '--swatch-color': opt.fill } as CSSProperties}
              onClick={() => onPatch({ skinTone: opt.value })}
            />
          ))}
        </div>
      </div>

      <div className="utopia-wardrobe-field">
        <span className="utopia-wardrobe-label">斗篷</span>
        <div className="utopia-wardrobe-swatches" role="group" aria-label="手绘斗篷色选择">
          {CHIBI_CLOAK_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              title={`斗篷：${opt.label}`}
              aria-label={`斗篷：${opt.label}`}
              aria-pressed={appearance.cloakColor === opt.value}
              className={`utopia-wardrobe-swatch ${appearance.cloakColor === opt.value ? 'is-active' : ''}`}
              style={{ '--swatch-color': opt.cape } as CSSProperties}
              onClick={() => onPatch({ cloakColor: opt.value })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ResidentDetailAndDraft(props: {
  readonly client: NimiLocalAppClient;
  readonly snapshot: NimiUtopiaSnapshot;
  readonly busy: boolean;
  readonly draftState: LocalChatDraftState | null;
  readonly avatarsByHandle?: Readonly<Record<string, string | null>>;
  readonly bindingsByHandle?: Readonly<Record<string, string>>;
  readonly chibiWardrobe?: ChibiWardrobeMap;
  readonly wardrobeReady?: boolean;
  readonly onUpdateChibiAppearance?: (agentHandle: string, updater: ChibiAppearanceUpdater) => void;
  readonly onDraftStateChange: Dispatch<SetStateAction<LocalChatDraftState | null>>;
  readonly onApplyIntent: (intent: NimiUtopiaUpdateIntent) => Promise<void>;
  readonly onOpenHomePartners?: () => void;
  readonly onOpenHomePartnerManagement?: (input: {
    readonly conversationAnchorId?: string | null;
    readonly displayName: string;
  }) => void;
  readonly onOpenPartnerInZhiyu?: (input: {
    readonly agentHandle: NimiUtopiaResident['agentHandle'];
    readonly mountedAnchorId?: string | null;
    readonly draftText?: string | null;
  }) => Promise<boolean> | void;
  readonly sessionFactory?: ConversationSessionFactory;
}) {
  const {
    client,
    snapshot,
    busy,
    draftState,
    avatarsByHandle,
    bindingsByHandle,
    chibiWardrobe,
    wardrobeReady = true,
    onUpdateChibiAppearance,
    onDraftStateChange,
    onApplyIntent,
    onOpenHomePartners,
    onOpenHomePartnerManagement,
    onOpenPartnerInZhiyu,
    sessionFactory,
  } = props;

  const [draftError, setDraftError] = useState<string | null>(null);
  const [mountedAnchorId, setMountedAnchorId] = useState<string | null>(null);
  const [zhiyuHandoffBusy, setZhiyuHandoffBusy] = useState(false);
  const [introMap, setIntroMap] = useState<Readonly<Record<string, CompanionIntroSummary | null>>>({});
  const [playingVoiceHandle, setPlayingVoiceHandle] = useState<string | null>(null);
  const [wardrobeOpen, setWardrobeOpen] = useState(false);
  const [fallbackWardrobe, setFallbackWardrobe] = useState<ChibiWardrobeMap>({});
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const introInflightRef = useRef<Set<string>>(new Set());

  const effectiveWardrobe = chibiWardrobe ?? fallbackWardrobe;

  const applyWardrobeChange = (handle: string, updater: ChibiAppearanceUpdater) => {
    if (!wardrobeReady) return;
    if (onUpdateChibiAppearance) {
      onUpdateChibiAppearance(handle, updater);
      return;
    }
    setFallbackWardrobe((prev) => {
      const copy: Record<string, ChibiAppearance> = { ...prev };
      if (updater === null) {
        delete copy[handle];
        const bKey = bindingsByHandle?.[handle];
        if (bKey) delete copy[bKey];
      } else if (typeof updater === 'function') {
        const key = bindingsByHandle?.[handle]?.trim() || handle;
        copy[key] = Object.freeze(updater(resolveChibiAppearance(handle, prev, bindingsByHandle)));
      } else {
        const key = bindingsByHandle?.[handle]?.trim() || handle;
        copy[key] = updater;
      }
      return Object.freeze(copy);
    });
  };

  const defaultFactory = useMemo<ConversationSessionFactory>(
    () => sessionFactory ?? (() => createAppConversationEntrySession({
      client,
      hostPort: createBrowserAppConversationHostPort(),
    })),
    [client, sessionFactory],
  );

  // Read-only agent introduction lookup (only runs when client exposes agents.getIntroduction)
  useEffect(() => {
    const handle = draftState?.agentHandle;
    if (!handle || handle in introMap || introInflightRef.current.has(handle)) return;
    if (!client || typeof client.agents?.getIntroduction !== 'function') return;

    let alive = true;
    introInflightRef.current.add(handle);
    void loadCompanionIntroduction(client, handle).then((summary) => {
      introInflightRef.current.delete(handle);
      if (alive) {
        setIntroMap((prev) => ({ ...prev, [handle]: summary }));
      }
    });
    return () => {
      alive = false;
    };
  }, [client, draftState?.agentHandle, introMap]);

  // Stop any voice sample preview if target changes or panel unmounts
  useEffect(() => {
    return () => {
      if (voiceAudioRef.current) {
        voiceAudioRef.current.pause();
        voiceAudioRef.current = null;
      }
    };
  }, []);

  const toggleVoicePreview = (handle: string, voiceUrl: string) => {
    if (playingVoiceHandle === handle && voiceAudioRef.current) {
      voiceAudioRef.current.pause();
      voiceAudioRef.current = null;
      setPlayingVoiceHandle(null);
      return;
    }
    if (voiceAudioRef.current) {
      voiceAudioRef.current.pause();
    }
    if (typeof globalThis.Audio !== 'function') return;
    const audio = new globalThis.Audio(voiceUrl);
    voiceAudioRef.current = audio;
    setPlayingVoiceHandle(handle);
    audio.onended = () => setPlayingVoiceHandle(null);
    audio.onerror = () => setPlayingVoiceHandle(null);
    void audio.play().catch(() => setPlayingVoiceHandle(null));
  };

  const handleOpenDraft = (resident: NimiUtopiaResident, prefill = '') => {
    setDraftError(null);
    onDraftStateChange(createZeroSideEffectDraftState(resident, prefill));
  };

  const handleMountFormal = (mode: 'expand-history' | 'send-now') => {
    if (!draftState) return;
    const outcome = activateFormalSessionFromDraft(draftState, mode, snapshot.residents);
    setDraftError(outcome.error);
    if (outcome.next !== draftState) {
      onDraftStateChange(outcome.next);
    }
  };

  const draftCharCount = draftState ? Array.from(draftState.text.trim()).length : 0;
  const draftOverZhiyuLimit = draftCharCount > MAX_UTOPIA_ZHIYU_DRAFT_CHARS;

  const handleOpenInZhiyu = () => {
    if (!draftState || !onOpenPartnerInZhiyu || zhiyuHandoffBusy) return;
    if (draftState.text.includes('\0')) {
      setDraftError('门前便签包含不受支持的控制字符，草稿已保留，请整理后再交接至织羽。');
      return;
    }
    if (draftOverZhiyuLimit) {
      setDraftError(`门前便签已达 ${draftCharCount} 字，超过织羽交接上限（${MAX_UTOPIA_ZHIYU_DRAFT_CHARS} 字），请精简后再交接。`);
      return;
    }
    setDraftError(null);
    setZhiyuHandoffBusy(true);
    const snapshotDraft = draftState;
    void Promise.resolve(
      onOpenPartnerInZhiyu({
        agentHandle: snapshotDraft.agentHandle,
        mountedAnchorId: snapshotDraft.sessionMounted ? mountedAnchorId : null,
        draftText: snapshotDraft.text,
      }),
    ).finally(() => {
      setZhiyuHandoffBusy(false);
    });
  };

  const focusedResident = draftState
    ? (snapshot.residents.find((r) => r.agentHandle === draftState.agentHandle) ?? null)
    : null;
  const focusedIntro = draftState ? (introMap[draftState.agentHandle] ?? null) : null;
  const focusedPresence = focusedResident ? resolveResidentPresence(focusedResident, snapshot) : null;
  const focusedActiveShared = focusedResident
    ? snapshot.sharedActivities.find(
        (act) => act.state === 'active'
          && (act.initiatorHandle === focusedResident.agentHandle || act.recipientHandle === focusedResident.agentHandle),
      )
    : undefined;
  const focusedPartnerName = focusedActiveShared && focusedResident
    ? snapshot.residents.find(
        (r) => r.agentHandle === (
          focusedActiveShared.initiatorHandle === focusedResident.agentHandle
            ? focusedActiveShared.recipientHandle
            : focusedActiveShared.initiatorHandle
        ),
      )?.displayName
    : undefined;
  const focusedNowText = focusedResident
    ? (focusedActiveShared
        ? `${focusedPartnerName ? `与${focusedPartnerName}一起` : ''}${focusedActiveShared.activityLabel} · ${focusedActiveShared.placeLabel}`
        : describeResidentFrame(focusedResident.current, snapshot.habitatActivationId))
    : null;
  const focusedChibi = draftState
    ? resolveChibiAppearance(draftState.agentHandle, effectiveWardrobe, bindingsByHandle)
    : null;
  const focusedChibiCustomized = draftState
    ? hasCustomChibiAppearance(draftState.agentHandle, effectiveWardrobe, bindingsByHandle)
    : false;
  const focusedLocalAgentAvatarUrl = draftState
    ? (avatarsByHandle?.[draftState.agentHandle] ?? focusedIntro?.referenceImageUrl ?? null)
    : null;

  const icebreakers = focusedResident && snapshot.habitat?.places
    ? buildContextualIcebreakers(focusedResident, snapshot)
    : [];

  return (
    <div className="utopia-side-stack">
      {draftError && (
        <InlineAlert tone="warning">
          {draftError}
        </InlineAlert>
      )}

      {draftState && (
        <section
          className="utopia-card-section is-highlighted utopia-spotlight-card"
          aria-label={`${draftState.displayName} 伙伴详情与搭话`}
        >
          {/* Canonical LocalAgent Identity & Portrait Avatar */}
          <div className="utopia-spotlight-hero">
            <div className="utopia-agent-portrait-wrap" title={`${draftState.displayName} 的 LocalAgent 头像`}>
              <CompanionAvatar
                displayName={draftState.displayName}
                agentHandle={draftState.agentHandle}
                avatarUrl={focusedLocalAgentAvatarUrl}
                size="lg"
                presenceTone={focusedPresence?.tone}
              />
              <span className="utopia-agent-portrait-tag">本相</span>
            </div>

            <div className="utopia-spotlight-meta">
              <div className="utopia-spotlight-name-row">
                <strong>{draftState.displayName}</strong>
                {focusedPresence && (
                  <span className={`utopia-presence-pill tone-${focusedPresence.tone}`}>
                    {focusedPresence.statusBadge}
                  </span>
                )}
              </div>
              {focusedIntro?.originLine && (
                <p className="utopia-spotlight-origin">{focusedIntro.originLine}</p>
              )}
              {focusedPresence && (
                <p className="utopia-spotlight-now">{focusedPresence.shortLocationOrState}</p>
              )}
            </div>

            <div className="utopia-spotlight-head-actions">
              {focusedIntro?.voiceUrl && (
                <button
                  type="button"
                  className={`utopia-voice-btn ${playingVoiceHandle === draftState.agentHandle ? 'is-playing' : ''}`}
                  onClick={() => toggleVoicePreview(draftState.agentHandle, focusedIntro.voiceUrl!)}
                  title="试听伙伴声线样本（不触发对话）"
                >
                  {playingVoiceHandle === draftState.agentHandle ? <PauseWaveIcon size={12} /> : <PlayWaveIcon size={12} />}
                  <span>{playingVoiceHandle === draftState.agentHandle ? '停止' : '声线'}</span>
                </button>
              )}
              {onOpenHomePartnerManagement && (
                <Button
                  tone="ghost"
                  size="sm"
                  aria-label={`在 Home 管理 ${draftState.displayName}`}
                  onClick={() => {
                    onOpenHomePartnerManagement({
                      conversationAnchorId: draftState.sessionMounted ? mountedAnchorId : null,
                      displayName: draftState.displayName,
                    });
                  }}
                >
                  在 Home 管理
                </Button>
              )}
              <Button tone="ghost" size="sm" onClick={() => onDraftStateChange(null)}>
                收起
              </Button>
            </div>
          </div>

          {/* Hand-Drawn Chibi Wardrobe Bar & Expandable Studio */}
          {focusedChibi && (
            <div className="utopia-chibi-studio-card">
              <div className="utopia-chibi-studio-bar">
                <div className="utopia-chibi-studio-ident">
                  <HandDrawnChibiMedallion
                    appearance={focusedChibi}
                    size="sm"
                    presenceTone={focusedPresence?.tone}
                  />
                  <div className="utopia-chibi-studio-copy">
                    <span className="utopia-chibi-studio-title">
                      洞天手绘小人
                      {focusedChibiCustomized && <em>已定制</em>}
                    </span>
                    <small>{describeChibiAppearanceSummary(focusedChibi)}</small>
                  </div>
                </div>
                <div className="utopia-chibi-studio-btns">
                  <button
                    type="button"
                    className="utopia-chibi-mini-btn"
                    disabled={!wardrobeReady}
                    title={!wardrobeReady ? '正在读取受管衣柜，请稍候…' : undefined}
                    aria-label={`随机更换 ${draftState.displayName} 的手绘小人形象`}
                    onClick={() => {
                      applyWardrobeChange(draftState.agentHandle, (cur) => randomizeChibiAppearance(cur));
                    }}
                  >
                    随机
                  </button>
                  <button
                    type="button"
                    disabled={!wardrobeReady}
                    title={!wardrobeReady ? '正在读取受管衣柜，请稍候…' : undefined}
                    aria-expanded={wardrobeReady && wardrobeOpen}
                    className={`utopia-chibi-mini-btn is-customize ${wardrobeReady && wardrobeOpen ? 'is-open' : ''}`}
                    onClick={() => setWardrobeOpen((o) => !o)}
                  >
                    {!wardrobeReady ? '读取衣柜中…' : (wardrobeOpen ? '完成定制' : '定制形象')}
                  </button>
                </div>
              </div>

              {wardrobeReady && wardrobeOpen && (
                <ChibiWardrobeEditor
                  displayName={draftState.displayName}
                  appearance={focusedChibi}
                  isCustomized={focusedChibiCustomized}
                  presenceTone={focusedPresence?.tone}
                  onPatch={(patch) => {
                    applyWardrobeChange(draftState.agentHandle, (cur) => Object.freeze({ ...cur, ...patch }));
                  }}
                  onReset={() => applyWardrobeChange(draftState.agentHandle, null)}
                />
              )}
            </div>
          )}

          {/* Focused Companion Live Rhythm & Solitude */}
          {focusedResident && focusedNowText && (
            <>
              <dl className="utopia-frame-dl">
                <div className="is-now">
                  <dt>现在</dt>
                  <dd>{focusedNowText}</dd>
                </div>
                <div>
                  <dt>刚刚</dt>
                  <dd>{describeResidentFrame(focusedResident.recent, snapshot.habitatActivationId)}</dd>
                </div>
                <div>
                  <dt>接下来</dt>
                  <dd>{describeResidentFrame(focusedResident.next, snapshot.habitatActivationId)}</dd>
                </div>
              </dl>

              <div className="utopia-solitude-row">
                <div className="utopia-solitude-copy">
                  <span className="utopia-solitude-label">安静独处</span>
                  <small>{describeSolitudeConsequence(focusedResident, snapshot)}</small>
                </div>
                <Toggle
                  checked={focusedResident.solitary}
                  disabled={busy}
                  ariaLabel={`设置 ${focusedResident.displayName} 安静独处`}
                  onValueChange={(checked) => {
                    void onApplyIntent({
                      kind: 'set-solitude',
                      agentHandle: focusedResident.agentHandle,
                      solitary: checked,
                    });
                  }}
                />
              </div>
            </>
          )}

          {/* Zero-Side-Effect Doorstep Postcard Draft + Handoff to Zhiyu */}
          {!draftState.sessionMounted ? (
            <div className="utopia-local-draft-box">
              <div className="utopia-section-header">
                <strong>给 {draftState.displayName} 留张门前便签</strong>
                <span className="utopia-muted-caption">递出前不打断活动</span>
              </div>

              {icebreakers.length > 0 && (
                <div className="utopia-icebreaker-row" role="group" aria-label="住地话题灵感">
                  {icebreakers.map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      className="utopia-icebreaker-chip"
                      onClick={() => {
                        onDraftStateChange((current) =>
                          current ? editZeroSideEffectDraftText(current, chip.prefill) : current,
                        );
                      }}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              )}

              <TextareaField
                id="utopia-zero-side-effect-draft"
                aria-label={`给 ${draftState.displayName} 的草稿内容`}
                rows={3}
                value={draftState.text}
                placeholder={`想对 ${draftState.displayName} 递句简短问候，或写好草稿带去织羽深聊…`}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && draftState.text.trim()) {
                    e.preventDefault();
                    handleMountFormal('send-now');
                  }
                }}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  onDraftStateChange((current) => (current ? editZeroSideEffectDraftText(current, value) : current));
                }}
              />
              {draftOverZhiyuLimit && (
                <p className="utopia-causal-note" role="alert">
                  当前草稿已达 {draftCharCount} 字，超过织羽交接上限（{MAX_UTOPIA_ZHIYU_DRAFT_CHARS} 字），请精简后再带去织羽。
                </p>
              )}
              <div className="utopia-draft-actions">
                {onOpenPartnerInZhiyu && (
                  <Button
                    type="button"
                    tone="secondary"
                    size="sm"
                    disabled={zhiyuHandoffBusy || draftOverZhiyuLimit}
                    title={draftOverZhiyuLimit ? `当前便签已达 ${draftCharCount} 字，超过织羽交接上限（${MAX_UTOPIA_ZHIYU_DRAFT_CHARS} 字）` : undefined}
                    onClick={handleOpenInZhiyu}
                  >
                    {zhiyuHandoffBusy ? '唤起织羽中…' : '去织羽深聊'}
                  </Button>
                )}
                <Button
                  type="button"
                  tone="primary"
                  size="sm"
                  disabled={!draftState.text.trim() || zhiyuHandoffBusy}
                  onClick={() => handleMountFormal('send-now')}
                >
                  递句话
                </Button>
              </div>
            </div>
          ) : (
            <LazyMountedFormalConversation
              key={draftState.agentHandle}
              agentHandle={draftState.agentHandle}
              displayName={draftState.displayName}
              avatarUrl={focusedLocalAgentAvatarUrl}
              draftText={draftState.text}
              sendOperation={draftState.sendOperation}
              deliveryError={draftState.sendError}
              handoffBusy={zhiyuHandoffBusy}
              draftOverZhiyuLimit={draftOverZhiyuLimit}
              draftCharCount={draftCharCount}
              onDraftTextChange={(next) => {
                onDraftStateChange((current) => (current ? editZeroSideEffectDraftText(current, next) : current));
              }}
              onDraftStateChange={onDraftStateChange}
              onConversationAnchorChange={setMountedAnchorId}
              onOpenInZhiyu={onOpenPartnerInZhiyu ? handleOpenInZhiyu : undefined}
              onClose={() => {
                setMountedAnchorId(null);
                onDraftStateChange((cur) => (cur ? Object.freeze({ ...cur, sessionMounted: false }) : cur));
              }}
              createSession={defaultFactory}
            />
          )}
        </section>
      )}

      <section className="utopia-card-section" aria-label="邻里串门总开关">
        <div className="utopia-switch-row">
          <div>
            <strong>街巷串门与相约小聚</strong>
            <p className="utopia-causal-note">
              {snapshot.publicParticipation
                ? '闲暇时伙伴们会去茶座、庭院散步，遇上合拍的兴致也会自然相约小聚。'
                : '关闭后大家各自享受清静时光，暂时不去街巷串门，手头的相约也会自然收尾。'}
            </p>
          </div>
          <Toggle
            checked={snapshot.publicParticipation}
            disabled={busy}
            ariaLabel="开启街巷串门与相约小聚"
            onValueChange={(checked) => {
              void onApplyIntent({ kind: 'set-public-participation', enabled: checked });
            }}
          />
        </div>
      </section>

      <section className="utopia-card-section" aria-labelledby="residents-list-heading">
        <div className="utopia-section-header">
          <h3 id="residents-list-heading">洞天居民</h3>
          <span className="utopia-muted-caption">{snapshot.residents.length} 位入住中</span>
        </div>

        {snapshot.residents.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
            <p className="utopia-empty-hint">
              在 Nimi Home「我的伙伴」中为伙伴开启自主生活后，他们会自动入住当前洞天。
            </p>
            {onOpenHomePartners && (
              <Button tone="secondary" size="sm" onClick={onOpenHomePartners}>
                前往 Home「我的伙伴」
              </Button>
            )}
          </div>
        ) : (
          <div className="utopia-resident-cards">
            {snapshot.residents.map((resident) => {
              const activeShared = snapshot.sharedActivities.find(
                (act) => act.state === 'active'
                  && (act.initiatorHandle === resident.agentHandle || act.recipientHandle === resident.agentHandle),
              );
              const partnerName = activeShared
                ? snapshot.residents.find(
                    (r) => r.agentHandle === (
                      activeShared.initiatorHandle === resident.agentHandle
                        ? activeShared.recipientHandle
                        : activeShared.initiatorHandle
                    ),
                  )?.displayName
                : undefined;
              const presence = resolveResidentPresence(resident, snapshot);
              const nowText = activeShared
                ? `${partnerName ? `与${partnerName}一起` : ''}${activeShared.activityLabel} · ${activeShared.placeLabel}`
                : describeResidentFrame(resident.current, snapshot.habitatActivationId);
              const isFocused = draftState?.agentHandle === resident.agentHandle;
              const chibi = resolveChibiAppearance(resident.agentHandle, effectiveWardrobe, bindingsByHandle);

              return (
                <article
                  key={resident.agentHandle}
                  className={`utopia-resident-card ${isFocused ? 'is-focused' : ''}`}
                >
                  <div className="utopia-resident-card-head">
                    <div className="utopia-resident-ident">
                      <CompanionAvatar
                        displayName={resident.displayName}
                        agentHandle={resident.agentHandle}
                        avatarUrl={avatarsByHandle?.[resident.agentHandle]}
                        size="md"
                        presenceTone={presence.tone}
                      />
                      <div className="utopia-resident-title-group">
                        <div className="utopia-resident-name-line">
                          <strong>{resident.displayName}</strong>
                          <HandDrawnChibiMedallion appearance={chibi} size="xs" />
                          {resident.solitary && <StatusBadge tone="neutral">独处中</StatusBadge>}
                          {resident.current?.interaction && <StatusBadge tone="success">对话或协作中</StatusBadge>}
                        </div>
                        {isFocused && <small className="utopia-resident-quick-now">{nowText}</small>}
                      </div>
                    </div>
                    <Button
                      type="button"
                      tone={isFocused ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => handleOpenDraft(resident, '')}
                    >
                      {isFocused ? '查看中' : '详情 · 搭话'}
                    </Button>
                  </div>

                  {!isFocused && (
                    <>
                      <dl className="utopia-frame-dl">
                        <div className="is-now">
                          <dt>现在</dt>
                          <dd>{nowText}</dd>
                        </div>
                        <div>
                          <dt>刚刚</dt>
                          <dd>{describeResidentFrame(resident.recent, snapshot.habitatActivationId)}</dd>
                        </div>
                        <div>
                          <dt>接下来</dt>
                          <dd>{describeResidentFrame(resident.next, snapshot.habitatActivationId)}</dd>
                        </div>
                      </dl>

                      <div className="utopia-solitude-row">
                        <div className="utopia-solitude-copy">
                          <span className="utopia-solitude-label">安静独处</span>
                          <small>{describeSolitudeConsequence(resident, snapshot)}</small>
                        </div>
                        <Toggle
                          checked={resident.solitary}
                          disabled={busy}
                          ariaLabel={`设置 ${resident.displayName} 安静独处`}
                          onValueChange={(checked) => {
                            void onApplyIntent({
                              kind: 'set-solitude',
                              agentHandle: resident.agentHandle,
                              solitary: checked,
                            });
                          }}
                        />
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
