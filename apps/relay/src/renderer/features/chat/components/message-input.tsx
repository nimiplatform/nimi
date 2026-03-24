// Message input — polished input area per design.md §6
// Auto-resize textarea, circular send button, toolbar

import { useState, useCallback, useRef, type KeyboardEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, Paperclip } from 'lucide-react';
import { IconButton, Surface, TextareaField } from '@nimiplatform/nimi-kit/ui';

interface MessageInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  modelName?: string;
  toolbar?: React.ReactNode;
}

export function MessageInput({ onSend, disabled, placeholder, modelName, toolbar }: MessageInputProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, disabled, onSend]);

  const handleSubmit = useCallback((e: FormEvent) => {
    e.preventDefault();
    submit();
  }, [submit]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }, [submit]);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, []);

  const canSend = !!text.trim() && !disabled;

  return (
    <div className="px-6 pb-4 pt-2">
      <Surface
        as="form"
        tone="panel"
        padding="none"
        onSubmit={handleSubmit}
        className="rounded-2xl border-[color:var(--nimi-border-subtle)] focus-within:border-[color:var(--nimi-field-focus)]"
      >
        <div className="flex items-end gap-2 px-4 py-3">
          <IconButton
            type="button"
            tone="ghost"
            icon={<Paperclip size={18} />}
            className="mb-0.5 h-8 w-8 text-text-secondary hover:text-text-primary"
            aria-label={t('chat.attach', { defaultValue: 'Attach' })}
          />

          <TextareaField
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            disabled={disabled}
            placeholder={placeholder || t('chat.typeMessage')}
            rows={1}
            tone="quiet"
            className="flex-1 min-h-0 border-0 bg-transparent px-0 py-0"
            textareaClassName="min-h-6 max-h-[200px] resize-none text-[15px] leading-6 text-text-primary placeholder:text-text-placeholder"
          />

          <IconButton
            type="submit"
            disabled={!canSend}
            tone={canSend ? 'primary' : 'secondary'}
            icon={<ArrowUp size={18} />}
            className="mb-0.5 h-9 w-9 rounded-full"
            aria-label={t('chat.send', { defaultValue: 'Send' })}
          />
        </div>

        <div className="flex items-center gap-3 px-4 pb-2.5 pt-0">
          {toolbar}
          {modelName && (
            <span className="text-[11px] text-text-placeholder ml-auto">{modelName}</span>
          )}
          <span className="text-[11px] text-text-placeholder">
            {t('chat.enterToSend')}
          </span>
        </div>
      </Surface>
    </div>
  );
}
