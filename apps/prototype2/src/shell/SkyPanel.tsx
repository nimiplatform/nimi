import { useEffect, useRef } from 'react';
import { useUi, PHASE_LABEL } from './UiContext';
import { formatDayTime } from './sky/skyMath';

interface SkyPanelProps {
  open: boolean;
  onClose: () => void;
}

/** Floating light & time controls for the living-sky background. */
export function SkyPanel({ open, onClose }: SkyPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const {
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
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      previousFocus?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const minutes = Math.floor(dayTime * 24 * 60) % (24 * 60);

  return (
    <div
      id="sky-control-panel"
      className="sky-panel pane nimi-material-glass-chrome bg-[var(--nimi-material-glass-chrome-bg)] border border-[var(--nimi-material-glass-chrome-border)] backdrop-blur-[var(--nimi-backdrop-blur-chrome)] backdrop-saturate-[var(--nimi-backdrop-saturate)]"
      data-nimi-material="glass-chrome"
      data-nimi-tone="overlay"
      role="dialog"
      aria-label="光影与时间"
    >
      <div className="sky-panel-head">
        <span className="t-overline">光影 · Light & Time</span>
        <button ref={closeRef} type="button" className="sky-panel-close" onClick={onClose} aria-label="关闭">
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
