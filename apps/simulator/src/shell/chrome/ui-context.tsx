/**
 * Simulator shell chrome state: one React context + reducer holding the
 * shell-atmosphere (sky phase/time/intensity/motion), chrome overlays (Lens,
 * Tide, Apps page, Sky panel, Field menu, toast), and window geometry for the
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
import {
  dayTimeFromDate,
  phaseFromDayTime,
  PHASE_PRESET_TIME,
  type Phase,
} from './sky-math.ts';

export type { Phase } from './sky-math.ts';
export type PhaseSetting = Phase | 'auto';

const PHASE_ORDER: PhaseSetting[] = ['auto', 'day', 'dusk', 'night', 'dawn'];

export const PHASE_LABEL: Record<PhaseSetting, string> = {
  auto: '自动 · Auto',
  day: '昼 · Day',
  dusk: '暮 · Dusk',
  night: '夜 · Night',
  dawn: '晨 · Dawn',
};

/** Time-of-day driven phase for the Auto atmosphere mode. */
export function autoPhase(now = new Date()): Phase {
  return phaseFromDayTime(dayTimeFromDate(now));
}

export interface ChromeWindowGeometry {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly z: number;
  readonly minimized: boolean;
}

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
  readonly dayTime: number;
  readonly autoTime: boolean;
  readonly intensity: number;
  readonly motion: number;
  readonly lensOpen: boolean;
  readonly tide: boolean;
  readonly appsPageOpen: boolean;
  readonly skyPanelOpen: boolean;
  readonly fieldMenu: ChromeFieldMenu | null;
  readonly receiptGrantId: string | null;
  readonly toast: ChromeToast | null;
  readonly windows: Readonly<Record<string, ChromeWindowGeometry>>;
  readonly windowNotices: Readonly<Record<string, string>>;
  readonly zCounter: number;
  readonly panePos: Readonly<Record<string, ChromePaneSpot>>;
  readonly paneZs: Readonly<Record<string, number>>;
  readonly paneZCounter: number;
}

type ChromeAction =
  | { readonly type: 'set-day-time'; readonly t: number }
  | { readonly type: 'tick-day-time'; readonly t: number }
  | { readonly type: 'set-auto-time' }
  | { readonly type: 'cycle-phase' }
  | { readonly type: 'set-intensity'; readonly v: number }
  | { readonly type: 'set-motion'; readonly v: number }
  | { readonly type: 'set-lens-open'; readonly v: boolean }
  | { readonly type: 'toggle-tide' }
  | { readonly type: 'set-apps-page-open'; readonly v: boolean }
  | { readonly type: 'set-sky-panel-open'; readonly v: boolean }
  | { readonly type: 'set-field-menu'; readonly menu: ChromeFieldMenu | null }
  | { readonly type: 'set-receipt-grant'; readonly grantId: string | null }
  | { readonly type: 'show-toast'; readonly toast: ChromeToast }
  | { readonly type: 'dismiss-toast' }
  | { readonly type: 'sync-windows'; readonly instances: readonly { readonly instanceId: string; readonly moduleId: string }[] }
  | { readonly type: 'move-window'; readonly instanceId: string; readonly x: number; readonly y: number }
  | { readonly type: 'focus-window'; readonly instanceId: string }
  | { readonly type: 'minimize-window'; readonly instanceId: string }
  | { readonly type: 'restore-window'; readonly instanceId: string }
  | { readonly type: 'tidy-windows'; readonly instances: readonly { readonly instanceId: string; readonly moduleId: string }[] }
  | { readonly type: 'set-window-notice'; readonly moduleId: string; readonly text: string | null }
  | { readonly type: 'move-pane'; readonly paneId: string; readonly x: number; readonly y: number }
  | { readonly type: 'focus-pane'; readonly paneId: string }
  | { readonly type: 'tidy-panes' }
  | { readonly type: 'viewport-resize'; readonly vw: number; readonly vh: number };

/* — Spawn layout: a pure function of the viewport —
 * Every slot derives from (vw, vh); at the qualified 1440×1000 viewport each
 * formula evaluates to the exact pixel geometry required by the layout contract
 * (desktop 24/500×64 460×600, tester/zhiyu 224×288 at y 688, pane column
 * x 1002 w 414, pane slots agent/identity/modules/instances/grants/worlds).
 * Structure: a right pane column (paneW = round(vw × 0.2875), right margin
 * 24), a window zone from x 24 to paneX-34, two full-height desktop windows
 * on top (their 100vh-centered auth primary control must stay visible and
 * clickable), and four small windows tiling the bottom strip. Below the
 * ~721px/800px floor the ported media queries reflow the cradle into a
 * scrolling grid, so pinned controls stay reachable by scrolling. */

const PANE_IDS = ['identity', 'agent', 'modules', 'instances', 'grants', 'worlds'] as const;

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
  // Compact strip mode for the media-query zone (≤720px wide or ≤800px
  // tall): the cradle reflows into a scrolling grid there (see panes.css),
  // so windows park as small tiles along the reserved bottom strip instead
  // of covering pinned pane content. Slot order: desktop, tester, zhiyu
  // pairs left to right.
  if (vw <= 720 || vh <= 800) {
    const w = Math.max(110, Math.floor((vw - 48 - 5 * 12) / 6));
    const h = clampNumber(Math.round(vh * 0.18), 96, 160);
    const y = vh - 24 - h;
    const order = moduleId === 'desktop' ? 0 : moduleId === 'tester' ? 2 : moduleId === 'zhiyu' ? 4 : -1;
    if (order < 0) return [];
    return [0, 1].map((i) => ({
      x: 24 + (order + i) * (w + 12),
      y,
      w,
      h,
    }));
  }
  const paneW = clampNumber(Math.round(vw * 0.2875), 340, 460);
  const paneX = vw - 24 - paneW;
  const zoneX = 24;
  const zoneW = Math.max(280, paneX - 34 - zoneX);
  const smallH = clampNumber(Math.round(vh * 0.288), 170, 288);
  // The desktop auth logo centers at window.top + chrome + vh/2 (100vh
  // shell): the bottom strip must start low enough for it to stay visible.
  const bottomY = Math.max(Math.round(vh / 2 + 157), vh - 24 - smallH);
  const desktopH = Math.min(bottomY - 24 - 64, 960);
  const desktopW = Math.max(240, Math.floor((zoneW - 24) / 2));
  const smallW = Math.max(110, Math.floor((zoneW - 48) / 4));
  if (moduleId === 'desktop') {
    return [
      { x: zoneX, y: 64, w: desktopW, h: desktopH },
      { x: zoneX + desktopW + 16, y: 64, w: desktopW, h: desktopH },
    ];
  }
  const smallOffset = moduleId === 'tester' ? 0 : moduleId === 'zhiyu' ? 2 : -1;
  if (smallOffset < 0) return [];
  return [0, 1].map((i) => ({
    x: zoneX + (smallOffset + i) * (smallW + 16),
    y: bottomY,
    w: smallW,
    h: smallH,
  }));
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
  // modules is content-sized and scroll-clips below its full height; the
  // instances/grants/worlds remainder splits the leftover column by the
  // exact 190:130:74 ratio of the 1440×1000 slot.
  const modulesH = clampNumber(Math.round(vh * 0.374), 280, 374);
  const instancesY = 192 + modulesH + 8;
  const avail = vh - 16 - instancesY;
  const instancesH = Math.max(72, Math.round((avail * 19) / 41));
  const grantsH = Math.max(56, Math.round((avail * 13) / 41));
  const grantsY = instancesY + instancesH + 8;
  const worldsY = grantsY + grantsH + 8;
  const worldsH = Math.max(30, vh - 16 - worldsY);
  return {
    agent: { x, y: 52, w: paneW, h: 52 },
    identity: { x, y: 108, w: paneW, h: 76 },
    modules: { x, y: 192, w: paneW, h: modulesH },
    instances: { x, y: instancesY, w: paneW, h: instancesH },
    grants: { x, y: grantsY, w: paneW, h: grantsH },
    worlds: { x, y: worldsY, w: paneW, h: worldsH },
  };
}

function initialChromeState(): ChromeState {
  return {
    dayTime: dayTimeFromDate(),
    autoTime: true,
    intensity: 1,
    motion: 1,
    lensOpen: false,
    tide: false,
    appsPageOpen: false,
    skyPanelOpen: false,
    fieldMenu: null,
    receiptGrantId: null,
    toast: null,
    windows: {},
    windowNotices: {},
    zCounter: 10,
    panePos: defaultPaneSpots(viewport().w, viewport().h),
    paneZs: {},
    paneZCounter: PANE_IDS.length,
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
      minimized: false,
    };
  }
  return changed ? { ...state, windows, zCounter } : state;
}

function raiseWindow(state: ChromeState, instanceId: string): ChromeState {
  const geometry = state.windows[instanceId];
  if (!geometry) return state;
  const zCounter = state.zCounter + 1;
  if (geometry.z === state.zCounter && !geometry.minimized) return state;
  return {
    ...state,
    zCounter,
    windows: { ...state.windows, [instanceId]: { ...geometry, z: zCounter } },
  };
}

function chromeReducer(state: ChromeState, action: ChromeAction): ChromeState {
  switch (action.type) {
    case 'set-day-time':
      return { ...state, autoTime: false, dayTime: ((action.t % 1) + 1) % 1 };
    case 'tick-day-time':
      return state.autoTime && state.dayTime !== action.t ? { ...state, dayTime: action.t } : state;
    case 'set-auto-time':
      return { ...state, autoTime: true, dayTime: dayTimeFromDate() };
    case 'cycle-phase': {
      const effectivePhase = phaseFromDayTime(state.dayTime);
      const current: PhaseSetting = state.autoTime ? 'auto' : effectivePhase;
      const next = PHASE_ORDER[(PHASE_ORDER.indexOf(current) + 1) % PHASE_ORDER.length];
      if (next === 'auto') return { ...state, autoTime: true, dayTime: dayTimeFromDate() };
      return { ...state, autoTime: false, dayTime: PHASE_PRESET_TIME[next] };
    }
    case 'set-intensity':
      return { ...state, intensity: action.v };
    case 'set-motion':
      return { ...state, motion: action.v };
    case 'set-lens-open':
      return state.lensOpen === action.v ? state : { ...state, lensOpen: action.v };
    case 'toggle-tide':
      return { ...state, tide: !state.tide };
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
    case 'move-window': {
      const geometry = state.windows[action.instanceId];
      if (!geometry) return state;
      if (geometry.x === action.x && geometry.y === action.y) return state;
      return {
        ...state,
        windows: { ...state.windows, [action.instanceId]: { ...geometry, x: action.x, y: action.y } },
      };
    }
    case 'focus-window':
      return raiseWindow(state, action.instanceId);
    case 'minimize-window': {
      const geometry = state.windows[action.instanceId];
      if (!geometry || geometry.minimized) return state;
      return {
        ...state,
        windows: { ...state.windows, [action.instanceId]: { ...geometry, minimized: true } },
      };
    }
    case 'restore-window': {
      const geometry = state.windows[action.instanceId];
      if (!geometry || !geometry.minimized) return state;
      const zCounter = state.zCounter + 1;
      return {
        ...state,
        zCounter,
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
  readonly phase: PhaseSetting;
  readonly effectivePhase: Phase;
  readonly dayTime: number;
  readonly autoTime: boolean;
  readonly intensity: number;
  readonly motion: number;
  readonly lensOpen: boolean;
  readonly tide: boolean;
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
  readonly setDayTime: (t: number) => void;
  readonly setAutoTime: () => void;
  readonly cyclePhase: () => void;
  readonly setIntensity: (v: number) => void;
  readonly setMotion: (v: number) => void;
  readonly setLensOpen: (v: boolean) => void;
  readonly toggleTide: () => void;
  readonly setAppsPageOpen: (v: boolean) => void;
  readonly setSkyPanelOpen: (v: boolean) => void;
  readonly setFieldMenu: (menu: ChromeFieldMenu | null) => void;
  readonly setReceiptGrantId: (grantId: string | null) => void;
  readonly showToast: (toast: ChromeToast) => void;
  readonly dismissToast: () => void;
  readonly syncWindows: (instances: readonly { readonly instanceId: string; readonly moduleId: string }[]) => void;
  readonly moveWindow: (instanceId: string, x: number, y: number) => void;
  readonly focusWindow: (instanceId: string) => void;
  readonly minimizeWindow: (instanceId: string) => void;
  readonly restoreWindow: (instanceId: string) => void;
  readonly tidyWindows: (instances: readonly { readonly instanceId: string; readonly moduleId: string }[]) => void;
  readonly setWindowNotice: (moduleId: string, text: string | null) => void;
  readonly movePane: (paneId: string, x: number, y: number) => void;
  readonly focusPane: (paneId: string) => void;
  readonly tidyPanes: () => void;
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

  useEffect(() => {
    if (!state.autoTime) return undefined;
    const t = window.setInterval(() => {
      dispatch({ type: 'tick-day-time', t: dayTimeFromDate() });
    }, 15_000);
    return () => window.clearInterval(t);
  }, [state.autoTime]);

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
    const effectivePhase = phaseFromDayTime(state.dayTime);
    return {
      phase: state.autoTime ? 'auto' : effectivePhase,
      effectivePhase,
      dayTime: state.dayTime,
      autoTime: state.autoTime,
      intensity: state.intensity,
      motion: state.motion,
      lensOpen: state.lensOpen,
      tide: state.tide,
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
      setDayTime: (t) => dispatch({ type: 'set-day-time', t }),
      setAutoTime: () => dispatch({ type: 'set-auto-time' }),
      cyclePhase: () => dispatch({ type: 'cycle-phase' }),
      setIntensity: (v) => dispatch({ type: 'set-intensity', v }),
      setMotion: (v) => dispatch({ type: 'set-motion', v }),
      setLensOpen: (v) => dispatch({ type: 'set-lens-open', v }),
      toggleTide: () => dispatch({ type: 'toggle-tide' }),
      setAppsPageOpen: (v) => dispatch({ type: 'set-apps-page-open', v }),
      setSkyPanelOpen: (v) => dispatch({ type: 'set-sky-panel-open', v }),
      setFieldMenu: (menu) => dispatch({ type: 'set-field-menu', menu }),
      setReceiptGrantId: (grantId) => dispatch({ type: 'set-receipt-grant', grantId }),
      showToast: (toast) => dispatch({ type: 'show-toast', toast }),
      dismissToast: () => dispatch({ type: 'dismiss-toast' }),
      syncWindows: (instances) => dispatch({ type: 'sync-windows', instances }),
      moveWindow: (instanceId, x, y) => dispatch({ type: 'move-window', instanceId, x, y }),
      focusWindow: (instanceId) => dispatch({ type: 'focus-window', instanceId }),
      minimizeWindow: (instanceId) => dispatch({ type: 'minimize-window', instanceId }),
      restoreWindow: (instanceId) => dispatch({ type: 'restore-window', instanceId }),
      tidyWindows: (instances) => dispatch({ type: 'tidy-windows', instances }),
      setWindowNotice: (moduleId, text) => dispatch({ type: 'set-window-notice', moduleId, text }),
      movePane: (paneId, x, y) => dispatch({ type: 'move-pane', paneId, x, y }),
      focusPane: (paneId) => dispatch({ type: 'focus-pane', paneId }),
      tidyPanes: () => dispatch({ type: 'tidy-panes' }),
      subscribeFamily: subscribeFamily ?? NOOP_UNSUBSCRIBE,
      stageElement: stageElement ?? NO_STAGE,
    };
  }, [state, subscribeFamily, stageElement]);

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): UiState {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi must be used inside UiProvider');
  return ctx;
}
