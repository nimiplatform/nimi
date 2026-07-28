/**
 * Simulator shell chrome state: one React context + reducer holding the
 * shell-atmosphere (sky phase/time/intensity/motion), chrome overlays (Lens,
 * Apps page, Sky panel, Field menu, toast), and window geometry for the
 * imperative `.simulator-surface` sections (per-instance x/y/w/h/z/minimized).
 *
 * This is presentation state only. Product/session truth stays in the State
 * Engine; chrome reads instances through the shell view props.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import { usePrefersReducedMotion } from '@nimiplatform/kit/ui/motion';
import {
  sceneTimeFromDate,
  scenePhaseFromTime,
  SCENE_PHASE_PRESET_TIME,
  type ScenePhase,
} from './sky-math.ts';

export type { ScenePhase } from './sky-math.ts';
export type ScenePhaseSetting = ScenePhase | 'auto';

const SCENE_PHASE_ORDER: ScenePhaseSetting[] = ['auto', 'day', 'dusk', 'night', 'dawn'];
const SCENE_TIME_PANEL_TICK_MS = 1_000;
const SCENE_TIME_BACKGROUND_TICK_MS = 15_000;

export const SCENE_PHASE_LABEL: Record<ScenePhaseSetting, string> = {
  auto: '演进 · Auto',
  day: '月昼 · Lunar day',
  dusk: '月暮 · Lunar dusk',
  night: '月夜 · Lunar night',
  dawn: '月晨 · Lunar dawn',
};

/** Authored lunar-cycle phase for the automatically evolving scene. */
export function autoScenePhase(now = new Date()): ScenePhase {
  return scenePhaseFromTime(sceneTimeFromDate(now));
}

export interface ChromeWindowGeometry {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly z: number;
  readonly minimized: boolean;
}

export type ChromeWindowBounds = Pick<ChromeWindowGeometry, 'x' | 'y' | 'w' | 'h'>;

export interface ChromePaneSpot {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface ChromeToast {
  readonly title: string;
  readonly detail: string;
}

export interface ChromeFieldMenu {
  readonly x: number;
  readonly y: number;
}

interface ChromeState {
  readonly sceneTime: number;
  readonly autoSceneTime: boolean;
  readonly intensity: number;
  readonly motion: number;
  readonly lensOpen: boolean;
  readonly appsPageOpen: boolean;
  readonly skyPanelOpen: boolean;
  readonly fieldMenu: ChromeFieldMenu | null;
  readonly receiptGrantId: string | null;
  readonly toast: ChromeToast | null;
  readonly windows: Readonly<Record<string, ChromeWindowGeometry>>;
  readonly windowNotices: Readonly<Record<string, string>>;
  readonly zCounter: number;
  readonly surfaceLayerZ: number;
  readonly homeDepthLayerZ: number;
  readonly panePos: Readonly<Record<string, ChromePaneSpot>>;
  readonly paneZs: Readonly<Record<string, number>>;
  readonly paneZCounter: number;
  readonly homeDepthWindow: string;
}

type ChromeAction =
  | { readonly type: 'set-scene-time'; readonly t: number }
  | { readonly type: 'tick-scene-time'; readonly t: number }
  | { readonly type: 'set-auto-scene-time' }
  | { readonly type: 'cycle-scene-phase' }
  | { readonly type: 'set-intensity'; readonly v: number }
  | { readonly type: 'set-motion'; readonly v: number }
  | { readonly type: 'set-lens-open'; readonly v: boolean }
  | { readonly type: 'set-apps-page-open'; readonly v: boolean }
  | { readonly type: 'set-sky-panel-open'; readonly v: boolean }
  | { readonly type: 'set-field-menu'; readonly menu: ChromeFieldMenu | null }
  | { readonly type: 'set-receipt-grant'; readonly grantId: string | null }
  | { readonly type: 'show-toast'; readonly toast: ChromeToast }
  | { readonly type: 'dismiss-toast' }
  | { readonly type: 'sync-windows'; readonly instances: readonly { readonly instanceId: string; readonly moduleId: string }[] }
  | { readonly type: 'present-window'; readonly instanceId: string; readonly moduleId: string }
  | { readonly type: 'move-window'; readonly instanceId: string; readonly x: number; readonly y: number }
  | { readonly type: 'resize-window'; readonly instanceId: string; readonly bounds: ChromeWindowBounds }
  | { readonly type: 'focus-window'; readonly instanceId: string }
  | { readonly type: 'minimize-window'; readonly instanceId: string }
  | { readonly type: 'restore-window'; readonly instanceId: string }
  | { readonly type: 'tidy-windows'; readonly instances: readonly { readonly instanceId: string; readonly moduleId: string }[] }
  | { readonly type: 'set-window-notice'; readonly moduleId: string; readonly text: string | null }
  | { readonly type: 'move-pane'; readonly paneId: string; readonly x: number; readonly y: number }
  | { readonly type: 'focus-pane'; readonly paneId: string }
  | { readonly type: 'tidy-panes' }
  | { readonly type: 'set-home-depth-window'; readonly windowId: string }
  | { readonly type: 'viewport-resize'; readonly vw: number; readonly vh: number };

/* — Spawn layout: a pure function of the viewport —
 * The three admitted App surfaces share one large stage rectangle. Their
 * foreground order is projected as depth by WindowManager; per-window x/y
 * remains available when a surface is focused and dragged. */

const PANE_IDS = ['identity', 'agent', 'modules', 'instances', 'grants', 'worlds'] as const;
const SURFACE_LAYER_BASE_Z = 40;
const HOME_DEPTH_LAYER_BASE_Z = 45;
const SURFACE_LAYER_FOREGROUND_Z = 46;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function viewport(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 1600, h: 1000 };
  return { w: window.innerWidth, h: window.innerHeight };
}

function clampWindow(x: number, y: number): { x: number; y: number } {
  const { w, h } = viewport();
  return {
    x: clampNumber(x, 8, Math.max(8, w - 120)),
    y: clampNumber(y, 48, Math.max(48, h - 96)),
  };
}

interface SpawnSlot {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function spawnSlots(moduleId: string, vw: number, vh: number): readonly SpawnSlot[] {
  if (!['desktop', 'tester', 'zhiyu'].includes(moduleId)) return [];
  const compact = vw <= 720 || vh <= 760;
  const w = compact
    ? Math.max(280, vw - 96)
    : clampNumber(Math.round(vw * 0.64), 680, 1080);
  const h = compact
    ? Math.max(320, vh - 176)
    : clampNumber(Math.round(vh * 0.7), 520, 760);
  const x = compact
    ? 68
    : clampNumber(Math.round((vw - w) * 0.22), 88, 180);
  const y = compact
    ? 64
    : clampNumber(Math.round((vh - h) * 0.42), 72, 148);
  return [{ x, y, w, h }];
}

function spawnGeometry(
  moduleId: string,
  ordinal: number,
  sequence: number,
): { x: number; y: number; w: number; h: number } {
  const { w: vw, h: vh } = viewport();
  const slots = spawnSlots(moduleId, vw, vh);
  if (slots.length > 0) {
    const slot = slots[ordinal % slots.length];
    const cascade = Math.floor(ordinal / slots.length) * 36;
    const pos = clampWindow(slot.x + cascade, slot.y + cascade);
    return { ...slot, ...pos };
  }
  // Unknown modules: generic cascade.
  const w = Math.min(620, vw - 48);
  const h = Math.min(500, vh - 160);
  const step = sequence % 5;
  const pos = clampWindow(88 + step * 44, 72 + step * 40);
  return { ...pos, w, h };
}

function defaultPaneSpots(vw: number, vh: number): Record<string, ChromePaneSpot> {
  const paneW = clampNumber(Math.round(vw * 0.2875), 340, 460);
  const x = vw - 24 - paneW;
  const identityW = clampNumber(Math.round(vw * 0.36), 420, 620);
  const instancesW = clampNumber(Math.round(vw * 0.23), 300, 390);
  const instancesH = clampNumber(Math.round(vh * 0.18), 150, 210);
  // modules is content-sized and scroll-clips below its full height; the
  // worlds photo card takes a fixed share of the leftover column and the
  // instances/grants remainder splits the rest by the 19:13 ratio.
  const modulesH = clampNumber(Math.round(vh * 0.3), 240, 300);
  const instancesY = 192 + modulesH + 8;
  const avail = vh - 16 - instancesY;
  const worldsTarget = clampNumber(Math.round(avail * 0.45), 130, 260);
  const split = avail - worldsTarget - 8;
  const legacyInstancesH = Math.max(72, Math.round((split * 19) / 32));
  const grantsH = Math.max(56, split - legacyInstancesH);
  const grantsY = instancesY + legacyInstancesH + 8;
  const worldsY = grantsY + grantsH + 8;
  const worldsH = Math.max(30, vh - 16 - worldsY);
  return {
    agent: { x, y: 52, w: paneW, h: 52 },
    identity: { x: 28, y: 70, w: identityW, h: 76 },
    modules: { x, y: 192, w: paneW, h: modulesH },
    instances: { x: 28, y: 174, w: instancesW, h: instancesH },
    grants: { x, y: grantsY, w: paneW, h: grantsH },
    worlds: { x, y: worldsY, w: paneW, h: worldsH },
  };
}

function initialChromeState(): ChromeState {
  return {
    sceneTime: sceneTimeFromDate(),
    autoSceneTime: true,
    intensity: 1,
    motion: 1,
    lensOpen: false,
    appsPageOpen: false,
    skyPanelOpen: false,
    fieldMenu: null,
    receiptGrantId: null,
    toast: null,
    windows: {},
    windowNotices: {},
    zCounter: 10,
    surfaceLayerZ: SURFACE_LAYER_BASE_Z,
    homeDepthLayerZ: HOME_DEPTH_LAYER_BASE_Z,
    panePos: defaultPaneSpots(viewport().w, viewport().h),
    paneZs: {},
    paneZCounter: PANE_IDS.length,
    homeDepthWindow: 'modules',
  };
}

function syncWindows(
  state: ChromeState,
  instances: readonly { readonly instanceId: string; readonly moduleId: string }[],
): ChromeState {
  const live = new Set(instances.map((entry) => entry.instanceId));
  let changed = false;
  const windows: Record<string, ChromeWindowGeometry> = {};
  for (const [id, geometry] of Object.entries(state.windows)) {
    if (live.has(id)) windows[id] = geometry;
    else changed = true;
  }
  let zCounter = state.zCounter;
  const ordinalByModule = new Map<string, number>();
  for (const entry of instances) {
    const existing = windows[entry.instanceId];
    const ordinal = ordinalByModule.get(entry.moduleId) ?? 0;
    ordinalByModule.set(entry.moduleId, ordinal + 1);
    if (existing) continue;
    changed = true;
    zCounter += 1;
    windows[entry.instanceId] = {
      ...spawnGeometry(entry.moduleId, ordinal, Object.keys(windows).length),
      z: zCounter,
      minimized: true,
    };
  }
  if (!changed) return state;
  const hasVisibleWindow = Object.values(windows).some((geometry) => !geometry.minimized);
  return {
    ...state,
    windows,
    zCounter,
    ...(hasVisibleWindow
      ? {}
      : {
          surfaceLayerZ: SURFACE_LAYER_BASE_Z,
          homeDepthLayerZ: HOME_DEPTH_LAYER_BASE_Z,
        }),
  };
}

function raiseWindow(state: ChromeState, instanceId: string): ChromeState {
  const geometry = state.windows[instanceId];
  if (!geometry) return state;
  if (
    geometry.z === state.zCounter
    && state.surfaceLayerZ > state.homeDepthLayerZ
    && !geometry.minimized
  ) return state;
  const zCounter = state.zCounter + 1;
  return {
    ...state,
    zCounter,
    surfaceLayerZ: SURFACE_LAYER_FOREGROUND_Z,
    windows: { ...state.windows, [instanceId]: { ...geometry, z: zCounter } },
  };
}

function presentWindow(state: ChromeState, instanceId: string, moduleId: string): ChromeState {
  const existing = state.windows[instanceId];
  if (existing) {
    return raiseWindow(
      existing.minimized
        ? {
            ...state,
            windows: {
              ...state.windows,
              [instanceId]: { ...existing, minimized: false },
            },
          }
        : state,
      instanceId,
    );
  }
  const zCounter = state.zCounter + 1;
  const next = {
    ...state,
    zCounter,
    windows: {
      ...state.windows,
      [instanceId]: {
        ...spawnGeometry(moduleId, 0, Object.keys(state.windows).length),
        z: zCounter,
        minimized: false,
      },
    },
  };
  return raiseWindow(next, instanceId);
}

function raiseHomeDepthWindow(state: ChromeState, windowId: string): ChromeState {
  if (
    state.homeDepthWindow === windowId
    && state.homeDepthLayerZ > state.surfaceLayerZ
  ) return state;
  return {
    ...state,
    surfaceLayerZ: SURFACE_LAYER_BASE_Z,
    homeDepthLayerZ: HOME_DEPTH_LAYER_BASE_Z,
    homeDepthWindow: windowId,
  };
}

function chromeReducer(state: ChromeState, action: ChromeAction): ChromeState {
  switch (action.type) {
    case 'set-scene-time':
      return { ...state, autoSceneTime: false, sceneTime: ((action.t % 1) + 1) % 1 };
    case 'tick-scene-time':
      return state.autoSceneTime && state.sceneTime !== action.t
        ? { ...state, sceneTime: action.t }
        : state;
    case 'set-auto-scene-time':
      return { ...state, autoSceneTime: true, sceneTime: sceneTimeFromDate() };
    case 'cycle-scene-phase': {
      const effectivePhase = scenePhaseFromTime(state.sceneTime);
      const current: ScenePhaseSetting = state.autoSceneTime ? 'auto' : effectivePhase;
      const next = SCENE_PHASE_ORDER[
        (SCENE_PHASE_ORDER.indexOf(current) + 1) % SCENE_PHASE_ORDER.length
      ];
      if (next === 'auto') {
        return { ...state, autoSceneTime: true, sceneTime: sceneTimeFromDate() };
      }
      return { ...state, autoSceneTime: false, sceneTime: SCENE_PHASE_PRESET_TIME[next] };
    }
    case 'set-intensity':
      return { ...state, intensity: action.v };
    case 'set-motion':
      return { ...state, motion: action.v };
    case 'set-lens-open':
      return state.lensOpen === action.v ? state : { ...state, lensOpen: action.v };
    case 'set-apps-page-open':
      return state.appsPageOpen === action.v ? state : { ...state, appsPageOpen: action.v };
    case 'set-sky-panel-open':
      return state.skyPanelOpen === action.v ? state : { ...state, skyPanelOpen: action.v };
    case 'set-field-menu':
      return { ...state, fieldMenu: action.menu };
    case 'set-receipt-grant':
      return state.receiptGrantId === action.grantId ? state : { ...state, receiptGrantId: action.grantId };
    case 'show-toast':
      return { ...state, toast: action.toast };
    case 'dismiss-toast':
      return state.toast === null ? state : { ...state, toast: null };
    case 'sync-windows':
      return syncWindows(state, action.instances);
    case 'present-window':
      return presentWindow(state, action.instanceId, action.moduleId);
    case 'move-window': {
      const geometry = state.windows[action.instanceId];
      if (!geometry) return state;
      if (geometry.x === action.x && geometry.y === action.y) return state;
      return {
        ...state,
        windows: { ...state.windows, [action.instanceId]: { ...geometry, x: action.x, y: action.y } },
      };
    }
    case 'resize-window': {
      const geometry = state.windows[action.instanceId];
      if (!geometry) return state;
      const { x, y, w, h } = action.bounds;
      if (geometry.x === x && geometry.y === y && geometry.w === w && geometry.h === h) return state;
      return {
        ...state,
        windows: { ...state.windows, [action.instanceId]: { ...geometry, x, y, w, h } },
      };
    }
    case 'focus-window':
      return raiseWindow(state, action.instanceId);
    case 'minimize-window': {
      const geometry = state.windows[action.instanceId];
      if (!geometry || geometry.minimized) return state;
      const windows = {
        ...state.windows,
        [action.instanceId]: { ...geometry, minimized: true },
      };
      const hasVisibleWindow = Object.values(windows).some((entry) => !entry.minimized);
      return {
        ...state,
        windows,
        ...(hasVisibleWindow
          ? {}
          : {
              surfaceLayerZ: SURFACE_LAYER_BASE_Z,
              homeDepthLayerZ: HOME_DEPTH_LAYER_BASE_Z,
            }),
      };
    }
    case 'restore-window': {
      const geometry = state.windows[action.instanceId];
      if (!geometry || !geometry.minimized) return state;
      const zCounter = state.zCounter + 1;
      return {
        ...state,
        zCounter,
        surfaceLayerZ: SURFACE_LAYER_FOREGROUND_Z,
        windows: { ...state.windows, [action.instanceId]: { ...geometry, minimized: false, z: zCounter } },
      };
    }
    case 'tidy-windows': {
      let next: ChromeState = { ...state, windows: {} };
      next = syncWindows(next, action.instances);
      return next;
    }
    case 'set-window-notice': {
      const current = state.windowNotices[action.moduleId] ?? null;
      if (current === action.text) return state;
      const windowNotices = { ...state.windowNotices };
      if (action.text === null) delete windowNotices[action.moduleId];
      else windowNotices[action.moduleId] = action.text;
      return { ...state, windowNotices };
    }
    case 'move-pane': {
      const spot = state.panePos[action.paneId];
      if (!spot) return state;
      return {
        ...state,
        panePos: { ...state.panePos, [action.paneId]: { ...spot, x: action.x, y: action.y } },
      };
    }
    case 'focus-pane': {
      const paneZCounter = state.paneZCounter + 1;
      return {
        ...state,
        paneZCounter,
        paneZs: { ...state.paneZs, [action.paneId]: paneZCounter },
      };
    }
    case 'tidy-panes':
      return { ...state, panePos: defaultPaneSpots(viewport().w, viewport().h), paneZs: {} };
    case 'set-home-depth-window':
      return raiseHomeDepthWindow(state, action.windowId);
    case 'viewport-resize': {
      // Re-clamp open windows into the new bounds (positions preserved, sizes
      // capped to the viewport) and re-flow the cradle pane constellation.
      let windowsChanged = false;
      const windows: Record<string, ChromeWindowGeometry> = {};
      for (const [id, geometry] of Object.entries(state.windows)) {
        const w = Math.min(geometry.w, Math.max(240, action.vw - 48));
        const h = Math.min(geometry.h, Math.max(200, action.vh - 112));
        const x = clampNumber(geometry.x, 8, Math.max(8, action.vw - 120));
        const y = clampNumber(geometry.y, 48, Math.max(48, action.vh - 96));
        if (x !== geometry.x || y !== geometry.y || w !== geometry.w || h !== geometry.h) {
          windowsChanged = true;
        }
        windows[id] = { ...geometry, x, y, w, h };
      }
      const panePos = defaultPaneSpots(action.vw, action.vh);
      const panesChanged = Object.entries(panePos).some(([id, spot]) => {
        const current = state.panePos[id];
        return !current
          || current.x !== spot.x || current.y !== spot.y
          || current.w !== spot.w || current.h !== spot.h;
      });
      if (!windowsChanged && !panesChanged) return state;
      return {
        ...state,
        windows: windowsChanged ? windows : state.windows,
        panePos: panesChanged ? panePos : state.panePos,
      };
    }
    default:
      return state;
  }
}

export interface UiState {
  readonly phase: ScenePhaseSetting;
  readonly effectivePhase: ScenePhase;
  readonly sceneTime: number;
  readonly autoSceneTime: boolean;
  readonly intensity: number;
  readonly motion: number;
  readonly prefersReducedMotion: boolean;
  readonly lensOpen: boolean;
  readonly appsPageOpen: boolean;
  readonly skyPanelOpen: boolean;
  readonly fieldMenu: ChromeFieldMenu | null;
  readonly receiptGrantId: string | null;
  readonly toast: ChromeToast | null;
  readonly windows: Readonly<Record<string, ChromeWindowGeometry>>;
  readonly windowNotices: Readonly<Record<string, string>>;
  readonly panePos: Readonly<Record<string, ChromePaneSpot>>;
  readonly paneZs: Readonly<Record<string, number>>;
  readonly paneZCounter: number;
  readonly zCounter: number;
  readonly surfaceLayerZ: number;
  readonly homeDepthLayerZ: number;
  readonly homeDepthWindow: string;
  readonly setSceneTime: (t: number) => void;
  readonly setAutoSceneTime: () => void;
  readonly cycleScenePhase: () => void;
  readonly setIntensity: (v: number) => void;
  readonly setMotion: (v: number) => void;
  readonly setLensOpen: (v: boolean) => void;
  readonly setAppsPageOpen: (v: boolean) => void;
  readonly setSkyPanelOpen: (v: boolean) => void;
  readonly setFieldMenu: (menu: ChromeFieldMenu | null) => void;
  readonly setReceiptGrantId: (grantId: string | null) => void;
  readonly showToast: (toast: ChromeToast) => void;
  readonly dismissToast: () => void;
  readonly syncWindows: (instances: readonly { readonly instanceId: string; readonly moduleId: string }[]) => void;
  readonly presentWindow: (instanceId: string, moduleId: string) => void;
  readonly moveWindow: (instanceId: string, x: number, y: number) => void;
  readonly resizeWindow: (instanceId: string, bounds: ChromeWindowBounds) => void;
  readonly focusWindow: (instanceId: string) => void;
  readonly minimizeWindow: (instanceId: string) => void;
  readonly restoreWindow: (instanceId: string) => void;
  readonly tidyWindows: (instances: readonly { readonly instanceId: string; readonly moduleId: string }[]) => void;
  readonly setWindowNotice: (moduleId: string, text: string | null) => void;
  readonly movePane: (paneId: string, x: number, y: number) => void;
  readonly focusPane: (paneId: string) => void;
  readonly tidyPanes: () => void;
  readonly setHomeDepthWindow: (windowId: string) => void;
  readonly subscribeFamily: (familyId: string, handler: (event: unknown) => void) => (() => void) | null;
  readonly stageElement: (instanceId: string) => HTMLElement | null;
}

const UiContext = createContext<UiState | null>(null);

const NOOP_UNSUBSCRIBE = (): (() => void) | null => null;
const NO_STAGE = (): HTMLElement | null => null;

export interface UiProviderProps {
  readonly children: ReactNode;
  readonly subscribeFamily?: (familyId: string, handler: (event: unknown) => void) => (() => void) | null;
  readonly stageElement?: (instanceId: string) => HTMLElement | null;
}

export function UiProvider({ children, subscribeFamily, stageElement }: UiProviderProps) {
  const [state, dispatch] = useReducer(chromeReducer, null, () => initialChromeState());
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!state.autoSceneTime || prefersReducedMotion) return undefined;
    const t = window.setInterval(() => {
      dispatch({ type: 'tick-scene-time', t: sceneTimeFromDate() });
    }, state.skyPanelOpen
      ? SCENE_TIME_PANEL_TICK_MS
      : SCENE_TIME_BACKGROUND_TICK_MS);
    return () => window.clearInterval(t);
  }, [prefersReducedMotion, state.autoSceneTime, state.skyPanelOpen]);

  // Re-clamp/re-flow chrome geometry on viewport changes through the
  // admitted `viewport` listener family (rAF-coalesced, deterministic — the
  // reducer only ever sees (innerWidth, innerHeight) at frame time).
  useEffect(() => {
    if (!subscribeFamily) return undefined;
    let raf = 0;
    const unsubscribe = subscribeFamily('viewport', () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const { w, h } = viewport();
        dispatch({ type: 'viewport-resize', vw: w, vh: h });
      });
    });
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      unsubscribe?.();
    };
  }, [subscribeFamily]);

  const value = useMemo<UiState>(() => {
    const effectivePhase = scenePhaseFromTime(state.sceneTime);
    return {
      phase: state.autoSceneTime ? 'auto' : effectivePhase,
      effectivePhase,
      sceneTime: state.sceneTime,
      autoSceneTime: state.autoSceneTime,
      intensity: state.intensity,
      motion: state.motion,
      prefersReducedMotion,
      lensOpen: state.lensOpen,
      appsPageOpen: state.appsPageOpen,
      skyPanelOpen: state.skyPanelOpen,
      fieldMenu: state.fieldMenu,
      receiptGrantId: state.receiptGrantId,
      toast: state.toast,
      windows: state.windows,
      windowNotices: state.windowNotices,
      panePos: state.panePos,
      paneZs: state.paneZs,
      paneZCounter: state.paneZCounter,
      zCounter: state.zCounter,
      surfaceLayerZ: state.surfaceLayerZ,
      homeDepthLayerZ: state.homeDepthLayerZ,
      homeDepthWindow: state.homeDepthWindow,
      setSceneTime: (t) => dispatch({ type: 'set-scene-time', t }),
      setAutoSceneTime: () => dispatch({ type: 'set-auto-scene-time' }),
      cycleScenePhase: () => dispatch({ type: 'cycle-scene-phase' }),
      setIntensity: (v) => dispatch({ type: 'set-intensity', v }),
      setMotion: (v) => dispatch({ type: 'set-motion', v }),
      setLensOpen: (v) => dispatch({ type: 'set-lens-open', v }),
      setAppsPageOpen: (v) => dispatch({ type: 'set-apps-page-open', v }),
      setSkyPanelOpen: (v) => dispatch({ type: 'set-sky-panel-open', v }),
      setFieldMenu: (menu) => dispatch({ type: 'set-field-menu', menu }),
      setReceiptGrantId: (grantId) => dispatch({ type: 'set-receipt-grant', grantId }),
      showToast: (toast) => dispatch({ type: 'show-toast', toast }),
      dismissToast: () => dispatch({ type: 'dismiss-toast' }),
      syncWindows: (instances) => dispatch({ type: 'sync-windows', instances }),
      presentWindow: (instanceId, moduleId) => dispatch({ type: 'present-window', instanceId, moduleId }),
      moveWindow: (instanceId, x, y) => dispatch({ type: 'move-window', instanceId, x, y }),
      resizeWindow: (instanceId, bounds) => dispatch({ type: 'resize-window', instanceId, bounds }),
      focusWindow: (instanceId) => dispatch({ type: 'focus-window', instanceId }),
      minimizeWindow: (instanceId) => dispatch({ type: 'minimize-window', instanceId }),
      restoreWindow: (instanceId) => dispatch({ type: 'restore-window', instanceId }),
      tidyWindows: (instances) => dispatch({ type: 'tidy-windows', instances }),
      setWindowNotice: (moduleId, text) => dispatch({ type: 'set-window-notice', moduleId, text }),
      movePane: (paneId, x, y) => dispatch({ type: 'move-pane', paneId, x, y }),
      focusPane: (paneId) => dispatch({ type: 'focus-pane', paneId }),
      tidyPanes: () => dispatch({ type: 'tidy-panes' }),
      setHomeDepthWindow: (windowId) => dispatch({ type: 'set-home-depth-window', windowId }),
      subscribeFamily: subscribeFamily ?? NOOP_UNSUBSCRIBE,
      stageElement: stageElement ?? NO_STAGE,
    };
  }, [prefersReducedMotion, state, subscribeFamily, stageElement]);

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): UiState {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi must be used inside UiProvider');
  return ctx;
}
