import type { CSSProperties } from 'react';

export const WORLD_DETAIL_PAPER_PAGE_MAX_WIDTH = 1180;
export const WORLD_DETAIL_PAPER_TOP_PADDING = '20px';
export const WORLD_DETAIL_PAPER_CONTENT_PADDING = `${WORLD_DETAIL_PAPER_TOP_PADDING} 28px 80px`;

export function worldDetailPaperContentFrameStyle(overrides: CSSProperties = {}): CSSProperties {
  return {
    position: 'relative',
    zIndex: 1,
    maxWidth: WORLD_DETAIL_PAPER_PAGE_MAX_WIDTH,
    margin: '0 auto',
    padding: WORLD_DETAIL_PAPER_CONTENT_PADDING,
    ...overrides,
  };
}
