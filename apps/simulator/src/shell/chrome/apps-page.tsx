import { useMemo, useState } from 'react';
import { useUi } from './ui-context.tsx';
import { liveInstancesOf, useShellActions } from './shell-actions.tsx';

/** The apps page — a launcher overlay entered from the cradle's modules pane.
 * Lists the selected registry modules with their real running state; the
 * simulator admits no placeholder catalog, so the grid stays honest. */
export function AppsPage() {
  const { appsPageOpen, setAppsPageOpen } = useUi();
  const { modules, instances, open } = useShellActions();
  const [query, setQuery] = useState('');
  const [full, setFull] = useState(false);

  const entries = useMemo(() => modules.map((module) => ({
    key: module.moduleId,
    name: module.moduleId,
    desc: module.surfaces.map((surface) => surface.label).join(' · ') || 'no surfaces',
    running: liveInstancesOf(instances, module.moduleId).length > 0,
    surfaceId: module.surfaces[0]?.id ?? null,
  })), [modules, instances]);

  if (!appsPageOpen) return null;
  const q = query.trim().toLowerCase();
  const list = q
    ? entries.filter((entry) => `${entry.name} ${entry.desc}`.toLowerCase().includes(q))
    : entries;

  const close = () => setAppsPageOpen(false);

  return (
    <>
      <div className="apps-backdrop" onClick={close} aria-hidden />
      <div
        className={`apps-page${full ? ' apps-page-full' : ''}`}
        data-nimi-material="glass-regular"
        data-nimi-tone="panel"
        role="dialog"
        aria-label="应用 · APPS"
      >
        <div className="apps-head">
          <h2 className="apps-title">应用 · APPS</h2>
          <span className="apps-head-actions">
            <button
              type="button"
              className="apps-head-btn"
              title={full ? '还原面板' : '铺满屏幕'}
              aria-label={full ? '还原面板' : '铺满屏幕'}
              onClick={() => setFull((f) => !f)}
            >
              ⤢
            </button>
            <button type="button" className="apps-head-btn" title="关闭" aria-label="关闭" onClick={close}>
              ✕
            </button>
          </span>
        </div>

        <div className="apps-tools">
          <label className="apps-search">
            <span className="apps-search-icon" aria-hidden>⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索应用…"
              aria-label="搜索应用"
            />
          </label>
        </div>

        <div className="apps-grid">
          {list.length === 0 ? (
            <div className="apps-empty">没有匹配的应用</div>
          ) : (
            list.map((entry) => (
              <div key={entry.key} className="apps-card" data-open={entry.running || undefined}>
                <button
                  type="button"
                  className="apps-card-open"
                  title={`${entry.name} · 点击${entry.running ? '聚焦' : '打开'}`}
                  aria-label={`${entry.name} · ${entry.running ? '聚焦运行中的应用' : '打开应用'}`}
                  disabled={!entry.surfaceId}
                  onClick={() => {
                    if (entry.surfaceId) open(entry.key, entry.surfaceId);
                    close();
                  }}
                >
                  <span className="apps-icon" aria-hidden>
                    <span className={`spine-glyph spine-glyph-${entry.key}`}>
                      <i />
                      <i />
                      <i />
                    </span>
                  </span>
                  <span className="apps-card-main">
                    <b>
                      {entry.name}
                      <em className="apps-status" data-status={entry.running ? 'running' : 'standby'}>
                        {entry.running ? '运行中' : '待机'}
                      </em>
                    </b>
                    <span className="apps-card-desc">{entry.desc}</span>
                  </span>
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
