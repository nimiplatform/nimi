import type { InvokeRequest } from '../types';

export function sleep(ms: number, signal?: AbortSignal) {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    if (!signal) {
      return;
    }

    const onAbort = () => {
      clearTimeout(timeout);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function recoverMessagesForOverflow(messages: InvokeRequest['messages']) {
  if (messages.length <= 3) {
    return messages;
  }

  const system = messages.filter((message) => String(message.role).toLowerCase() === 'system').slice(0, 1);
  const tail = messages.slice(-2);
  return [...system, ...tail];
}

export function buildRecoveryAction(before: number, after: number) {
  if (before === after) {
    return undefined;
  }
  return `context_compacted:${after}/${before}`;
}
