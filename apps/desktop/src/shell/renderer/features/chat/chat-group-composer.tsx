import { useMemo, useState } from 'react';
import { CanonicalComposer } from '@nimiplatform/kit/features/chat/components/canonical-composer';
import { useTranslation } from 'react-i18next';
import { CHAT_CONTENT_POSITION_CLASS, CHAT_CONTENT_WIDTH_CLASS } from './chat-shared-content-layout';

export function ChatGroupComposer(props: {
  selectedGroupId: string;
  onSendMessage: (content: string) => Promise<void>;
  isSending: boolean;
}) {
  const { selectedGroupId, onSendMessage, isSending } = props;
  const { t } = useTranslation();
  const [text, setText] = useState('');

  const submitAdapter = useMemo(() => ({
    submit: async (input: { text: string }) => {
      const trimmed = input.text.trim();
      if (!selectedGroupId || !trimmed || isSending) {
        return;
      }
      await onSendMessage(trimmed);
    },
  }), [isSending, onSendMessage, selectedGroupId]);

  return (
    <div
      className="relative shrink-0"
      data-chat-composer-layout="stacked"
      data-chat-group-composer-layout="stacked"
    >
      <CanonicalComposer
        adapter={submitAdapter}
        text={text}
        onTextChange={setText}
        disabled={!selectedGroupId || isSending}
        placeholder={t('TurnInput.typeMessage', { defaultValue: 'Type a message...' })}
        layout="stacked"
        widthClassName={CHAT_CONTENT_WIDTH_CLASS}
        widthPositionClassName={CHAT_CONTENT_POSITION_CLASS}
      />
    </div>
  );
}
