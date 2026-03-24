// Message input — polished input area per design.md §6
// Shared nimi-kit ChatComposer shell with relay-specific copy and toolbar

import { useTranslation } from 'react-i18next';
import { ChatComposer } from '@nimiplatform/nimi-kit/features/chat/ui';

interface MessageInputProps {
  onSend: (text: string) => Promise<void> | void;
  disabled?: boolean;
  placeholder?: string;
  modelName?: string;
  toolbar?: React.ReactNode;
}

export function MessageInput({ onSend, disabled, placeholder, modelName, toolbar }: MessageInputProps) {
  const { t } = useTranslation();

  return (
    <div className="px-6 pb-4 pt-2">
      <ChatComposer
        adapter={{
          submit: async ({ text }) => {
            await onSend(text);
          },
        }}
        disabled={disabled}
        placeholder={placeholder || t('chat.typeMessage')}
        toolbar={toolbar}
        modelLabel={modelName ? <span className="text-text-placeholder">{modelName}</span> : null}
        sendHint={t('chat.enterToSend')}
        sendLabel={t('chat.send', { defaultValue: 'Send' })}
      />
    </div>
  );
}
