import { useEffect, useRef } from 'react';

// The transcript virtualizes rows. Mounting a row in its overscan region
// alone does not mean the user saw the corresponding reply.
export function ConversationReadMarker<T>({ value, onVisible }: {
  value: T;
  onVisible: (value: T) => void;
}) {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = marker.current;
    if (!node) return;
    let visible = false;
    let attempted = false;
    const acknowledge = () => {
      if (attempted || !visible || document.visibilityState !== 'visible' || !document.hasFocus()) return;
      attempted = true;
      onVisible(value);
    };
    const onFocus = () => { attempted = false; acknowledge(); };
    const observer = new IntersectionObserver((entries) => {
      // Initial layout and the jump to the current reply can be delivered in
      // one batch. The latest observation, not the initial offscreen one,
      // describes what the user can currently see.
      const entry = entries.at(-1);
      visible = entry?.isIntersecting === true;
      if (!visible) attempted = false;
      acknowledge();
    }, { threshold: 1 });
    observer.observe(node);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', acknowledge);
    return () => {
      observer.disconnect();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', acknowledge);
    };
  }, [value, onVisible]);
  return <span ref={marker} aria-hidden="true" className="block h-px w-px" />;
}
