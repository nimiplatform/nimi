import type { Notification } from 'electron';

// @nimi-authority: rule.nimi.desktop.product-surfaces.human-chat-notice
export function createHumanChatNoticeRegistry() {
  const notices = new Set<Notification>();
  return {
    retain(notice: Notification) {
      notices.add(notice);
      const release = () => notices.delete(notice);
      notice.on('close', details => {
        // A timed-out Windows banner remains clickable in Action Center.
        if (details.reason !== 'timedOut') release();
      });
      notice.once('failed', release);
      notice.once('click', release);
    },
    clear() {
      for (const notice of notices) notice.close();
      notices.clear();
    },
  };
}
