import React, { type CSSProperties, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '../design-tokens.js';

type DialogProps = {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
};

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </DialogPrimitive.Root>
  );
}

export const DialogTrigger = DialogPrimitive.Trigger;

type DialogContentProps = {
  onClose?: () => void;
  className?: string;
  overlayClassName?: string;
  children?: ReactNode;
  style?: CSSProperties;
  dataTestId?: string;
};

export function DialogContent({
  onClose,
  className,
  overlayClassName,
  children,
  style,
  dataTestId,
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          'nimi-overlay-backdrop nimi-overlay-backdrop--dialog fixed inset-0 z-[var(--nimi-z-dialog)] bg-[var(--nimi-overlay-backdrop)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          overlayClassName,
        )}
      />
      <DialogPrimitive.Content
        data-testid={dataTestId}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={() => onClose?.()}
        className={cn(
          'nimi-overlay-panel nimi-overlay-panel--dialog fixed top-1/2 left-1/2 z-[var(--nimi-z-dialog)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] shadow-[var(--nimi-elevation-modal)] w-full max-w-md',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          className,
        )}
        style={style}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div className={cn('nimi-overlay-title px-6 pt-6 pb-2 text-[length:var(--nimi-type-section-title-size)] font-[var(--nimi-type-section-title-weight)] leading-[var(--nimi-type-section-title-line-height)]', className)}>
      {children}
    </div>
  );
}

export function DialogBody({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={cn('nimi-overlay-content px-6 py-2', className)}>{children}</div>;
}

export function DialogFooter({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={cn('nimi-overlay-footer px-6 pt-2 pb-6', className)}>{children}</div>;
}

export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
export const DialogClose = DialogPrimitive.Close;

// ---------------------------------------------------------------------------
// OverlayShell — canonical app-facing overlay shell for dialog/drawer surfaces.
// ---------------------------------------------------------------------------

type OverlayShellKind = 'dialog' | 'drawer' | 'popover';

export type OverlayShellSize = 'S' | 'M' | 'L' | 'XL' | 'full';

export const OVERLAY_SHELL_SIZE_WIDTH: Record<OverlayShellSize, string> = {
  S: '480px',
  M: '720px',
  L: '960px',
  XL: '1120px',
  full: 'calc(100vw - 32px)',
};

const OVERLAY_SHELL_SIZE_CLASS: Record<OverlayShellSize, string> = {
  S: 'nimi-overlay-panel--size-s',
  M: 'nimi-overlay-panel--size-m',
  L: 'nimi-overlay-panel--size-l',
  XL: 'nimi-overlay-panel--size-xl',
  full: 'nimi-overlay-panel--size-full',
};

const OVERLAY_SHELL_MAX_WIDTH = 'calc(100vw - 32px)';

type OverlayShellProps = {
  open: boolean;
  kind?: OverlayShellKind;
  size?: OverlayShellSize;
  onClose?: () => void;
  closeOnBackdrop?: boolean;
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  sidebar?: ReactNode;
  sidebarClassName?: string;
  className?: string;
  panelClassName?: string;
  panelStyle?: CSSProperties;
  contentClassName?: string;
  children?: ReactNode;
  dataTestId?: string;
};

export function OverlayShell({
  open,
  kind = 'dialog',
  size,
  onClose,
  closeOnBackdrop = true,
  title,
  description,
  footer,
  sidebar,
  sidebarClassName,
  className,
  panelClassName,
  panelStyle,
  contentClassName,
  children,
  dataTestId,
}: OverlayShellProps) {
  const focusReturnTargetRef = React.useRef<HTMLElement | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && onClose) onClose();
  };

  const handleOpenAutoFocus = () => {
    const activeElement = document.activeElement;
    focusReturnTargetRef.current = activeElement instanceof HTMLElement ? activeElement : null;
  };

  const handleCloseAutoFocus = (event: Event) => {
    const focusReturnTarget = focusReturnTargetRef.current;
    focusReturnTargetRef.current = null;
    if (!focusReturnTarget?.isConnected || focusReturnTarget.matches(':disabled')) return;
    event.preventDefault();
    focusReturnTarget.focus({ preventScroll: true });
  };

  const backdropKindClass = kind === 'drawer'
    ? 'nimi-overlay-backdrop--drawer'
    : kind === 'popover'
      ? 'nimi-overlay-backdrop--popover'
      : 'nimi-overlay-backdrop--dialog';
  const panelKindClass = kind === 'drawer'
    ? 'nimi-overlay-panel--drawer'
    : kind === 'popover'
      ? 'nimi-overlay-panel--popover'
      : 'nimi-overlay-panel--dialog';

  const drawerClasses = kind === 'drawer'
    ? 'top-0 right-0 left-auto h-full translate-x-0 translate-y-0 max-w-sm rounded-l-[var(--nimi-radius-lg)] rounded-r-none'
    : '';

  const hasSize = size !== undefined;
  const sizeClass = hasSize ? OVERLAY_SHELL_SIZE_CLASS[size] : '';
  const defaultWidthClass = hasSize ? '' : 'max-w-md';

  const mergedPanelStyle: CSSProperties | undefined = hasSize
    ? { width: OVERLAY_SHELL_SIZE_WIDTH[size], maxWidth: OVERLAY_SHELL_MAX_WIDTH, ...panelStyle }
    : panelStyle;

  const hasSidebar = sidebar !== undefined;

  const titleNode = title || description ? (
    <div className="nimi-overlay-title px-6 pt-6 pb-2 text-[length:var(--nimi-type-section-title-size)] font-[var(--nimi-type-section-title-weight)] leading-[var(--nimi-type-section-title-line-height)]">
      {title ? (
        <DialogPrimitive.Title asChild>
          <div>{title}</div>
        </DialogPrimitive.Title>
      ) : null}
      {description ? (
        <DialogPrimitive.Description asChild>
          <div>{description}</div>
        </DialogPrimitive.Description>
      ) : null}
    </div>
  ) : null;
  const contentNode = (
    <div className={cn('nimi-overlay-content px-6 py-2', contentClassName)}>{children}</div>
  );
  const footerNode = footer ? <div className="nimi-overlay-footer px-6 pt-2 pb-6">{footer}</div> : null;

  const panelInner = hasSidebar ? (
    <div className="flex flex-row min-h-0 h-full">
      <aside
        className={cn(
          'nimi-overlay-sidebar flex-none w-[200px] border-r border-[var(--nimi-border-subtle)] p-5',
          sidebarClassName,
        )}
      >
        {sidebar}
      </aside>
      <div className="flex flex-1 flex-col min-w-0">
        {titleNode}
        {contentNode}
        {footerNode}
      </div>
    </div>
  ) : (
    <>
      {titleNode}
      {contentNode}
      {footerNode}
    </>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'nimi-overlay-backdrop fixed inset-0 z-[var(--nimi-z-dialog)] bg-[var(--nimi-overlay-backdrop)]',
            backdropKindClass,
            className,
          )}
        />
        <DialogPrimitive.Content
          data-testid={dataTestId}
          aria-modal="true"
          {...(description ? {} : { 'aria-describedby': undefined })}
          onOpenAutoFocus={handleOpenAutoFocus}
          onCloseAutoFocus={handleCloseAutoFocus}
          onPointerDownOutside={closeOnBackdrop ? undefined : (e) => e.preventDefault()}
          onInteractOutside={closeOnBackdrop ? undefined : (e) => e.preventDefault()}
          className={cn(
            'nimi-overlay-panel fixed top-1/2 left-1/2 z-[var(--nimi-z-dialog)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] shadow-[var(--nimi-elevation-modal)] w-full',
            defaultWidthClass,
            panelKindClass,
            drawerClasses,
            sizeClass,
            panelClassName,
          )}
          style={mergedPanelStyle}
        >
          {panelInner}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}
