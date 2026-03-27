import { forwardRef, type ReactNode, type Ref } from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { cn } from '../design-tokens.js';

export type ScrollAreaProps = {
  children: ReactNode;
  className?: string;
  viewportClassName?: string;
  contentClassName?: string;
  viewportRef?: Ref<HTMLDivElement>;
};

export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea(
  {
    children,
    className,
    viewportClassName,
    contentClassName,
    viewportRef,
  },
  ref,
) {
  return (
    <ScrollAreaPrimitive.Root
      ref={ref}
      className={cn('relative min-h-0 overflow-hidden', className)}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        className={cn('h-full w-full rounded-[inherit]', viewportClassName)}
      >
        {contentClassName ? <div className={contentClassName}>{children}</div> : children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="flex touch-none select-none p-0.5 transition-colors data-[orientation=vertical]:w-2.5"
      >
        <ScrollAreaPrimitive.Thumb
          className="relative flex-1 rounded-full bg-[var(--nimi-scrollbar-thumb)] hover:bg-[var(--nimi-scrollbar-thumb-hover)] transition-colors"
        />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
});
