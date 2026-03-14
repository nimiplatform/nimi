import { useEffect, useState, type RefObject } from 'react';

export type ScrollShellMetrics = {
  visible: boolean;
  top: number;
  height: number;
};

export type UseScrollShellMetricsOptions = {
  thumbMinHeight?: number;
  railInsetTop?: number;
  railInsetBottom?: number;
  hideRailWhenNotScrollable?: boolean;
};

const DEFAULT_METRICS: ScrollShellMetrics = {
  visible: false,
  top: 0,
  height: 0,
};

export function useScrollShellMetrics(
  viewportRef: RefObject<HTMLDivElement | null>,
  options: UseScrollShellMetricsOptions = {},
): ScrollShellMetrics {
  const {
    thumbMinHeight = 44,
    railInsetTop = 12,
    railInsetBottom = 12,
    hideRailWhenNotScrollable = true,
  } = options;
  const [metrics, setMetrics] = useState<ScrollShellMetrics>(DEFAULT_METRICS);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) {
      return;
    }

    const updateMetrics = () => {
      const { scrollTop, clientHeight, scrollHeight } = node;
      const trackHeight = clientHeight - railInsetTop - railInsetBottom;
      if (trackHeight <= 0) {
        setMetrics(DEFAULT_METRICS);
        return;
      }

      if (scrollHeight <= clientHeight + 1) {
        setMetrics({
          visible: !hideRailWhenNotScrollable,
          top: 0,
          height: Math.max(trackHeight, 0),
        });
        return;
      }

      const thumbHeight = Math.max(thumbMinHeight, (clientHeight / scrollHeight) * trackHeight);
      const maxThumbTop = Math.max(trackHeight - thumbHeight, 0);
      const maxScrollTop = Math.max(scrollHeight - clientHeight, 1);
      const thumbTop = (scrollTop / maxScrollTop) * maxThumbTop;

      setMetrics({
        visible: true,
        top: thumbTop,
        height: thumbHeight,
      });
    };

    updateMetrics();
    node.addEventListener('scroll', updateMetrics, { passive: true });
    window.addEventListener('resize', updateMetrics);

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => updateMetrics())
      : null;
    resizeObserver?.observe(node);

    return () => {
      node.removeEventListener('scroll', updateMetrics);
      window.removeEventListener('resize', updateMetrics);
      resizeObserver?.disconnect();
    };
  }, [hideRailWhenNotScrollable, railInsetBottom, railInsetTop, thumbMinHeight, viewportRef]);

  return metrics;
}
