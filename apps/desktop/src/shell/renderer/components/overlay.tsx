import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { OVERLAY_BACKDROP_CLASS, OVERLAY_PANEL_CLASS, cx, type OverlayKind } from './design-tokens.js';

type OverlayShellKind = Exclude<OverlayKind, 'tooltip'>;

type OverlayShellProps = {
  open: boolean;
  kind?: OverlayShellKind;
  onClose?: () => void;
  closeOnBackdrop?: boolean;
  title?: ReactNode;
  footer?: ReactNode;
  className?: string;
  panelClassName?: string;
  contentClassName?: string;
  children?: ReactNode;
  dataTestId?: string;
};

type TooltipBubbleProps = {
  visible: boolean;
  coords: { left: number; top: number } | null;
  placement?: 'top' | 'bottom';
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

export function OverlayShell({
  open,
  kind = 'dialog',
  onClose,
  closeOnBackdrop = true,
  title,
  footer,
  className,
  panelClassName,
  contentClassName,
  children,
  dataTestId,
}: OverlayShellProps) {
  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    setPortalReady(typeof document !== 'undefined');
  }, []);

  useEffect(() => {
    if (!open || !onClose) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !portalReady) {
    return null;
  }

  return createPortal(
    <div
      className={cx('nimi-overlay-backdrop', OVERLAY_BACKDROP_CLASS[kind], className)}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        data-testid={dataTestId}
        role={kind === 'dialog' ? 'dialog' : undefined}
        aria-modal={kind === 'dialog' ? 'true' : undefined}
        className={cx('nimi-overlay-panel', OVERLAY_PANEL_CLASS[kind], panelClassName)}
        onClick={(event) => event.stopPropagation()}
      >
        {title ? <div className="border-b border-slate-100 px-5 py-4">{title}</div> : null}
        <div className={cx('px-5 py-5', contentClassName)}>{children}</div>
        {footer ? <div className="border-t border-slate-100 px-5 py-4">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function TooltipBubble({
  visible,
  coords,
  placement = 'bottom',
  children,
  className,
  contentClassName,
}: TooltipBubbleProps) {
  const hiddenTransform = placement === 'bottom' ? '-translate-y-1' : 'translate-y-1';
  const visibleTransform = placement === 'bottom' ? 'translate-y-0' : '-translate-y-0';
  const style: CSSProperties = {
    left: coords ? `${coords.left}px` : '-9999px',
    top: coords ? `${coords.top}px` : '-9999px',
  };

  return (
    <div
      className={cx(
        'nimi-tooltip-layer fixed -translate-x-1/2 transition-all',
        visible ? `opacity-100 ${visibleTransform}` : `pointer-events-none opacity-0 ${hiddenTransform}`,
        className,
      )}
      style={style}
    >
      <div className={cx('nimi-tooltip-bubble', contentClassName)}>
        {children}
      </div>
    </div>
  );
}
