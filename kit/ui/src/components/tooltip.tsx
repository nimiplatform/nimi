import React, { createContext, useContext, useState, type ReactNode } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '../design-tokens.js';
import {
  AnimatePresence,
  motion,
  nimiOverlayPanelMotion,
  useNimiReducedMotion,
} from '../motion/index.js';

export const TooltipProvider = TooltipPrimitive.Provider;

/**
 * `null` = unmanaged (TooltipContent used outside the kit Tooltip root):
 * render instantly with no motion rather than breaking presence.
 */
const TooltipPresenceContext = createContext<boolean | null>(null);

const BUBBLE_CLASSES =
  'nimi-tooltip-layer nimi-tooltip-bubble rounded-[var(--nimi-radius-sm)] bg-[var(--nimi-surface-overlay)] border border-[var(--nimi-border-subtle)] px-3 py-1.5 text-[length:var(--nimi-type-caption-size)] leading-[var(--nimi-type-caption-line-height)] shadow-[var(--nimi-elevation-floating)]';

export type TooltipPlacement = 'top' | 'right' | 'bottom' | 'left';

function MotionTooltipBubble({
  side,
  className,
  children,
}: {
  side: TooltipPlacement;
  className?: string;
  children?: ReactNode;
}) {
  const reducedMotion = useNimiReducedMotion();
  const panelMotion = nimiOverlayPanelMotion({ kind: 'popover', side, reducedMotion });
  return (
    <motion.div
      className={cn(BUBBLE_CLASSES, className)}
      {...panelMotion}
      style={panelMotion.style}
    >
      {children}
    </motion.div>
  );
}

type TooltipProps = {
  children: ReactNode;
  content: ReactNode;
  placement?: TooltipPlacement;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  contentClassName?: string;
};

export function Tooltip({
  children,
  content,
  placement = 'bottom',
  open,
  defaultOpen,
  onOpenChange,
  className,
  contentClassName,
}: TooltipProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
  const actualOpen = open ?? internalOpen;
  return (
    <TooltipPrimitive.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={(next) => {
        setInternalOpen(next);
        onOpenChange?.(next);
      }}
    >
      <TooltipPresenceContext.Provider value={actualOpen}>
        <TooltipPrimitive.Trigger asChild>
          <span className={cn('inline-flex items-center justify-center', className)}>
            {children}
          </span>
        </TooltipPrimitive.Trigger>
        <AnimatePresence>
          {actualOpen ? (
            <TooltipPrimitive.Portal forceMount>
              {/* Outer Content owns popper positioning; inner bubble owns
                  visual chrome + spring (P-DESIGN-027). */}
              <TooltipPrimitive.Content forceMount side={placement} sideOffset={8} className="z-[var(--nimi-z-tooltip)]">
                <MotionTooltipBubble side={placement} className={contentClassName}>
                  {content}
                </MotionTooltipBubble>
              </TooltipPrimitive.Content>
            </TooltipPrimitive.Portal>
          ) : null}
        </AnimatePresence>
      </TooltipPresenceContext.Provider>
    </TooltipPrimitive.Root>
  );
}

export function TooltipTrigger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <TooltipPrimitive.Trigger asChild>
      <span className={cn('inline-flex', className)}>{children}</span>
    </TooltipPrimitive.Trigger>
  );
}

export function TooltipContent({ children, className, side = 'bottom', sideOffset = 8, ...rest }: { children: ReactNode; className?: string; side?: TooltipPlacement; sideOffset?: number }) {
  const managedOpen = useContext(TooltipPresenceContext);
  if (managedOpen === null) {
    // Unmanaged usage: render instantly (no dead classes, no motion).
    return (
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={sideOffset} className="z-[var(--nimi-z-tooltip)]" {...rest}>
          <div className={cn(BUBBLE_CLASSES, className)}>{children}</div>
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    );
  }
  return (
    <AnimatePresence>
      {managedOpen ? (
        <TooltipPrimitive.Portal forceMount>
          <TooltipPrimitive.Content forceMount side={side} sideOffset={sideOffset} className="z-[var(--nimi-z-tooltip)]" {...rest}>
            <MotionTooltipBubble side={side} className={className}>
              {children}
            </MotionTooltipBubble>
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      ) : null}
    </AnimatePresence>
  );
}
