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
