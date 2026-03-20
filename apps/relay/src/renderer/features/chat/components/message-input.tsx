// Message input — polished input area per design.md §6
// Auto-resize textarea, circular send button, toolbar

import { useState, useCallback, useRef, type KeyboardEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, Paperclip } from 'lucide-react';

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
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-border-subtle bg-bg-surface transition-all duration-150 focus-within:border-accent focus-within:shadow-glow"
      >
        {/* Input row */}
        <div className="flex items-end gap-2 px-4 py-3">
          {/* Attach button */}
          <button
            type="button"
            className="p-1 rounded-lg text-text-secondary hover:text-text-primary transition-colors duration-150 mb-0.5"
          >
            <Paperclip size={18} />
          </button>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            disabled={disabled}
            placeholder={placeholder || t('chat.typeMessage')}
            rows={1}
            className="flex-1 bg-transparent text-text-primary placeholder:text-text-placeholder outline-none resize-none"
            style={{ fontSize: '15px', lineHeight: '1.5', minHeight: '24px', maxHeight: '200px' }}
          />

          {/* Send button — circular */}
          <button
            type="submit"
            disabled={!canSend}
            className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-150 mb-0.5 ${
              canSend
                ? 'bg-accent hover:bg-accent-hover text-white'
                : 'bg-bg-elevated text-text-placeholder'
            }`}
          >
            <ArrowUp size={18} />
          </button>
        </div>

        {/* Toolbar row */}
        <div className="flex items-center gap-3 px-4 pb-2.5 pt-0">
          {toolbar}
          {modelName && (
            <span className="text-[11px] text-text-placeholder ml-auto">{modelName}</span>
          )}
          <span className="text-[11px] text-text-placeholder">
            {t('chat.enterToSend')}
          </span>
        </div>
      </form>
    </div>
  );
}
