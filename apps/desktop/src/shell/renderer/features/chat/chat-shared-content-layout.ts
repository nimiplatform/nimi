// Unified content width for chat transcript + composer across agent, nimi, and
// human modes. Parent containers already exclude side-sheets/rails via flex
// layout, so this is a pure max-width ceiling with centering — no viewport math.
export const CHAT_CONTENT_WIDTH_CLASS = 'max-w-[720px]';
export const CHAT_CONTENT_POSITION_CLASS = 'mx-auto';
// Scroll viewport spans to the pane edge (window edge), with the relationship
// rail floating as an overlay; pr-[76px] keeps the centered content column in
// the same place it had when the rail consumed layout width.
export const CHAT_TRANSCRIPT_SCROLL_VIEWPORT_CLASS = 'w-full pr-[76px] [scrollbar-gutter:stable]';
export const CHAT_TRANSCRIPT_SCROLL_POSITION_CLASS = '';
// Same reservation for the composer row so the composer column stays aligned
// with the transcript column below it. 68px (not 76) because the transcript's
// centering box additionally loses its 8px scrollbar gutter on the right.
export const CHAT_COMPOSER_RAIL_RESERVE_CLASS = 'pr-[60px]';
// Same reservation for the side sheets (settings, thread list): they are
// in-flow flex items, so the right margin must clear the 72px floating rail
// (right-4 + w-14) plus 4px breathing room, matching the transcript reserve.
export const CHAT_SIDE_SHEET_RAIL_RESERVE_CLASS = 'mr-[76px]';
// Bottom reserve so the last message can scroll clear of the floating composer
// overlay (composer card ≈90px + breathing room).
export const CHAT_TRANSCRIPT_BOTTOM_RESERVE_CLASS = 'pb-[clamp(140px,16vh,200px)]';
