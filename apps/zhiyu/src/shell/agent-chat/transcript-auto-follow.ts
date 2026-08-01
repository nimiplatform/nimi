const CANONICAL_TRANSCRIPT_CONTENT_SELECTOR = '[data-canonical-transcript-width]';
const NEAR_BOTTOM_THRESHOLD_PX = 80;

export function followZhiyuTranscriptToLatest(
  root: HTMLElement,
  end: HTMLElement,
): () => void {
  const content = root.querySelector<HTMLElement>(CANONICAL_TRANSCRIPT_CONTENT_SELECTOR);
  let active = true;
  let scrollNotificationQueued = false;
  // Follow only while the user stays near the bottom. Scrolling up unpins so
  // observer callbacks (which also fire on virtualizer row swaps triggered by
  // the scroll itself) stop yanking the transcript back down.
  let pinned = true;
  const isNearBottom = () => (
    root.scrollTop + root.clientHeight >= root.scrollHeight - NEAR_BOTTOM_THRESHOLD_PX
  );
  const handleScroll = () => {
    pinned = isNearBottom();
  };
  root.addEventListener('scroll', handleScroll, { passive: true });
  const notifyCanonicalVirtualizer = () => {
    if (scrollNotificationQueued) {
      return;
    }
    scrollNotificationQueued = true;
    queueMicrotask(() => {
      scrollNotificationQueued = false;
      if (!active) {
        return;
      }
      root.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
  };
  const scrollToLatest = () => {
    if (!pinned) {
      return;
    }
    end.scrollIntoView({
      block: 'end',
      inline: 'nearest',
    });
    root.scrollTop = Math.max(0, root.scrollHeight - root.clientHeight);
    // Chromium does not consistently emit a scroll event for the programmatic
    // alignment above. The canonical virtualizer consumes that event to move
    // its rendered window from the initial rows to the transcript tail. Notify
    // outside the React lifecycle callback because the virtualizer flushes its
    // resulting state update synchronously.
    notifyCanonicalVirtualizer();
  };

  scrollToLatest();
  if (!content) {
    return () => {
      active = false;
      root.removeEventListener('scroll', handleScroll);
    };
  }

  const resizeObserver = typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver(scrollToLatest);
  const mutationObserver = typeof MutationObserver === 'undefined'
    ? null
    : new MutationObserver(scrollToLatest);
  resizeObserver?.observe(content);
  mutationObserver?.observe(content, {
    attributes: true,
    attributeFilter: ['style', 'data-index'],
    childList: true,
    subtree: true,
  });
  return () => {
    active = false;
    root.removeEventListener('scroll', handleScroll);
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
  };
}
