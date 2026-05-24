// Wave 1 — Embodiment Stage surface.
// Renders the Live2D carrier on a transparent background. Owns the hit-region /
// drag-region / pointer interaction wiring. Per app-shell-contract.md
// K-NAV-SHELL-COMPOSITION-001..002 this surface is mounted ONLY when composition
// state is `ready` or `fixture_active`; it is hard-cut unmounted under any
// degraded / loading / error / relaunch-pending state.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { cn } from '@nimiplatform/kit/ui';
import {
  createAvatarHitRegionSnapshot,
  rectFromElement,
} from '../interaction/avatar-hit-region.js';
import { AvatarInteractionController } from '../interaction/avatar-interaction-controller.js';
import {
  constrainWindowToVisibleArea,
  dragWindowBy,
  getCursorClientPosition,
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
import { createThrottledCursorEvents } from '../app-shell/throttled-cursor-events.js';
import { createThrottledEmit } from '../app-shell/throttled-emit.js';

export type EmbodimentStageProps = {
  /** Active BackendBranch supplying the surface component, audio
   *  consumer, and hit-region snapshots. `null` while bootstrap is in
   *  flight; the parent must not mount the stage before composition
   *  reaches a `ready` / `fixture_active` posture. */
  backend: BackendBranch | null;
  windowSize: { width: number; height: number };
  embodied: boolean;
  // composition state (K-NAV-SHELL-COMPOSITION-001) at the time the surface is
  // mounted. Required so the surface-mounted/unmounted evidence carries the
  // correct posture annotation (`ready` vs `fixture_active`).
  compositionState: string;
  emit?: (event: AppOriginEvent) => void;
  setBodyHovered?: (value: boolean) => void;
  setBodyPointerContact?: (value: boolean) => void;
  interactionModality: 'keyboard' | 'pointer';
  onFocusVisibleChange?: (value: boolean) => void;
};

const CLICK_THROUGH_RECOVERY_POLL_INTERVAL_MS = 50;

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

  // ── BackendSurface lifecycle wiring (wave_1 step_4 + wave_4 chunk 4-C) ──
  // The active BackendBranch exposes a Component that publishes three
  // lifecycle channels: audio-consumer, hit-region, evidence. Each one
  // bridges into an existing app-shell concern:
  //   * onAudioConsumerReady → register sink with the shared audio
  //     pipeline (lipsync), unregister on backend swap / unmount.
  //   * onHitRegionChange    → store the latest region (throttled via
  //     `createThrottledEmit` so per-frame snapshot updates are capped at
  //     ≤ 1 per 100ms per packet acceptance_invariant 8). Pointer hit
  //     testing (alpha-mask + bbox fallback) drives the 60Hz-capped
  //     `setIgnoreCursorEvents` throttle below.
  //   * onLifecycleEvidence  → record into the avatar evidence stream so
  //     mounted/unmounted/load-error transitions surface in telemetry.
  const sinkRegistrationRef = useRef<(() => void) | null>(null);
  const currentHitRegionRef = useRef<BackendHitRegion | null>(null);

  // 60Hz-capped throttle around the Tauri set_ignore_cursor_events IPC.
  // Per packet acceptance_invariant 7 + negative_test #3, rapid pointermove
  // (1000+ events in 10ms) must not saturate the IPC channel. The throttle
  // dedupes same-value calls and coalesces with trailing-edge fire.
  const cursorEventsThrottleRef = useMemo(
    () => createThrottledCursorEvents(),
    [],
  );
  const clickThroughRecoveryPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleAudioConsumerReady = useCallback(
    (consumer: BackendAudioConsumer) => {
      // Tear down any prior registration before installing the new sink.
      sinkRegistrationRef.current?.();
      const audioPipeline = getSharedAudioPipelineController();
      sinkRegistrationRef.current = audioPipeline.registerLipsyncSink(consumer);
    },
    [],
  );

  // 100ms-cap throttle around the bbox-snapshot consumer fan-out. The
  // backend surface may emit on every captured frame; the consumer
  // (window-bounds resize wiring etc.) only needs at most 10 updates per
  // second per packet acceptance_invariant 8.
  const hitRegionEmitThrottleRef = useMemo(
    () =>
      createThrottledEmit<BackendHitRegion>({
        callback: (region) => {
          // Fan-out point: today the only downstream consumer is the
          // ref store used by pointermove; future wiring (e.g. Tauri
          // set_size for dynamic window bounds) attaches here.
          currentHitRegionRef.current = region;
        },
      }),
    [],
  );

  const handleHitRegionChange = useCallback(
    (region: BackendHitRegion) => {
      // Always update the ref synchronously so the very first region is
      // available to the pointermove handler immediately on backend mount
      // (the throttle's leading edge fires the consumer too, but we don't
      // want to gate "any region at all" behind it).
      if (currentHitRegionRef.current == null) {
        currentHitRegionRef.current = region;
      }
      hitRegionEmitThrottleRef.emit(region);
    },
    [hitRegionEmitThrottleRef],
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

  // Sink unregistration + throttle disposal on unmount / backend swap.
  useEffect(
    () => () => {
      sinkRegistrationRef.current?.();
      sinkRegistrationRef.current = null;
      currentHitRegionRef.current = null;
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

  const stopClickThroughRecoveryPoll = useCallback((): void => {
    if (clickThroughRecoveryPollRef.current === null) return;
    clearInterval(clickThroughRecoveryPollRef.current);
    clickThroughRecoveryPollRef.current = null;
  }, []);

  useEffect(
    () => () => {
      stopClickThroughRecoveryPoll();
      void setIgnoreCursorEvents(false);
      cursorEventsThrottleRef.dispose();
      hitRegionEmitThrottleRef.dispose();
    },
    [
      cursorEventsThrottleRef,
      hitRegionEmitThrottleRef,
      stopClickThroughRecoveryPoll,
    ],
  );

  // Wave 4 chunk 4-C: pointer hit-test driver. Per app-shell-contract.md
  // §2.3.1 the alpha-mask probe takes precedence over the bbox; the
  // backend-supplied `isOpaqueAtClientPoint` returns null when the
  // backend is on tier C / capability detection failed, in which case we
  // fall back to a body-bbox check (viewport-normalized → absolute).
  const computeIgnoreForPoint = useCallback(
    (clientX: number, clientY: number): boolean => {
      const region = currentHitRegionRef.current;
      // Pre-region (backend not yet announced) → conservative: capture
      // pointer (ignore=false) so the user can interact with the
      // embodiment-stage even before alpha-mask is wired.
      if (region == null) return false;
      if (region.isOpaqueAtClientPoint) {
        return !region.isOpaqueAtClientPoint(clientX, clientY);
      }
      // Bbox fallback. The body rect is viewport-normalized [0,1]; map
      // to absolute window coords via the embodiment-stage rect.
      const stageEl = bodyRef.current?.parentElement;
      if (stageEl == null) return false;
      const stageRect = stageEl.getBoundingClientRect();
      if (stageRect.width <= 0 || stageRect.height <= 0) return true;
      const absLeft = stageRect.left + region.body.left * stageRect.width;
      const absRight = stageRect.left + region.body.right * stageRect.width;
      const absTop = stageRect.top + region.body.top * stageRect.height;
      const absBottom = stageRect.top + region.body.bottom * stageRect.height;
      const inside =
        clientX >= absLeft &&
        clientX < absRight &&
        clientY >= absTop &&
        clientY < absBottom;
      return !inside;
    },
    [],
  );

  const startClickThroughRecoveryPoll = useCallback((): void => {
    if (clickThroughRecoveryPollRef.current !== null) return;
    clickThroughRecoveryPollRef.current = setInterval(() => {
      void getCursorClientPosition()
        .then((position) => {
          if (computeIgnoreForPoint(position.clientX, position.clientY)) {
            return;
          }
          stopClickThroughRecoveryPoll();
          cursorEventsThrottleRef.setIgnore(false);
        })
        .catch(() => undefined);
    }, CLICK_THROUGH_RECOVERY_POLL_INTERVAL_MS);
  }, [
    computeIgnoreForPoint,
    cursorEventsThrottleRef,
    stopClickThroughRecoveryPoll,
  ]);

  const setClickThrough = useCallback(
    (ignore: boolean): void => {
      if (ignore) {
        startClickThroughRecoveryPoll();
      } else {
        stopClickThroughRecoveryPoll();
      }
      cursorEventsThrottleRef.setIgnore(ignore);
    },
    [
      cursorEventsThrottleRef,
      startClickThroughRecoveryPoll,
      stopClickThroughRecoveryPoll,
    ],
  );

  const updateClickThroughForPointer = useCallback(
    (clientX: number, clientY: number): void => {
      const ignore = computeIgnoreForPoint(clientX, clientY);
      setClickThrough(ignore);
    },
    [computeIgnoreForPoint, setClickThrough],
  );

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
        setClickThrough,
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
      setClickThrough,
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

  // Reset NSWindow.ignoreCursorEvents on mount. Prevents a stuck
  // click-through state from a prior renderer session (or from an old
  // build that toggled ignoreCursorEvents=true on transparent regions
  // and never recovered) from leaving the avatar permanently
  // unclickable.
  useEffect(() => {
    stopClickThroughRecoveryPoll();
    void setIgnoreCursorEvents(false);
  }, [stopClickThroughRecoveryPoll]);

  return (
    <section
      className={cn('avatar-embodiment-stage')}
      data-testid="avatar-embodiment-stage"
      onPointerEnter={(event) => {
        if (isInteractiveTarget(event.target)) return;
        // Wave 4 chunk 4-C: alpha-mask-aware click-through via the 60Hz
        // throttle. Same call from onPointerMove; placing it on enter
        // covers the case where the pointer enters at an opaque region. If
        // this flips to click-through, a global cursor poll keeps watching
        // for re-entry onto opaque pixels so macOS does not strand the
        // window in ignoreCursorEvents=true.
        updateClickThroughForPointer(event.clientX, event.clientY);
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
        // Wave 4 chunk 4-C: alpha-mask-aware click-through via the 60Hz
        // throttle. The throttle dedupes same-state calls (so rapid
        // pointermove inside an opaque region does not saturate the IPC
        // channel) and fires Tauri at most once per ~16.67ms. When the
        // window becomes click-through, the global cursor poll is the
        // recovery path because the webview no longer receives pointermove.
        updateClickThroughForPointer(event.clientX, event.clientY);
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
