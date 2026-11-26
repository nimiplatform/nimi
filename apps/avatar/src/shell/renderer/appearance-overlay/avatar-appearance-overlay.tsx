import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { AvatarModelManifest } from '@nimiplatform/kit/features/avatar/headless';
import { motion, nimiOverlayPanelMotion, useNimiReducedMotion } from '@nimiplatform/kit/ui/motion';
import { useTranslation } from '../i18n/index.js';
import { useClampedOverlayPosition } from '../use-clamped-overlay-position.js';

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
  returnFocusTarget?: HTMLElement | null;
  onDismiss(reason: AvatarAppearanceOverlayDismissReason): void;
};

const OVERLAY_WIDTH_PX = 300;
const OVERLAY_ESTIMATED_HEIGHT_PX = 240;
const VIEWPORT_PADDING_PX = 8;

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
    returnFocusTarget,
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
      dismissedRef.current = true;
      onDismiss('outside_click');
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (dismissedRef.current || event.key !== 'Escape') return;
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
    <motion.div
      ref={rootRef}
      id="avatar-appearance-overlay"
      className="avatar-appearance-overlay nimi-material-glass-chrome bg-[var(--nimi-material-glass-chrome-bg)] border-[var(--nimi-material-glass-chrome-border)] backdrop-blur-[var(--nimi-backdrop-blur-chrome)] backdrop-saturate-[var(--nimi-backdrop-saturate)]"
      {...panelMotion}
      style={{ ...panelMotion.style, left: position.left, top: position.top }}
      role="dialog"
      aria-label={t('Avatar.appearance.popover_aria')}
      tabIndex={-1}
      data-testid="avatar-appearance-overlay"
      data-nimi-material="glass-chrome"
      data-nimi-tone="overlay"
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
          onClick={() => {
            if (dismissedRef.current) return;
            dismissedRef.current = true;
            onDismiss('close');
          }}
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
    </motion.div>
  );
}
