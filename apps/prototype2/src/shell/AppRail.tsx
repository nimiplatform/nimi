import { useSim } from '../engine/SimContext';
import { MODULES, MODULE_ORDER } from '../scenario/meta';
import type { ModuleId } from '../scenario/types';

/** Center of a rail icon in viewport coordinates — the animation target for
 * windows flying into / out of the left app rail. */
export function railIconCenter(moduleId: ModuleId): { x: number; y: number } | null {
  const el = document.querySelector<HTMLElement>(`.app-rail-btn[data-mod='${moduleId}']`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** App rail — left sidebar, dock-style. Always lists every app; a vertical
 * bar on the icon's left edge marks running instances (focused or minimized)
 * and disappears when the app closes. Minimized windows fly back into their
 * rail icon; clicking an icon launches, focuses, or restores the app. */
export function AppRail() {
  const { state, openApp, focusWindow } = useSim();
  return (
    <nav
      className="app-rail nimi-material-glass-chrome bg-[var(--nimi-material-glass-chrome-bg)] border border-[var(--nimi-material-glass-chrome-border)] backdrop-blur-[var(--nimi-backdrop-blur-chrome)] backdrop-saturate-[var(--nimi-backdrop-saturate)]"
      data-nimi-material="glass-chrome"
      data-nimi-tone="panel"
      aria-label="应用栏"
    >
      {MODULE_ORDER.map((id) => {
        const m = MODULES[id];
        const win = state.windows.find((w) => w.moduleId === id);
        const title = win
          ? win.minimized
            ? `${m.name} · 已最小化 · 点击恢复`
            : `${m.name} · 运行中`
          : `打开 · ${m.name}`;
        return (
          <button
            key={id}
            type="button"
            className="app-rail-btn"
            data-mod={id}
            data-open={Boolean(win)}
            data-minimized={win?.minimized || undefined}
            title={title}
            aria-label={title}
            onClick={() => (win ? focusWindow(win.instanceId) : openApp(id))}
          >
            <span className={`spine-glyph spine-glyph-${id}`} aria-hidden>
              <i />
              <i />
              <i />
            </span>
          </button>
        );
      })}
    </nav>
  );
}
