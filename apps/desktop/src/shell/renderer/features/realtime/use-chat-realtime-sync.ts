import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { rememberRealmChatSeenEvent } from '@nimiplatform/kit/features/chat/realm';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

export function rememberSeenEvent(seen: Map<string, number>, key: string): boolean {
  return rememberRealmChatSeenEvent(seen, key);
}

export function useChatRealtimeSync(): void {
  const queryClient = useQueryClient();
  const bindings = useDesktopRendererBindings();
  const authStatus = useAppStore((state) => state.auth.status);
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  useEffect(() => {
    if (authStatus !== 'authenticated') return undefined;
    return bindings.app.events.connectChatRealtimeSync({ queryClient, selectedChatId });
  }, [authStatus, bindings, queryClient, selectedChatId]);
}
