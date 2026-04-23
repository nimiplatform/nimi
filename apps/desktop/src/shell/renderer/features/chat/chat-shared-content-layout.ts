// Unified content width for chat transcript + composer across agent, nimi, and
// human modes. Parent containers already exclude side-sheets/rails via flex
// layout, so this is a pure max-width ceiling with centering — no viewport math.
export const CHAT_CONTENT_WIDTH_CLASS = 'max-w-[720px]';
export const CHAT_CONTENT_POSITION_CLASS = 'mx-auto';
