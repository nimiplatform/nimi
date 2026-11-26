import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { SelectField } from '@nimiplatform/kit/ui';
import { motion, nimiOverlayPanelMotion, useNimiReducedMotion } from '@nimiplatform/kit/ui/motion';
import { useTranslation } from '../i18n/index.js';
import type { AvatarShellSettings } from '../settings-state.js';
import { useClampedOverlayPosition } from '../use-clamped-overlay-position.js';

export type AvatarSettingsOverlayDismissReason =
  | 'close'
  | 'outside_click'
  | 'escape'
  | 'composition_change';

export type AvatarSettingsOverlayChangeKey =
  | 'always_on_top'
  | 'show_voice_captions'
  | 'caption_size'
  | 'caption_contrast'
  | 'caption_duration';

export type AvatarSettingsOverlayProps = {
  x: number;
  y: number;
  settings: AvatarShellSettings;
  returnFocusTarget?: HTMLElement | null;
  onSettingsChange(next: AvatarShellSettings, changedKey: AvatarSettingsOverlayChangeKey): void;
  onDismiss(reason: AvatarSettingsOverlayDismissReason): void;
};

const OVERLAY_WIDTH_PX = 288;
const OVERLAY_ESTIMATED_HEIGHT_PX = 410;
const VIEWPORT_PADDING_PX = 8;

export function AvatarSettingsOverlay(props: AvatarSettingsOverlayProps) {
  const {
    x,
    y,
    settings,
    returnFocusTarget,
    onSettingsChange,
    onDismiss,
  } = props;
  const { t } = useTranslation();
  const reducedMotion = useNimiReducedMotion();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const dismissedRef = useRef(false);
  dismissedRef.current = false;

  const position = useClampedOverlayPosition({
    x,
    y,
    fallbackWidth: OVERLAY_WIDTH_PX,
    fallbackHeight: OVERLAY_ESTIMATED_HEIGHT_PX,
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
    rootEl?.focus();
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

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      if (dismissedRef.current) return;
      const root = rootRef.current;
      if (!root || !(event.target instanceof Node) || root.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest('[data-nimi-select-layer]')) return;
      dismissedRef.current = true;
      onDismiss('outside_click');
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (dismissedRef.current || event.key !== 'Escape') return;
      if (rootRef.current?.querySelector('[role="combobox"][aria-expanded="true"]')) return;
      event.preventDefault();
      dismissedRef.current = true;
      onDismiss('escape');
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [onDismiss]);

  return (
    <motion.div
      ref={rootRef}
      id="avatar-settings-overlay"
      className="avatar-settings-popover nimi-material-glass-chrome bg-[var(--nimi-material-glass-chrome-bg)] border-[var(--nimi-material-glass-chrome-border)] backdrop-blur-[var(--nimi-backdrop-blur-chrome)] backdrop-saturate-[var(--nimi-backdrop-saturate)]"
      {...panelMotion}
      style={{ ...panelMotion.style, left: position.left, top: position.top }}
      role="dialog"
      aria-label={t('Avatar.settings.popover_aria')}
      tabIndex={-1}
      data-testid="avatar-settings-overlay"
      data-nimi-material="glass-chrome"
      data-nimi-tone="overlay"
      data-avatar-interactive-region="true"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="avatar-settings-popover__header">
        <span>{t('Avatar.settings.header')}</span>
        <button
          type="button"
          className="avatar-settings-popover__close"
          aria-label={t('Avatar.settings.close_aria')}
          data-testid="avatar-settings-overlay-close"
          onClick={() => {
            if (dismissedRef.current) return;
            dismissedRef.current = true;
            onDismiss('close');
          }}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <label className="avatar-settings-popover__toggle">
        <span className="avatar-settings-popover__toggle-text">
          <span className="avatar-settings-popover__toggle-label">
            {t('Avatar.settings.always_on_top.label')}
          </span>
          <span className="avatar-settings-popover__toggle-help">
            {t('Avatar.settings.always_on_top.help')}
          </span>
        </span>
        <input
          type="checkbox"
          className="avatar-settings-popover__switch"
          checked={settings.alwaysOnTop}
          data-testid="avatar-settings-toggle-always-on-top"
          onChange={(event) => {
            onSettingsChange(
              { ...settings, alwaysOnTop: event.currentTarget.checked },
              'always_on_top',
            );
          }}
        />
      </label>
      <label className="avatar-settings-popover__toggle">
        <span className="avatar-settings-popover__toggle-text">
          <span className="avatar-settings-popover__toggle-label">
            {t('Avatar.settings.show_voice_captions.label')}
          </span>
          <span className="avatar-settings-popover__toggle-help">
            {t('Avatar.settings.show_voice_captions.help')}
          </span>
        </span>
        <input
          type="checkbox"
          className="avatar-settings-popover__switch"
          checked={settings.showVoiceCaptions}
          data-testid="avatar-settings-toggle-show-voice-captions"
          onChange={(event) => {
            onSettingsChange(
              { ...settings, showVoiceCaptions: event.currentTarget.checked },
              'show_voice_captions',
            );
          }}
        />
      </label>
      <p className="avatar-settings-popover__note">
        {t('Avatar.settings.show_voice_captions.note')}
      </p>
      <div
        className={
          settings.showVoiceCaptions
            ? 'avatar-settings-popover__caption-group'
            : 'avatar-settings-popover__caption-group avatar-settings-popover__caption-group--muted'
        }
        aria-disabled={!settings.showVoiceCaptions || undefined}
      >
        <label className="avatar-settings-popover__select-row">
          <span>{t('Avatar.settings.caption_size.label')}</span>
          <SelectField
            value={settings.captionSize}
            disabled={!settings.showVoiceCaptions}
            className="avatar-settings-popover__select"
            data-testid="avatar-settings-caption-size"
            options={[
              { value: 'small', label: t('Avatar.settings.caption_size.small') },
              { value: 'medium', label: t('Avatar.settings.caption_size.medium') },
              { value: 'large', label: t('Avatar.settings.caption_size.large') },
            ]}
            onValueChange={(value) => onSettingsChange(
              { ...settings, captionSize: value as AvatarShellSettings['captionSize'] },
              'caption_size',
            )}
          />
        </label>
        <label className="avatar-settings-popover__select-row">
          <span>{t('Avatar.settings.caption_contrast.label')}</span>
          <SelectField
            value={settings.captionContrast}
            disabled={!settings.showVoiceCaptions}
            className="avatar-settings-popover__select"
            data-testid="avatar-settings-caption-contrast"
            options={[
              { value: 'standard', label: t('Avatar.settings.caption_contrast.standard') },
              { value: 'high', label: t('Avatar.settings.caption_contrast.high') },
            ]}
            onValueChange={(value) => onSettingsChange(
              { ...settings, captionContrast: value as AvatarShellSettings['captionContrast'] },
              'caption_contrast',
            )}
          />
        </label>
        <label className="avatar-settings-popover__select-row">
          <span>{t('Avatar.settings.caption_duration.label')}</span>
          <SelectField
            value={settings.captionDuration}
            disabled={!settings.showVoiceCaptions}
            className="avatar-settings-popover__select"
            data-testid="avatar-settings-caption-duration"
            options={[
              { value: 'short', label: t('Avatar.settings.caption_duration.short') },
              { value: 'standard', label: t('Avatar.settings.caption_duration.standard') },
              { value: 'long', label: t('Avatar.settings.caption_duration.long') },
            ]}
            onValueChange={(value) => onSettingsChange(
              { ...settings, captionDuration: value as AvatarShellSettings['captionDuration'] },
              'caption_duration',
            )}
          />
        </label>
      </div>
    </motion.div>
  );
}
