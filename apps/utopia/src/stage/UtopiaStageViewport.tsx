import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  animate,
  nimiSpring,
  projectMomentum,
  rubberband,
  shouldCommitGesture,
} from '@nimiplatform/kit/ui';
import type {
  HabitatDaypart,
  HabitatPlaceArchetype,
  HabitatPlaceSpec,
  NimiUtopiaResident,
  NimiUtopiaSnapshot,
} from '@nimiplatform/sdk/app';
import {
  ArchetypeIcon,
  CompassRoseIcon,
  LockClosedIcon,
  SceneryGlyph,
} from '../components/UtopiaIcons.js';
import type { ResolvedStageMedia } from '../domain/bundle-registry.js';
import type { ChibiWardrobeMap } from '../domain/chibi-wardrobe.js';
import { evalStageCondition, previewParameterPlaceDiff } from '../domain/visit-journal.js';
import { resolveWorldLandmarks, type WorldScenicLandmark } from '../domain/world-landmarks.js';
import {
  FallbackJournalStage,
  PlaceResidentBadges,
  SanctuaryPresenceDock,
  buildPlaceAriaLabel,
  buildPlaceOccupancyBreakdown,
} from './FallbackJournalStage.js';
import { LivingResidentsLayer } from './LivingResidentsLayer.js';
import { UtopiaWorldCanvas, type StageCameraState } from './UtopiaWorldCanvas.js';
import type { ActiveAmbientEffect } from './WeatherParticleCanvas.js';
import { WorldMiniMap, type MiniMapViewportBox } from './WorldMiniMap.js';
import { WorldSceneryLayer } from './WorldSceneryLayer.js';

function resolveUnlockPatchForPlace(
  place: HabitatPlaceSpec,
  snapshot: NimiUtopiaSnapshot,
): {
  readonly reason: string;
  readonly patch: Record<string, string> | null;
  readonly scopeAndSideEffectNote: string | null;
} {
  const paramMap = new Map(snapshot.habitat.parameters.map((p) => [p.key, p]));
  const missingDescriptions: string[] = [];
  const patch: Record<string, string> = {};

  for (const cond of place.openWhen) {
    const actual = snapshot.parameterValues[cond.parameterKey];
    if (actual && cond.allowedValues.includes(actual)) continue;
    const paramSpec = paramMap.get(cond.parameterKey);
    const firstAllowed = cond.allowedValues[0];
    if (firstAllowed) {
      patch[cond.parameterKey] = firstAllowed;
    }
    const allowedLabels = cond.allowedValues.map(
      (val) => paramSpec?.options.find((o) => o.value === val)?.label ?? val,
    );
    missingDescriptions.push(`${paramSpec?.label ?? cond.parameterKey}需为「${allowedLabels.join(' / ')}」`);
  }

  const hasPatch = Object.keys(patch).length > 0;
  let scopeAndSideEffectNote: string | null = null;
  if (hasPatch) {
    const diff = previewParameterPlaceDiff(snapshot.habitat, snapshot.parameterValues, patch);
    const closingIds = new Set(diff.newlyClosed.map((p) => p.id));
    const affected = closingIds.size > 0
      ? snapshot.residents.filter((r) => r.current?.placeId && closingIds.has(r.current.placeId) && !r.current.interaction)
      : [];
    const parts = ['全住地环境生效'];
    if (diff.newlyClosed.length > 0) {
      const closedNames = diff.newlyClosed.map((p) => p.name).join('、');
      parts.push(
        affected.length > 0
          ? `将暂闭「${closedNames}」并中断 ${affected.map((r) => r.displayName).join('、')} 当前活动`
          : `将暂闭「${closedNames}」`,
      );
    }
    scopeAndSideEffectNote = parts.join(' · ');
  }

  return {
    reason: missingDescriptions.join('，'),
    patch: hasPatch ? patch : null,
    scopeAndSideEffectNote,
  };
}

function computeCoverDimensions(
  vw: number,
  vh: number,
  aspectNum: number,
  aspectDen: number,
): { readonly baseW: number; readonly baseH: number } {
  const worldW = 1920;
  const worldH = Math.round((1920 * aspectDen) / aspectNum);
  const coverScale = Math.max(vw / worldW, vh / worldH);
  return {
    baseW: worldW * coverScale,
    baseH: worldH * coverScale,
  };
}

type ClickRipple = Readonly<{
  id: number;
  xClient: number;
  yClient: number;
}>;

export const STREET_DEFAULT_ZOOM = 1.16;
export const STREET_DEFAULT_TOP_CLEARANCE_RATIO = 0.05;
export const UTOPIA_PRESENCE_DOCK_HEIGHT_VAR = '--utopia-presence-dock-height';
const MAX_STAGE_ZOOM = 2.5;
const DRAG_HYSTERESIS_PX = 10;

export function computeDefaultStageCamera(
  vw: number,
  vh: number,
  aspectNum = 16,
  aspectDen = 9,
): StageCameraState {
  if (vw <= 0 || vh <= 0) {
    return { zoom: STREET_DEFAULT_ZOOM, panX: 0, panY: 0 };
  }
  const { baseH } = computeCoverDimensions(vw, vh, aspectNum, aspectDen);
  const maxPanY = Math.max(0, (baseH * STREET_DEFAULT_ZOOM - vh) / 2);
  const panY = Math.min(maxPanY, Math.round(vh * STREET_DEFAULT_TOP_CLEARANCE_RATIO));
  return { zoom: STREET_DEFAULT_ZOOM, panX: 0, panY };
}

export function UtopiaStageViewport(props: {
  readonly snapshot: NimiUtopiaSnapshot;
  readonly stageMedia: ResolvedStageMedia | null;
  readonly daypart: HabitatDaypart;
  readonly frozen: boolean;
  readonly reducedMotion: boolean;
  readonly transitioning: boolean;
  readonly selectedPlaceId: string | null;
  readonly selectedResidentHandle: string | null;
  readonly chibiWardrobe?: ChibiWardrobeMap;
  readonly bindingsByHandle?: Readonly<Record<string, string>>;
  readonly packFallbackReason?: 'pack-index-error' | 'version-mismatch' | 'no-pack';
  readonly packFallbackDetail?: string | null;
  readonly onOpenPackLibrary?: () => void;
  readonly busy?: boolean;
  readonly drawerOpen?: boolean;
  readonly hudHidden?: boolean;
  readonly onToggleHudHidden?: () => void;
  readonly onOpenTuner?: () => void;
  readonly onOpenHomePartners?: () => void;
  readonly onSelectPlace: (placeId: string) => void;
  readonly onSelectResident: (resident: NimiUtopiaResident) => void;
  readonly onQuickApplyParameters?: (parameters: Readonly<Record<string, string>>) => void;
  readonly onBackgroundClick?: () => void;
}) {
  const {
    snapshot,
    stageMedia,
    daypart,
    frozen,
    reducedMotion,
    transitioning,
    selectedPlaceId,
    selectedResidentHandle,
    chibiWardrobe,
    bindingsByHandle,
    packFallbackReason,
    packFallbackDetail,
    onOpenPackLibrary,
    busy = false,
    drawerOpen = false,
    hudHidden = false,
    onToggleHudHidden,
    onOpenTuner,
    onOpenHomePartners,
    onSelectPlace,
    onSelectResident,
    onQuickApplyParameters,
    onBackgroundClick,
  } = props;

  const matchingMedia = stageMedia && stageMedia.pack.contentDigest === snapshot.contentDigest
    ? stageMedia
    : null;

  const [aspectNum, aspectDen] = useMemo<[number, number]>(() => {
    const ratio = matchingMedia?.pack.stage.aspectRatio ?? '16:9';
    const [nRaw, dRaw] = ratio.split(':');
    return [Number(nRaw) || 16, Number(dRaw) || 9];
  }, [matchingMedia]);

  const [viewportSize, setViewportSize] = useState<{ vw: number; vh: number }>({ vw: 0, vh: 0 });
  const [pointerOffset, setPointerOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [cameraView, setCameraView] = useState<{ cur: StageCameraState; target: StageCameraState }>(() => {
    const initial: StageCameraState = { zoom: STREET_DEFAULT_ZOOM, panX: 0, panY: 0 };
    return { cur: initial, target: initial };
  });
  const [isDragging, setIsDragging] = useState(false);
  const [selectedLandmarkId, setSelectedLandmarkId] = useState<string | null>(null);
  const [ripples, setRipples] = useState<readonly ClickRipple[]>([]);
  const [, setMiniMapPulse] = useState(0);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const presenceDockRef = useRef<HTMLDivElement | null>(null);
  const initialFramingActivationRef = useRef<string | null>(null);
  const cameraEngineRef = useRef<{
    cur: StageCameraState;
    target: StageCameraState;
    rafId: number;
    lastTs: number;
  }>({
    cur: { zoom: STREET_DEFAULT_ZOOM, panX: 0, panY: 0 },
    target: { zoom: STREET_DEFAULT_ZOOM, panX: 0, panY: 0 },
    rafId: 0,
    lastTs: 0,
  });
  const liveResidentCoordsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const rippleSeqRef = useRef(0);
  const panSpringControlsRef = useRef<Array<{ stop: () => void }>>([]);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
    moved: boolean;
    samples: Array<{ x: number; y: number; t: number }>;
  } | null>(null);

  const targetCamera = cameraView.target;
  const renderCamera = cameraView.cur;

  const stopCameraGlide = useCallback(() => {
    const eng = cameraEngineRef.current;
    if (eng.rafId !== 0) {
      window.cancelAnimationFrame(eng.rafId);
      eng.rafId = 0;
    }
    if (panSpringControlsRef.current.length > 0) {
      for (const ctrl of panSpringControlsRef.current) {
        ctrl.stop();
      }
      panSpringControlsRef.current = [];
    }
  }, []);

  useEffect(() => stopCameraGlide, [stopCameraGlide]);

  const getPanBounds = useCallback((zoom: number) => {
    const viewEl = viewportRef.current;
    const vw = viewEl?.clientWidth ?? viewportSize.vw;
    const vh = viewEl?.clientHeight ?? viewportSize.vh;
    if (vw <= 0 || vh <= 0) {
      return { maxPanX: 0, maxPanY: 0, vw: 1, vh: 1, measured: false };
    }
    const { baseW, baseH } = computeCoverDimensions(vw, vh, aspectNum, aspectDen);
    return {
      maxPanX: Math.max(0, (baseW * zoom - vw) / 2),
      maxPanY: Math.max(0, (baseH * zoom - vh) / 2),
      vw,
      vh,
      measured: true,
    };
  }, [viewportSize.vw, viewportSize.vh, aspectNum, aspectDen]);

  const clampCamera = useCallback((nextZoom: number, rawPanX: number, rawPanY: number): StageCameraState => {
    const z = Math.max(1, Math.min(MAX_STAGE_ZOOM, Number(nextZoom.toFixed(4))));
    const { maxPanX, maxPanY, measured } = getPanBounds(z);
    if (!measured) {
      return { zoom: z, panX: 0, panY: 0 };
    }
    return {
      zoom: z,
      panX: Math.max(-maxPanX, Math.min(maxPanX, rawPanX)),
      panY: Math.max(-maxPanY, Math.min(maxPanY, rawPanY)),
    };
  }, [getPanBounds]);

  const rubberbandCamera = useCallback((nextZoom: number, rawPanX: number, rawPanY: number): StageCameraState => {
    const z = Math.max(1, Math.min(MAX_STAGE_ZOOM, Number(nextZoom.toFixed(4))));
    const { maxPanX, maxPanY, vw, vh, measured } = getPanBounds(z);
    if (!measured) {
      return { zoom: z, panX: 0, panY: 0 };
    }
    const resist = (val: number, maxBound: number, dim: number) => {
      if (val > maxBound) return maxBound + rubberband(val - maxBound, dim);
      if (val < -maxBound) return -maxBound - rubberband(-maxBound - val, dim);
      return val;
    };
    return {
      zoom: z,
      panX: resist(rawPanX, maxPanX, vw),
      panY: resist(rawPanY, maxPanY, vh),
    };
  }, [getPanBounds]);

  const commitCameraImmediate = useCallback((next: StageCameraState) => {
    stopCameraGlide();
    const eng = cameraEngineRef.current;
    eng.cur = next;
    eng.target = next;
    setCameraView({ cur: next, target: next });
  }, [stopCameraGlide]);

  const startCameraGlideLoop = useCallback(() => {
    const eng = cameraEngineRef.current;
    if (eng.rafId !== 0) return;
    eng.lastTs = performance.now();

    const step = (now: number) => {
      const state = cameraEngineRef.current;
      const dt = Math.min(0.05, Math.max(0.004, (now - state.lastTs) / 1000));
      state.lastTs = now;
      const alpha = 1 - Math.pow(0.00025, dt);

      const dz = state.target.zoom - state.cur.zoom;
      const dx = state.target.panX - state.cur.panX;
      const dy = state.target.panY - state.cur.panY;

      if (Math.abs(dz) < 0.0006 && Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25) {
        state.cur = state.target;
        state.rafId = 0;
        setCameraView({ cur: state.target, target: state.target });
        return;
      }

      const nextCur: StageCameraState = {
        zoom: state.cur.zoom + dz * alpha,
        panX: state.cur.panX + dx * alpha,
        panY: state.cur.panY + dy * alpha,
      };
      state.cur = nextCur;
      setCameraView({ cur: nextCur, target: state.target });
      state.rafId = window.requestAnimationFrame(step);
    };

    eng.rafId = window.requestAnimationFrame(step);
  }, []);

  const applyCamera = useCallback(
    (updater: (prev: StageCameraState) => StageCameraState, instant = false) => {
      const eng = cameraEngineRef.current;
      const base = instant ? eng.cur : eng.target;
      const next = updater(base);
      if (instant || reducedMotion || frozen || dragStateRef.current?.moved) {
        commitCameraImmediate(next);
        return;
      }
      eng.target = next;
      setCameraView({ cur: eng.cur, target: next });
      startCameraGlideLoop();
    },
    [reducedMotion, frozen, commitCameraImmediate, startCameraGlideLoop],
  );

  // Snap in-flight glide immediately if motion becomes frozen or reduced
  useEffect(() => {
    if (!reducedMotion && !frozen) return;
    const eng = cameraEngineRef.current;
    if (
      eng.rafId !== 0
      || eng.cur.zoom !== eng.target.zoom
      || eng.cur.panX !== eng.target.panX
      || eng.cur.panY !== eng.target.panY
    ) {
      commitCameraImmediate(eng.target);
    }
  }, [reducedMotion, frozen, commitCameraImmediate]);

  const focusOnPercent = useCallback(
    (xPercent: number, yPercent: number, targetMinZoom = STREET_DEFAULT_ZOOM, reserveRightDrawer = false) => {
      const viewEl = viewportRef.current;
      if (!viewEl || viewEl.clientWidth <= 0 || viewEl.clientHeight <= 0) return;

      applyCamera((prev) => {
        const vw = viewEl.clientWidth;
        const vh = viewEl.clientHeight;
        const { baseW, baseH } = computeCoverDimensions(vw, vh, aspectNum, aspectDen);
        const neededForRightDrawer = reserveRightDrawer && vw > 860
          ? 500 / (Math.max(0.17, 1 - xPercent / 100) * baseW)
          : 1;
        const z = Math.min(MAX_STAGE_ZOOM, Math.max(prev.zoom, targetMinZoom, neededForRightDrawer));
        const rightBiasPx = reserveRightDrawer && vw > 860 ? -200 : 0;
        const desiredPanX = (0.5 - xPercent / 100) * baseW * z + rightBiasPx;
        const desiredPanY = (0.5 - yPercent / 100) * baseH * z;
        return clampCamera(z, desiredPanX, desiredPanY);
      }, false);
    },
    [applyCamera, clampCamera, aspectNum, aspectDen],
  );

  const handleMiniMapJump = useCallback(
    (xPercent: number, yPercent: number, instant = false) => {
      const viewEl = viewportRef.current;
      if (!viewEl || viewEl.clientWidth <= 0 || viewEl.clientHeight <= 0) return;

      applyCamera((prev) => {
        const { baseW, baseH } = computeCoverDimensions(viewEl.clientWidth, viewEl.clientHeight, aspectNum, aspectDen);
        const z = Math.max(prev.zoom, STREET_DEFAULT_ZOOM);
        const desiredPanX = (0.5 - xPercent / 100) * baseW * z;
        const desiredPanY = (0.5 - yPercent / 100) * baseH * z;
        return clampCamera(z, desiredPanX, desiredPanY);
      }, instant);
    },
    [applyCamera, clampCamera, aspectNum, aspectDen],
  );

  const getDefaultCamera = useCallback((): StageCameraState => {
    const viewEl = viewportRef.current;
    const vw = viewEl?.clientWidth ?? viewportSize.vw;
    const vh = viewEl?.clientHeight ?? viewportSize.vh;
    return computeDefaultStageCamera(vw, vh, aspectNum, aspectDen);
  }, [viewportSize.vw, viewportSize.vh, aspectNum, aspectDen]);

  // Reset camera to lively street-district view & clear landmark selection when relocating to a new habitat
  useEffect(() => {
    const viewEl = viewportRef.current;
    const vw = viewEl?.clientWidth ?? 0;
    const vh = viewEl?.clientHeight ?? 0;
    if (vw > 0 && vh > 0) {
      initialFramingActivationRef.current = snapshot.habitatActivationId;
      commitCameraImmediate(computeDefaultStageCamera(vw, vh, aspectNum, aspectDen));
    } else {
      initialFramingActivationRef.current = null;
      commitCameraImmediate({ zoom: STREET_DEFAULT_ZOOM, panX: 0, panY: 0 });
    }
    setSelectedLandmarkId(null);
  }, [snapshot.habitatActivationId, aspectNum, aspectDen, commitCameraImmediate]);

  // Publish live presence-dock height so narrow floating drawers stay clear of the dock
  useEffect(() => {
    const el = presenceDockRef.current;
    if (!el) return;
    const hostTarget = (el.closest('.utopia-world-shell') as HTMLElement | null) ?? document.documentElement;

    const publishDockHeight = (entry?: ResizeObserverEntry) => {
      const borderBoxHeight = entry?.borderBoxSize?.[0]?.blockSize ?? 0;
      const rectHeight = el.getBoundingClientRect().height;
      const measured = borderBoxHeight > 0
        ? borderBoxHeight
        : (rectHeight > 0 ? rectHeight : (el.offsetHeight > 0 ? el.offsetHeight : (entry?.contentRect?.height ?? 0)));
      if (measured > 0) {
        hostTarget.style.setProperty(UTOPIA_PRESENCE_DOCK_HEIGHT_VAR, `${Math.ceil(measured)}px`);
      }
    };

    publishDockHeight();
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver((entries) => {
          publishDockHeight(entries[0]);
        })
      : null;
    ro?.observe(el);
    const onResize = () => publishDockHeight();
    window.addEventListener('resize', onResize);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
      hostTarget.style.removeProperty(UTOPIA_PRESENCE_DOCK_HEIGHT_VAR);
    };
  }, [matchingMedia]);

  // Keep mini-map companion dots gently updated without coupling to 30fps sprite loop
  useEffect(() => {
    if (frozen || reducedMotion) return;
    const id = window.setInterval(() => {
      setMiniMapPulse((n) => (n + 1) & 0xfff);
    }, 900);
    return () => window.clearInterval(id);
  }, [frozen, reducedMotion]);

  // Measure viewport dimensions & apply initial top-clearance framing / re-clamp camera on resize
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const syncViewport = () => {
      const vw = el.clientWidth;
      const vh = el.clientHeight;
      setViewportSize((prev) => (prev.vw === vw && prev.vh === vh ? prev : { vw, vh }));
      if (vw > 0 && vh > 0) {
        if (initialFramingActivationRef.current !== snapshot.habitatActivationId) {
          initialFramingActivationRef.current = snapshot.habitatActivationId;
          commitCameraImmediate(computeDefaultStageCamera(vw, vh, aspectNum, aspectDen));
          return;
        }
        const { baseW, baseH } = computeCoverDimensions(vw, vh, aspectNum, aspectDen);
        const clampWithDims = (c: StageCameraState): StageCameraState => {
          const maxX = Math.max(0, (baseW * c.zoom - vw) / 2);
          const maxY = Math.max(0, (baseH * c.zoom - vh) / 2);
          const px = Math.max(-maxX, Math.min(maxX, c.panX));
          const py = Math.max(-maxY, Math.min(maxY, c.panY));
          return px === c.panX && py === c.panY ? c : { zoom: c.zoom, panX: px, panY: py };
        };
        const eng = cameraEngineRef.current;
        const nextCur = clampWithDims(eng.cur);
        const nextTarget = clampWithDims(eng.target);
        if (nextCur !== eng.cur || nextTarget !== eng.target) {
          eng.cur = nextCur;
          eng.target = nextTarget;
          setCameraView({ cur: nextCur, target: nextTarget });
        }
      }
    };

    syncViewport();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncViewport) : null;
    ro?.observe(el);
    window.addEventListener('resize', syncViewport);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', syncViewport);
    };
  }, [matchingMedia, aspectNum, aspectDen, snapshot.habitatActivationId, commitCameraImmediate]);

  // Cursor-anchored smooth wheel & trackpad-pinch zoom across the entire stage shell
  useEffect(() => {
    const viewEl = viewportRef.current;
    if (!viewEl) return;
    const listenRoot = (viewEl.closest('.utopia-world-shell') as HTMLElement | null) ?? viewEl;

    const onWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          '.utopia-floating-drawer, [role="dialog"], .utopia-minimap-place-strip, .utopia-dock-list, input[type="range"]',
        )
      ) {
        return;
      }

      const rawDeltaY = e.deltaMode === 1
        ? e.deltaY * 24
        : (e.deltaMode === 2 ? e.deltaY * 240 : e.deltaY);

      // Ignore pure horizontal two-finger trackpad swipes so deltaY===0 never triggers accidental zoom-out
      if (Math.abs(rawDeltaY) < 0.05) return;

      e.preventDefault();
      const rect = viewEl.getBoundingClientRect();
      const ox = rect.width > 0 ? (e.clientX - rect.left - rect.width / 2) : 0;
      const oy = rect.height > 0 ? (e.clientY - rect.top - rect.height / 2) : 0;

      const clampedDelta = Math.max(-140, Math.min(140, rawDeltaY));
      let zoomFactor: number;
      if (e.ctrlKey) {
        zoomFactor = Math.exp(-clampedDelta * 0.011);
      } else if (Math.abs(clampedDelta) >= 36) {
        const stepMag = Math.min(0.18, Math.max(0.11, Math.abs(clampedDelta) * 0.0017));
        zoomFactor = Math.exp(-Math.sign(clampedDelta) * stepMag);
      } else {
        zoomFactor = Math.exp(-clampedDelta * 0.0042);
      }

      applyCamera((prev) => {
        const nextZ = Math.max(1, Math.min(MAX_STAGE_ZOOM, prev.zoom * zoomFactor));
        if (Math.abs(nextZ - prev.zoom) < 0.0002) return prev;
        const ratio = nextZ / prev.zoom;
        const nextPanX = ox - (ox - prev.panX) * ratio;
        const nextPanY = oy - (oy - prev.panY) * ratio;
        return clampCamera(nextZ, nextPanX, nextPanY);
      }, false);
    };

    listenRoot.addEventListener('wheel', onWheel, { passive: false });
    return () => listenRoot.removeEventListener('wheel', onWheel);
  }, [applyCamera, clampCamera, matchingMedia]);

  // Keyboard zoom shortcuts (+ / - / 0) when focus is not inside a text field
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        applyCamera((p) => clampCamera(p.zoom + 0.22, p.panX * 1.15, p.panY * 1.15));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        applyCamera((p) => clampCamera(p.zoom - 0.18, p.panX * 0.82, p.panY * 0.82));
      } else if (e.key === '0') {
        e.preventDefault();
        applyCamera(() => getDefaultCamera());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [applyCamera, clampCamera, getDefaultCamera]);

  const prevSelectedPlaceKeyRef = useRef<string>('');

  // Pan camera smoothly ONLY when selectedPlaceId actively changes to a new place
  useEffect(() => {
    const key = `${snapshot.habitatActivationId}:${selectedPlaceId ?? ''}`;
    if (prevSelectedPlaceKeyRef.current === key) return;
    prevSelectedPlaceKeyRef.current = key;
    if (!selectedPlaceId) return;
    setSelectedLandmarkId(null);
    if (!matchingMedia) return;
    const anchor = matchingMedia.pack.stage.anchors.find((a) => a.targetId === selectedPlaceId);
    if (anchor) {
      focusOnPercent(anchor.xPercent, Math.min(86, anchor.yPercent + 5), STREET_DEFAULT_ZOOM, drawerOpen);
    }
  }, [snapshot.habitatActivationId, selectedPlaceId, matchingMedia, focusOnPercent, drawerOpen]);

  const prevSelectedHandleKeyRef = useRef<string>('');

  // Glide camera smoothly onto selected resident ONLY when selection handle actively changes
  useEffect(() => {
    const key = `${snapshot.habitatActivationId}:${selectedResidentHandle ?? ''}`;
    if (prevSelectedHandleKeyRef.current === key) return;
    prevSelectedHandleKeyRef.current = key;
    if (!matchingMedia || !selectedResidentHandle) return;
    const pt = liveResidentCoordsRef.current.get(selectedResidentHandle);
    if (pt) {
      focusOnPercent(pt.x, pt.y, 1.48, drawerOpen);
    }
  }, [snapshot.habitatActivationId, selectedResidentHandle, matchingMedia, focusOnPercent, drawerOpen]);

  const visibleLayers = useMemo(() => {
    if (!matchingMedia) return [];
    return [...matchingMedia.pack.stage.layers]
      .filter((layer) => evalStageCondition(
        layer.visibleWhen,
        daypart,
        snapshot.parameterValues,
        snapshot.activeEvents,
      ))
      .sort((a, b) => a.zIndex - b.zIndex);
  }, [matchingMedia, daypart, snapshot.parameterValues, snapshot.activeEvents]);

  const activeEffects = useMemo<readonly ActiveAmbientEffect[]>(() => {
    if (!matchingMedia) return [];
    return matchingMedia.pack.stage.ambientEffects
      .filter((eff) => evalStageCondition(
        eff.visibleWhen,
        daypart,
        snapshot.parameterValues,
        snapshot.activeEvents,
      ))
      .map((eff) => ({ effect: eff.effect, intensity: eff.intensity }));
  }, [matchingMedia, daypart, snapshot.parameterValues, snapshot.activeEvents]);

  const sortedAnchors = useMemo(() => {
    if (!matchingMedia) return [];
    return [...matchingMedia.pack.stage.anchors].sort(
      (a, b) => (a.xPercent - b.xPercent) || (a.yPercent - b.yPercent),
    );
  }, [matchingMedia]);

  const landmarks = useMemo(
    () => resolveWorldLandmarks(snapshot.habitat.habitatId),
    [snapshot.habitat.habitatId],
  );

  const selectedLandmark: WorldScenicLandmark | null = useMemo(
    () => (selectedLandmarkId ? (landmarks.find((l) => l.id === selectedLandmarkId) ?? null) : null),
    [landmarks, selectedLandmarkId],
  );

  if (!matchingMedia) {
    return (
      <FallbackJournalStage
        snapshot={snapshot}
        daypart={daypart}
        frozen={frozen}
        reducedMotion={reducedMotion}
        selectedPlaceId={selectedPlaceId}
        selectedResidentHandle={selectedResidentHandle}
        chibiWardrobe={chibiWardrobe}
        bindingsByHandle={bindingsByHandle}
        packFallbackReason={packFallbackReason}
        packFallbackDetail={packFallbackDetail}
        onOpenPackLibrary={onOpenPackLibrary}
        onOpenHomePartners={onOpenHomePartners}
        onSelectPlace={onSelectPlace}
        onSelectResident={onSelectResident}
      />
    );
  }

  const { stage, manifest } = matchingMedia.pack;
  const openSet = new Set(snapshot.openPlaceIds);
  const placeMap = new Map(snapshot.habitat.places.map((p) => [p.id, p]));
  const previewUrl = matchingMedia.assetUrls[manifest.previewAsset];

  const hasMeasuredViewport = viewportSize.vw > 0 && viewportSize.vh > 0;
  const coverDims = hasMeasuredViewport
    ? computeCoverDimensions(viewportSize.vw, viewportSize.vh, aspectNum, aspectDen)
    : null;

  const projectWorldPercent = coverDims
    ? (
        xPercent: number,
        yPercent: number,
        offsetX = '-50%',
        offsetY = '-50%',
      ): React.CSSProperties => {
        const px = (viewportSize.vw / 2 + renderCamera.panX + (xPercent / 100 - 0.5) * coverDims.baseW * renderCamera.zoom).toFixed(1);
        const py = (viewportSize.vh / 2 + renderCamera.panY + (yPercent / 100 - 0.5) * coverDims.baseH * renderCamera.zoom).toFixed(1);
        return {
          left: '0px',
          top: '0px',
          transform: `translate3d(${px}px, ${py}px, 0) translate(${offsetX}, ${offsetY})`,
        };
      }
    : undefined;

  const computeViewportBox = (): MiniMapViewportBox => {
    if (!coverDims) {
      return { leftPercent: 16, topPercent: 16, widthPercent: 68, heightPercent: 68 };
    }
    const vw = viewportSize.vw;
    const vh = viewportSize.vh;
    const scaledW = coverDims.baseW * renderCamera.zoom;
    const scaledH = coverDims.baseH * renderCamera.zoom;
    const rawW = Math.min(100, (vw / scaledW) * 100);
    const rawH = Math.min(100, (vh / scaledH) * 100);
    const rawL = Math.max(0, Math.min(100 - rawW, (0.5 + (-vw / 2 - renderCamera.panX) / scaledW) * 100));
    const rawT = Math.max(0, Math.min(100 - rawH, (0.5 + (-vh / 2 - renderCamera.panY) / scaledH) * 100));
    return {
      leftPercent: rawL,
      topPercent: rawT,
      widthPercent: rawW,
      heightPercent: rawH,
    };
  };

  const viewportBox = computeViewportBox();

  const spawnClickRipple = (clientX: number, clientY: number) => {
    const viewEl = viewportRef.current;
    if (!viewEl || reducedMotion) return;
    const rect = viewEl.getBoundingClientRect();
    const id = ++rippleSeqRef.current;
    const item: ClickRipple = {
      id,
      xClient: clientX - rect.left,
      yClient: clientY - rect.top,
    };
    setRipples((prev) => [...prev.slice(-4), item]);
    window.setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 680);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (
      target?.closest(
        'button, a, input, textarea, [role="dialog"], .utopia-minimap-card, .utopia-place-caption-card, .utopia-presence-dock',
      )
    ) {
      return;
    }

    stopCameraGlide();
    const currentCam = cameraEngineRef.current.cur;
    cameraEngineRef.current.target = currentCam;
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startPanX: currentCam.panX,
      startPanY: currentCam.panY,
      moved: false,
      samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }],
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag) {
      const rect = e.currentTarget.getBoundingClientRect();
      if (!reducedMotion && !frozen && rect.width > 0 && rect.height > 0) {
        const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
        const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
        setPointerOffset({ x: nx, y: ny });
      }
      return;
    }

    if (drag.pointerId !== e.pointerId) return;
    const now = performance.now();
    const rawDx = e.clientX - drag.startX;
    const rawDy = e.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.hypot(rawDx, rawDy) < DRAG_HYSTERESIS_PX) return;
      drag.moved = true;
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      drag.startPanX = cameraEngineRef.current.cur.panX;
      drag.startPanY = cameraEngineRef.current.cur.panY;
      drag.samples = [{ x: e.clientX, y: e.clientY, t: now }];
      setIsDragging(true);
      return;
    }

    drag.samples.push({ x: e.clientX, y: e.clientY, t: now });
    const cutoff = now - 100;
    while (drag.samples.length > 2 && drag.samples[0]!.t < cutoff) {
      drag.samples.shift();
    }

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const curZoom = cameraEngineRef.current.cur.zoom;
    commitCameraImmediate(rubberbandCamera(curZoom, drag.startPanX + dx, drag.startPanY + dy));
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragStateRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (drag.moved) {
      setIsDragging(false);
      const cur = cameraEngineRef.current.cur;
      const { maxPanX, maxPanY } = getPanBounds(cur.zoom);
      const outOfBounds = Math.abs(cur.panX) > maxPanX + 0.5 || Math.abs(cur.panY) > maxPanY + 0.5;

      if (reducedMotion || frozen || e.type === 'pointercancel') {
        commitCameraImmediate(clampCamera(cur.zoom, cur.panX, cur.panY));
        return;
      }

      // Compute release velocity (px/s) from recent pointermove samples
      let vx = 0;
      let vy = 0;
      const samples = drag.samples;
      const now = performance.now();
      if (samples.length >= 2) {
        const last = samples[samples.length - 1]!;
        const first = samples[0]!;
        const dtSec = (last.t - first.t) / 1000;
        if (now - last.t < 80 && dtSec > 0.004) {
          vx = (last.x - first.x) / dtSec;
          vy = (last.y - first.y) / dtSec;
        }
      }

      const projDx = outOfBounds ? 0 : projectMomentum(vx, 0.992);
      const projDy = outOfBounds ? 0 : projectMomentum(vy, 0.992);
      const commitX = !outOfBounds && shouldCommitGesture({
        originValue: drag.startPanX,
        currentValue: cur.panX,
        targetValue: cur.panX + projDx,
        releaseVelocityPxPerSec: vx,
      });
      const commitY = !outOfBounds && shouldCommitGesture({
        originValue: drag.startPanY,
        currentValue: cur.panY,
        targetValue: cur.panY + projDy,
        releaseVelocityPxPerSec: vy,
      });
      const clampedTarget = clampCamera(
        cur.zoom,
        commitX ? cur.panX + projDx : cur.panX,
        commitY ? cur.panY + projDy : cur.panY,
      );

      if (outOfBounds || Math.hypot(clampedTarget.panX - cur.panX, clampedTarget.panY - cur.panY) > 0.5) {
        stopCameraGlide();
        const spring = nimiSpring(outOfBounds ? 'default' : 'momentum');
        const eng = cameraEngineRef.current;
        eng.target = clampedTarget;
        const controls: Array<{ stop: () => void }> = [];

        if (Math.abs(clampedTarget.panX - cur.panX) > 0.25) {
          controls.push(
            animate(cur.panX, clampedTarget.panX, {
              ...spring,
              velocity: outOfBounds ? 0 : vx,
              onUpdate: (nextPanX) => {
                const nextCam: StageCameraState = {
                  zoom: eng.cur.zoom,
                  panX: nextPanX,
                  panY: eng.cur.panY,
                };
                eng.cur = nextCam;
                setCameraView({ cur: nextCam, target: clampedTarget });
              },
            }),
          );
        }
        if (Math.abs(clampedTarget.panY - cur.panY) > 0.25) {
          controls.push(
            animate(cur.panY, clampedTarget.panY, {
              ...spring,
              velocity: outOfBounds ? 0 : vy,
              onUpdate: (nextPanY) => {
                const nextCam: StageCameraState = {
                  zoom: eng.cur.zoom,
                  panX: eng.cur.panX,
                  panY: nextPanY,
                };
                eng.cur = nextCam;
                setCameraView({ cur: nextCam, target: clampedTarget });
              },
            }),
          );
        }
        panSpringControlsRef.current = controls;
      }
    } else {
      spawnClickRipple(e.clientX, e.clientY);
      setSelectedLandmarkId(null);
      onBackgroundClick?.();
    }
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (
      target?.closest(
        'button, a, input, textarea, [role="dialog"], .utopia-minimap-card, .utopia-place-caption-card, .utopia-presence-dock',
      )
    ) {
      return;
    }
    const viewEl = viewportRef.current;
    if (!viewEl) return;
    const rect = viewEl.getBoundingClientRect();
    const ox = rect.width > 0 ? (e.clientX - rect.left - rect.width / 2) : 0;
    const oy = rect.height > 0 ? (e.clientY - rect.top - rect.height / 2) : 0;

    applyCamera((prev) => {
      if (prev.zoom >= MAX_STAGE_ZOOM - 0.12) {
        return getDefaultCamera();
      }
      const nextZ = Math.min(MAX_STAGE_ZOOM, prev.zoom + 0.38);
      const ratio = nextZ / prev.zoom;
      return clampCamera(nextZ, ox - (ox - prev.panX) * ratio, oy - (oy - prev.panY) * ratio);
    }, false);
  };

  const handlePointerLeave = () => {
    if (!dragStateRef.current && (pointerOffset.x !== 0 || pointerOffset.y !== 0)) {
      setPointerOffset({ x: 0, y: 0 });
    }
  };

  const selectedPlace = selectedPlaceId === 'personal-quarter'
    ? {
        id: 'personal-quarter',
        name: snapshot.habitat.personalQuarter.name,
        archetype: 'personal-quarter' as const,
        traits: snapshot.habitat.personalQuarter.sensoryTraits,
        isOpen: true,
        meta: '安静小窝 · 各自独立的起居空间',
        breakdown: buildPlaceOccupancyBreakdown('personal-quarter', snapshot),
        activities: snapshot.habitat.activities
          .filter((a) => a.placeIds.includes('personal-quarter'))
          .map((a) => a.name),
        events: snapshot.activeEvents.filter((ev) => ev.placeId === 'personal-quarter'),
        unlock: null,
      }
    : selectedPlaceId
      ? (() => {
          const p = placeMap.get(selectedPlaceId);
          if (!p) return null;
          const isOpen = openSet.has(p.id);
          return {
            id: p.id,
            name: p.name,
            archetype: p.archetype as HabitatPlaceArchetype,
            traits: p.sensoryTraits,
            isOpen,
            meta: isOpen
              ? `${p.indoor ? '室内小筑' : '露天隅角'} · 敞门迎客`
              : '受天气潮汐影响 · 暂歇',
            breakdown: buildPlaceOccupancyBreakdown(p.id, snapshot),
            activities: snapshot.habitat.activities
              .filter((a) => a.placeIds.includes(p.id))
              .map((a) => a.name),
            events: snapshot.activeEvents.filter((ev) => ev.placeId === p.id),
            unlock: isOpen ? null : resolveUnlockPatchForPlace(p, snapshot),
          };
        })()
      : null;

  const zoomPercent = Math.round(targetCamera.zoom * 100);
  const isOverviewZoom = targetCamera.zoom <= 1.03;
  const defaultCamera = computeDefaultStageCamera(viewportSize.vw, viewportSize.vh, aspectNum, aspectDen);
  const isDefaultCamera = Math.abs(targetCamera.zoom - defaultCamera.zoom) <= 0.03
    && Math.abs(targetCamera.panX - defaultCamera.panX) < 4
    && Math.abs(targetCamera.panY - defaultCamera.panY) < 4;
  const chibiScale = Math.pow(Math.max(1, renderCamera.zoom), 0.56).toFixed(3);

  return (
    <section
      className={[
        'utopia-stage-shell',
        `layout-${stage.layout}`,
        `motif-${stage.palette.frameMotif}`,
        `daypart-${daypart}`,
        frozen ? 'is-frozen' : '',
        transitioning ? 'is-relocating' : '',
        isDragging ? 'is-dragging-map' : '',
        hudHidden ? 'is-hud-hidden' : '',
      ].filter(Boolean).join(' ')}
      data-utopia-expressive-stage="illustrated-scroll"
      aria-label={`${snapshot.habitat.title} 洞天画卷舞台`}
      style={{
        '--utopia-stage-bg': stage.palette.stageCanvasBg,
        '--utopia-stage-badge-bg': stage.palette.badgeBg,
        '--utopia-stage-badge-text': stage.palette.badgeText,
        '--utopia-stage-accent': stage.palette.accent,
        '--utopia-stage-aspect': stage.aspectRatio.replace(':', ' / '),
        '--utopia-aspect-num': String(aspectNum),
        '--utopia-aspect-den': String(aspectDen),
        '--utopia-chibi-scale': chibiScale,
      } as React.CSSProperties}
    >
      <div
        ref={viewportRef}
        className="utopia-stage-viewport-frame"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUpOrCancel}
        onPointerCancel={handlePointerUpOrCancel}
        onPointerLeave={handlePointerLeave}
        onDoubleClick={handleDoubleClick}
      >
        {/* Viewport-Sized Retina <canvas> World Renderer (4K Ink Maps + Vector Micro-Scenery + Weather) */}
        <UtopiaWorldCanvas
          visibleLayers={visibleLayers}
          assetUrls={matchingMedia.assetUrls}
          stageCanvasBg={stage.palette.stageCanvasBg}
          frameMotif={stage.palette.frameMotif}
          aspectNum={aspectNum}
          aspectDen={aspectDen}
          camera={renderCamera}
          pointerOffset={pointerOffset}
          effects={activeEffects}
          sceneryEvents={snapshot.activeEvents}
          anchors={sortedAnchors}
          daypart={daypart}
          habitatId={snapshot.habitat.habitatId}
          frozen={frozen}
          reducedMotion={reducedMotion}
        />

        {/* Crisp 1:1 Screen-Projected Vector Overlay Plane (Zero CSS scale() Bitmap Blur) */}
        <div className="utopia-stage-overlay-plane">
          {/* Clickable Scenic Landmarks (`风物地标`) */}
          <WorldSceneryLayer
            habitatId={snapshot.habitat.habitatId}
            selectedLandmarkId={selectedLandmarkId}
            projectPercent={projectWorldPercent}
            onSelectLandmark={(lm) => {
              if (selectedPlaceId) {
                onSelectPlace(selectedPlaceId);
              }
              const nextId = selectedLandmarkId === lm.id ? null : lm.id;
              setSelectedLandmarkId(nextId);
              if (nextId) {
                focusOnPercent(lm.xPercent, Math.min(86, lm.yPercent + 5), STREET_DEFAULT_ZOOM, drawerOpen);
              }
            }}
          />

          {/* Diegetic Hand-Drawn Roof Signposts */}
          <div className="utopia-anchors-layer">
            {sortedAnchors.map((anchor) => {
              const isPrivateQuarter = anchor.targetId === 'personal-quarter';
              const placeSpec = isPrivateQuarter ? null : (placeMap.get(anchor.targetId) ?? null);
              const placeName = isPrivateQuarter
                ? snapshot.habitat.personalQuarter.name
                : (placeSpec?.name ?? anchor.targetId);
              const indoor = isPrivateQuarter ? true : Boolean(placeSpec?.indoor);
              const isOpen = isPrivateQuarter ? true : openSet.has(anchor.targetId);
              const breakdown = buildPlaceOccupancyBreakdown(anchor.targetId, snapshot);
              const isSelected = selectedPlaceId === anchor.targetId;
              const occupantCount = breakdown.sharedPairs.length * 2
                + breakdown.independentResidents.length
                + breakdown.privateResidents.length;
              const hasPlaceScenery = snapshot.activeEvents.some((ev) => ev.placeId === anchor.targetId);
              const archetype = isPrivateQuarter ? 'personal-quarter' : (placeSpec?.archetype ?? 'courtyard');
              const posStyle = projectWorldPercent
                ? projectWorldPercent(anchor.xPercent, anchor.yPercent)
                : { left: `${anchor.xPercent}%`, top: `${anchor.yPercent}%` };

              return (
                <div
                  key={anchor.targetId}
                  className={[
                    'utopia-anchor-node',
                    `badge-${anchor.badgeStyle}`,
                    isOpen ? 'is-open' : 'is-closed',
                    isSelected ? 'is-selected' : '',
                    occupantCount > 0 ? 'has-occupants' : '',
                  ].filter(Boolean).join(' ')}
                  style={posStyle}
                >
                  <button
                    type="button"
                    className="utopia-anchor-pin-btn"
                    aria-label={buildPlaceAriaLabel({
                      placeName,
                      indoor,
                      isOpen,
                      isPrivateQuarter,
                      breakdown,
                    })}
                    aria-pressed={isSelected}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedLandmarkId(null);
                      onSelectPlace(anchor.targetId);
                    }}
                  >
                    <span className="utopia-anchor-icon" aria-hidden="true">
                      {isOpen ? (
                        <ArchetypeIcon archetype={archetype} size={12} />
                      ) : (
                        <LockClosedIcon size={11} />
                      )}
                    </span>
                    <span className="utopia-anchor-title">{placeName}</span>
                    {hasPlaceScenery && isOpen && (
                      <span className="utopia-anchor-scenery-dot" title="此处正有风物景象" aria-hidden="true" />
                    )}
                    {occupantCount > 0 && (
                      <span className="utopia-anchor-occ-pip" aria-hidden="true">{occupantCount}</span>
                    )}
                    {!isOpen && <span className="utopia-anchor-closed-label">暂闭</span>}
                    {isPrivateQuarter && <span className="utopia-anchor-quarter-tag">私舍</span>}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Embodied 2.5D Chibi Companions Walking & Interacting on the Map */}
          <LivingResidentsLayer
            snapshot={snapshot}
            stage={stage}
            frozen={frozen}
            reducedMotion={reducedMotion}
            selectedResidentHandle={selectedResidentHandle}
            chibiWardrobe={chibiWardrobe}
            bindingsByHandle={bindingsByHandle}
            liveCoordsRef={liveResidentCoordsRef}
            projectPercent={projectWorldPercent}
            onSelectResident={(resident, coords) => {
              if (coords) {
                focusOnPercent(coords.x, coords.y, 1.5, true);
              }
              onSelectResident(resident);
            }}
          />
        </div>

        {/* Tactile Click Ripples */}
        {ripples.map((r) => (
          <span
            key={r.id}
            className="utopia-map-click-ripple"
            style={{ left: `${r.xClient}px`, top: `${r.yClient}px` }}
            aria-hidden="true"
          />
        ))}

        {/* Floating Place Field Note Card (Top-Left below Floating Ribbon) */}
        {selectedPlace && (
          <div className="utopia-place-floating-sheet" role="status" aria-live="polite">
            <div className="utopia-place-caption-card">
              <div className="utopia-place-caption-head">
                <span className="utopia-place-caption-title">
                  <ArchetypeIcon archetype={selectedPlace.archetype} size={14} />
                  <strong>{selectedPlace.name}</strong>
                </span>
                <div className="utopia-place-caption-head-right">
                  <span className={`utopia-place-status-chip ${selectedPlace.isOpen ? 'is-open' : 'is-closed'}`}>
                    {selectedPlace.meta}
                  </span>
                  <button
                    type="button"
                    className="utopia-place-close-btn"
                    aria-label="关闭场所说明"
                    onClick={() => onSelectPlace(selectedPlace.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
              <p className="utopia-place-caption-prose">{selectedPlace.traits}</p>

              {selectedPlace.events.length > 0 && (
                <div className="utopia-place-scenery-row">
                  {selectedPlace.events.map((ev) => (
                    <span key={ev.eventId} className="utopia-place-scenery-tag">
                      <SceneryGlyph kind={ev.sceneryKind} size={12} />
                      <span>{ev.label}：{ev.description}</span>
                    </span>
                  ))}
                </div>
              )}

              {(selectedPlace.breakdown.sharedPairs.length > 0
                || selectedPlace.breakdown.independentResidents.length > 0
                || selectedPlace.breakdown.privateResidents.length > 0) ? (
                <div className="utopia-place-companions-box">
                  <span className="utopia-place-companions-kicker">
                    {selectedPlace.breakdown.sharedPairs.length > 0
                      ? '此刻正相伴于此'
                      : selectedPlace.id === 'personal-quarter'
                        ? '正在小窝歇息'
                        : selectedPlace.breakdown.independentResidents.length > 0
                          ? '此刻公开在此停留'
                          : '各自在此活动（未开启公共同场）'}
                  </span>
                  <PlaceResidentBadges
                    placeId={selectedPlace.id}
                    breakdown={selectedPlace.breakdown}
                    maxVisibleAvatars={4}
                    selectedHandle={selectedResidentHandle}
                    chibiWardrobe={chibiWardrobe}
                    bindingsByHandle={bindingsByHandle}
                    onSelectResident={(resident) => {
                      const pt = liveResidentCoordsRef.current.get(resident.agentHandle);
                      if (pt) {
                        focusOnPercent(pt.x, pt.y, 1.5, true);
                      }
                      onSelectResident(resident);
                    }}
                  />
                </div>
              ) : selectedPlace.isOpen ? (
                <p className="utopia-place-quiet-hint">
                  此刻这里安安静静，正敞着门等伙伴散步经过。
                </p>
              ) : null}

              {selectedPlace.activities.length > 0 && (
                <p className="utopia-place-activities-line">
                  常有兴致：{selectedPlace.activities.join(' · ')}
                </p>
              )}

              {!selectedPlace.isOpen && selectedPlace.unlock && (
                <div className="utopia-place-unlock-bar">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span>{selectedPlace.unlock.reason || '受当前洞天环境参数限制'}</span>
                    {selectedPlace.unlock.scopeAndSideEffectNote && (
                      <small style={{ fontSize: 11, opacity: 0.78 }}>
                        {selectedPlace.unlock.scopeAndSideEffectNote}
                      </small>
                    )}
                  </div>
                  {selectedPlace.unlock.patch && onQuickApplyParameters && (
                    <button
                      type="button"
                      disabled={busy || frozen}
                      className="utopia-place-unlock-btn"
                      title={selectedPlace.unlock.scopeAndSideEffectNote ?? '将调整全住地环境参数'}
                      onClick={() => onQuickApplyParameters(selectedPlace.unlock!.patch!)}
                    >
                      调至开放条件
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Floating Scenic Landmark Note Card (`风物观景手记`) */}
        {!selectedPlace && selectedLandmark && (
          <div className="utopia-place-floating-sheet" role="status" aria-live="polite">
            <div className="utopia-place-caption-card is-landmark-note">
              <div className="utopia-place-caption-head">
                <span className="utopia-place-caption-title">
                  <CompassRoseIcon size={14} />
                  <strong>{selectedLandmark.name}</strong>
                </span>
                <div className="utopia-place-caption-head-right">
                  <span className="utopia-place-status-chip is-landmark">
                    风物观景地标 · {selectedLandmark.categoryLabel}
                  </span>
                  <button
                    type="button"
                    className="utopia-place-close-btn"
                    aria-label="关闭风物地标手记"
                    onClick={() => setSelectedLandmarkId(null)}
                  >
                    ×
                  </button>
                </div>
              </div>
              <p className="utopia-place-caption-prose">{selectedLandmark.summary}</p>
              {selectedLandmark.daypartNote?.[daypart] && (
                <p className="utopia-place-activities-line">
                  此刻景致：{selectedLandmark.daypartNote[daypart]}
                </p>
              )}
              <div className="utopia-landmark-footer-row">
                <small className="utopia-landmark-honesty-note">
                  散步路过的风景角落 · 伙伴闲逛时会驻足看看
                </small>
                {onOpenTuner && !frozen && (
                  <button
                    type="button"
                    className="utopia-place-unlock-btn"
                    onClick={onOpenTuner}
                  >
                    去营造台题写风物
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Bottom-Left Floating Companion Bubble Dock (AI-Town Style) */}
        <div
          ref={presenceDockRef}
          className={`utopia-floating-bottom-left ${isDragging || hudHidden ? 'is-egressed' : ''}`}
        >
          <SanctuaryPresenceDock
            snapshot={snapshot}
            selectedResidentHandle={selectedResidentHandle}
            chibiWardrobe={chibiWardrobe}
            bindingsByHandle={bindingsByHandle}
            onSelectResident={(resident) => {
              const pt = liveResidentCoordsRef.current.get(resident.agentHandle);
              if (pt) {
                focusOnPercent(pt.x, pt.y, 1.5, true);
              }
              onSelectResident(resident);
            }}
            onFocusPlace={(pid) => {
              const anchor = matchingMedia.pack.stage.anchors.find((a) => a.targetId === pid);
              if (anchor) {
                focusOnPercent(anchor.xPercent, Math.min(86, anchor.yPercent + 7), 1.44, true);
              }
            }}
            onOpenHomePartners={onOpenHomePartners}
          />
        </div>

        {/* Bottom-Right Interactive World Mini-Map & Camera Controls */}
        <div className={`utopia-floating-bottom-right-stack ${isDragging ? 'is-egressed' : ''}`}>
          {!hudHidden && !drawerOpen && (
            <WorldMiniMap
              snapshot={snapshot}
              previewUrl={previewUrl}
              anchors={sortedAnchors}
              viewportBox={viewportBox}
              selectedPlaceId={selectedPlaceId}
              selectedLandmarkId={selectedLandmarkId}
              residentCoords={liveResidentCoordsRef.current}
              onJumpToPercent={handleMiniMapJump}
              onSelectPlace={(pid) => {
                setSelectedLandmarkId(null);
                onSelectPlace(pid);
              }}
            />
          )}

          <div className="utopia-floating-camera-dock" role="group" aria-label="画卷镜头控制">
            <button
              type="button"
              className="utopia-cam-btn"
              aria-label="缩小画卷视野"
              title="缩小视野"
              disabled={targetCamera.zoom <= 1.01}
              onClick={() => applyCamera((p) => clampCamera(p.zoom - 0.18, p.panX * 0.82, p.panY * 0.82))}
            >
              −
            </button>
            <span className="utopia-cam-zoom-readout" title="滚轮以光标为中心缩放 · 拖拽漫游全域">{zoomPercent}%</span>
            <button
              type="button"
              className="utopia-cam-btn"
              aria-label="放大画卷细节"
              title="放大查看街区与伙伴"
              disabled={targetCamera.zoom >= MAX_STAGE_ZOOM - 0.03}
              onClick={() => applyCamera((p) => clampCamera(p.zoom + 0.22, p.panX * 1.15, p.panY * 1.15))}
            >
              +
            </button>
            <button
              type="button"
              className={`utopia-cam-reset-btn ${isOverviewZoom ? 'is-active' : ''}`}
              title={isOverviewZoom ? `切回街区漫游视野 (${Math.round(STREET_DEFAULT_ZOOM * 100)}%)` : '拉远至 100% 俯瞰整幅洞天全景'}
              onClick={() => {
                if (isOverviewZoom) {
                  applyCamera(() => getDefaultCamera());
                } else {
                  applyCamera(() => clampCamera(1, 0, 0));
                }
              }}
            >
              {isOverviewZoom ? '街区' : '全景'}
            </button>
            {!isDefaultCamera && !isOverviewZoom && (
              <button
                type="button"
                className="utopia-cam-reset-btn"
                onClick={() => applyCamera(() => getDefaultCamera())}
              >
                回中
              </button>
            )}
            {onToggleHudHidden && (
              <button
                type="button"
                className={`utopia-cam-reset-btn ${hudHidden ? 'is-active' : ''}`}
                aria-pressed={hudHidden}
                onClick={onToggleHudHidden}
              >
                {hudHidden ? '唤出界面' : '净享画卷'}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
