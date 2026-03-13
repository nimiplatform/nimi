import { useState, useCallback, useRef, type KeyboardEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

interface MessageInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function MessageInput({ onSend, disabled, placeholder }: MessageInputProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, disabled, onSend]);

  const handleSubmit = useCallback((e: FormEvent) => {
    e.preventDefault();
    submit();
  }, [submit]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter inserts newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }, [submit]);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
    }
  }, []);

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 p-4 border-t border-gray-800">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        disabled={disabled}
        placeholder={placeholder || t('chat.typeMessage')}
        rows={1}
        className="flex-1 bg-gray-800 text-white rounded-lg px-4 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 resize-none"
      />
      <button
        type="submit"
        disabled={disabled || !text.trim()}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed self-end"
      >
        {t('chat.send')}
      </button>
    </form>
  );
}
