import { MODULES } from '../scenario/meta';
import { useSim } from '../engine/SimContext';

/** Buoy dock — minimized running instances become floating buoys on the
 * LEFT edge of the field. Bottom spine = launch; left buoys = running. */
export function BuoyDock() {
  const { state, focusWindow } = useSim();
  const minimized = state.windows.filter((w) => w.minimized);
  if (minimized.length === 0) return null;
  return (
    <nav className="buoy-dock" aria-label="运行中的实例">
      {minimized.map((w, i) => {
        const m = MODULES[w.moduleId];
        return (
          <div key={w.instanceId} className="buoy-cell" style={{ animationDelay: `${i * 0.6}s` }}>
            <button
              type="button"
              className="buoy nimi-material-glass-thin bg-[var(--nimi-material-glass-thin-bg)] border border-[var(--nimi-material-glass-thin-border)] backdrop-blur-[var(--nimi-backdrop-blur-thin)] backdrop-saturate-[var(--nimi-backdrop-saturate)]"
              data-nimi-material="glass-thin"
              data-nimi-tone="panel"
              data-mod={w.moduleId}
              title={`${m.name} · 点击恢复`}
              onClick={() => focusWindow(w.instanceId)}
            >
              <span className={`spine-glyph spine-glyph-${w.moduleId}`} aria-hidden>
                <i />
                <i />
                <i />
              </span>
              <span className="buoy-ring" aria-hidden />
            </button>
          </div>
        );
      })}
    </nav>
  );
}
