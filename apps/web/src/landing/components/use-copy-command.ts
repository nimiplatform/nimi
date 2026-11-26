import { useCallback, useEffect, useRef, useState } from 'react';

export type CopyFeedbackStatus = 'idle' | 'copied' | 'error';

export function useCopyFeedback(resetDelayMs = 2000) {
  const [status, setStatus] = useState<CopyFeedbackStatus>('idle');
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const copyText = useCallback(
    async (text: string, onError?: () => void) => {
      clearTimer();
      try {
        await navigator.clipboard.writeText(text);
        setStatus('copied');
        if (typeof window !== 'undefined' && resetDelayMs > 0) {
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            setStatus('idle');
          }, resetDelayMs);
        }
        return true;
      } catch {
        onError?.();
        setStatus('error');
        if (typeof window !== 'undefined' && resetDelayMs > 0) {
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            setStatus('idle');
          }, resetDelayMs * 2);
        }
        return false;
      }
    },
    [clearTimer, resetDelayMs],
  );

  return { copyText, status };
}

export function useCopyCommand(command: string, onError?: () => void) {
  const { copyText, status } = useCopyFeedback(2000);

  const copy = useCallback(() => copyText(command, onError), [command, copyText, onError]);

  return { copy, copyStatus: status };
}
