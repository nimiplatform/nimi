import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CanonicalDrawerSection,
} from '@nimiplatform/kit/features/chat/components/canonical-drawer-section';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat/headless';

export function useHumanVoiceUiState() {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingVoiceMessageId, setPlayingVoiceMessageId] = useState<string | null>(null);
  const [voiceTranscriptVisibleById, setVoiceTranscriptVisibleById] = useState<Record<string, boolean>>({});
  const [voiceContextMenu, setVoiceContextMenu] = useState<{ messageId: string; x: number; y: number } | null>(null);
  const [selectedVoiceMessageId, setSelectedVoiceMessageId] = useState<string | null>(null);

  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  useEffect(() => {
    if (!voiceContextMenu) {
      return undefined;
    }
    const handlePointerDown = () => {
      setVoiceContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setVoiceContextMenu(null);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [voiceContextMenu]);

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
    setVoiceContextMenu({
      messageId: message.id,
      x: event.clientX,
      y: event.clientY,
    });
  }, []);

  const toggleVoiceTranscript = useCallback((messageId: string) => {
    setVoiceTranscriptVisibleById((current) => ({
      ...current,
      [messageId]: !current[messageId],
    }));
    setVoiceContextMenu(null);
  }, []);

  const rightSidebarOverlayMenu: ReactNode = voiceContextMenu ? (
    <div
      className="fixed z-50 min-w-[160px] rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl"
      style={{ left: `${voiceContextMenu.x}px`, top: `${voiceContextMenu.y}px`, animation: 'panel-scale-in 0.15s ease-out both' }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-800 transition-colors hover:bg-gray-100"
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
          <div className="text-sm font-semibold text-slate-900">{senderName}</div>
          <div className="text-xs text-slate-500">
            {props.playing
              ? t('Chat.voiceInspectPlaying', { defaultValue: 'Currently playing' })
              : t('Chat.voiceInspectReady', { defaultValue: 'Ready to play' })}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => props.onPlay(props.message)}
            className="rounded-full bg-gradient-to-r from-emerald-400 to-teal-400 px-4 py-2 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(16,185,129,0.24)] transition hover:-translate-y-px"
          >
            {props.playing
              ? t('Chat.voiceInspectStop', { defaultValue: 'Stop playback' })
              : t('Chat.voiceInspectPlay', { defaultValue: 'Play voice' })}
          </button>
          <button
            type="button"
            onClick={() => props.onToggleTranscript(props.message.id)}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
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
          <p className="text-sm leading-6 text-slate-700">
            {transcript || t('Chat.voiceInspectTranscriptUnavailable', { defaultValue: 'No transcript available for this voice beat.' })}
          </p>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-3 py-4 text-center text-[11px] text-gray-500">
            {t('Chat.voiceInspectTranscriptHidden', { defaultValue: 'Transcript is hidden until you reveal it.' })}
          </div>
        )}
      </CanonicalDrawerSection>
    </div>
  );
}
