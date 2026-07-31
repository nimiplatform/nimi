export type MainLayoutTitlebarFrame = {
  readonly topInsetClass: 'top-0' | 'top-7';
  readonly contentTopPaddingClass: 'pt-14' | 'pt-[calc(3.5rem+1.75rem)]';
  readonly leftInsetClass: 'pl-3' | 'pl-[92px]';
};

export function resolveMainLayoutTitlebarFrame(
  titlebarDragEnabled: boolean,
): MainLayoutTitlebarFrame {
  return titlebarDragEnabled
    ? Object.freeze({
      topInsetClass: 'top-7',
      contentTopPaddingClass: 'pt-[calc(3.5rem+1.75rem)]',
      leftInsetClass: 'pl-[92px]',
    })
    : Object.freeze({
      topInsetClass: 'top-0',
      contentTopPaddingClass: 'pt-14',
      leftInsetClass: 'pl-3',
    });
}
