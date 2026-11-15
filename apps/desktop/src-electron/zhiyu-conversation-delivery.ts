import { randomUUID } from 'node:crypto';
import type { ZhiyuConversationOpenRequest, ZhiyuConversationOpenTarget } from '../../zhiyu/src/shell/app/conversation-open.js';

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.conversation-open
// One explicit navigation request. No retries, business replay or durable host state.
export function createZhiyuConversationDelivery(emit: () => void) {
  let pending: { request: ZhiyuConversationOpenRequest; finish(opened: boolean): void } | null = null;
  return {
    read: () => pending?.request ?? null,
    deliver(target: ZhiyuConversationOpenTarget): Promise<void> {
      pending?.finish(false);
      return new Promise((resolve, reject) => {
        const request = { ...target, requestId: `conversation-open-${randomUUID()}` };
        const timer = setTimeout(() => entry.finish(false), 30_000);
        const entry = { request, finish(opened: boolean) {
          if (pending !== entry) return;
          clearTimeout(timer); pending = null; emit();
          if (opened) resolve(); else reject(new Error('Zhiyu did not reach the requested conversation.'));
        } };
        pending = entry;
        emit();
      });
    },
    acknowledge(value: unknown) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const row = value as Record<string, unknown>;
      if (Object.keys(row).some(key => !['requestId', 'status'].includes(key)) || row.requestId !== pending?.request.requestId) return;
      if (row.status === 'opened' || row.status === 'failed') pending?.finish(row.status === 'opened');
    },
    close() { pending?.finish(false); },
  };
}
