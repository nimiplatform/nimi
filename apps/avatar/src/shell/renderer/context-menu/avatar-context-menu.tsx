import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  EyeOff,
  Keyboard,
  Mic,
  Palette,
  Pin,
  PinOff,
  Power,
  RotateCcw,
  Settings,
  Square,
} from 'lucide-react';
import { cn } from '@nimiplatform/kit/ui';
import { useTranslation } from '../i18n/index.js';
import { moveMenuItemFocus } from '../avatar-shell-utils.js';

export type AvatarContextMenuDismissReason =
  | 'action'
  | 'outside_click'
  | 'escape'
  | 'composition_change';

export type AvatarContextMenuAction =
  | 'open_text_input'
  | 'wake_foreground'
  | 'interrupt'
  | 'appearance'
  | 'reset_scale'
  | 'toggle_always_on_top'
  | 'hide'
  | 'close'
  | 'settings';

export type AvatarContextMenuProps = {
  x: number;
  y: number;
  alwaysOnTop: boolean;
  textInputEnabled: boolean;
  foregroundPriorityEnabled: boolean;
  interruptEnabled: boolean;
  appearanceEnabled: boolean;
  resetScaleEnabled: boolean;
  settingsEnabled: boolean;
  shellLifecycleEnabled: boolean;
  onAction(action: AvatarContextMenuAction): void;
  onDismiss(reason: AvatarContextMenuDismissReason): void;
};

type MenuItem = {
  action: AvatarContextMenuAction;
  labelKey: string;
  icon: ReactNode;
  enabled: boolean;
  checked?: boolean;
};

const MENU_WIDTH_PX = 220;
const MENU_ESTIMATED_HEIGHT_PX = 330;
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

export function AvatarContextMenu(props: AvatarContextMenuProps) {
  const {
    x,
    y,
    alwaysOnTop,
    textInputEnabled,
    foregroundPriorityEnabled,
    interruptEnabled,
    appearanceEnabled,
    resetScaleEnabled,
    settingsEnabled,
    shellLifecycleEnabled,
    onAction,
    onDismiss,
  } = props;
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const position = useMemo(() => {
    const viewport = readViewportSize();
    return {
      left: clampPosition(x, MENU_WIDTH_PX, viewport.width),
      top: clampPosition(y, MENU_ESTIMATED_HEIGHT_PX, viewport.height),
    };
  }, [x, y]);

  const items: MenuItem[] = [
    {
      action: 'open_text_input',
      labelKey: 'Avatar.context_menu.open_text_input',
      icon: <Keyboard size={15} aria-hidden="true" />,
      enabled: textInputEnabled,
    },
    {
      action: 'wake_foreground',
      labelKey: 'Avatar.context_menu.wake_foreground',
      icon: <Mic size={15} aria-hidden="true" />,
      enabled: foregroundPriorityEnabled,
    },
    {
      action: 'interrupt',
      labelKey: 'Avatar.context_menu.interrupt',
      icon: <Square size={15} aria-hidden="true" />,
      enabled: interruptEnabled,
    },
    {
      action: 'appearance',
      labelKey: 'Avatar.context_menu.appearance',
      icon: <Palette size={15} aria-hidden="true" />,
      enabled: appearanceEnabled,
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
      icon: alwaysOnTop
        ? <PinOff size={15} aria-hidden="true" />
        : <Pin size={15} aria-hidden="true" />,
      enabled: true,
      checked: alwaysOnTop,
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
      action: 'settings',
      labelKey: 'Avatar.context_menu.settings',
      icon: <Settings size={15} aria-hidden="true" />,
      enabled: settingsEnabled,
    },
  ];

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
      className="avatar-context-menu nimi-material-glass-thick"
      style={{ left: position.left, top: position.top }}
      role="menu"
      aria-label={t('Avatar.context_menu.aria')}
      tabIndex={-1}
      data-testid="avatar-context-menu"
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (moveMenuItemFocus(event.currentTarget, event.key)) {
          event.preventDefault();
        }
      }}
    >
      {items.map((item) => (
        <button
          key={item.action}
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
            if (!item.enabled) return;
            onAction(item.action);
          }}
        >
          <span className="avatar-context-menu__icon">{item.icon}</span>
          <span className="avatar-context-menu__label">{t(item.labelKey)}</span>
          {!item.enabled ? (
            <span className="avatar-context-menu__pending">{t('Avatar.context_menu.pending')}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
