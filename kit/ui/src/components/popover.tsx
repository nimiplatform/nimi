import React, { createContext, useContext, useState, type MouseEventHandler, type ReactNode } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '../design-tokens.js';
import {
  AnimatePresence,
  motion,
  nimiOverlayPanelMotion,
  useNimiReducedMotion,
} from '../motion/index.js';

/**
 * Presence context: Radix roots own the open state; the content layer
 * reads it here so AnimatePresence can run spring exit motion before
 * unmount (P-DESIGN-027 — popover motion is spring-based, side-aware,
 * and anchored to its trigger).
 */
const PopoverPresenceContext = createContext(false);

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
  return (
    <PopoverPrimitive.Root
      open={open}
      defaultOpen={defaultOpen}
      modal={modal}
      onOpenChange={(next) => {
        setInternalOpen(next);
        onOpenChange?.(next);
      }}
    >
      <PopoverPresenceContext.Provider value={actualOpen}>
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
};

export function PopoverContent({
  className,
  align = 'center',
  side = 'bottom',
  sideOffset = 4,
  children,
  ...rest
}: PopoverContentProps) {
  const open = useContext(PopoverPresenceContext);
  const reducedMotion = useNimiReducedMotion();
  const panelMotion = nimiOverlayPanelMotion({ kind: 'popover', side, reducedMotion });

  // Structure: the outer Radix Content owns popper positioning (its own
  // inline transform); the inner motion element owns the visual chrome
  // and the enter/exit spring. Keeping positioning and animation on
  // separate elements avoids the popper-transform conflict.
  return (
    <AnimatePresence>
      {open ? (
        <PopoverPrimitive.Portal forceMount>
          <PopoverPrimitive.Content forceMount
            align={align}
            side={side}
            sideOffset={sideOffset}
            className="z-[var(--nimi-z-popover)] outline-none"
            {...rest}
          >
            <motion.div
              className={cn(
                // Kit-owned shell: default padding, material boundary, and
                // elevation so consumers supply content, not chrome.
                'nimi-overlay-panel nimi-overlay-panel--popover rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] p-[var(--nimi-space-4)] shadow-[var(--nimi-elevation-floating)]',
                className,
              )}
              {...panelMotion}
              style={panelMotion.style}
            >
              {children}
            </motion.div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      ) : null}
    </AnimatePresence>
  );
}
