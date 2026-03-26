import React, { type ReactNode } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '../design-tokens.js';

export const TooltipProvider = TooltipPrimitive.Provider;

const CONTENT_CLASSES =
  'z-[var(--nimi-z-tooltip)] rounded-[var(--nimi-radius-sm)] bg-[var(--nimi-surface-overlay)] border border-[var(--nimi-border-subtle)] px-3 py-1.5 text-[length:var(--nimi-type-caption-size)] leading-[var(--nimi-type-caption-line-height)] shadow-[var(--nimi-elevation-floating)] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2';

type TooltipProps = {
  children: ReactNode;
  content: ReactNode;
  placement?: 'top' | 'bottom';
  className?: string;
  contentClassName?: string;
  delayDuration?: number;
};

export function Tooltip({
  children,
  content,
  placement = 'bottom',
  className,
  contentClassName,
  delayDuration = 300,
}: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <span className={cn('inline-flex items-center justify-center', className)}>
            {children}
          </span>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={placement}
            sideOffset={8}
            className={cn(CONTENT_CLASSES, contentClassName)}
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export function TooltipTrigger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <TooltipPrimitive.Trigger asChild>
      <span className={cn('inline-flex', className)}>{children}</span>
    </TooltipPrimitive.Trigger>
  );
}

export function TooltipContent({ children, className, ...rest }: { children: ReactNode; className?: string; side?: 'top' | 'bottom'; sideOffset?: number }) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={8}
        className={cn(CONTENT_CLASSES, className)}
        {...rest}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}
