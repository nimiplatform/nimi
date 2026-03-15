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

function clampMetric(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 100) / 100;
}

function createMetrics(
  visible: boolean,
  top: number,
  height: number,
): ScrollShellMetrics {
  return {
    visible,
    top: clampMetric(top),
    height: clampMetric(height),
  };
}

function areMetricsEqual(left: ScrollShellMetrics, right: ScrollShellMetrics): boolean {
  return left.visible === right.visible
    && left.top === right.top
    && left.height === right.height;
}

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
      let nextMetrics = DEFAULT_METRICS;

      if (trackHeight <= 0) {
        nextMetrics = DEFAULT_METRICS;
      } else if (scrollHeight <= clientHeight + 1) {
        nextMetrics = createMetrics(
          !hideRailWhenNotScrollable,
          0,
          Math.max(trackHeight, 0),
        );
      } else {
        const thumbHeight = Math.max(thumbMinHeight, (clientHeight / scrollHeight) * trackHeight);
        const maxThumbTop = Math.max(trackHeight - thumbHeight, 0);
        const maxScrollTop = Math.max(scrollHeight - clientHeight, 1);
        const thumbTop = (scrollTop / maxScrollTop) * maxThumbTop;

        nextMetrics = createMetrics(true, thumbTop, thumbHeight);
      }

      setMetrics((current) => (areMetricsEqual(current, nextMetrics) ? current : nextMetrics));
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
