import { useState } from 'react';

export function useCopyCommand(command: string, onError?: () => void) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopyStatus('copied');
    } catch {
      onError?.();
      setCopyStatus('error');
    }
  };

  return { copy, copyStatus };
}
