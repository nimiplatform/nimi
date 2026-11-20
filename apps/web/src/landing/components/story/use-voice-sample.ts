import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceSampleState = {
  playingUrl: string | null;
  failedUrl: string | null;
  toggle: (url: string) => void;
  stop: () => void;
};

/**
 * Lightweight browser-only audio preview hook for published character voice clips.
 * Safe during SSR static rendering (touches Audio only on user click / cleanup).
 */
export function useVoiceSample(): VoiceSampleState {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const stop = useCallback(() => {
    const node = audioRef.current;
    audioRef.current = null;
    if (node) {
      node.onended = null;
      node.onpause = null;
      node.onerror = null;
      node.pause();
      node.src = '';
    }
    setPlayingUrl(null);
  }, []);

  useEffect(() => stop, [stop]);

  const toggle = useCallback(
    (url: string) => {
      if (typeof Audio === 'undefined') return;
      if (playingUrl === url) {
        stop();
        return;
      }
      stop();
      setFailedUrl(null);
      const node = new Audio(url);
      audioRef.current = node;
      node.onended = () => {
        if (audioRef.current === node) {
          audioRef.current = null;
          setPlayingUrl(null);
        }
      };
      node.onerror = () => {
        if (audioRef.current === node) {
          audioRef.current = null;
          setPlayingUrl(null);
          setFailedUrl(url);
        }
      };
      setPlayingUrl(url);
      void node.play().catch(() => {
        if (audioRef.current === node) {
          audioRef.current = null;
          setPlayingUrl(null);
          setFailedUrl(url);
        }
      });
    },
    [playingUrl, stop],
  );

  return { playingUrl, failedUrl, toggle, stop };
}
