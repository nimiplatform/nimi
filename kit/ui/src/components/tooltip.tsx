import React, { createContext, useContext, useState, type ReactNode } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { FOCUS_RING_CLASS_NAME } from '../a11y/focus.js';
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

type TooltipTriggerElementProps = {
  className?: string;
  tabIndex?: number;
  href?: string;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
};

function tooltipTriggerChild(children: ReactNode, className?: string) {
  if (React.isValidElement<TooltipTriggerElementProps>(children) && children.type !== React.Fragment) {
    if (children.props.disabled === true) {
      return (
        <span
          tabIndex={0}
          role="button"
          aria-disabled="true"
          aria-label={children.props['aria-label']}
          aria-labelledby={children.props['aria-labelledby']}
          className={cn('inline-flex items-center justify-center', FOCUS_RING_CLASS_NAME, className)}
        >
          {React.cloneElement(children, {
            className: cn('pointer-events-none', children.props.className),
            tabIndex: -1,
          })}
        </span>
      );
    }
    const nativeType = typeof children.type === 'string' ? children.type : null;
    const nativeInteractive = nativeType === 'button'
      || nativeType === 'input'
      || nativeType === 'select'
      || nativeType === 'textarea'
      || (nativeType === 'a' && Boolean(children.props.href));
    const addKeyboardFocus = Boolean(nativeType) && !nativeInteractive && children.props.tabIndex === undefined;
    return React.cloneElement(children, {
      className: cn(
        'inline-flex items-center justify-center',
        addKeyboardFocus && FOCUS_RING_CLASS_NAME,
        children.props.className,
        className,
      ),
      tabIndex: addKeyboardFocus ? 0 : children.props.tabIndex,
    });
  }
  return (
    <span tabIndex={0} className={cn('inline-flex items-center justify-center', FOCUS_RING_CLASS_NAME, className)}>
      {children}
    </span>
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
          {tooltipTriggerChild(children, className)}
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
      {tooltipTriggerChild(children, className)}
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
