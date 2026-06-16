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
} from '@nimiplatform/kit/features/avatar/headless';
import { AvatarInteractionController } from '../interaction/avatar-interaction-controller.js';
import {
  beginManualDragWindow,
  constrainWindowToVisibleArea,
  getCursorClientPosition,
  moveManualDragWindow,
  setIgnoreCursorEvents,
  startWindowDrag,
  type AvatarManualDragWindowOrigin,
} from '../app-shell/tauri-commands.js';
import { isTauriRuntime } from '../app-shell/tauri-lifecycle.js';
import { useSurfaceMountEvidence } from '../app-shell/composition-events.js';
import {
  recordAvatarEvidenceEventually,
  type AvatarEvidenceKind,
} from '../app-shell/avatar-evidence.js';
import { isInteractiveTarget } from '../avatar-shell-utils.js';
import type { AppOriginEvent } from '../driver/types.js';
import type {
  BackendAudioConsumer,
  BackendBranch,
  BackendHitRegion,
} from '../carrier/backend-branch.js';
import { getSharedAudioPipelineController } from '@nimiplatform/kit/features/avatar/headless';
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
  onAvatarWheel?: (input: {
    deltaY: number;
    clientX: number;
    clientY: number;
  }) => void;
  interactionModality: 'keyboard' | 'pointer';
  onFocusVisibleChange?: (value: boolean) => void;
};

const CLICK_THROUGH_RECOVERY_POLL_INTERVAL_MS = 50;
const ADMITTED_BACKEND_LIFECYCLE_EVIDENCE = new Set([
  'context_lost',
  'context_restored',
  'failed_closed',
  'load_failed',
  'audio_pipeline_ready',
  'audio_pipeline_failed',
  'hit_region_degraded',
]);

type ManualDragState = {
  mode: 'armed' | 'manual';
  startScreenX: number;
  startScreenY: number;
  lastScreenX: number;
  lastScreenY: number;
  pointerId: number;
  totalDx: number;
  totalDy: number;
  pendingTarget: { totalDx: number; totalDy: number } | null;
  origin: AvatarManualDragWindowOrigin | null;
  originFailed: boolean;
  moveInFlight: boolean;
  ended: boolean;
  constrainOnEnd: boolean;
  rafHandle: number | null;
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
    onAvatarWheel,
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
  const alphaProbeFailureReportedRef = useRef(false);

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
      if (!ADMITTED_BACKEND_LIFECYCLE_EVIDENCE.has(kind)) {
        recordAvatarEvidenceEventually({
          kind: 'avatar.carrier.lifecycle.failed_closed',
          detail: {
            source: 'embodiment-stage',
            model_kind: backend?.kind ?? 'unknown',
            reason_code: 'unadmitted_lifecycle_evidence_kind',
            lifecycle: kind,
            closed_at: new Date().toISOString(),
          },
        });
        return;
      }
      if (kind === 'audio_pipeline_ready') {
        recordAvatarEvidenceEventually({
          kind: 'avatar.audio.pipeline.ready',
          detail: {
            source: 'embodiment-stage',
            ...detail,
            ready_at: new Date().toISOString(),
          },
        });
        return;
      }
      if (kind === 'audio_pipeline_failed') {
        recordAvatarEvidenceEventually({
          kind: 'avatar.audio.pipeline.failed',
          detail: {
            source: 'embodiment-stage',
            ...detail,
            failed_at: new Date().toISOString(),
          },
        });
        return;
      }
      if (kind === 'hit_region_degraded') {
        recordAvatarEvidenceEventually({
          kind: 'avatar.hit_region.degraded',
          detail: {
            source: 'embodiment-stage',
            model_kind: backend?.kind ?? 'unknown',
            ...detail,
            recorded_at: new Date().toISOString(),
          },
        });
        return;
      }
      const evidenceKind: AvatarEvidenceKind = kind === 'context_lost'
        ? 'avatar.carrier.lifecycle.context_lost'
        : kind === 'context_restored'
          ? 'avatar.carrier.lifecycle.context_restored'
          : 'avatar.carrier.lifecycle.failed_closed';
      recordAvatarEvidenceEventually({
        kind: evidenceKind,
        detail: {
          source: 'embodiment-stage',
          model_kind: backend?.kind ?? 'unknown',
          lifecycle: kind,
          composition_state: compositionState,
          ...detail,
        },
      });
    },
    [backend?.kind, compositionState],
  );

  // Sink unregistration + throttle disposal on unmount / backend swap.
  useEffect(
    () => () => {
      sinkRegistrationRef.current?.();
      sinkRegistrationRef.current = null;
      currentHitRegionRef.current = null;
      alphaProbeFailureReportedRef.current = false;
    },
    [backend],
  );

  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Wave 4 manual drag fallback state. macOS NSWindow with transparent +
  // always_on_top + decorations(false) doesn't honor `start_dragging()`,
  // so we track screen-coord deltas during pointermove. The origin is read
  // once at pointerdown; move IPCs use absolute target positions derived from
  // total delta so Rust does not read the current window position per frame.
  const dragRef = useRef<ManualDragState | null>(null);

  const shouldUseManualDragFallback = (): boolean => {
    if (!isTauriRuntime()) return false;
    const platform = window.navigator.platform || '';
    const userAgent = window.navigator.userAgent || '';
    if (/Win|Linux|X11/i.test(platform)) return false;
    if (/Windows|Linux|X11/i.test(userAgent)) return false;
    // Tauri/WKWebView on macOS may report an empty/deprecated platform
    // string. The transparent no-chrome Avatar window needs the manual path
    // on macOS, so unknown desktop Tauri defaults to the fallback.
    return true;
  };

  const finalizeManualDragIfDone = (drag: ManualDragState): void => {
    if (!drag.ended || drag.moveInFlight || drag.pendingTarget) return;
    if (dragRef.current === drag) {
      dragRef.current = null;
    }
    if (drag.constrainOnEnd) {
      void constrainWindowToVisibleArea();
    }
  };

  const pumpManualDragMove = (drag: ManualDragState): void => {
    if (drag.moveInFlight || drag.pendingTarget === null) {
      finalizeManualDragIfDone(drag);
      return;
    }
    if (drag.origin === null) {
      if (drag.originFailed) {
        drag.pendingTarget = null;
        finalizeManualDragIfDone(drag);
      }
      return;
    }
    const target = drag.pendingTarget;
    drag.pendingTarget = null;
    drag.moveInFlight = true;
    void moveManualDragWindow({
      origin: drag.origin,
      totalDeltaX: target.totalDx,
      totalDeltaY: target.totalDy,
    }).finally(() => {
      drag.moveInFlight = false;
      if (drag.pendingTarget) {
        pumpManualDragMove(drag);
        return;
      }
      finalizeManualDragIfDone(drag);
    });
  };

  const flushManualDragTarget = (): void => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.rafHandle = null;
    if (drag.totalDx === 0 && drag.totalDy === 0) return;
    drag.pendingTarget = {
      totalDx: drag.totalDx,
      totalDy: drag.totalDy,
    };
    pumpManualDragMove(drag);
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
  // backend-supplied `isOpaqueAtClientPoint` can be absent, return null, or
  // return a false transparent sample while the visual carrier is still inside
  // its admitted bbox. Native click-through is irreversible for the next
  // pointerdown, so `ignore=true` is allowed only outside the bbox guard.
  const computeIgnoreForPoint = useCallback(
    (clientX: number, clientY: number): boolean => {
      const region = currentHitRegionRef.current;
      // Pre-region (backend not yet announced) → conservative: capture
      // pointer (ignore=false) so the user can interact with the
      // embodiment-stage even before alpha-mask is wired.
      if (region == null) return false;
      if (region.isOpaqueAtClientPoint) {
        try {
          const opaque = region.isOpaqueAtClientPoint(clientX, clientY);
          if (opaque === true) {
            return false;
          }
          if (opaque === false) {
            return computeIgnoreForBodyBbox(region, bodyRef.current?.parentElement, clientX, clientY);
          }
        } catch (error: unknown) {
          if (!alphaProbeFailureReportedRef.current) {
            alphaProbeFailureReportedRef.current = true;
            recordAvatarEvidenceEventually({
              kind: 'avatar.hit_region.degraded',
              detail: {
                source: 'embodiment-stage',
                model_kind: backend?.kind ?? 'unknown',
                reason_code: 'alpha_probe_threw',
                error: error instanceof Error ? error.message : String(error || 'alpha probe failed'),
                recorded_at: new Date().toISOString(),
              },
            });
          }
        }
      }
      return computeIgnoreForBodyBbox(region, bodyRef.current?.parentElement, clientX, clientY);
    },
    [backend?.kind],
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
            if (drag.mode === 'armed') {
              drag.mode = 'manual';
              controller.pointerCancel();
            }
            drag.lastScreenX = event.screenX;
            drag.lastScreenY = event.screenY;
            drag.totalDx = event.screenX - drag.startScreenX;
            drag.totalDy = event.screenY - drag.startScreenY;
            if (drag.rafHandle === null) {
              drag.rafHandle = requestAnimationFrame(flushManualDragTarget);
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
        setClickThrough(false);
        if (event.button === 0) {
          // Capture pointer so subsequent move/up events fire here even when
          // the cursor leaves the element while dragging.
          (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
          if (shouldUseManualDragFallback()) {
            const drag: ManualDragState = {
              mode: 'armed',
              startScreenX: event.screenX,
              startScreenY: event.screenY,
              lastScreenX: event.screenX,
              lastScreenY: event.screenY,
              pointerId: event.pointerId,
              totalDx: 0,
              totalDy: 0,
              pendingTarget: null,
              origin: null,
              originFailed: false,
              moveInFlight: false,
              ended: false,
              constrainOnEnd: false,
              rafHandle: null,
            };
            dragRef.current = drag;
            void beginManualDragWindow()
              .then((origin) => {
                if (dragRef.current !== drag || origin === null) return;
                drag.origin = origin;
                if (drag.totalDx !== 0 || drag.totalDy !== 0) {
                  drag.pendingTarget = {
                    totalDx: drag.totalDx,
                    totalDy: drag.totalDy,
                  };
                  pumpManualDragMove(drag);
                }
              })
              .catch((error: unknown) => {
                drag.originFailed = true;
                recordAvatarEvidenceEventually({
                  kind: 'avatar.carrier.lifecycle.failed_closed',
                  detail: {
                    source: 'embodiment-stage',
                    lifecycle: 'failed_closed',
                    reason_code: 'manual_drag_origin_failed',
                    error: error instanceof Error ? error.message : String(error || 'manual drag origin failed'),
                  },
                });
                if (dragRef.current === drag) {
                  dragRef.current = null;
                }
              });
          }
        }
        controller.pointerDown(event);
      }}
      onContextMenu={(event) => {
        if (isInteractiveTarget(event.target)) return;
        event.preventDefault();
      }}
      onWheel={(event) => {
        if (isInteractiveTarget(event.target)) return;
        if (computeIgnoreForPoint(event.clientX, event.clientY)) return;
        event.preventDefault();
        event.stopPropagation();
        onAvatarWheel?.({
          deltaY: event.deltaY,
          clientX: event.clientX,
          clientY: event.clientY,
        });
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current;
        let consumedDrag = false;
        if (drag && drag.pointerId === event.pointerId) {
          consumedDrag = drag.mode !== 'armed';
          (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
          if (drag.rafHandle !== null) {
            cancelAnimationFrame(drag.rafHandle);
            // Flush any residual delta synchronously so the cursor and window
            // end the drag in lock-step (otherwise a few unflushed pixels are
            // dropped on pointer release).
            drag.rafHandle = null;
            if (drag.totalDx !== 0 || drag.totalDy !== 0) {
              drag.pendingTarget = {
                totalDx: drag.totalDx,
                totalDy: drag.totalDy,
              };
              pumpManualDragMove(drag);
            }
          }
          if (consumedDrag) {
            drag.ended = true;
            drag.constrainOnEnd = true;
            finalizeManualDragIfDone(drag);
          } else {
            dragRef.current = null;
          }
        }
        if (consumedDrag) {
          controller.pointerCancel();
          return;
        }
        if (isInteractiveTarget(event.target)) return;
        controller.pointerUp(event);
      }}
      onPointerCancel={() => {
        const drag = dragRef.current;
        if (drag && drag.rafHandle !== null) {
          cancelAnimationFrame(drag.rafHandle);
        }
        if (drag) {
          drag.rafHandle = null;
          drag.ended = true;
          drag.constrainOnEnd = false;
          finalizeManualDragIfDone(drag);
        }
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

function computeIgnoreForBodyBbox(
  region: BackendHitRegion,
  stageEl: Element | null | undefined,
  clientX: number,
  clientY: number,
): boolean {
  // Bbox fallback. The body rect is viewport-normalized [0,1]; map to
  // absolute window coords via the embodiment-stage rect.
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
}
