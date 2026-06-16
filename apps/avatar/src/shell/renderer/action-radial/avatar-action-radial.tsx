import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  Eye,
  Hand,
  Keyboard,
  Shuffle,
  Smile,
  VolumeX,
} from 'lucide-react';
import { cn } from '@nimiplatform/kit/ui';
import { useSurfaceMountEvidence } from '../app-shell/composition-events.js';
import { useTranslation } from '../i18n/index.js';

export type AvatarActionRadialAction =
  | 'greet'
  | 'look_at_me'
  | 'happy'
  | 'quiet'
  | 'random_motion'
  | 'open_text_input';

export type AvatarActionRadialDismissReason =
  | 'action'
  | 'outside_click'
  | 'escape'
  | 'composition_change';

export type AvatarActionRadialProps = {
  x: number;
  y: number;
  compositionState: string;
  textInputEnabled: boolean;
  onAction(action: AvatarActionRadialAction): void;
  onDismiss(reason: AvatarActionRadialDismissReason): void;
};

type RadialItem = {
  action: AvatarActionRadialAction;
  labelKey: string;
  icon: ReactNode;
  enabled: boolean;
};

const RADIAL_SIZE_PX = 176;
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

export function AvatarActionRadial(props: AvatarActionRadialProps) {
  const {
    x,
    y,
    compositionState,
    textInputEnabled,
    onAction,
    onDismiss,
  } = props;
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useSurfaceMountEvidence('action-radial', compositionState);

  const position = useMemo(() => {
    const viewport = readViewportSize();
    return {
      left: clampPosition(x - RADIAL_SIZE_PX / 2, RADIAL_SIZE_PX, viewport.width),
      top: clampPosition(y - RADIAL_SIZE_PX / 2, RADIAL_SIZE_PX, viewport.height),
    };
  }, [x, y]);

  const items: RadialItem[] = [
    {
      action: 'greet',
      labelKey: 'Avatar.action_radial.greet',
      icon: <Hand size={17} aria-hidden="true" />,
      enabled: true,
    },
    {
      action: 'look_at_me',
      labelKey: 'Avatar.action_radial.look_at_me',
      icon: <Eye size={17} aria-hidden="true" />,
      enabled: true,
    },
    {
      action: 'happy',
      labelKey: 'Avatar.action_radial.happy',
      icon: <Smile size={17} aria-hidden="true" />,
      enabled: true,
    },
    {
      action: 'quiet',
      labelKey: 'Avatar.action_radial.quiet',
      icon: <VolumeX size={17} aria-hidden="true" />,
      enabled: true,
    },
    {
      action: 'random_motion',
      labelKey: 'Avatar.action_radial.random_motion',
      icon: <Shuffle size={17} aria-hidden="true" />,
      enabled: true,
    },
    {
      action: 'open_text_input',
      labelKey: 'Avatar.action_radial.open_text_input',
      icon: <Keyboard size={17} aria-hidden="true" />,
      enabled: textInputEnabled,
    },
  ];

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

  return (
    <div
      ref={rootRef}
      className="avatar-action-radial nimi-material-glass-thick"
      style={{ left: position.left, top: position.top }}
      role="menu"
      aria-label={t('Avatar.action_radial.aria')}
      tabIndex={-1}
      data-testid="avatar-action-radial"
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => (
        <button
          key={item.action}
          type="button"
          className={cn('avatar-action-radial__item', `avatar-action-radial__item--${index}`)}
          role="menuitem"
          disabled={!item.enabled}
          aria-disabled={!item.enabled}
          title={t(item.labelKey)}
          data-testid={`avatar-action-radial-item-${item.action}`}
          onClick={() => {
            if (!item.enabled) return;
            onAction(item.action);
          }}
        >
          <span className="avatar-action-radial__icon">{item.icon}</span>
          <span className="avatar-action-radial__label">{t(item.labelKey)}</span>
        </button>
      ))}
    </div>
  );
}
