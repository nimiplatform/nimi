import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { ChatGroupCreateModal } from './chat-group-create-modal';

const GROUP_CHATS_QUERY_KEY = ['group-chats'] as const;

export type ChatGroupCreateController = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  modal: ReactNode;
};

export function resolveCreatedGroupId(result: unknown): string {
  if (!result || typeof result !== 'object' || !('id' in result)) {
    throw new Error('chat-group-create:contract-violation:missing-id');
  }
  const rawId = (result as { id: unknown }).id;
  if (typeof rawId !== 'string') {
    throw new Error('chat-group-create:contract-violation:invalid-id');
  }
  const newId = rawId.trim();
  if (!newId) {
    throw new Error('chat-group-create:contract-violation:empty-id');
  }
  return newId;
}

export function useChatGroupCreateController(): ChatGroupCreateController {
  const queryClient = useQueryClient();
  const setChatMode = useAppStore((state) => state.setChatMode);
  const setSelectedTargetForSource = useAppStore((state) => state.setSelectedTargetForSource);
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleCreateGroup = useCallback(async (title: string, participantIds: string[]) => {
    const result = await dataSync.createGroup(title, participantIds);
    const newId = resolveCreatedGroupId(result);
    setChatMode('group');
    setSelectedTargetForSource('group', newId);
    void queryClient.invalidateQueries({ queryKey: GROUP_CHATS_QUERY_KEY });
    setIsOpen(false);
  }, [queryClient, setChatMode, setSelectedTargetForSource]);

  const modal = useMemo(
    () => (
      <ChatGroupCreateModal
        open={isOpen}
        onClose={close}
        onCreateGroup={handleCreateGroup}
      />
    ),
    [isOpen, close, handleCreateGroup],
  );

  return useMemo(
    () => ({ isOpen, open, close, modal }),
    [isOpen, open, close, modal],
  );
}
