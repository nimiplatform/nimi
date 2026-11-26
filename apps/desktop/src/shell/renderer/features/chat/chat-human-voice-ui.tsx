import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CanonicalDrawerSection,
} from '@nimiplatform/kit/features/chat/components/canonical-drawer-section';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat/headless';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

export function useHumanVoiceUiState() {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [playingVoiceMessageId, setPlayingVoiceMessageId] = useState<string | null>(null);
  const [voiceTranscriptVisibleById, setVoiceTranscriptVisibleById] = useState<Record<string, boolean>>({});
  const [voiceContextMenu, setVoiceContextMenu] = useState<{ messageId: string; x: number; y: number } | null>(null);
  const [clampedMenuPos, setClampedMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedVoiceMessageId, setSelectedVoiceMessageId] = useState<string | null>(null);

  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  useLayoutEffect(() => {
    if (!voiceContextMenu) {
      setClampedMenuPos(null);
      return;
    }
    const margin = 8;
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 720;
    const rect = menuRef.current?.getBoundingClientRect();
    const width = rect?.width || 180;
    const height = rect?.height || 52;
    setClampedMenuPos({
      x: Math.max(margin, Math.min(voiceContextMenu.x, viewportWidth - width - margin)),
      y: Math.max(margin, Math.min(voiceContextMenu.y, viewportHeight - height - margin)),
    });
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [voiceContextMenu]);

  useEffect(() => {
    if (!voiceContextMenu) {
      return undefined;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) {
        return;
      }
      setVoiceContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setVoiceContextMenu(null);
      }
    };
    const unsubscribePointer = bindings.app.events.subscribeDocumentPointerDown(handlePointerDown);
    const unsubscribeKey = bindings.app.events.subscribeWindowKeyDown(handleKeyDown);
    return () => {
      unsubscribePointer();
      unsubscribeKey();
    };
  }, [bindings.app.events, voiceContextMenu]);

  const onPlayVoiceMessage = useCallback((message: ConversationCanonicalMessage) => {
    const metadata = (message.metadata as Record<string, unknown> | undefined) || {};
    const voiceUrl = String(metadata.voiceUrl || '').trim();
    if (!voiceUrl || typeof Audio === 'undefined') {
      return;
    }
    setSelectedVoiceMessageId(message.id);
    if (playingVoiceMessageId === message.id && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlayingVoiceMessageId(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(voiceUrl);
    audioRef.current = audio;
    audio.addEventListener('ended', () => {
      if (audioRef.current === audio) {
        setPlayingVoiceMessageId(null);
      }
    });
    audio.addEventListener('pause', () => {
      if (audioRef.current === audio && audio.ended === false) {
        setPlayingVoiceMessageId(null);
      }
    });
    audio.addEventListener('error', () => {
      if (audioRef.current === audio) {
        setPlayingVoiceMessageId(null);
      }
    });
    void audio.play().then(() => {
      setPlayingVoiceMessageId(message.id);
    }).catch(() => {
      if (audioRef.current === audio) {
        setPlayingVoiceMessageId(null);
      }
    });
  }, [playingVoiceMessageId]);

  const onVoiceContextMenu = useCallback((message: ConversationCanonicalMessage, event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedVoiceMessageId(message.id);
    const margin = 8;
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 720;
    setVoiceContextMenu({
      messageId: message.id,
      x: Math.max(margin, Math.min(event.clientX, viewportWidth - 180 - margin)),
      y: Math.max(margin, Math.min(event.clientY, viewportHeight - 52 - margin)),
    });
  }, []);

  const toggleVoiceTranscript = useCallback((messageId: string) => {
    setVoiceTranscriptVisibleById((current) => ({
      ...current,
      [messageId]: !current[messageId],
    }));
    setVoiceContextMenu(null);
  }, []);

  const menuPos = clampedMenuPos ?? (voiceContextMenu ? { x: voiceContextMenu.x, y: voiceContextMenu.y } : null);
  const rightSidebarOverlayMenu: ReactNode = voiceContextMenu && menuPos ? (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t('Chat.voiceInspectTitle', { defaultValue: 'Voice inspect' })}
      className="fixed z-50 min-w-[160px] rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] p-1.5 shadow-xl"
      style={{ left: `${menuPos.x}px`, top: `${menuPos.y}px` }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setVoiceContextMenu(null);
        }
      }}
    >
      <button
        type="button"
        role="menuitem"
        className="w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--nimi-text-secondary)] transition-[background-color,transform] hover:bg-[var(--nimi-action-ghost-hover)] active:scale-[0.98] motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)] focus-visible:ring-offset-1"
        onClick={() => toggleVoiceTranscript(voiceContextMenu.messageId)}
      >
        {voiceTranscriptVisibleById[voiceContextMenu.messageId]
          ? t('Chat.voiceCollapseTranscript', { defaultValue: 'Collapse transcript' })
          : t('Chat.voiceTranscribe', { defaultValue: 'Transcribe voice' })}
      </button>
    </div>
  ) : null;

  return {
    playingVoiceMessageId,
    selectedVoiceMessageId,
    isVoiceTranscriptVisible: (message: ConversationCanonicalMessage) => Boolean(voiceTranscriptVisibleById[message.id]),
    onPlayVoiceMessage,
    onVoiceContextMenu,
    toggleVoiceTranscript,
    rightSidebarOverlayMenu,
  };
}

export type HumanVoiceUiState = ReturnType<typeof useHumanVoiceUiState>;

export function HumanVoiceInspectSidebar(props: {
  message: ConversationCanonicalMessage;
  playing: boolean;
  transcriptVisible: boolean;
  onPlay: (message: ConversationCanonicalMessage) => void;
  onToggleTranscript: (messageId: string) => void;
}) {
  const { t } = useTranslation();
  const metadata = (props.message.metadata as Record<string, unknown> | undefined) || {};
  const transcript = String(metadata.voiceTranscript || props.message.text || '').trim();
  const senderName = String(props.message.senderName || t('Chat.voiceInspectSender', { defaultValue: 'Voice message' })).trim();

  return (
    <div className="space-y-4">
      <CanonicalDrawerSection
        title={t('Chat.voiceInspectTitle', { defaultValue: 'Voice inspect' })}
        hint={t('Chat.voiceInspectHint', { defaultValue: 'Playback and transcript controls for the selected voice beat.' })}
      >
        <div className="space-y-2">
          <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">{senderName}</div>
          <div className="text-xs text-[var(--nimi-text-muted)]">
            {props.playing
              ? t('Chat.voiceInspectPlaying', { defaultValue: 'Currently playing' })
              : t('Chat.voiceInspectReady', { defaultValue: 'Ready to play' })}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => props.onPlay(props.message)}
            className="rounded-full bg-[var(--nimi-action-primary-bg)] px-4 py-2 text-sm font-semibold text-[var(--nimi-action-primary-text)] shadow-[0_12px_30px_color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,transparent)] transition-[transform,opacity] hover:-translate-y-px active:scale-[0.97] motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)] focus-visible:ring-offset-1"
          >
            {props.playing
              ? t('Chat.voiceInspectStop', { defaultValue: 'Stop playback' })
              : t('Chat.voiceInspectPlay', { defaultValue: 'Play voice' })}
          </button>
          <button
            type="button"
            onClick={() => props.onToggleTranscript(props.message.id)}
            className="rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 py-2 text-sm font-semibold text-[var(--nimi-text-secondary)] transition-[background-color,transform] hover:bg-[var(--nimi-action-ghost-hover)] active:scale-[0.97] motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)] focus-visible:ring-offset-1"
          >
            {props.transcriptVisible
              ? t('Chat.voiceCollapseTranscript', { defaultValue: 'Collapse transcript' })
              : t('Chat.voiceTranscribe', { defaultValue: 'Transcribe voice' })}
          </button>
        </div>
      </CanonicalDrawerSection>

      <CanonicalDrawerSection
        title={t('Chat.voiceInspectTranscriptTitle', { defaultValue: 'Transcript' })}
        hint={t('Chat.voiceInspectTranscriptHint', { defaultValue: 'Voice transcripts stay hidden until you explicitly reveal them.' })}
      >
        {props.transcriptVisible ? (
          <p className="text-sm leading-6 text-[var(--nimi-text-secondary)]">
            {transcript || t('Chat.voiceInspectTranscriptUnavailable', { defaultValue: 'No transcript available for this voice beat.' })}
          </p>
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_60%,transparent)] px-3 py-4 text-center text-[11px] text-[var(--nimi-text-muted)]">
            {t('Chat.voiceInspectTranscriptHidden', { defaultValue: 'Transcript is hidden until you reveal it.' })}
          </div>
        )}
      </CanonicalDrawerSection>
    </div>
  );
}
