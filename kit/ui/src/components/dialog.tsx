import React, { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '../design-tokens.js';
import {
  AnimatePresence,
  NIMI_SPRING_DEFAULT,
  motion,
  nimiOverlayBackdropMotion,
  nimiOverlayPanelMotion,
  useIsPresent,
  useNimiReducedMotion,
  type NimiOverlayMotionProps,
} from '../motion/index.js';

type DialogProps = {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
};

/**
 * Presence context: Radix roots own the open state; panel parts read it
 * here so AnimatePresence can run spring exit motion before unmount
 * (P-DESIGN-027 — overlay motion is spring-based and symmetric).
 */
const DialogPresenceContext = createContext(false);

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPresenceContext.Provider value={open}>
        {children}
      </DialogPresenceContext.Provider>
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
  /** @deprecated Use `'data-testid'` instead. When both are passed, `'data-testid'` wins. */
  dataTestId?: string;
  'data-testid'?: string;
};

function DialogPresenceLayer({
  overlayClassName,
  className,
  backdropMotion,
  panelMotion,
  style,
  resolvedDataTestId,
  handleOpenAutoFocus,
  handleCloseAutoFocus,
  onClose,
  children,
}: {
  overlayClassName?: string;
  className?: string;
  backdropMotion: NimiOverlayMotionProps;
  panelMotion: NimiOverlayMotionProps;
  style?: CSSProperties;
  resolvedDataTestId?: string;
  handleOpenAutoFocus: () => void;
  handleCloseAutoFocus: (event: Event) => void;
  onClose?: () => void;
  children?: ReactNode;
}) {
  const isPresent = useIsPresent();
  const exitingPointerStyle: CSSProperties | undefined = isPresent ? undefined : { pointerEvents: 'none' };

  return (
    <DialogPrimitive.Portal forceMount>
      <DialogPrimitive.Overlay asChild forceMount style={exitingPointerStyle}>
        <motion.div
          className={cn(
            'nimi-overlay-backdrop nimi-overlay-backdrop--dialog fixed inset-0 z-[var(--nimi-z-dialog)] bg-[var(--nimi-overlay-backdrop)]',
            !isPresent && 'pointer-events-none',
            overlayClassName,
          )}
          {...backdropMotion}
          style={{ ...backdropMotion.style, pointerEvents: isPresent ? 'auto' : 'none' }}
        />
      </DialogPrimitive.Overlay>
      <DialogPrimitive.Content asChild forceMount
        aria-hidden={!isPresent || undefined}
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={handleCloseAutoFocus}
        onEscapeKeyDown={() => onClose?.()}
        style={exitingPointerStyle}
      >
        <motion.div
          data-testid={resolvedDataTestId}
          className={cn(
            'nimi-overlay-panel nimi-overlay-panel--dialog fixed top-1/2 left-1/2 z-[var(--nimi-z-dialog)] -translate-x-1/2 -translate-y-1/2 flex max-h-[calc(100dvh-2rem)] w-full max-w-[min(28rem,calc(100vw-2rem))] flex-col rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] shadow-[var(--nimi-elevation-modal)]',
            !isPresent && 'pointer-events-none',
            className,
          )}
          {...panelMotion}
          style={{ ...panelMotion.style, ...style, ...(isPresent ? undefined : { pointerEvents: 'none' }) }}
        >
          {children}
        </motion.div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogContent({
  onClose,
  className,
  overlayClassName,
  children,
  style,
  dataTestId,
  'data-testid': dataTestIdKebab,
}: DialogContentProps) {
  const open = useContext(DialogPresenceContext);
  const reducedMotion = useNimiReducedMotion();
  const panelMotion = nimiOverlayPanelMotion({ kind: 'dialog', reducedMotion });
  const backdropMotion = nimiOverlayBackdropMotion({ reducedMotion });
  const focusReturnTargetRef = React.useRef<HTMLElement | null>(null);
  const resolvedDataTestId = dataTestIdKebab ?? dataTestId;

  // Same focus contract as OverlayShell: the previously focused element is
  // captured on open and restored on close, while Radix performs its default
  // initial focus (first focusable child, else the content container).
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

  return (
    <AnimatePresence>
      {open ? (
        <DialogPresenceLayer
          overlayClassName={overlayClassName}
          className={className}
          backdropMotion={backdropMotion}
          panelMotion={panelMotion}
          style={style}
          resolvedDataTestId={resolvedDataTestId}
          handleOpenAutoFocus={handleOpenAutoFocus}
          handleCloseAutoFocus={handleCloseAutoFocus}
          onClose={onClose}
        >
          {children}
        </DialogPresenceLayer>
      ) : null}
    </AnimatePresence>
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

export type OverlayShellCanonicalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

/** @deprecated Legacy uppercase sizes; use the lowercase forms (`'S'`→`'sm'`, `'M'`→`'md'`, `'L'`→`'lg'`, `'XL'`→`'xl'`). */
export type OverlayShellLegacySize = 'S' | 'M' | 'L' | 'XL';

export type OverlayShellSize = OverlayShellCanonicalSize | OverlayShellLegacySize;

const OVERLAY_SHELL_SIZE_NORMALIZE: Record<OverlayShellSize, OverlayShellCanonicalSize> = {
  sm: 'sm',
  md: 'md',
  lg: 'lg',
  xl: 'xl',
  full: 'full',
  S: 'sm',
  M: 'md',
  L: 'lg',
  XL: 'xl',
};

export const OVERLAY_SHELL_SIZE_WIDTH: Record<OverlayShellSize, string> = {
  sm: '480px',
  md: '720px',
  lg: '960px',
  xl: '1120px',
  full: 'calc(100vw - 32px)',
  S: '480px',
  M: '720px',
  L: '960px',
  XL: '1120px',
};

const OVERLAY_SHELL_SIZE_CLASS: Record<OverlayShellCanonicalSize, string> = {
  sm: 'nimi-overlay-panel--size-s',
  md: 'nimi-overlay-panel--size-m',
  lg: 'nimi-overlay-panel--size-l',
  xl: 'nimi-overlay-panel--size-xl',
  full: 'nimi-overlay-panel--size-full',
};

const OVERLAY_SHELL_MAX_WIDTH = 'calc(100vw - 32px)';

type OverlayShellProps = {
  open: boolean;
  kind?: OverlayShellKind;
  /** Edge axis for `kind="drawer"`. Defaults to `'right'`. */
  side?: 'left' | 'right';
  size?: OverlayShellSize;
  onClose?: () => void;
  closeOnBackdrop?: boolean;
  /** Resolve the logical trigger at dismissal when navigation can replace the original control. */
  getReturnFocusTarget?: () => HTMLElement | null;
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
  /** @deprecated Use `'data-testid'` instead. When both are passed, `'data-testid'` wins. */
  dataTestId?: string;
  'data-testid'?: string;
};

function currentFocusTarget(): HTMLElement | null {
  return typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
    ? document.activeElement : null;
}

function OverlayShellPresenceLayer({
  drawerBackdropPositionClass,
  backdropKindClass,
  className,
  backdropMotion,
  description,
  handleCloseAutoFocus,
  closeOnBackdrop,
  resolvedDataTestId,
  defaultWidthClass,
  panelKindClass,
  drawerClasses,
  sizeClass,
  panelClassName,
  panelMotion,
  mergedPanelStyle,
  panelInner,
}: {
  drawerBackdropPositionClass: string;
  backdropKindClass: string;
  className?: string;
  backdropMotion: NimiOverlayMotionProps;
  description?: ReactNode;
  handleCloseAutoFocus: (event: Event) => void;
  closeOnBackdrop: boolean;
  resolvedDataTestId?: string;
  defaultWidthClass: string;
  panelKindClass: string;
  drawerClasses: string;
  sizeClass: string;
  panelClassName?: string;
  panelMotion: NimiOverlayMotionProps;
  mergedPanelStyle?: CSSProperties;
  panelInner: ReactNode;
}) {
  const isPresent = useIsPresent();
  const exitingPointerStyle: CSSProperties | undefined = isPresent ? undefined : { pointerEvents: 'none' };

  return (
    <DialogPrimitive.Portal forceMount>
      <DialogPrimitive.Overlay asChild forceMount style={exitingPointerStyle}>
        <motion.div
          className={cn(
            'nimi-overlay-backdrop fixed z-[var(--nimi-z-dialog)] bg-[var(--nimi-overlay-backdrop)]',
            !isPresent && 'pointer-events-none',
            drawerBackdropPositionClass,
            backdropKindClass,
            className,
          )}
          {...backdropMotion}
          style={{ ...backdropMotion.style, pointerEvents: isPresent ? 'auto' : 'none' }}
        />
      </DialogPrimitive.Overlay>
      <DialogPrimitive.Content asChild forceMount
        aria-modal={isPresent ? 'true' : undefined}
        aria-hidden={!isPresent}
        {...(description ? {} : { 'aria-describedby': undefined })}
        onCloseAutoFocus={handleCloseAutoFocus}
        onPointerDownOutside={closeOnBackdrop ? undefined : (e) => e.preventDefault()}
        onInteractOutside={closeOnBackdrop ? undefined : (e) => e.preventDefault()}
        style={exitingPointerStyle}
      >
        <motion.div
          data-testid={resolvedDataTestId}
          className={cn(
            'nimi-overlay-panel fixed top-1/2 left-1/2 z-[var(--nimi-z-dialog)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] shadow-[var(--nimi-elevation-modal)] w-full',
            !isPresent && 'pointer-events-none',
            defaultWidthClass,
            panelKindClass,
            drawerClasses,
            sizeClass,
            panelClassName,
          )}
          {...panelMotion}
          style={{
            ...panelMotion.style,
            ...mergedPanelStyle,
            ...(isPresent ? undefined : { pointerEvents: 'none' }),
          }}
        >
          {panelInner}
        </motion.div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

// @nimi-authority: rule.nimi.platform.ui-design-system.p-design-013a
// @nimi-authority: rule.nimi.platform.ui-design-system.p-design-013b
export function OverlayShell({
  open,
  kind = 'dialog',
  side = 'right',
  size,
  onClose,
  closeOnBackdrop = true,
  getReturnFocusTarget,
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
  'data-testid': dataTestIdKebab,
}: OverlayShellProps) {
  // Capture before descendants commit: a child's autoFocus runs before
  // Radix's onOpenAutoFocus and would otherwise replace the external trigger.
  const [focusReturn, setFocusReturn] = React.useState(() => ({
    open, target: open ? currentFocusTarget() : null,
  }));
  if (focusReturn.open !== open) {
    setFocusReturn({ open, target: open ? currentFocusTarget() : focusReturn.target });
  }
  const [presenceMounted, setPresenceMounted] = React.useState(open);
  const openRef = React.useRef(open);
  openRef.current = open;
  const reducedMotion = useNimiReducedMotion();
  const panelMotion = nimiOverlayPanelMotion({
    kind: kind === 'drawer' ? 'drawer' : kind === 'popover' ? 'popover' : 'dialog',
    side: kind === 'drawer' ? side : 'bottom',
    reducedMotion,
  });
  const backdropMotion = nimiOverlayBackdropMotion({ reducedMotion });

  React.useEffect(() => {
    if (open) {
      setPresenceMounted(true);
      return;
    }
    if (!presenceMounted) return;
    // A background Electron renderer may defer Motion's exit callback after
    // the panel has visually finished. Keep the spring, then release its DOM.
    const delayMs = reducedMotion ? 250 : NIMI_SPRING_DEFAULT.responseSeconds * 1000 + 200;
    const timer = window.setTimeout(() => setPresenceMounted(false), delayMs);
    return () => window.clearTimeout(timer);
  }, [open, presenceMounted, reducedMotion]);

  const finishExit = () => {
    if (!openRef.current) setPresenceMounted(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && onClose) onClose();
  };

  const handleCloseAutoFocus = (event: Event) => {
    // A successful action may have moved focus to its destination while the
    // old overlay exits. Neither our restoration nor Radix's fallback may
    // take that focus back, even when the old trigger is still mounted.
    event.preventDefault();
    const activeElement = document.activeElement;
    const closingScope = event.target instanceof HTMLElement ? event.target : null;
    if (activeElement && activeElement !== document.body && activeElement !== document.documentElement
      && !closingScope?.contains(activeElement)) return;
    const target = getReturnFocusTarget?.() ?? focusReturn.target;
    if (target?.isConnected && !target.matches(':disabled')) target.focus({ preventScroll: true });
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

  const drawerBackdropPositionClass = kind === 'drawer'
    ? 'top-[var(--nimi-titlebar-area-height,env(titlebar-area-height,0px))] right-0 bottom-0 left-0'
    : 'inset-0';

  const drawerClasses = kind === 'drawer'
    ? (side === 'left'
      ? 'top-[var(--nimi-titlebar-area-height,env(titlebar-area-height,0px))] left-0 bottom-0 right-auto h-[calc(100dvh-var(--nimi-titlebar-area-height,env(titlebar-area-height,0px)))] max-h-[calc(100dvh-var(--nimi-titlebar-area-height,env(titlebar-area-height,0px)))] translate-x-0 translate-y-0 max-w-sm rounded-r-[var(--nimi-radius-lg)] rounded-l-none'
      : 'top-[var(--nimi-titlebar-area-height,env(titlebar-area-height,0px))] right-0 bottom-0 left-auto h-[calc(100dvh-var(--nimi-titlebar-area-height,env(titlebar-area-height,0px)))] max-h-[calc(100dvh-var(--nimi-titlebar-area-height,env(titlebar-area-height,0px)))] translate-x-0 translate-y-0 max-w-sm rounded-l-[var(--nimi-radius-lg)] rounded-r-none')
    : '';

  const canonicalSize = size === undefined ? undefined : OVERLAY_SHELL_SIZE_NORMALIZE[size];
  const hasSize = canonicalSize !== undefined;
  const sizeClass = hasSize ? OVERLAY_SHELL_SIZE_CLASS[canonicalSize] : '';
  const defaultWidthClass = hasSize ? '' : 'max-w-[min(28rem,calc(100vw-2rem))]';

  const mergedPanelStyle: CSSProperties | undefined = hasSize
    ? { width: OVERLAY_SHELL_SIZE_WIDTH[canonicalSize], maxWidth: OVERLAY_SHELL_MAX_WIDTH, ...panelStyle }
    : panelStyle;

  const hasSidebar = sidebar !== undefined;

  const titleNode = title || description ? (
    <div className="nimi-overlay-title px-6 pt-6 pb-2">
      {title ? (
        <DialogPrimitive.Title asChild>
          <div className="text-[length:var(--nimi-type-section-title-size)] font-[var(--nimi-type-section-title-weight)] leading-[var(--nimi-type-section-title-line-height)] tracking-[var(--nimi-type-section-title-letter-spacing)] text-[var(--nimi-text-primary)]">{title}</div>
        </DialogPrimitive.Title>
      ) : null}
      {description ? (
        <DialogPrimitive.Description asChild>
          <div className="mt-1 text-[length:var(--nimi-type-body-sm-size)] font-normal leading-[var(--nimi-type-body-sm-line-height)] text-[var(--nimi-text-secondary)]">{description}</div>
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
      {presenceMounted ? <AnimatePresence onExitComplete={finishExit}>
        {open ? (
          <OverlayShellPresenceLayer
            drawerBackdropPositionClass={drawerBackdropPositionClass}
            backdropKindClass={backdropKindClass}
            className={className}
            backdropMotion={backdropMotion}
            description={description}
            handleCloseAutoFocus={handleCloseAutoFocus}
            closeOnBackdrop={closeOnBackdrop}
            resolvedDataTestId={dataTestIdKebab ?? dataTestId}
            defaultWidthClass={defaultWidthClass}
            panelKindClass={panelKindClass}
            drawerClasses={drawerClasses}
            sizeClass={sizeClass}
            panelClassName={panelClassName}
            panelMotion={panelMotion}
            mergedPanelStyle={mergedPanelStyle}
            panelInner={panelInner}
          />
        ) : null}
      </AnimatePresence> : null}
    </Dialog>
  );
}
