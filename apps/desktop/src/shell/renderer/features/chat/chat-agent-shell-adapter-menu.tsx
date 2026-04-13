import {
  type ReactElement,
  useCallback,
  useEffect,
  type MouseEvent,
  useRef,
  useState,
} from 'react';
import type { ConversationCanonicalMessage } from '@nimiplatform/nimi-kit/features/chat/headless';
import type { TFunction } from 'i18next';
import { shouldDismissFloatingMenu } from './chat-floating-menu';

type UseAgentConversationMessageMenuInput = {
  onDeleteMessage: (messageId: string) => void;
  submittingThreadId: string | null;
  t: TFunction;
};

export function useAgentConversationMessageMenu(
  input: UseAgentConversationMessageMenuInput,
): {
  auxiliaryOverlayContent: ReactElement | null;
  clearMessageContextMenu: () => void;
  onMessageContextMenu: (
    message: ConversationCanonicalMessage,
    event: MouseEvent<HTMLDivElement>,
  ) => void;
} {
  const [messageContextMenu, setMessageContextMenu] = useState<{
    messageId: string;
    x: number;
    y: number;
  } | null>(null);
  const messageContextMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!messageContextMenu) {
      return undefined;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!shouldDismissFloatingMenu({
        container: messageContextMenuRef.current,
        target: event.target,
      })) {
        return;
      }
      setMessageContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMessageContextMenu(null);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [messageContextMenu]);

  const clearMessageContextMenu = useCallback(() => {
    setMessageContextMenu(null);
  }, []);

  const onMessageContextMenu = useCallback((
    message: ConversationCanonicalMessage,
    event: MouseEvent<HTMLDivElement>,
  ) => {
    if (Boolean(input.submittingThreadId) || message.status === 'pending') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setMessageContextMenu({
      messageId: message.id,
      x: event.clientX,
      y: event.clientY,
    });
  }, [input.submittingThreadId]);

  const handleDeleteMessageFromMenu = useCallback(() => {
    if (!messageContextMenu) {
      return;
    }
    const { messageId } = messageContextMenu;
    setMessageContextMenu(null);
    input.onDeleteMessage(messageId);
  }, [input, messageContextMenu]);

  const auxiliaryOverlayContent = messageContextMenu ? (
    <div
      ref={messageContextMenuRef}
      className="fixed z-50 min-w-[160px] rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl"
      style={{ left: `${messageContextMenu.x}px`, top: `${messageContextMenu.y}px`, animation: 'panel-scale-in 0.15s ease-out both' }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50"
        onClick={handleDeleteMessageFromMenu}
      >
        {input.t('Chat.deleteMessage', { defaultValue: 'Delete' })}
      </button>
    </div>
  ) : null;

  return {
    auxiliaryOverlayContent,
    clearMessageContextMenu,
    onMessageContextMenu,
  };
}
