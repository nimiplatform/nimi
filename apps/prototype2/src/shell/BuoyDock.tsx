import { MODULES } from '../scenario/meta';
import { useSim } from '../engine/SimContext';

/** Buoy dock — minimized running instances use the same system chrome as the
 * bottom spine. Bottom spine = launch; left buoys = running. */
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
              className="buoy nimi-material-glass-chrome bg-[var(--nimi-material-glass-chrome-bg)] border border-[var(--nimi-material-glass-chrome-border)] backdrop-blur-[var(--nimi-backdrop-blur-chrome)] backdrop-saturate-[var(--nimi-backdrop-saturate)]"
              data-nimi-material="glass-chrome"
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
