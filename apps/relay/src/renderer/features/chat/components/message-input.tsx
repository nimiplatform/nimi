// Message input — polished input area per design.md §6
// Shared nimi-kit ChatComposer shell with relay-specific copy and toolbar

import { useTranslation } from 'react-i18next';
import { Surface } from '@nimiplatform/nimi-kit/ui';
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
    <Surface
      as="div"
      tone="canvas"
      padding="none"
      className="border-transparent bg-transparent px-6 pb-4 pt-2 shadow-none"
    >
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
    </Surface>
  );
}
