import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AnimatePresence,
  NIMI_SPRING_DEFAULT,
  useNimiReducedMotion,
} from '@nimiplatform/kit/ui/motion';

/**
 * Bounded presence wrapper matching Kit's OverlayShell contract:
 * AnimatePresence runs the symmetric spring exit before unmount, while a
 * bounded fallback releases the DOM if a background Electron renderer defers
 * Motion's exit callback after the spring has visually settled.
 */
export function AvatarOverlayPresence({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const [presenceMounted, setPresenceMounted] = useState(open);
  const openRef = useRef(open);
  openRef.current = open;
  const reducedMotion = useNimiReducedMotion();

  useEffect(() => {
    if (open) {
      setPresenceMounted(true);
      return;
    }
    if (!presenceMounted) return;
    const delayMs = reducedMotion ? 250 : NIMI_SPRING_DEFAULT.responseSeconds * 1000 + 200;
    const timer = window.setTimeout(() => {
      if (!openRef.current) setPresenceMounted(false);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [open, presenceMounted, reducedMotion]);

  if (!presenceMounted && !open) return null;

  return (
    <AnimatePresence
      onExitComplete={() => {
        if (!openRef.current) setPresenceMounted(false);
      }}
    >
      {open ? children : null}
    </AnimatePresence>
  );
}
