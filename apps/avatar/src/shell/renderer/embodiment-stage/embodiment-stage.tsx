// Wave 1 — Embodiment Stage surface.
// Renders the Live2D carrier on a transparent background. Owns the hit-region /
// drag-region / pointer interaction wiring. Per app-shell-contract.md
// NAV-SHELL-COMPOSITION-001..002 this surface is mounted ONLY when composition
// state is `ready` or `fixture_active`; it is hard-cut unmounted under any
// degraded / loading / error / relaunch-pending state.

import { useEffect, useMemo, useRef } from 'react';
import { Live2DCarrierVisualSurface } from '../live2d/Live2DCarrierVisualSurface.js';
import {
  createAvatarHitRegionSnapshot,
  rectFromElement,
} from '../interaction/avatar-hit-region.js';
import { AvatarInteractionController } from '../interaction/avatar-interaction-controller.js';
import {
  constrainWindowToVisibleArea,
  setIgnoreCursorEvents,
  startWindowDrag,
} from '../app-shell/tauri-commands.js';
import { isTauriRuntime } from '../app-shell/tauri-lifecycle.js';
import { isInteractiveTarget } from '../avatar-shell-utils.js';
import type { Live2DBackendSession } from '../live2d/backend-session.js';
import type { AppOriginEvent } from '../driver/types.js';

export type EmbodimentStageProps = {
  visualSession: Live2DBackendSession | null;
  windowSize: { width: number; height: number };
  embodied: boolean;
  emit?: (event: AppOriginEvent) => void;
  setBodyHovered?: (value: boolean) => void;
  setBodyPointerContact?: (value: boolean) => void;
  interactionModality: 'keyboard' | 'pointer';
  onFocusVisibleChange?: (value: boolean) => void;
};

export function EmbodimentStage(props: EmbodimentStageProps) {
  const {
    visualSession,
    windowSize,
    embodied,
    emit,
    setBodyHovered,
    setBodyPointerContact,
    interactionModality,
    onFocusVisibleChange,
  } = props;

  const bodyRef = useRef<HTMLDivElement | null>(null);

  const controller = useMemo(
    () =>
      new AvatarInteractionController({
        getHitRegionSnapshot: () => {
          if (!embodied) return null;
          const body = rectFromElement(bodyRef.current, 'body') ?? {
            x: 0,
            y: 0,
            width: Math.max(1, windowSize.width ?? 400),
            height: Math.max(1, windowSize.height ?? 600),
            region: 'body' as const,
          };
          return createAvatarHitRegionSnapshot({
            body,
            capturedAtMs: performance.now(),
          });
        },
        emit: (event) => {
          emit?.(event);
        },
        setPointerInside: (inside) => {
          setBodyHovered?.(inside);
        },
        setPointerContact: (contact) => {
          setBodyPointerContact?.(contact);
        },
        setClickThrough: (ignore) => setIgnoreCursorEvents(ignore),
        startWindowDrag,
        constrainWindowToVisibleArea,
        nowMs: () => performance.now(),
        isTauriRuntime,
      }),
    [
      embodied,
      emit,
      setBodyHovered,
      setBodyPointerContact,
      windowSize.width,
      windowSize.height,
    ],
  );

  useEffect(
    () => () => {
      controller.teardown();
    },
    [controller],
  );

  return (
    <section
      className="avatar-embodiment-stage"
      data-testid="avatar-embodiment-stage"
      onPointerEnter={(event) => {
        if (isInteractiveTarget(event.target)) return;
        controller.pointerMove(event);
      }}
      onPointerMove={(event) => {
        if (isInteractiveTarget(event.target)) return;
        controller.pointerMove(event);
      }}
      onPointerLeave={() => {
        controller.pointerCancel();
      }}
      onPointerDown={(event) => {
        if (isInteractiveTarget(event.target)) return;
        controller.pointerDown(event);
      }}
      onPointerUp={(event) => {
        if (isInteractiveTarget(event.target)) return;
        controller.pointerUp(event);
      }}
      onPointerCancel={() => {
        controller.pointerCancel();
      }}
      onFocusCapture={() => {
        if (!embodied) return;
        onFocusVisibleChange?.(interactionModality === 'keyboard');
      }}
      onBlurCapture={(event) => {
        const currentTarget = event.currentTarget;
        window.requestAnimationFrame(() => {
          const activeElement = document.activeElement;
          if (!embodied) {
            onFocusVisibleChange?.(false);
            return;
          }
          if (
            interactionModality === 'keyboard'
            && activeElement instanceof Element
            && currentTarget.contains(activeElement)
          ) {
            onFocusVisibleChange?.(true);
            return;
          }
          onFocusVisibleChange?.(false);
        });
      }}
    >
      <Live2DCarrierVisualSurface session={visualSession} />
      <div className="avatar-embodiment-stage__body" data-testid="avatar-body-hit-region" ref={bodyRef} />
    </section>
  );
}
