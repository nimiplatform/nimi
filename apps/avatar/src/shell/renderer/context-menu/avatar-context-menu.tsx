import { useEffect, useRef, type ReactNode } from 'react';
import {
  Check,
  EyeOff,
  Keyboard,
  LogOut,
  Mic,
  Palette,
  Pin,
  Power,
  RotateCcw,
  Settings,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { cn } from '@nimiplatform/kit/ui';
import { motion, nimiOverlayPanelMotion, useNimiReducedMotion } from '@nimiplatform/kit/ui/motion';
import { useTranslation } from '../i18n/index.js';
import { moveMenuItemFocus } from '../avatar-shell-utils.js';
import { useClampedOverlayPosition } from '../use-clamped-overlay-position.js';

export type AvatarContextMenuDismissReason =
  | 'action'
  | 'outside_click'
  | 'escape'
  | 'composition_change';

export type AvatarContextMenuAction =
  | 'open_text_input'
  | 'open_capsule'
  | 'quiet'
  | 'appearance'
  | 'zoom_in'
  | 'zoom_out'
  | 'reset_scale'
  | 'toggle_always_on_top'
  | 'hide'
  | 'close'
  | 'quit_app'
  | 'settings';

export type AvatarContextMenuProps = {
  x: number;
  y: number;
  alwaysOnTop: boolean;
  textInputEnabled: boolean;
  capsuleEnabled: boolean;
  appearanceEnabled: boolean;
  resetScaleEnabled: boolean;
  zoomInEnabled: boolean;
  zoomOutEnabled: boolean;
  quietActive: boolean;
  settingsEnabled: boolean;
  shellLifecycleEnabled: boolean;
  returnFocusTarget?: HTMLElement | null;
  onAction(action: AvatarContextMenuAction): void;
  onDismiss(reason: AvatarContextMenuDismissReason): void;
};

type MenuItem = {
  action: AvatarContextMenuAction;
  labelKey: string;
  icon: ReactNode;
  enabled: boolean;
  checked?: boolean;
  dividerBefore?: boolean;
};

const MENU_WIDTH_PX = 220;
const MENU_ESTIMATED_HEIGHT_PX = 448;
const VIEWPORT_PADDING_PX = 8;

export function AvatarContextMenu(props: AvatarContextMenuProps) {
  const {
    x,
    y,
    alwaysOnTop,
    textInputEnabled,
    capsuleEnabled,
    appearanceEnabled,
    resetScaleEnabled,
    zoomInEnabled,
    zoomOutEnabled,
    quietActive,
    settingsEnabled,
    shellLifecycleEnabled,
    returnFocusTarget,
    onAction,
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
    fallbackWidth: MENU_WIDTH_PX,
    fallbackHeight: MENU_ESTIMATED_HEIGHT_PX,
    padding: VIEWPORT_PADDING_PX,
    rootRef,
  });
  const panelMotion = nimiOverlayPanelMotion({
    kind: 'popover',
    side: position.side,
    align: position.align,
    reducedMotion,
  });

  const items: MenuItem[] = [
    {
      action: 'open_text_input',
      labelKey: 'Avatar.context_menu.open_text_input',
      icon: <Keyboard size={15} aria-hidden="true" />,
      enabled: textInputEnabled,
    },
    {
      action: 'open_capsule',
      labelKey: 'Avatar.context_menu.open_capsule',
      icon: <Mic size={15} aria-hidden="true" />,
      enabled: capsuleEnabled,
    },
    {
      action: 'quiet',
      labelKey: 'Avatar.context_menu.quiet',
      icon: <VolumeX size={15} aria-hidden="true" />,
      enabled: true,
      checked: quietActive,
    },
    {
      action: 'appearance',
      labelKey: 'Avatar.context_menu.appearance',
      icon: <Palette size={15} aria-hidden="true" />,
      enabled: appearanceEnabled,
      dividerBefore: true,
    },
    {
      action: 'zoom_in',
      labelKey: 'Avatar.context_menu.zoom_in',
      icon: <ZoomIn size={15} aria-hidden="true" />,
      enabled: zoomInEnabled,
    },
    {
      action: 'zoom_out',
      labelKey: 'Avatar.context_menu.zoom_out',
      icon: <ZoomOut size={15} aria-hidden="true" />,
      enabled: zoomOutEnabled,
    },
    {
      action: 'reset_scale',
      labelKey: 'Avatar.context_menu.reset_scale',
      icon: <RotateCcw size={15} aria-hidden="true" />,
      enabled: resetScaleEnabled,
    },
    {
      action: 'toggle_always_on_top',
      labelKey: 'Avatar.context_menu.always_on_top',
      icon: <Pin size={15} aria-hidden="true" />,
      enabled: true,
      checked: alwaysOnTop,
      dividerBefore: true,
    },
    {
      action: 'hide',
      labelKey: 'Avatar.context_menu.hide',
      icon: <EyeOff size={15} aria-hidden="true" />,
      enabled: shellLifecycleEnabled,
    },
    {
      action: 'close',
      labelKey: 'Avatar.context_menu.close',
      icon: <Power size={15} aria-hidden="true" />,
      enabled: shellLifecycleEnabled,
    },
    {
      action: 'quit_app',
      labelKey: 'Avatar.context_menu.quit_app',
      icon: <LogOut size={15} aria-hidden="true" />,
      enabled: shellLifecycleEnabled,
    },
    {
      action: 'settings',
      labelKey: 'Avatar.context_menu.settings',
      icon: <Settings size={15} aria-hidden="true" />,
      enabled: settingsEnabled,
      dividerBefore: true,
    },
  ];

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

  return (
    <motion.div
      ref={rootRef}
      className="avatar-context-menu nimi-material-glass-chrome bg-[var(--nimi-material-glass-chrome-bg)] border-[var(--nimi-material-glass-chrome-border)] backdrop-blur-[var(--nimi-backdrop-blur-chrome)] backdrop-saturate-[var(--nimi-backdrop-saturate)]"
      {...panelMotion}
      style={{ ...panelMotion.style, left: position.left, top: position.top }}
      role="menu"
      aria-label={t('Avatar.context_menu.aria')}
      tabIndex={-1}
      data-testid="avatar-context-menu"
      data-nimi-material="glass-chrome"
      data-nimi-tone="overlay"
      data-avatar-interactive-region="true"
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (moveMenuItemFocus(event.currentTarget, event.key)) {
          event.preventDefault();
        }
      }}
    >
      {items.map((item) => (
        <div key={item.action} className="avatar-context-menu__entry">
          {item.dividerBefore ? (
            <div className="avatar-context-menu__separator" role="separator" aria-hidden="true" />
          ) : null}
          <button
            type="button"
            className={cn(
              'avatar-context-menu__item',
              item.checked && 'avatar-context-menu__item--checked',
            )}
            role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            disabled={!item.enabled}
            aria-disabled={!item.enabled}
            aria-checked={item.checked}
            data-testid={`avatar-context-menu-item-${item.action}`}
            onClick={() => {
              if (!item.enabled || dismissedRef.current) return;
              dismissedRef.current = true;
              onAction(item.action);
            }}
          >
            <span className="avatar-context-menu__icon">{item.icon}</span>
            <span className="avatar-context-menu__label">{t(item.labelKey)}</span>
            {item.checked ? (
              <span className="avatar-context-menu__check" aria-hidden="true">
                <Check size={14} />
              </span>
            ) : null}
          </button>
        </div>
      ))}
    </motion.div>
  );
}
