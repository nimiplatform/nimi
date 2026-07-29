export type MainLayoutTitlebarFrame = {
  readonly topInsetClass: 'top-0' | 'top-7';
  readonly contentTopPaddingClass: 'pt-14' | 'pt-[calc(3.5rem+1.75rem)]';
  readonly settingsMenuFallbackTop: 64 | 92;
  readonly leftInsetClass: 'pl-3' | 'pl-[92px]';
};

export function resolveMainLayoutTitlebarFrame(
  titlebarDragEnabled: boolean,
): MainLayoutTitlebarFrame {
  return titlebarDragEnabled
    ? Object.freeze({
      topInsetClass: 'top-7',
      contentTopPaddingClass: 'pt-[calc(3.5rem+1.75rem)]',
      settingsMenuFallbackTop: 92,
      leftInsetClass: 'pl-[92px]',
    })
    : Object.freeze({
      topInsetClass: 'top-0',
      contentTopPaddingClass: 'pt-14',
      settingsMenuFallbackTop: 64,
      leftInsetClass: 'pl-3',
    });
}
