import {
  useEffect,
  useRef,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Send, X } from 'lucide-react';
import { IconButton, TextareaField } from '@nimiplatform/kit/ui';
import { motion, nimiOverlayPanelMotion, useNimiReducedMotion } from '@nimiplatform/kit/ui/motion';
import { useTranslation } from '../i18n/index.js';
import { useClampedOverlayPosition } from '../use-clamped-overlay-position.js';

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
  returnFocusTarget?: HTMLElement | null;
  onDraftChange(draft: string): void;
  onSubmit(): void;
  onDismiss(reason: AvatarTransientComposerDismissReason): void;
};

const COMPOSER_WIDTH_PX = 336;
const COMPOSER_ESTIMATED_HEIGHT_PX = 112;
const VIEWPORT_PADDING_PX = 10;

export function AvatarTransientComposer(props: AvatarTransientComposerProps) {
  const {
    x,
    y,
    draft,
    sendState,
    sendError,
    returnFocusTarget,
    onDraftChange,
    onSubmit,
    onDismiss,
  } = props;
  const { t } = useTranslation();
  const reducedMotion = useNimiReducedMotion();
  const rootRef = useRef<HTMLFormElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const dismissedRef = useRef(false);
  dismissedRef.current = false;

  const position = useClampedOverlayPosition({
    x,
    y,
    fallbackWidth: COMPOSER_WIDTH_PX,
    fallbackHeight: COMPOSER_ESTIMATED_HEIGHT_PX,
    padding: VIEWPORT_PADDING_PX,
    rootRef,
  });
  const panelMotion = nimiOverlayPanelMotion({
    kind: 'popover',
    side: position.side,
    align: position.align,
    reducedMotion,
  });

  useEffect(() => {
    const rootEl = rootRef.current;
    const active = document.activeElement;
    returnFocusRef.current =
      returnFocusTarget
      ?? (active instanceof HTMLElement && !active.closest('[data-avatar-interactive-region="true"]')
        ? active
        : null);
    textareaRef.current?.focus();
    return () => {
      const target = returnFocusRef.current;
      const currentActive = document.activeElement;
      const shouldRestore =
        !currentActive
        || currentActive === document.body
        || currentActive === document.documentElement
        || (rootEl !== null && rootEl.contains(currentActive));
      if (shouldRestore && target?.isConnected) target.focus();
    };
  }, []);

  const dismiss = (reason: AvatarTransientComposerDismissReason): void => {
    if (dismissedRef.current || sendState === 'sending') return;
    dismissedRef.current = true;
    onDismiss(reason);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (dismissedRef.current || sendState === 'sending') return;
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
    if (dismissedRef.current || event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    if (sendState === 'sending') return;
    event.preventDefault();
    dismissedRef.current = true;
    onDismiss('escape');
  };

  return (
    <motion.form
      ref={rootRef}
      className="avatar-transient-composer nimi-material-glass-chrome bg-[var(--nimi-material-glass-chrome-bg)] border-[var(--nimi-material-glass-chrome-border)] backdrop-blur-[var(--nimi-backdrop-blur-chrome)] backdrop-saturate-[var(--nimi-backdrop-saturate)]"
      {...panelMotion}
      style={{ ...panelMotion.style, left: position.left, top: position.top }}
      data-testid="avatar-transient-composer"
      data-nimi-material="glass-chrome"
      data-nimi-tone="overlay"
      data-avatar-interactive-region="true"
      onSubmit={handleSubmit}
      onKeyDownCapture={handleComposerKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      onBlurCapture={(event) => {
        if (dismissedRef.current) return;
        const root = event.currentTarget;
        window.requestAnimationFrame(() => {
          if (dismissedRef.current) return;
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
      {sendError ? (
        <p className="avatar-transient-composer__error" role="alert">
          {`${t('Avatar.composer.send_failed_prefix')}: ${sendError}`}
        </p>
      ) : null}
      <div className="avatar-transient-composer__actions">
        <span className="avatar-transient-composer__spacer" aria-hidden="true" />
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
    </motion.form>
  );
}
