import { useUi } from './ui-context.tsx';
import { liveInstancesOf, useShellActions } from './shell-actions.tsx';

/** Center of a rail icon in viewport coordinates — the animation target for
 * windows flying into / out of the left app rail. */
export function railIconCenter(moduleId: string): { x: number; y: number } | null {
  const el = document.querySelector<HTMLElement>(`.app-rail-btn[data-mod='${moduleId}']`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** App rail — left sidebar, dock-style. Always lists every selected module;
 * a vertical bar on the icon's left edge marks running instances. Clicking an
 * icon launches the module's first surface or restores/focuses its most
 * recent live window. */
export function AppRail() {
  const { modules, instances, open } = useShellActions();
  const { windows, focusWindow, restoreWindow, showToast } = useUi();
  return (
    <nav className="app-rail" data-nimi-material="glass-chrome" data-nimi-tone="panel" aria-label="应用栏">
      {modules.map((module) => {
        const id = module.moduleId;
        const live = liveInstancesOf(instances, id);
        const latest = live.at(-1) ?? null;
        const minimized = latest ? windows[latest.instanceId]?.minimized === true : false;
        const title = latest
          ? minimized
            ? `${id} · 已最小化 · 点击恢复`
            : `${id} · 运行中`
          : `打开 · ${id}`;
        return (
          <button
            key={id}
            type="button"
            className="app-rail-btn"
            data-mod={id}
            data-open={live.length > 0 || undefined}
            data-minimized={minimized || undefined}
            title={title}
            aria-label={title}
            onClick={() => {
              if (latest) {
                restoreWindow(latest.instanceId);
                focusWindow(latest.instanceId);
              } else if (module.surfaces[0]) {
                open(id, module.surfaces[0].id);
              } else {
                showToast({ title: id, detail: 'This module declares no surfaces.' });
              }
            }}
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
