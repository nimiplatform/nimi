import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  NIMI_SPRING_DEFAULT,
  motion,
  type NimiOverlayMotionProps,
  type NimiPopoverSide,
} from '../motion/index.js';

export type OverlayExitRect = {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
};

export type OverlayExitSnapshot = {
  readonly id: number;
  readonly rect: OverlayExitRect;
  readonly zIndex: string;
  readonly side: NimiPopoverSide;
  readonly clone: HTMLElement;
  readonly scrollOffsets: ReadonlyArray<{ readonly index: number; readonly top: number; readonly left: number }>;
};

let nextGhostId = 0;

function readSide(element: HTMLElement, fallback: NimiPopoverSide): NimiPopoverSide {
  const attr = element.getAttribute('data-side');
  if (attr === 'top' || attr === 'right' || attr === 'bottom' || attr === 'left') {
    return attr;
  }
  return fallback;
}

function readZIndex(element: HTMLElement): string {
  if (typeof window === 'undefined') return '50';
  let cur: HTMLElement | null = element;
  for (let depth = 0; depth < 3 && cur; depth += 1) {
    const z = window.getComputedStyle(cur).zIndex;
    if (z && z !== 'auto') return z;
    cur = cur.parentElement;
  }
  return '50';
}

/**
 * Snapshot a live overlay's painted geometry and DOM pixels so Radix's modal
 * layer (DismissableLayer / RemoveScroll / FocusScope / hideOthers) can unmount
 * synchronously on close while a purely presentational ghost runs the symmetric
 * spring exit animation without intercepting pointer or keyboard input.
 */
export function captureOverlayExitSnapshot(
  element: HTMLElement | null,
  fallbackSide: NimiPopoverSide,
): OverlayExitSnapshot | null {
  if (!element || typeof document === 'undefined') return null;
  const rect = element.getBoundingClientRect();
  const clone = element.cloneNode(true) as HTMLElement;
  clone.removeAttribute('id');
  for (const node of clone.querySelectorAll('[id]')) {
    node.removeAttribute('id');
  }
  clone.style.pointerEvents = 'none';
  clone.style.position = 'static';
  clone.style.transform = 'none';
  clone.style.margin = '0';

  const scrollOffsets: Array<{ index: number; top: number; left: number }> = [];
  const originals = element.querySelectorAll<HTMLElement>('*');
  for (let i = 0; i < originals.length; i += 1) {
    const orig = originals[i]!;
    if (orig.scrollTop !== 0 || orig.scrollLeft !== 0) {
      scrollOffsets.push({ index: i, top: orig.scrollTop, left: orig.scrollLeft });
    }
  }

  return {
    id: ++nextGhostId,
    rect: {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    },
    zIndex: readZIndex(element),
    side: readSide(element, fallbackSide),
    clone,
    scrollOffsets,
  };
}

export function OverlayExitCapture({ onBeforeUnmount }: { onBeforeUnmount: () => void }) {
  const callbackRef = useRef(onBeforeUnmount);
  callbackRef.current = onBeforeUnmount;
  useLayoutEffect(() => () => {
    callbackRef.current();
  }, []);
  return null;
}

export function OverlayExitGhost({
  snapshot,
  panelMotion,
  reducedMotion,
  onComplete,
}: {
  snapshot: OverlayExitSnapshot | null;
  panelMotion: NimiOverlayMotionProps;
  reducedMotion: boolean;
  onComplete: (id: number) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const completedRef = useRef<number | null>(null);

  const finish = () => {
    if (!snapshot || completedRef.current === snapshot.id) return;
    completedRef.current = snapshot.id;
    onComplete(snapshot.id);
  };

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const slot = slotRef.current;
    if (!snapshot || !wrapper || !slot) return undefined;
    wrapper.setAttribute('inert', '');
    slot.replaceChildren(snapshot.clone);
    if (snapshot.scrollOffsets.length > 0) {
      const clonedNodes = snapshot.clone.querySelectorAll<HTMLElement>('*');
      for (const offset of snapshot.scrollOffsets) {
        const target = clonedNodes[offset.index];
        if (target) {
          target.scrollTop = offset.top;
          target.scrollLeft = offset.left;
        }
      }
    }
    return () => {
      slot.replaceChildren();
    };
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot || typeof window === 'undefined') return undefined;
    const delayMs = reducedMotion ? 250 : NIMI_SPRING_DEFAULT.responseSeconds * 1000 + 200;
    const timer = window.setTimeout(() => {
      if (completedRef.current !== snapshot.id) {
        completedRef.current = snapshot.id;
        onComplete(snapshot.id);
      }
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [snapshot, reducedMotion, onComplete]);

  if (!snapshot || typeof document === 'undefined') return null;

  return createPortal(
    <div
      key={snapshot.id}
      ref={wrapperRef}
      aria-hidden="true"
      data-nimi-overlay-exit-ghost="true"
      className="pointer-events-none fixed m-0"
      style={{
        top: `${snapshot.rect.top}px`,
        left: `${snapshot.rect.left}px`,
        width: snapshot.rect.width > 0 ? `${snapshot.rect.width}px` : undefined,
        height: snapshot.rect.height > 0 ? `${snapshot.rect.height}px` : undefined,
        zIndex: snapshot.zIndex,
        pointerEvents: 'none',
      }}
    >
      <motion.div
        ref={slotRef}
        initial={panelMotion.animate}
        animate={panelMotion.exit}
        transition={panelMotion.transition}
        onAnimationComplete={finish}
        style={{
          ...panelMotion.style,
          pointerEvents: 'none',
          width: '100%',
          height: '100%',
        }}
      />
    </div>,
    document.body,
  );
}
