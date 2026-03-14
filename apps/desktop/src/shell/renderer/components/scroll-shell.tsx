import { forwardRef, useCallback, useRef, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { useScrollShellMetrics } from './use-scroll-shell-metrics.js';

type ScrollShellTag = 'div' | 'main' | 'aside' | 'nav' | 'section';

export type ScrollShellProps = {
  as?: ScrollShellTag;
  children: ReactNode;
  className?: string;
  viewportClassName?: string;
  contentClassName?: string;
  viewportRef?: Ref<HTMLDivElement>;
  thumbMinHeight?: number;
  railInsetTop?: number;
  railInsetBottom?: number;
  hideRailWhenNotScrollable?: boolean;
  railClassName?: string;
  thumbClassName?: string;
} & Omit<HTMLAttributes<HTMLElement>, 'children'>;

function joinClasses(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function assignRef<T>(ref: Ref<T> | undefined, value: T): void {
  if (!ref) {
    return;
  }
  if (typeof ref === 'function') {
    ref(value);
    return;
  }
  (ref as { current: T }).current = value;
}

export const ScrollShell = forwardRef<HTMLDivElement, ScrollShellProps>(function ScrollShell(props, forwardedRef) {
  const {
    as = 'div',
    children,
    className,
    viewportClassName,
    contentClassName,
    viewportRef,
    thumbMinHeight = 44,
    railInsetTop = 12,
    railInsetBottom = 12,
    hideRailWhenNotScrollable = true,
    railClassName,
    thumbClassName,
    ...rest
  } = props;
  const viewportNodeRef = useRef<HTMLDivElement>(null);
  const Tag = as;
  const metrics = useScrollShellMetrics(viewportNodeRef, {
    thumbMinHeight,
    railInsetTop,
    railInsetBottom,
    hideRailWhenNotScrollable,
  });

  const handleViewportRef = useCallback((node: HTMLDivElement | null) => {
    viewportNodeRef.current = node;
    assignRef(forwardedRef, node);
    assignRef(viewportRef, node);
  }, [forwardedRef, viewportRef]);

  return (
    <Tag className={joinClasses('relative min-h-0', className)} {...rest}>
      <div
        ref={handleViewportRef}
        className={joinClasses('scroll-shell__viewport h-full overflow-y-auto', viewportClassName)}
      >
        {contentClassName ? <div className={contentClassName}>{children}</div> : children}
      </div>
      {metrics.visible ? (
        <div
          className={joinClasses('pointer-events-none absolute right-1 z-10 w-[10px]', railClassName)}
          style={{ top: `${railInsetTop}px`, bottom: `${railInsetBottom}px` }}
        >
          <div className="absolute inset-x-[3px] inset-y-0 rounded-full bg-transparent" />
          <div
            className={joinClasses(
              'absolute right-[1px] w-[6px] rounded-full bg-[rgba(148,163,184,0.36)] transition-colors duration-200',
              thumbClassName,
            )}
            style={{
              top: `${metrics.top}px`,
              height: `${metrics.height}px`,
            }}
          />
        </div>
      ) : null}
    </Tag>
  );
});
