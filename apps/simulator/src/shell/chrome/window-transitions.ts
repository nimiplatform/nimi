/**
 * macOS-style window transitions between a surface stage and its app-rail
 * icon: minimize/close collapse the window into the icon (accelerating
 * suction, vertical squash), restore/open zoom it back out of the icon with
 * a gentle overshoot, and the icon itself nudges like a dock bounce.
 *
 * Pure keyframe math (`windowToRailIconKeyframes` / `windowFromRailIconKeyframes`)
 * is exported for the contract suite and touches no DOM. The glue fails
 * closed to instant state changes when WAAPI / matchMedia is unavailable
 * (jsdom) or when the user prefers reduced motion — the controlled dev
 * browser sets reduced-motion, so qualified traces stay deterministic.
 */

export interface WindowTransitionRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface RailIconPoint {
  readonly x: number;
  readonly y: number;
}

export type WindowTransitionKind = 'minimize' | 'close' | 'restore' | 'open';

/** Center of a rail icon in viewport coordinates — the animation target for
 * windows flying into / out of the left app rail. */
export function railIconCenter(moduleId: string): RailIconPoint | null {
  const el = document.querySelector<HTMLElement>(`.app-rail-btn[data-mod='${moduleId}']`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

const MINIMIZE_DURATION_MS = 420;
const CLOSE_DURATION_MS = 260;
const RESTORE_DURATION_MS = 380;
const OPEN_DURATION_MS = 340;
const ICON_BOUNCE_DURATION_MS = 460;

/** Accelerating suction into the icon (macOS genie/scale collapse feel). */
const EASE_IN_SUCTION = 'cubic-bezier(0.5, 0, 0.75, 0)';
/** Fast start, gentle landing (macOS restore zoom). */
const EASE_OUT_ZOOM = 'cubic-bezier(0.22, 1, 0.36, 1)';

function px(value: number): string {
  return `${Number(value.toFixed(2))}px`;
}

function endScale(rect: WindowTransitionRect): { readonly sx: number; readonly sy: number } {
  return {
    sx: Number(Math.min(0.18, 36 / Math.max(1, rect.w)).toFixed(4)),
    sy: Number(Math.min(0.1, 12 / Math.max(1, rect.h)).toFixed(4)),
  };
}

/** Frames for minimize/close: the window accelerates toward the icon,
 * squashing vertically (suction) and fading out. */
export function windowToRailIconKeyframes(
  rect: WindowTransitionRect,
  icon: RailIconPoint,
): Keyframe[] {
  const dx = icon.x - (rect.x + rect.w / 2);
  const dy = icon.y - (rect.y + rect.h / 2);
  const { sx, sy } = endScale(rect);
  return [
    { transform: 'translate(0px, 0px) scale(1, 1)', opacity: '1', offset: 0 },
    {
      transform: `translate(${px(dx * 0.5)}, ${px(dy * 0.5)}) scale(0.55, 0.42)`,
      opacity: '0.85',
      offset: 0.55,
    },
    { transform: `translate(${px(dx)}, ${px(dy)}) scale(${sx}, ${sy})`, opacity: '0', offset: 1 },
  ];
}

/** Frames for restore/open: the window zooms out of the icon with a small
 * overshoot before settling. */
export function windowFromRailIconKeyframes(
  rect: WindowTransitionRect,
  icon: RailIconPoint,
): Keyframe[] {
  const dx = icon.x - (rect.x + rect.w / 2);
  const dy = icon.y - (rect.y + rect.h / 2);
  const { sx, sy } = endScale(rect);
  return [
    { transform: `translate(${px(dx)}, ${px(dy)}) scale(${sx}, ${sy})`, opacity: '0', offset: 0 },
    {
      transform: `translate(${px(dx * 0.12)}, ${px(dy * 0.12)}) scale(1.02, 1.015)`,
      opacity: '1',
      offset: 0.7,
    },
    { transform: 'translate(0px, 0px) scale(1, 1)', opacity: '1', offset: 1 },
  ];
}

const sessions = new Map<string, number>();

function bumpSession(instanceId: string, stage: HTMLElement): number {
  const token = (sessions.get(instanceId) ?? 0) + 1;
  sessions.set(instanceId, token);
  if (typeof stage.getAnimations === 'function') {
    for (const animation of stage.getAnimations()) animation.cancel();
  }
  return token;
}

function isLiveSession(instanceId: string, token: number): boolean {
  return sessions.get(instanceId) === token;
}

function envAllowsMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function canAnimate(stage: HTMLElement | null): stage is HTMLElement {
  return Boolean(stage && typeof stage.animate === 'function') && envAllowsMotion();
}

function stageRect(stage: HTMLElement): WindowTransitionRect {
  const r = stage.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function afterFrames(count: number, callback: () => void): void {
  if (count <= 0) {
    callback();
    return;
  }
  window.requestAnimationFrame(() => afterFrames(count - 1, callback));
}

/** Collapse the window into its rail icon, then run `onDone` (dispatch the
 * minimize/close). Instant when animation is unavailable. */
export function transitionWindowToRailIcon(
  stage: HTMLElement | null,
  instanceId: string,
  moduleId: string,
  kind: 'minimize' | 'close',
  onDone: () => void,
): void {
  if (!canAnimate(stage)) {
    onDone();
    return;
  }
  const icon = railIconCenter(moduleId);
  if (!icon) {
    onDone();
    return;
  }
  const token = bumpSession(instanceId, stage);
  const animation = stage.animate(windowToRailIconKeyframes(stageRect(stage), icon), {
    duration: kind === 'close' ? CLOSE_DURATION_MS : MINIMIZE_DURATION_MS,
    easing: EASE_IN_SUCTION,
    fill: 'forwards',
  });
  animation.finished
    .then(() => {
      if (isLiveSession(instanceId, token)) onDone();
    })
    .catch(() => {
      // Cancelled by a newer transition (e.g. restore mid-collapse).
    });
}

/** Restore a minimized window: hides the flash with inline opacity while the
 * state commit un-hides the stage, then zooms out of the rail icon. */
export function transitionRestoreWindow(
  stage: HTMLElement | null,
  instanceId: string,
  moduleId: string,
  dispatchRestore: () => void,
): void {
  if (!canAnimate(stage)) {
    dispatchRestore();
    return;
  }
  const icon = railIconCenter(moduleId);
  if (!icon) {
    dispatchRestore();
    return;
  }
  const token = bumpSession(instanceId, stage);
  stage.style.opacity = '0';
  dispatchRestore();
  afterFrames(2, () => {
    stage.style.opacity = '';
    if (!isLiveSession(instanceId, token)) return;
    stage.animate(windowFromRailIconKeyframes(stageRect(stage), icon), {
      duration: RESTORE_DURATION_MS,
      easing: EASE_OUT_ZOOM,
      fill: 'backwards',
    });
  });
}

/** Zoom a newly opened window out of its rail icon (suppresses the generic
 * pane-in entrance animation while it plays). */
export function transitionOpenWindow(
  stage: HTMLElement | null,
  instanceId: string,
  moduleId: string,
): void {
  if (!canAnimate(stage)) return;
  const icon = railIconCenter(moduleId);
  if (!icon) return;
  bumpSession(instanceId, stage);
  stage.style.animation = 'none';
  const animation = stage.animate(windowFromRailIconKeyframes(stageRect(stage), icon), {
    duration: OPEN_DURATION_MS,
    easing: EASE_OUT_ZOOM,
    fill: 'backwards',
  });
  const restoreCssAnimation = () => {
    stage.style.animation = '';
  };
  animation.finished.then(restoreCssAnimation).catch(restoreCssAnimation);
}

/** Small dock-style nudge on the rail icon (launch/restore feedback). */
export function bounceRailIcon(moduleId: string): void {
  if (!envAllowsMotion()) return;
  const el = document.querySelector<HTMLElement>(`.app-rail-btn[data-mod='${moduleId}']`);
  if (!el || typeof el.animate !== 'function') return;
  el.animate(
    [
      { transform: 'translateY(0px)' },
      { transform: 'translateY(-9px)', offset: 0.38 },
      { transform: 'translateY(0px)' },
    ],
    { duration: ICON_BOUNCE_DURATION_MS, easing: 'cubic-bezier(0.28, 0.84, 0.42, 1)' },
  );
}
