import type { Notification } from 'electron';

// @nimi-authority: rule.nimi.desktop.product-surfaces.human-chat-notice
export function createHumanChatNoticeRegistry() {
  const notices = new Map<Notification, string>();
  return {
    retain(notice: Notification, target = '') {
      notices.set(notice, target);
      const release = () => notices.delete(notice);
      notice.on('close', details => {
        // A timed-out Windows banner remains clickable in Action Center.
        if (details.reason !== 'timedOut') release();
      });
      notice.once('failed', release);
      notice.once('click', release);
    },
    hasTarget(target: string) {
      return [...notices.values()].includes(target);
    },
    closeTarget(target: string) {
      for (const [notice, key] of notices) if (key === target) notice.close();
    },
    clear() {
      for (const notice of notices.keys()) notice.close();
      notices.clear();
    },
  };
}
