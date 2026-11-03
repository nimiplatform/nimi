import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat/types';
import type {
  LocalAppConversationPlayback,
  LocalAppPlaybackState,
} from '@nimiplatform/kit/features/chat/runtime';

const idle: LocalAppPlaybackState = {
  status: 'idle',
  phase: null,
  message: null,
  messageId: null,
  artifactId: null,
  position: 0,
  duration: 0,
  realtimeBlocked: false,
  sourceVisible: false,
  error: null,
};

/** Real browser playback for the demo's prerecorded clips; no speech-generation success is simulated. */
export function useDemoZhiyuPlayback(
  scope: string | null,
  onUnavailable: () => void,
): LocalAppConversationPlayback {
  const [state, setState] = useState<LocalAppPlaybackState>(idle);
  const audio = useRef<HTMLAudioElement | null>(null);
  const current = useRef(state);
  current.current = state;
  const release = useCallback(() => {
    const node = audio.current;
    audio.current = null;
    if (node) {
      node.onplay =
        node.onpause =
        node.onended =
        node.onerror =
        node.ontimeupdate =
        node.onloadedmetadata =
          null;
      node.pause();
      node.src = '';
    }
  }, []);
  const stop = useCallback(() => {
    release();
    setState(idle);
  }, [release]);
  useEffect(() => {
    stop();
    return release;
  }, [scope, stop, release]);
  const play = useCallback(
    async (message: ConversationCanonicalMessage) => {
      const url = message.metadata?.voiceUrl;
      if (typeof url !== 'string' || !url) {
        onUnavailable();
        return;
      }
      release();
      const node = new Audio(url);
      audio.current = node;
      setState({ ...idle, status: 'preparing', phase: 'play', message, messageId: message.id });
      const update = (patch: Partial<LocalAppPlaybackState>) => {
        if (audio.current === node) setState((previous) => ({ ...previous, ...patch }));
      };
      node.onplay = () => update({ status: 'playing' });
      node.onpause = () => update({ status: 'paused' });
      node.onended = stop;
      node.onerror = () => update({ status: 'error', error: new Error('Demo audio could not be played.') });
      node.ontimeupdate = node.onloadedmetadata = () =>
        update({ position: node.currentTime, duration: Number.isFinite(node.duration) ? node.duration : 0 });
      try {
        await node.play();
      } catch (error) {
        update({ status: 'error', error });
      }
    },
    [release, stop, onUnavailable],
  );
  const pause = useCallback(() => audio.current?.pause(), []);
  const resume = useCallback(async () => {
    try {
      await audio.current?.play();
    } catch (error) {
      setState((previous) => ({ ...previous, status: 'error', error }));
    }
  }, []);
  const seek = useCallback((seconds: number) => {
    if (audio.current) audio.current.currentTime = seconds;
  }, []);
  const setSourceVisible = useCallback(
    (sourceVisible: boolean) =>
      setState((previous) =>
        previous.sourceVisible === sourceVisible ? previous : { ...previous, sourceVisible },
      ),
    [],
  );
  const retry = useCallback(async () => {
    if (current.current.message) await play(current.current.message);
  }, [play]);
  return {
    state,
    play,
    pause,
    resume,
    seek,
    stop,
    retry,
    refresh: retry,
    continueRequest: retry,
    setSourceVisible,
  };
}
