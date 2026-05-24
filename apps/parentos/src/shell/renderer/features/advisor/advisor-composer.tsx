import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, IconButton, Surface, TextareaField } from '@nimiplatform/kit/ui';

const MIN_HEIGHT = 48;
const MAX_HEIGHT = 128;

export type AdvisorComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  disabled: boolean;
  isStreaming: boolean;
  recordRoute: string | null;
};

export function AdvisorComposer({
  value,
  onChange,
  onSend,
  onStop,
  disabled,
  isStreaming,
  recordRoute,
}: AdvisorComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isComposing, setIsComposing] = useState(false);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const h = Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT);
    el.style.height = `${h}px`;
    // Only show scrollbar when content actually exceeds max height
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    resize();
  }, [value, resize]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="shrink-0 px-5 pb-5 pt-2">
      <div className="mx-auto max-w-2xl">
        {/* Record data link - shown when navigated from a reminder. */}
        {recordRoute && (
          <div className="mb-2">
            <Button asChild tone="secondary" size="sm" leadingIcon={<PlusIcon />}>
              <Link to={recordRoute}>
              去记录数据
              </Link>
            </Button>
          </div>
        )}

        <Surface tone="card" material="glass-thick" elevation="floating" padding="none" className="rounded-xl">
          <div className="flex items-end gap-2 p-2">
            <TextareaField
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              placeholder="输入问题..."
              disabled={disabled}
              rows={1}
              className="min-w-0 flex-1 rounded-xl"
              textareaClassName="advisor-composer-textarea min-h-[48px] max-h-32 resize-none overflow-y-hidden"
            />
            {isStreaming ? (
              <IconButton
                onClick={onStop}
                tone="danger"
                size="md"
                icon={<StopIcon />}
                aria-label="停止"
              />
            ) : (
              <IconButton
                onClick={onSend}
                disabled={!value.trim()}
                tone="primary"
                size="md"
                icon={<SendIcon />}
                aria-label="发送"
              />
            )}
          </div>
        </Surface>
      </div>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}
