export type DesktopVirtualItem = {
  readonly index: number;
  readonly start: number;
};

export type DesktopVirtualizerOptions = {
  readonly count: number;
  readonly getScrollElement: () => Element | null;
  readonly estimateSize: () => number;
  readonly overscan: number;
  readonly scrollMargin?: number;
  readonly enabled: boolean;
};

export type DesktopVirtualizerProjection = {
  getTotalSize(): number;
  getVirtualItems(): readonly DesktopVirtualItem[];
  measureElement(element: Element | null): void;
};

export interface DesktopRendererVirtualizationPort {
  useVirtualizer(options: DesktopVirtualizerOptions): DesktopVirtualizerProjection;
}

export function createDeterministicDesktopVirtualizationPort(): DesktopRendererVirtualizationPort {
  return Object.freeze({
    useVirtualizer(options: DesktopVirtualizerOptions): DesktopVirtualizerProjection {
      const size = options.estimateSize();
      const items = options.enabled
        ? Array.from({ length: options.count }, (_, index) => Object.freeze({ index, start: index * size }))
        : [];
      return Object.freeze({
        getTotalSize: () => options.enabled ? options.count * size : 0,
        getVirtualItems: () => items,
        measureElement: () => undefined,
      });
    },
  });
}
