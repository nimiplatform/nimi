import { useUi } from './ui-context.tsx';
import { liveInstancesOf, useShellActions } from './shell-actions.tsx';
import { AppLogo } from './app-logo.tsx';
import { bounceRailIcon, railIconCenter, transitionRestoreWindow } from './window-transitions.ts';

export { railIconCenter };

/** App rail — left sidebar, dock-style. Always lists every selected module;
 * a vertical bar on the icon's left edge marks running instances. Clicking an
 * icon launches the module's first surface or restores/focuses its most
 * recent live window. */
export function AppRail() {
  const { modules, instances, open } = useShellActions();
  const { windows, focusWindow, restoreWindow, showToast, stageElement } = useUi();
  return (
    <nav className="app-rail" aria-label="应用栏">
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
                if (minimized) {
                  transitionRestoreWindow(stageElement(latest.instanceId), latest.instanceId, id, () => {
                    restoreWindow(latest.instanceId);
                    focusWindow(latest.instanceId);
                  });
                } else {
                  focusWindow(latest.instanceId);
                }
                bounceRailIcon(id);
              } else if (module.surfaces[0]) {
                bounceRailIcon(id);
                open(id, module.surfaces[0].id);
              } else {
                showToast({ title: id, detail: 'This module declares no surfaces.' });
              }
            }}
          >
            <AppLogo moduleId={id} size="rail" />
          </button>
        );
      })}
    </nav>
  );
}
