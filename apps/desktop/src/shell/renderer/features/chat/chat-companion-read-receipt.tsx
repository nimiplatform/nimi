import type { NimiAppActivityRecord } from '@nimiplatform/sdk/app';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { useHomeAppActivity } from '../system-entry/system-entry-context.js';
import { ConversationReadMarker } from '@nimiplatform/kit/features/chat/ui';

// @nimi-authority: rule.nimi.desktop.shell-ui.chat-sides
export function ChatCompanionReadReceipt({ reply }: { reply: NimiAppActivityRecord }) {
  const { t } = useTranslation();
  const { busy, notices, markRead } = useHomeAppActivity();
  const notice = notices[reply.activityId];
  return (
    <>
      <ConversationReadMarker value={reply} onVisible={markRead} />
      {notice?.tone === 'warning' ? (
        <InlineAlert tone="warning" action={
          <Button size="sm" tone="ghost" disabled={Boolean(busy[reply.activityId])} onClick={() => markRead(reply)}>
            {t('Chat.retryReadReceipt')}
          </Button>
        }>
          {notice.text}
        </InlineAlert>
      ) : null}
    </>
  );
}
