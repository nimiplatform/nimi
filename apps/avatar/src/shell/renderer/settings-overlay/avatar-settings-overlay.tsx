import { useEffect, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '../i18n/index.js';
import type { AvatarShellSettings } from '../settings-state.js';

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
  onSettingsChange(next: AvatarShellSettings, changedKey: AvatarSettingsOverlayChangeKey): void;
  onDismiss(reason: AvatarSettingsOverlayDismissReason): void;
};

const OVERLAY_WIDTH_PX = 280;
const OVERLAY_ESTIMATED_HEIGHT_PX = 410;
const VIEWPORT_PADDING_PX = 8;

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

export function AvatarSettingsOverlay(props: AvatarSettingsOverlayProps) {
  const {
    x,
    y,
    settings,
    onSettingsChange,
    onDismiss,
  } = props;
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const position = useMemo(() => {
    const viewport = readViewportSize();
    return {
      left: clampPosition(x, OVERLAY_WIDTH_PX, viewport.width),
      top: clampPosition(y, OVERLAY_ESTIMATED_HEIGHT_PX, viewport.height),
    };
  }, [x, y]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    rootRef.current?.focus();
    return () => {
      const target = returnFocusRef.current;
      if (target?.isConnected) target.focus();
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      const root = rootRef.current;
      if (!root || !(event.target instanceof Node) || root.contains(event.target)) return;
      onDismiss('outside_click');
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
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
    <div
      ref={rootRef}
      id="avatar-settings-overlay"
      className="avatar-settings-popover nimi-material-glass-thick"
      style={{ left: position.left, top: position.top }}
      role="dialog"
      aria-label={t('Avatar.settings.popover_aria')}
      tabIndex={-1}
      data-testid="avatar-settings-overlay"
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
          onClick={() => onDismiss('close')}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <label className="avatar-settings-popover__toggle">
        <input
          type="checkbox"
          checked={settings.alwaysOnTop}
          data-testid="avatar-settings-toggle-always-on-top"
          onChange={(event) => {
            onSettingsChange(
              { ...settings, alwaysOnTop: event.currentTarget.checked },
              'always_on_top',
            );
          }}
        />
        <span className="avatar-settings-popover__toggle-text">
          <span className="avatar-settings-popover__toggle-label">
            {t('Avatar.settings.always_on_top.label')}
          </span>
          <span className="avatar-settings-popover__toggle-help">
            {t('Avatar.settings.always_on_top.help')}
          </span>
        </span>
      </label>
      <label className="avatar-settings-popover__toggle">
        <input
          type="checkbox"
          checked={settings.showVoiceCaptions}
          data-testid="avatar-settings-toggle-show-voice-captions"
          onChange={(event) => {
            onSettingsChange(
              { ...settings, showVoiceCaptions: event.currentTarget.checked },
              'show_voice_captions',
            );
          }}
        />
        <span className="avatar-settings-popover__toggle-text">
          <span className="avatar-settings-popover__toggle-label">
            {t('Avatar.settings.show_voice_captions.label')}
          </span>
          <span className="avatar-settings-popover__toggle-help">
            {t('Avatar.settings.show_voice_captions.help')}
          </span>
        </span>
      </label>
      <p className="avatar-settings-popover__note">
        {t('Avatar.settings.show_voice_captions.note')}
      </p>
      <label className="avatar-settings-popover__select-row">
        <span>{t('Avatar.settings.caption_size.label')}</span>
        <select
          value={settings.captionSize}
          data-testid="avatar-settings-caption-size"
          onChange={(event) => onSettingsChange(
            { ...settings, captionSize: event.currentTarget.value as AvatarShellSettings['captionSize'] },
            'caption_size',
          )}
        >
          <option value="small">{t('Avatar.settings.caption_size.small')}</option>
          <option value="medium">{t('Avatar.settings.caption_size.medium')}</option>
          <option value="large">{t('Avatar.settings.caption_size.large')}</option>
        </select>
      </label>
      <label className="avatar-settings-popover__select-row">
        <span>{t('Avatar.settings.caption_contrast.label')}</span>
        <select
          value={settings.captionContrast}
          data-testid="avatar-settings-caption-contrast"
          onChange={(event) => onSettingsChange(
            { ...settings, captionContrast: event.currentTarget.value as AvatarShellSettings['captionContrast'] },
            'caption_contrast',
          )}
        >
          <option value="standard">{t('Avatar.settings.caption_contrast.standard')}</option>
          <option value="high">{t('Avatar.settings.caption_contrast.high')}</option>
        </select>
      </label>
      <label className="avatar-settings-popover__select-row">
        <span>{t('Avatar.settings.caption_duration.label')}</span>
        <select
          value={settings.captionDuration}
          data-testid="avatar-settings-caption-duration"
          onChange={(event) => onSettingsChange(
            { ...settings, captionDuration: event.currentTarget.value as AvatarShellSettings['captionDuration'] },
            'caption_duration',
          )}
        >
          <option value="short">{t('Avatar.settings.caption_duration.short')}</option>
          <option value="standard">{t('Avatar.settings.caption_duration.standard')}</option>
          <option value="long">{t('Avatar.settings.caption_duration.long')}</option>
        </select>
      </label>
    </div>
  );
}
