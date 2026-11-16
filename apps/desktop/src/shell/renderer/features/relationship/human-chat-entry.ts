import type { NimiNavigationResult } from '@nimiplatform/kit/core/navigation';
import type { HomeNavigation } from '../../app-shell/providers/home-navigation.js';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast.js';

export function reportHumanChatOpenResult(result: NimiNavigationResult, translate: (key: string) => string): void {
  if (result.status === 'committed' || result.status === 'unchanged' || result.status === 'invalidated' || result.status === 'disposed') return;
  emitFeedbackToast({ kind: 'warning', message: translate(result.status === 'cancelled'
    ? 'Notifications.chatOpenCancelled' : 'Notifications.chatOpenBlocked') });
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.human-chat-notice
export async function openHumanChatNotice(input: {
  navigation: HomeNavigation;
  chatId: string | null;
  isCurrent: () => boolean;
  focus: () => Promise<void>;
  report: (result: NimiNavigationResult) => void;
}) {
  if (!input.isCurrent()) return;
  const destination = input.navigation.getSnapshot().current.destination;
  if (input.chatId && destination.id === 'friends' && destination.chat?.threadId === input.chatId) {
    await input.focus();
    return;
  }
  // An editor's leave dialog needs to be visible. A human thread must first
  // leave the old Chat before focus can cause its read marker to acknowledge.
  if (input.navigation.getSnapshot().current.destination.id === 'settings') await input.focus();
  if (!input.isCurrent()) return;
  const result = await input.navigation.push(input.chatId
    ? { id: 'friends', chat: { mode: 'human', threadId: input.chatId } }
    : { id: 'friends' });
  if (!input.isCurrent()) return;
  input.report(result);
  if (result.status === 'committed' || result.status === 'unchanged'
    || input.navigation.getSnapshot().current.destination.id !== 'friends') await input.focus();
}
