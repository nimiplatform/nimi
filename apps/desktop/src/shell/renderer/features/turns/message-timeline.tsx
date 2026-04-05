import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ChatComposerResizeHandle,
  ChatComposerShell,
  ChatPanelState,
} from '@nimiplatform/nimi-kit/features/chat/ui';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import nimiLogo from '@renderer/assets/logo-gray.png';
import type { HumanChatViewDto } from '@renderer/features/chat/chat-human-thread-model';
import {
  HumanCanonicalComposer,
  HumanCanonicalProfileDrawer,
  HumanCanonicalTranscriptSurface,
} from '@renderer/features/chat/chat-human-canonical-components';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { HumanConversationGiftModal } from './human-conversation-gift-modal';

export function MessageTimeline() {
  const { t } = useTranslation();
  const COMPOSER_MIN_HEIGHT = 132;
  const COMPOSER_MAX_HEIGHT = 340;
  const [composerHeight, setComposerHeight] = useState(176);
  const [giftModalOpen, setGiftModalOpen] = useState(false);
  const timelineLayoutRef = useRef<HTMLDivElement>(null);
  const composerResizingRef = useRef(false);
  const authStatus = useAppStore((state) => state.auth.status);
  const selectedChatId = useAppStore((state) => state.selectedChatId);
  const profilePanelTarget = useAppStore((state) => state.chatProfilePanelTarget);
  const setProfilePanelTarget = useAppStore((state) => state.setChatProfilePanelTarget);

  const chatsQuery = useQuery({
    queryKey: ['chats', authStatus],
    queryFn: async () => dataSync.loadChats(),
    enabled: authStatus === 'authenticated',
  });

  const selectedChat = useMemo(() => {
    const chats = (chatsQuery.data as { items?: HumanChatViewDto[] } | undefined)?.items || [];
    return chats.find((chat) => String(chat.id || '') === String(selectedChatId)) || null;
  }, [chatsQuery.data, selectedChatId]);

  useEffect(() => {
    setProfilePanelTarget(null);
    setGiftModalOpen(false);
  }, [selectedChatId, setProfilePanelTarget]);

  useEffect(() => {
    const onMouseMove = (event: globalThis.MouseEvent) => {
      if (!composerResizingRef.current || !timelineLayoutRef.current) {
        return;
      }
      const rect = timelineLayoutRef.current.getBoundingClientRect();
      const nextHeight = Math.min(
        COMPOSER_MAX_HEIGHT,
        Math.max(COMPOSER_MIN_HEIGHT, Math.round(rect.bottom - event.clientY)),
      );
      setComposerHeight(nextHeight);
    };

    const onMouseUp = () => {
      composerResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const startComposerResize = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    composerResizingRef.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  if (!selectedChatId) {
    return (
      <ChatPanelState
        data-testid={E2E_IDS.messageTimeline}
        activeChatId=""
        className="bg-white text-inherit"
      >
        <img
          src={nimiLogo}
          alt="Nimi"
          className="h-64 w-64 object-contain select-none pointer-events-none"
          draggable={false}
        />
      </ChatPanelState>
    );
  }

  return (
    <section
      data-testid={E2E_IDS.messageTimeline}
      data-active-chat-id={selectedChatId}
      className="flex h-full min-w-0"
    >
      <div ref={timelineLayoutRef} className="flex min-w-0 flex-1 flex-col">
        <ScrollArea
          className="flex-1 bg-white"
          viewportClassName="bg-white"
          contentClassName="px-4 py-4"
        >
          <HumanCanonicalTranscriptSurface
            selectedChatId={selectedChatId}
            selectedChat={selectedChat}
          />
        </ScrollArea>

        <ChatComposerResizeHandle
          ariaLabel={t('ChatTimeline.resizeInputArea')}
          onMouseDown={startComposerResize}
          className="bg-white"
        />

        <ChatComposerShell height={composerHeight}>
          <HumanCanonicalComposer selectedChatId={selectedChatId} />
        </ChatComposerShell>
      </div>

      {profilePanelTarget ? (
        <aside className="flex h-full w-80 shrink-0 flex-col border-l border-gray-200 bg-white">
          <HumanCanonicalProfileDrawer
            selectedChat={selectedChat}
            onOpenGift={selectedChat?.otherUser?.id ? () => setGiftModalOpen(true) : undefined}
          />
        </aside>
      ) : null}

      <HumanConversationGiftModal
        open={giftModalOpen}
        selectedChat={selectedChat}
        onClose={() => setGiftModalOpen(false)}
      />
    </section>
  );
}
