type CoverListener = (visible: boolean | null) => void;

// Share one visibility window and one settle timer across the paged grid.
function createCoverWindow(root: HTMLElement) {
  const listeners = new Map<Element, CoverListener>();
  const near = new Set<Element>();
  let top = root.scrollTop;
  let last = performance.now();
  let movingFast = false;
  let scrolled = false;
  let settle: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;

  function update() {
    if (movingFast) return;
    const viewport = root.getBoundingClientRect();
    for (const node of near) {
      const rect = node.getBoundingClientRect();
      const visible = rect.bottom > viewport.top && rect.top < viewport.bottom;
      if (visible || scrolled) listeners.get(node)?.(visible);
    }
  }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) near.add(entry.target);
      else {
        near.delete(entry.target);
        listeners.get(entry.target)?.(null);
      }
    }
    update();
  }, { root, rootMargin: '200px 0px' });

  function onScroll() {
    const now = performance.now();
    const elapsed = Math.max(1, Math.min(100, now - last));
    movingFast = Math.abs(root.scrollTop - top) / elapsed > 2;
    scrolled = true;
    top = root.scrollTop;
    last = now;
    clearTimeout(settle);
    settle = setTimeout(() => { movingFast = false; update(); }, 150);
    if (!movingFast && !frame) frame = requestAnimationFrame(() => { frame = 0; update(); });
  }
  root.addEventListener('scroll', onScroll, { passive: true });
  return (node: Element, listener: CoverListener) => {
    listeners.set(node, listener);
    observer.observe(node);
    return () => {
      near.delete(node);
      listeners.delete(node);
      observer.unobserve(node);
      if (!listeners.size) {
        root.removeEventListener('scroll', onScroll);
        observer.disconnect();
        clearTimeout(settle);
        if (frame) cancelAnimationFrame(frame);
        windows.delete(root);
      }
    };
  };
}

const windows = new WeakMap<HTMLElement, ReturnType<typeof createCoverWindow>>();

export function observeDiscoveryCover(node: HTMLElement, listener: CoverListener) {
  const root = node.closest<HTMLElement>('.world-atlas-viewport');
  if (!root) {
    listener(true);
    return;
  }
  let observe = windows.get(root);
  if (!observe) {
    observe = createCoverWindow(root);
    windows.set(root, observe);
  }
  return observe(node, listener);
}
