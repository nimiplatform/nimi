import { useEffect, useRef } from 'react';
import { useUi, SCENE_PHASE_LABEL } from './ui-context.tsx';
import {
  AUTHORED_SCENE_CYCLE_MS,
  formatSceneTime,
  sceneTimeFromDate,
  SCENE_PHASE_PRESET_TIME,
  type ScenePhase,
} from './sky-math.ts';

const PHASE_SHORTCUTS: readonly {
  readonly phase: ScenePhase;
  readonly label: string;
}[] = [
  { phase: 'dawn', label: '月晨' },
  { phase: 'day', label: '月昼' },
  { phase: 'dusk', label: '月暮' },
  { phase: 'night', label: '月夜' },
];

/** Floating light & time controls for the living-sky background. */
export function SkyPanel() {
  const closeRef = useRef<HTMLButtonElement>(null);
  const {
    skyPanelOpen: open,
    setSkyPanelOpen,
    sceneTime,
    autoSceneTime,
    setSceneTime,
    setAutoSceneTime,
    effectivePhase,
    intensity,
    setIntensity,
    motion,
    setMotion,
    prefersReducedMotion,
  } = useUi();

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  const normalizedSceneTime = ((sceneTime % 1) + 1) % 1;
  const progress = Math.min(999, Math.floor(normalizedSceneTime * 1000));
  const authoredCycleMinutes = AUTHORED_SCENE_CYCLE_MS / 60_000;
  const playing = autoSceneTime && motion > 0 && !prefersReducedMotion;
  const playbackStatus = prefersReducedMotion
    ? '系统减少动态 · 已暂停'
    : playing
      ? `演进中 · ${authoredCycleMinutes} 分钟 / 周期`
      : `已暂停 · ${authoredCycleMinutes} 分钟 / 周期`;

  return (
    <div
      id="sky-control-panel"
      className="sky-panel pane"
      data-nimi-material="glass-chrome"
      data-nimi-tone="overlay"
      role="dialog"
      aria-label="光影与时间"
    >
      <div className="sky-panel-head">
        <span className="t-overline">光影 · Light & Time</span>
        <button
          ref={closeRef}
          type="button"
          className="sky-panel-close"
          onClick={() => setSkyPanelOpen(false)}
          aria-label="关闭"
        >
          ×
        </button>
      </div>

      <div className="sky-panel-row">
        <span className="t-caption">月昼进度</span>
        <span className="t-mono">
          {formatSceneTime(sceneTime)} · {SCENE_PHASE_LABEL[effectivePhase]}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={999}
        value={progress}
        onChange={(e) => setSceneTime(Number(e.target.value) / 1000)}
        aria-label="月昼进度"
      />
      <div
        className="sky-panel-presets"
        role="group"
        aria-label="月昼快捷态"
      >
        {PHASE_SHORTCUTS.map(({ phase, label }) => {
          const active = !autoSceneTime && effectivePhase === phase;
          return (
            <button
              key={phase}
              type="button"
              className="sky-panel-auto sky-panel-preset"
              data-active={active}
              aria-pressed={active}
              onClick={() => setSceneTime(SCENE_PHASE_PRESET_TIME[phase])}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="sky-panel-row">
        <span className="t-caption">光照强度</span>
        <span className="t-mono">{intensity.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={2}
        step={0.05}
        value={intensity}
        onChange={(e) => setIntensity(Number(e.target.value))}
        aria-label="光照强度"
      />

      <div className="sky-panel-row">
        <span className="t-caption">场景播放</span>
        <span className="t-mono">{playbackStatus}</span>
      </div>
      <button
        type="button"
        className="sky-panel-auto sky-panel-playback"
        data-active={playing}
        disabled={prefersReducedMotion}
        onClick={() => {
          if (playing) {
            setSceneTime(sceneTimeFromDate());
            setMotion(0);
            return;
          }
          setMotion(1);
          setAutoSceneTime();
        }}
      >
        {prefersReducedMotion
          ? '系统减少动态已开启'
          : playing
            ? '暂停演进'
            : '继续演进'}
      </button>
    </div>
  );
}
