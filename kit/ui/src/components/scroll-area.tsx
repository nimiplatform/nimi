import { forwardRef, type CSSProperties, type ReactNode, type Ref } from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { cn } from '../design-tokens.js';

export type ScrollAreaFadeEdges = boolean | 'top' | 'bottom' | 'both';

export type ScrollAreaProps = {
  children: ReactNode;
  className?: string;
  viewportClassName?: string;
  contentClassName?: string;
  viewportRef?: Ref<HTMLDivElement>;
  /** Apply subtle vertical mask fading along scroll edges without blocking pointer events. */
  fadeEdges?: ScrollAreaFadeEdges;
};

function resolveFadeMaskStyle(fadeEdges: ScrollAreaFadeEdges | undefined): CSSProperties | undefined {
  if (!fadeEdges) return undefined;
  const gradient = fadeEdges === 'top'
    ? 'linear-gradient(to bottom, transparent 0, black 16px, black 100%)'
    : fadeEdges === 'bottom'
      ? 'linear-gradient(to bottom, black 0, black calc(100% - 16px), transparent 100%)'
      : 'linear-gradient(to bottom, transparent 0, black 14px, black calc(100% - 14px), transparent 100%)';
  return {
    maskImage: gradient,
    WebkitMaskImage: gradient,
  };
}

export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea(
  {
    children,
    className,
    viewportClassName,
    contentClassName,
    viewportRef,
    fadeEdges,
  },
  ref,
) {
  const fadeMaskStyle = resolveFadeMaskStyle(fadeEdges);
  return (
    <ScrollAreaPrimitive.Root
      ref={ref}
      className={cn('relative min-h-0 overflow-hidden', className)}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-fade-edges={fadeEdges ? (fadeEdges === true ? 'both' : fadeEdges) : undefined}
        style={fadeMaskStyle}
        // This primitive only scrolls vertically. Radix's table content wrapper
        // otherwise expands to intrinsic width and clips actions beside text.
        className={cn('h-full max-h-[inherit] w-full rounded-[inherit] [&>div]:!block', viewportClassName)}
      >
        {contentClassName ? <div className={contentClassName}>{children}</div> : children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="flex touch-none select-none p-0.5 data-[orientation=vertical]:w-2.5 transition-opacity duration-[var(--nimi-motion-base)] data-[state=hidden]:opacity-0 data-[state=visible]:opacity-100"
      >
        <ScrollAreaPrimitive.Thumb
          className="relative flex-1 rounded-full bg-[var(--nimi-scrollbar-thumb)] hover:bg-[var(--nimi-scrollbar-thumb-hover)] transition-colors"
        />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
});
