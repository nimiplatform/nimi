import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEventHandler, type ReactNode } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '../design-tokens.js';
import {
  AnimatePresence,
  motion,
  nimiOverlayPanelMotion,
  useIsPresent,
  useNimiReducedMotion,
  type NimiOverlayMotionProps,
  type NimiPopoverSide,
} from '../motion/index.js';
import {
  OverlayExitCapture,
  OverlayExitGhost,
  captureOverlayExitSnapshot,
  type OverlayExitSnapshot,
} from './overlay-exit-ghost.js';

/**
 * Presence context: Radix roots own the open state; the content layer
 * reads it here so AnimatePresence can run spring exit motion before
 * unmount (P-DESIGN-027 — popover motion is spring-based, side-aware,
 * and anchored to its trigger). Modal popovers additionally unmount Radix's
 * DismissableLayer/RemoveScroll synchronously on close and play exit motion
 * through OverlayExitGhost so body pointer-events release immediately.
 */
type PopoverPresenceState = {
  readonly open: boolean;
  readonly modal: boolean;
  readonly registerBeforeClose: (handler: (() => void) | null) => void;
};

const PopoverPresenceContext = createContext<PopoverPresenceState>({
  open: false,
  modal: false,
  registerBeforeClose: () => {},
});

type PopoverProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
  modal?: boolean;
};

export function Popover({ open, defaultOpen, onOpenChange, children, modal }: PopoverProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
  const actualOpen = open ?? internalOpen;
  const isModal = Boolean(modal);
  const beforeCloseRef = useRef<(() => void) | null>(null);
  const registerBeforeClose = useCallback((handler: (() => void) | null) => {
    beforeCloseRef.current = handler;
  }, []);
  const contextValue = useMemo<PopoverPresenceState>(
    () => ({ open: actualOpen, modal: isModal, registerBeforeClose }),
    [actualOpen, isModal, registerBeforeClose],
  );
  return (
    <PopoverPrimitive.Root
      open={open}
      defaultOpen={defaultOpen}
      modal={modal}
      onOpenChange={(next) => {
        if (!next && isModal) {
          beforeCloseRef.current?.();
        }
        setInternalOpen(next);
        onOpenChange?.(next);
      }}
    >
      <PopoverPresenceContext.Provider value={contextValue}>
        {children}
      </PopoverPresenceContext.Provider>
    </PopoverPrimitive.Root>
  );
}

export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

type PopoverContentProps = {
  className?: string;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
  children?: ReactNode;
  onMouseEnter?: MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: MouseEventHandler<HTMLDivElement>;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onInteractOutside?: React.ComponentProps<typeof PopoverPrimitive.Content>['onInteractOutside'];
};

function PopoverPresenceLayer({
  contentRef,
  align,
  side,
  sideOffset,
  rest,
  className,
  panelMotion,
  children,
}: {
  contentRef: (node: HTMLDivElement | null) => void;
  align: 'start' | 'center' | 'end';
  side: 'top' | 'right' | 'bottom' | 'left';
  sideOffset: number;
  rest: Omit<PopoverContentProps, 'className' | 'align' | 'side' | 'sideOffset' | 'children'>;
  className?: string;
  panelMotion: NimiOverlayMotionProps;
  children?: ReactNode;
}) {
  const isPresent = useIsPresent();
  return (
    <PopoverPrimitive.Portal forceMount>
      <PopoverPrimitive.Content
        ref={contentRef}
        forceMount
        align={align}
        side={side}
        sideOffset={sideOffset}
        aria-hidden={!isPresent || undefined}
        className={cn('z-[var(--nimi-z-popover)] outline-none', !isPresent && 'pointer-events-none')}
        style={isPresent ? undefined : { pointerEvents: 'none' }}
        {...rest}
      >
        <motion.div
          className={cn(
            // Kit-owned shell: default padding, material boundary, and
            // elevation so consumers supply content, not chrome.
            'nimi-overlay-panel nimi-overlay-panel--popover rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] p-[var(--nimi-space-4)] shadow-[var(--nimi-elevation-floating)]',
            !isPresent && 'pointer-events-none',
            className,
          )}
          {...panelMotion}
          style={{ ...panelMotion.style, ...(isPresent ? undefined : { pointerEvents: 'none' }) }}
        >
          {children}
        </motion.div>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

export function PopoverContent({
  className,
  align = 'center',
  side = 'bottom',
  sideOffset = 4,
  children,
  ...rest
}: PopoverContentProps) {
  const { open, modal, registerBeforeClose } = useContext(PopoverPresenceContext);
  const openRef = useRef(open);
  openRef.current = open;
  const reducedMotion = useNimiReducedMotion();
  const [resolvedSide, setResolvedSide] = useState<NimiPopoverSide>(side);
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  const contentElRef = useRef<HTMLDivElement | null>(null);
  const [exitSnapshot, setExitSnapshot] = useState<OverlayExitSnapshot | null>(null);
  const capturedExitRef = useRef(false);
  const contentRef = useCallback((node: HTMLDivElement | null) => {
    if (node) contentElRef.current = node;
    setContentEl(node);
  }, []);

  useEffect(() => {
    setResolvedSide(side);
  }, [side]);

  useEffect(() => {
    if (!contentEl) return;
    const syncSide = () => {
      const attr = contentEl.getAttribute('data-side');
      if (attr === 'top' || attr === 'right' || attr === 'bottom' || attr === 'left') {
        setResolvedSide(attr);
      }
    };
    syncSide();
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(syncSide);
    observer.observe(contentEl, { attributes: true, attributeFilter: ['data-side'] });
    return () => observer.disconnect();
  }, [contentEl]);

  const captureExitSnapshot = useCallback(() => {
    if (!modal || capturedExitRef.current) return;
    const snapshot = captureOverlayExitSnapshot(contentElRef.current, resolvedSide);
    if (!snapshot) return;
    capturedExitRef.current = true;
    setExitSnapshot(snapshot);
  }, [modal, resolvedSide]);

  useEffect(() => {
    if (!modal) return undefined;
    registerBeforeClose(captureExitSnapshot);
    return () => registerBeforeClose(null);
  }, [modal, registerBeforeClose, captureExitSnapshot]);

  useEffect(() => {
    if (open) {
      capturedExitRef.current = false;
      setExitSnapshot(null);
    }
  }, [open]);

  const clearExitSnapshot = useCallback((id: number) => {
    setExitSnapshot((current) => (current?.id === id ? null : current));
  }, []);

  const panelMotion = nimiOverlayPanelMotion({ kind: 'popover', side: resolvedSide, align, reducedMotion });
  const ghostMotion = nimiOverlayPanelMotion({
    kind: 'popover',
    side: exitSnapshot?.side ?? resolvedSide,
    align,
    reducedMotion,
  });

  if (modal) {
    return (
      <>
        {open ? (
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              ref={contentRef}
              align={align}
              side={side}
              sideOffset={sideOffset}
              className="z-[var(--nimi-z-popover)] outline-none"
              {...rest}
            >
              <OverlayExitCapture onBeforeUnmount={() => {
                if (!openRef.current) captureExitSnapshot();
              }} />
              <motion.div
                className={cn(
                  'nimi-overlay-panel nimi-overlay-panel--popover rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] p-[var(--nimi-space-4)] shadow-[var(--nimi-elevation-floating)]',
                  className,
                )}
                initial={panelMotion.initial}
                animate={panelMotion.animate}
                transition={panelMotion.transition}
                style={panelMotion.style}
              >
                {children}
              </motion.div>
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        ) : null}
        <OverlayExitGhost
          snapshot={exitSnapshot}
          panelMotion={ghostMotion}
          reducedMotion={reducedMotion}
          onComplete={clearExitSnapshot}
        />
      </>
    );
  }

  // Structure: the outer Radix Content owns popper positioning (its own
  // inline transform); the inner motion element owns the visual chrome
  // and the enter/exit spring. Keeping positioning and animation on
  // separate elements avoids the popper-transform conflict.
  return (
    <AnimatePresence>
      {open ? (
        <PopoverPresenceLayer
          contentRef={contentRef}
          align={align}
          side={side}
          sideOffset={sideOffset}
          rest={rest}
          className={className}
          panelMotion={panelMotion}
        >
          {children}
        </PopoverPresenceLayer>
      ) : null}
    </AnimatePresence>
  );
}
