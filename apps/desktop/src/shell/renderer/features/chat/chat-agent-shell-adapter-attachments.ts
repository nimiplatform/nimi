import { useCallback, useEffect, useRef, useState } from 'react';
import { clearPendingAttachments, type PendingAttachment } from '../turns/turn-input-attachments';

export function useAgentConversationPendingAttachments(activeThreadId: string | null) {
  const [pendingAttachmentsByThreadId, setPendingAttachmentsByThreadId] = useState<Record<string, readonly PendingAttachment[]>>({});
  const pendingAttachmentsByThreadRef = useRef<Record<string, readonly PendingAttachment[]>>({});

  useEffect(() => {
    pendingAttachmentsByThreadRef.current = pendingAttachmentsByThreadId;
  }, [pendingAttachmentsByThreadId]);

  useEffect(() => () => {
    for (const attachments of Object.values(pendingAttachmentsByThreadRef.current)) {
      clearPendingAttachments([...attachments], (url) => URL.revokeObjectURL(url));
    }
  }, []);

  const activePendingAttachments = activeThreadId
    ? (pendingAttachmentsByThreadId[activeThreadId] || [])
    : [];

  const setPendingAttachmentsForThread = useCallback((threadId: string | null, nextAttachments: readonly PendingAttachment[]) => {
    const normalizedThreadId = typeof threadId === 'string' ? threadId.trim() : '';
    if (!normalizedThreadId) {
      return;
    }
    setPendingAttachmentsByThreadId((current) => {
      const existing = current[normalizedThreadId] || [];
      const nextUrlSet = new Set(nextAttachments.map((attachment) => attachment.previewUrl));
      for (const attachment of existing) {
        if (!nextUrlSet.has(attachment.previewUrl)) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      }
      if (nextAttachments.length === 0) {
        if (!(normalizedThreadId in current)) {
          return current;
        }
        const { [normalizedThreadId]: _removed, ...rest } = current;
        return rest;
      }
      return {
        ...current,
        [normalizedThreadId]: [...nextAttachments],
      };
    });
  }, []);

  return {
    activePendingAttachments,
    setPendingAttachmentsForThread,
  };
}
