import { useHomeChatPosition } from '../../app-shell/providers/home-chat-position.js';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

export function useChatRealtimeSync(): void {
  const homeChat = useHomeChatPosition();
  const queryClient = useQueryClient();
  const bindings = useDesktopRendererBindings();
  const authStatus = useAppStore((state) => state.auth.status);
  const selectedChatId = homeChat.humanThreadId;
  useEffect(() => {
    if (authStatus !== 'authenticated') return undefined;
    return bindings.app.events.connectChatRealtimeSync({ queryClient, selectedChatId });
  }, [authStatus, bindings, queryClient, selectedChatId]);
}
