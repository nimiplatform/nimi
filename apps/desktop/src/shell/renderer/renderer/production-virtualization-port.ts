import { useVirtualizer } from '@tanstack/react-virtual';
import type {
  DesktopRendererVirtualizationPort,
  DesktopVirtualizerOptions,
} from './virtualization-port.js';

export function createDesktopProductionVirtualizationPort(): DesktopRendererVirtualizationPort {
  return Object.freeze({
    useVirtualizer(options: DesktopVirtualizerOptions) {
      return useVirtualizer({
        count: options.count,
        getScrollElement: options.getScrollElement,
        estimateSize: options.estimateSize,
        overscan: options.overscan,
        scrollMargin: options.scrollMargin,
        enabled: options.enabled,
      });
    },
  });
}
