import { useEffect, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import type { AvatarModelManifest } from '@nimiplatform/kit/features/avatar/headless';
import { useTranslation } from '../i18n/index.js';

export type AvatarAppearanceOverlayDismissReason =
  | 'close'
  | 'outside_click'
  | 'escape'
  | 'composition_change';

export type AvatarAppearanceSourceAuthority = 'runtime' | 'fixture' | 'unknown';

export type AvatarAppearanceOverlayProps = {
  x: number;
  y: number;
  modelManifest: AvatarModelManifest;
  sourceAuthority: AvatarAppearanceSourceAuthority;
  scale: number;
  onDismiss(reason: AvatarAppearanceOverlayDismissReason): void;
};

const OVERLAY_WIDTH_PX = 300;
const OVERLAY_ESTIMATED_HEIGHT_PX = 240;
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

function scalePercent(scale: number): string {
  const safeScale = Number.isFinite(scale) ? scale : 1;
  return `${Math.round(safeScale * 100)}%`;
}

export function AvatarAppearanceOverlay(props: AvatarAppearanceOverlayProps) {
  const {
    x,
    y,
    modelManifest,
    sourceAuthority,
    scale,
    onDismiss,
  } = props;
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);

  const position = useMemo(() => {
    const viewport = readViewportSize();
    return {
      left: clampPosition(x, OVERLAY_WIDTH_PX, viewport.width),
      top: clampPosition(y, OVERLAY_ESTIMATED_HEIGHT_PX, viewport.height),
    };
  }, [x, y]);

  useEffect(() => {
    rootRef.current?.focus();
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

  const rows = [
    {
      label: t('Avatar.appearance.labels.backend'),
      value: t(`Avatar.appearance.backend.${modelManifest.kind}`),
    },
    {
      label: t('Avatar.appearance.labels.model'),
      value: modelManifest.modelId || t('Avatar.appearance.not_loaded'),
    },
    {
      label: t('Avatar.appearance.labels.source'),
      value: t(`Avatar.appearance.source.${sourceAuthority}`),
    },
    {
      label: t('Avatar.appearance.labels.scale'),
      value: scalePercent(scale),
    },
    {
      label: t('Avatar.appearance.labels.selection_owner'),
      value: t('Avatar.appearance.owner.runtime_presentation'),
    },
  ];

  return (
    <div
      ref={rootRef}
      id="avatar-appearance-overlay"
      className="avatar-appearance-overlay nimi-material-glass-thick"
      style={{ left: position.left, top: position.top }}
      role="dialog"
      aria-label={t('Avatar.appearance.popover_aria')}
      tabIndex={-1}
      data-testid="avatar-appearance-overlay"
      data-avatar-interactive-region="true"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="avatar-appearance-overlay__header">
        <span>{t('Avatar.appearance.header')}</span>
        <button
          type="button"
          className="avatar-appearance-overlay__icon-button"
          aria-label={t('Avatar.appearance.close_aria')}
          data-testid="avatar-appearance-overlay-close"
          onClick={() => onDismiss('close')}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <dl className="avatar-appearance-overlay__rows">
        {rows.map((row) => (
          <div className="avatar-appearance-overlay__row" key={row.label}>
            <dt>{row.label}</dt>
            {/* Values ellipsis-clip (long model ids); title keeps them readable. */}
            <dd title={row.value}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
