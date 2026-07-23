import { useEffect, useRef } from 'react';
import { useUi, PHASE_LABEL } from './ui-context.tsx';
import { formatDayTime } from './sky-math.ts';

/** Floating light & time controls for the living-sky background. */
export function SkyPanel() {
  const closeRef = useRef<HTMLButtonElement>(null);
  const {
    skyPanelOpen: open,
    setSkyPanelOpen,
    dayTime,
    autoTime,
    setDayTime,
    setAutoTime,
    effectivePhase,
    intensity,
    setIntensity,
    motion,
    setMotion,
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

  const minutes = Math.floor(dayTime * 24 * 60) % (24 * 60);

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
        <span className="t-caption">时间</span>
        <span className="t-mono">
          {formatDayTime(dayTime)} · {PHASE_LABEL[effectivePhase]}
          {autoTime ? ' · 自动' : ''}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={1439}
        value={minutes}
        onChange={(e) => setDayTime(Number(e.target.value) / 1440)}
        aria-label="时间"
      />
      <button
        type="button"
        className="sky-panel-auto"
        data-active={autoTime}
        onClick={setAutoTime}
        disabled={autoTime}
      >
        跟随本地时间
      </button>

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
        <span className="t-caption">动态幅度</span>
        <span className="t-mono">{motion.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={motion}
        onChange={(e) => setMotion(Number(e.target.value))}
        aria-label="动态幅度"
      />
    </div>
  );
}
