import {
  useEffect,
  useMemo,
  useRef,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Send, X } from 'lucide-react';
import { IconButton, TextareaField } from '@nimiplatform/kit/ui';
import { useTranslation } from '../i18n/index.js';

export type AvatarTransientComposerDismissReason =
  | 'focus_switch'
  | 'escape'
  | 'explicit_close'
  | 'composition_change';

export type AvatarTransientComposerSendState = 'idle' | 'sending' | 'error';

export type AvatarTransientComposerProps = {
  x: number;
  y: number;
  draft: string;
  sendState: AvatarTransientComposerSendState;
  sendError: string | null;
  onDraftChange(draft: string): void;
  onSubmit(): void;
  onDismiss(reason: AvatarTransientComposerDismissReason): void;
};

const COMPOSER_WIDTH_PX = 336;
const COMPOSER_ESTIMATED_HEIGHT_PX = 112;
const VIEWPORT_PADDING_PX = 10;

function clampPosition(value: number, size: number, viewport: number): number {
  if (!Number.isFinite(value)) return VIEWPORT_PADDING_PX;
  const max = Math.max(VIEWPORT_PADDING_PX, viewport - size - VIEWPORT_PADDING_PX);
  return Math.max(VIEWPORT_PADDING_PX, Math.min(value, max));
}

function readViewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') {
    return { width: 400, height: 600 };
  }
  return {
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight),
  };
}

export function AvatarTransientComposer(props: AvatarTransientComposerProps) {
  const {
    x,
    y,
    draft,
    sendState,
    sendError,
    onDraftChange,
    onSubmit,
    onDismiss,
  } = props;
  const { t } = useTranslation();
  const rootRef = useRef<HTMLFormElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const position = useMemo(() => {
    const viewport = readViewportSize();
    return {
      left: clampPosition(x, COMPOSER_WIDTH_PX, viewport.width),
      top: clampPosition(y, COMPOSER_ESTIMATED_HEIGHT_PX, viewport.height),
    };
  }, [x, y]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const dismiss = (reason: AvatarTransientComposerDismissReason): void => {
    if (sendState === 'sending') return;
    onDismiss(reason);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (sendState === 'sending') return;
    onSubmit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // IME composition uses Enter to commit candidates (and Escape to cancel);
    // those keys must never submit or dismiss the composer.
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLFormElement>): void => {
    // Escape applies anywhere inside the composer, including its action
    // buttons, but must not consume Escape owned by another overlay.
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    if (sendState === 'sending') return;
    event.preventDefault();
    onDismiss('escape');
  };

  return (
    <form
      ref={rootRef}
      className="avatar-transient-composer nimi-material-glass-thick"
      style={{ left: position.left, top: position.top }}
      data-testid="avatar-transient-composer"
      onSubmit={handleSubmit}
      onKeyDownCapture={handleComposerKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      onBlurCapture={(event) => {
        const root = event.currentTarget;
        window.requestAnimationFrame(() => {
          const activeElement = document.activeElement;
          if (activeElement instanceof Element && root.contains(activeElement)) return;
          dismiss('focus_switch');
        });
      }}
    >
      <TextareaField
        ref={textareaRef}
        value={draft}
        onChange={(event) => onDraftChange(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        className="avatar-transient-composer__field"
        textareaClassName="avatar-transient-composer__input"
        placeholder={t('Avatar.composer.placeholder')}
        aria-label={t('Avatar.composer.aria_label')}
        disabled={sendState === 'sending'}
        rows={2}
      />
      <div className="avatar-transient-composer__actions">
        {sendError ? (
          <p className="avatar-transient-composer__error" role="alert">
            {`${t('Avatar.composer.send_failed_prefix')}: ${sendError}`}
          </p>
        ) : (
          <span className="avatar-transient-composer__spacer" aria-hidden="true" />
        )}
        <IconButton
          type="button"
          className="avatar-transient-composer__close"
          aria-label={t('Avatar.composer.close_aria')}
          icon={<X size={15} aria-hidden="true" />}
          size="sm"
          tone="ghost"
          onClick={() => dismiss('explicit_close')}
          disabled={sendState === 'sending'}
        />
        <IconButton
          type="submit"
          className="avatar-transient-composer__send"
          aria-label={t('Avatar.composer.send_aria')}
          title={t('Avatar.composer.send_aria')}
          icon={<Send size={15} aria-hidden="true" />}
          size="sm"
          tone="primary"
          disabled={sendState === 'sending' || draft.trim().length === 0}
        />
      </div>
    </form>
  );
}
