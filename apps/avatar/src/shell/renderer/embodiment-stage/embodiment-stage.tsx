// Wave 1 — Embodiment Stage surface.
// Renders the Live2D carrier on a transparent background. Owns the hit-region /
// drag-region / pointer interaction wiring. Per app-shell-contract.md
// NAV-SHELL-COMPOSITION-001..002 this surface is mounted ONLY when composition
// state is `ready` or `fixture_active`; it is hard-cut unmounted under any
// degraded / loading / error / relaunch-pending state.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  createAvatarHitRegionSnapshot,
  rectFromElement,
} from '../interaction/avatar-hit-region.js';
import { AvatarInteractionController } from '../interaction/avatar-interaction-controller.js';
import {
  constrainWindowToVisibleArea,
  dragWindowBy,
  setIgnoreCursorEvents,
  startWindowDrag,
} from '../app-shell/tauri-commands.js';
import { isTauriRuntime } from '../app-shell/tauri-lifecycle.js';
import { useSurfaceMountEvidence } from '../app-shell/composition-events.js';
import { recordAvatarEvidenceEventually } from '../app-shell/avatar-evidence.js';
import { isInteractiveTarget } from '../avatar-shell-utils.js';
import type { AppOriginEvent } from '../driver/types.js';
import type {
  BackendAudioConsumer,
  BackendBranch,
  BackendHitRegion,
} from '../carrier/backend-branch.js';
import { getSharedAudioPipelineController } from '../audio/audio-pipeline.js';

export type EmbodimentStageProps = {
  /** Active BackendBranch supplying the surface component, audio
   *  consumer, and hit-region snapshots. `null` while bootstrap is in
   *  flight; the parent must not mount the stage before composition
   *  reaches a `ready` / `fixture_active` posture. */
  backend: BackendBranch | null;
  windowSize: { width: number; height: number };
  embodied: boolean;
  // composition state (NAV-SHELL-COMPOSITION-001) at the time the surface is
  // mounted. Required so the surface-mounted/unmounted evidence carries the
  // correct posture annotation (`ready` vs `fixture_active`).
  compositionState: string;
  emit?: (event: AppOriginEvent) => void;
  setBodyHovered?: (value: boolean) => void;
  setBodyPointerContact?: (value: boolean) => void;
  interactionModality: 'keyboard' | 'pointer';
  onFocusVisibleChange?: (value: boolean) => void;
};

export function EmbodimentStage(props: EmbodimentStageProps) {
  const {
    backend,
    windowSize,
    embodied,
    compositionState,
    emit,
    setBodyHovered,
    setBodyPointerContact,
    interactionModality,
    onFocusVisibleChange,
  } = props;

  useSurfaceMountEvidence('embodiment-stage', compositionState);

  // ── BackendSurface lifecycle wiring (wave_1 step_4) ─────────────────────
  // The active BackendBranch exposes a Component that publishes three
  // lifecycle channels: audio-consumer, hit-region, evidence. Each one
  // bridges into an existing app-shell concern:
  //   * onAudioConsumerReady → register sink with the shared audio
  //     pipeline (lipsync), unregister on backend swap / unmount.
  //   * onHitRegionChange    → throttle through setIgnoreCursorEvents so
  //     OS-level click-through follows the carrier's bbox snapshot.
  //   * onLifecycleEvidence  → record into the avatar evidence stream so
  //     mounted/unmounted/load-error transitions surface in telemetry.
  const sinkRegistrationRef = useRef<(() => void) | null>(null);
  const lastClickThroughRef = useRef<boolean | null>(null);

  const handleAudioConsumerReady = useCallback(
    (consumer: BackendAudioConsumer) => {
      // Tear down any prior registration before installing the new sink.
      sinkRegistrationRef.current?.();
      const audioPipeline = getSharedAudioPipelineController();
      sinkRegistrationRef.current = audioPipeline.registerLipsyncSink(consumer);
    },
    [],
  );

  const handleHitRegionChange = useCallback(
    (region: BackendHitRegion) => {
      // Throttle: only flip click-through when the bbox/alpha-mask
      // dispostion actually changed. Wave_1 only ships a bbox path
      // (alpha-mask deferred), so we approximate "interactive vs
      // pass-through" as "any non-zero body rect → capture cursor".
      const interactive =
        region.body.right > region.body.left && region.body.bottom > region.body.top;
      const ignore = !interactive;
      if (lastClickThroughRef.current === ignore) return;
      lastClickThroughRef.current = ignore;
      void setIgnoreCursorEvents(ignore);
    },
    [],
  );

  const handleLifecycleEvidence = useCallback(
    (kind: string, detail: Record<string, unknown>) => {
      // BackendSurface lifecycle events flow through the existing
      // `avatar.carrier.visual` evidence kind; the surface lifecycle
      // phase (`mounted` / `unmounted` / `failed_closed` / …) is
      // carried in `detail.lifecycle` so consumers don't need a new
      // event-contract admit at this wave.
      recordAvatarEvidenceEventually({
        kind: 'avatar.carrier.visual',
        detail: {
          source: 'embodiment-stage',
          lifecycle: kind,
          composition_state: compositionState,
          ...detail,
        },
      });
    },
    [compositionState],
  );

  // Sink unregistration on unmount / backend swap.
  useEffect(
    () => () => {
      sinkRegistrationRef.current?.();
      sinkRegistrationRef.current = null;
      lastClickThroughRef.current = null;
    },
    [backend],
  );

  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Wave 4 manual drag fallback state. macOS NSWindow with transparent +
  // always_on_top + decorations(false) doesn't honor `start_dragging()`,
  // so we track screen-coord deltas during pointermove. To keep dragging
  // smooth on high-frequency pointer devices, deltas are accumulated and
  // flushed once per animation frame instead of per pointermove (which fires
  // at 60–120 Hz on macOS and would otherwise produce one IPC round-trip
  // per event).
  const dragRef = useRef<{
    lastScreenX: number;
    lastScreenY: number;
    pointerId: number;
    pendingDx: number;
    pendingDy: number;
    rafHandle: number | null;
  } | null>(null);

  const flushDragDelta = (): void => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.rafHandle = null;
    const dx = drag.pendingDx;
    const dy = drag.pendingDy;
    if (dx === 0 && dy === 0) return;
    drag.pendingDx = 0;
    drag.pendingDy = 0;
    void dragWindowBy(dx, dy);
  };

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
        // Wave 4 manual drag: accumulate screen-coord deltas, flush once
        // per animation frame. macOS pointermove can fire 60–120 Hz; one
        // IPC per event makes drag feel laggy. Coalescing to RAF cadence
        // matches the compositor refresh and keeps the window glued to
        // the cursor without saturating the IPC channel.
        if (dragRef.current && (event.buttons & 1) === 1) {
          const drag = dragRef.current;
          const dx = event.screenX - drag.lastScreenX;
          const dy = event.screenY - drag.lastScreenY;
          if (dx !== 0 || dy !== 0) {
            drag.lastScreenX = event.screenX;
            drag.lastScreenY = event.screenY;
            drag.pendingDx += dx;
            drag.pendingDy += dy;
            if (drag.rafHandle === null) {
              drag.rafHandle = requestAnimationFrame(flushDragDelta);
            }
          }
          return;
        }
        if (isInteractiveTarget(event.target)) return;
        controller.pointerMove(event);
      }}
      onPointerLeave={() => {
        controller.pointerCancel();
      }}
      onPointerDown={(event) => {
        if (isInteractiveTarget(event.target)) return;
        if (event.button === 0) {
          // Capture pointer so subsequent move/up events fire here even when
          // the cursor leaves the element while dragging.
          (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
          dragRef.current = {
            lastScreenX: event.screenX,
            lastScreenY: event.screenY,
            pointerId: event.pointerId,
            pendingDx: 0,
            pendingDy: 0,
            rafHandle: null,
          };
        }
        controller.pointerDown(event);
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current;
        if (drag && drag.pointerId === event.pointerId) {
          (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
          if (drag.rafHandle !== null) {
            cancelAnimationFrame(drag.rafHandle);
            // Flush any residual delta synchronously so the cursor and window
            // end the drag in lock-step (otherwise a few unflushed pixels are
            // dropped on pointer release).
            flushDragDelta();
          }
          dragRef.current = null;
          void constrainWindowToVisibleArea();
        }
        if (isInteractiveTarget(event.target)) return;
        controller.pointerUp(event);
      }}
      onPointerCancel={() => {
        const drag = dragRef.current;
        if (drag && drag.rafHandle !== null) {
          cancelAnimationFrame(drag.rafHandle);
        }
        dragRef.current = null;
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
      {backend ? (
        <backend.surface.Component
          width={Math.max(1, windowSize.width ?? 0)}
          height={Math.max(1, windowSize.height ?? 0)}
          embodied={embodied}
          onAudioConsumerReady={handleAudioConsumerReady}
          onHitRegionChange={handleHitRegionChange}
          onLifecycleEvidence={handleLifecycleEvidence}
        />
      ) : null}
      <div className="avatar-embodiment-stage__body" data-testid="avatar-body-hit-region" ref={bodyRef} />
    </section>
  );
}
