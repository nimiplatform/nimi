import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  AnimatePresence,
  motion,
  nimiOverlayPanelMotion,
  useNimiReducedMotion,
} from '@nimiplatform/kit/ui';
import { useUi, PHASE_LABEL } from './UiContext';
import { formatDayTime } from './sky/skyMath';

interface SkyPanelProps {
  open: boolean;
  onClose: () => void;
}

/** Floating light & time controls for the living-sky background. */
export function SkyPanel({ open, onClose }: SkyPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useNimiReducedMotion();
  const {
    dayTime,
    autoTime,
    setDayTime,
    setAutoTime,
    effectivePhase,
    intensity,
    setIntensity,
    motion: skyMotion,
    setMotion,
  } = useUi();

  useLayoutEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      previousFocus?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (panelRef.current && target && !panelRef.current.contains(target)) {
        const trigger = (target as HTMLElement).closest?.('[aria-controls="sky-control-panel"]');
        if (!trigger) onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, onClose]);

  const minutes = Math.floor(dayTime * 24 * 60) % (24 * 60);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="sky-control-panel"
          ref={panelRef}
          id="sky-control-panel"
          className="sky-panel pane nimi-material-glass-chrome bg-[var(--nimi-material-glass-chrome-bg)] border border-[var(--nimi-material-glass-chrome-border)] backdrop-blur-[var(--nimi-backdrop-blur-chrome)] backdrop-saturate-[var(--nimi-backdrop-saturate)]"
          data-nimi-material="glass-chrome"
          data-nimi-tone="overlay"
          role="dialog"
          aria-label="光影与时间"
          {...nimiOverlayPanelMotion({ kind: 'popover', side: 'top', align: 'start', reducedMotion })}
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
            <span className="t-mono">
              {reducedMotion ? '已减弱动态 · 0.00' : skyMotion.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={reducedMotion ? 0 : skyMotion}
            disabled={reducedMotion}
            onChange={(e) => setMotion(Number(e.target.value))}
            aria-label="动态幅度"
            title={reducedMotion ? '系统已开启减弱动态效果，天空动态幅度锁定为 0' : undefined}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
