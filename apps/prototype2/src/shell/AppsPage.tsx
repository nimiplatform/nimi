import { useMemo, useState, type CSSProperties } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@nimiplatform/kit/ui';
import { useSim } from '../engine/SimContext';
import { MODULES, MODULE_ORDER } from '../scenario/meta';
import type { ModuleId } from '../scenario/types';

type AppStatus = '运行中' | '待机' | '同步中' | '空闲';
type AppsTab = 'recent' | 'fav' | 'all' | 'running' | 'collab';
type AppsSort = 'recent' | 'name';

interface AppEntry {
  key: string;
  name: string;
  desc: string;
  moduleId?: ModuleId;
  /** Text glyph for placeholder apps; real modules reuse the spine glyph. */
  glyph?: string;
  /** Icon hue for placeholder apps. */
  hue?: number;
  status: AppStatus;
  collab: boolean;
}

const TABS: { id: AppsTab; label: string }[] = [
  { id: 'recent', label: '最近使用' },
  { id: 'fav', label: '收藏' },
  { id: 'all', label: '全部' },
  { id: 'running', label: '运行中' },
  { id: 'collab', label: '可协作' },
];

/** Placeholder apps beyond the three live modules — display only, matching
 * the launcher's target catalog. */
const PLACEHOLDER_APPS: AppEntry[] = [
  { key: 'parentos', name: 'ParentOS', desc: '系统级父节点，管理核心能力与权限。', glyph: '◈', hue: 215, status: '运行中', collab: false },
  { key: 'memory', name: 'Memory', desc: '长期记忆存储与检索，跨应用可用。', glyph: '▤', hue: 260, status: '同步中', collab: true },
  { key: 'worldlab', name: 'World Lab', desc: '世界构建与模拟实验沙箱。', glyph: '◍', hue: 150, status: '运行中', collab: true },
  { key: 'agentkit', name: 'Agent Kit', desc: '智能体构建、工具与技能集成。', glyph: '△', hue: 275, status: '待机', collab: false },
  { key: 'archive', name: 'Archive', desc: '历史记录归档与可追溯检索。', glyph: '▣', hue: 40, status: '空闲', collab: false },
  { key: 'planner', name: 'Planner', desc: '任务规划、日程与目标管理。', glyph: '▦', hue: 350, status: '运行中', collab: true },
  { key: 'studio', name: 'Studio', desc: '内容创作、可视化与多模态编辑。', glyph: '✦', hue: 290, status: '运行中', collab: true },
  { key: 'connector', name: 'Connector', desc: '第三方服务与协议连接器。', glyph: '⌁', hue: 320, status: '空闲', collab: true },
  { key: 'insight', name: 'Insight', desc: '数据洞察与智能分析助手。', glyph: '◔', hue: 195, status: '待机', collab: false },
];

/** The apps page — a launcher overlay entered from the cradle's 领域 pane.
 * Lists live modules (with real running state) alongside placeholder apps,
 * with search, tabs, favorites and sorting. */
export function AppsPage({ onClose }: { onClose: () => void }) {
  const { state, openApp } = useSim();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<AppsTab>('recent');
  const [sort, setSort] = useState<AppsSort>('recent');
  const [favs, setFavs] = useState<ReadonlySet<string>>(new Set());
  const [full, setFull] = useState(false);

  const running = useMemo(() => new Set(state.windows.map((w) => w.moduleId)), [state.windows]);
  const entries = useMemo<AppEntry[]>(
    () => [
      ...MODULE_ORDER.map((id) => ({
        key: id,
        name: MODULES[id].name,
        desc: MODULES[id].desc,
        moduleId: id,
        status: '待机' as AppStatus,
        collab: id !== 'desktop',
      })),
      ...PLACEHOLDER_APPS,
    ],
    [],
  );
  const statusOf = (e: AppEntry): AppStatus =>
    e.moduleId ? (running.has(e.moduleId) ? '运行中' : '待机') : e.status;

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = entries.filter((e) => {
      if (q && !`${e.name} ${e.desc}`.toLowerCase().includes(q)) return false;
      if (tab === 'fav') return favs.has(e.key);
      if (tab === 'running') return statusOf(e) === '运行中';
      if (tab === 'collab') return e.collab;
      return true;
    });
    if (sort === 'name') out = [...out].sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [entries, query, tab, favs, sort, running]);

  const toggleFav = (key: string) =>
    setFavs((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const openEntry = (e: AppEntry) => {
    if (!e.moduleId) return;
    openApp(e.moduleId);
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        onClose={onClose}
        overlayClassName="apps-backdrop"
        className={`apps-page${full ? ' apps-page-full' : ''} nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)] backdrop-saturate-[var(--nimi-backdrop-saturate)]`}
      >
        <DialogDescription className="sr-only">
          浏览、筛选并打开原型中的模拟应用。
        </DialogDescription>
        <div data-nimi-material="glass-regular" data-nimi-tone="panel" className="apps-page-state">
          <div className="apps-head">
            <DialogTitle asChild>
              <h2 className="apps-title">应用 · APPS</h2>
            </DialogTitle>
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
              <button type="button" className="apps-head-btn" title="关闭" aria-label="关闭" onClick={onClose}>
                ✕
              </button>
            </span>
          </div>

          <div className="apps-tools">
            <label className="apps-search">
              <span className="apps-search-icon" aria-hidden>⌕</span>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索应用…"
                aria-label="搜索应用"
              />
            </label>
            <select
              className="apps-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as AppsSort)}
              title="排序方式"
              aria-label="排序方式"
            >
              <option value="recent">按最近使用</option>
              <option value="name">按名称</option>
            </select>
          </div>

          <div className="apps-tabs" role="tablist" aria-label="应用筛选">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                data-active={tab === t.id || undefined}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="apps-grid">
            {list.length === 0 ? (
              <div className="apps-empty">{tab === 'fav' ? '还没有收藏的应用' : '没有匹配的应用'}</div>
            ) : (
              list.map((e) => {
                const status = statusOf(e);
                const open = running.has(e.moduleId as ModuleId);
                return (
                  <div
                    key={e.key}
                    className="apps-card"
                    data-open={open || undefined}
                    data-placeholder={!e.moduleId || undefined}
                  >
                    <button
                      type="button"
                      className="apps-card-open"
                      title={e.moduleId ? `${e.name} · 点击${open ? '聚焦' : '打开'}` : `${e.name} · 原型占位`}
                      aria-label={
                        e.moduleId
                          ? `${e.name} · ${open ? '聚焦运行中的应用' : '打开应用'}`
                          : `${e.name} · 原型占位，暂不可打开`
                      }
                      disabled={!e.moduleId}
                      onClick={() => openEntry(e)}
                    >
                      <span
                        className="apps-icon"
                        style={e.hue !== undefined ? ({ '--app-hue': e.hue } as CSSProperties) : undefined}
                        aria-hidden
                      >
                        {e.moduleId ? (
                          <span className={`spine-glyph spine-glyph-${e.moduleId}`}>
                            <i />
                            <i />
                            <i />
                          </span>
                        ) : (
                          <span className="apps-icon-glyph">{e.glyph}</span>
                        )}
                      </span>
                      <span className="apps-card-main">
                        <b>
                          {e.name}
                          <em className="apps-status" data-status={status}>
                            {status}
                          </em>
                        </b>
                        <span className="apps-card-desc">{e.desc}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="apps-star"
                      data-active={favs.has(e.key) || undefined}
                      title={favs.has(e.key) ? '取消收藏' : '收藏'}
                      aria-label={favs.has(e.key) ? `取消收藏 ${e.name}` : `收藏 ${e.name}`}
                      aria-pressed={favs.has(e.key)}
                      onClick={() => toggleFav(e.key)}
                    >
                      {favs.has(e.key) ? '★' : '☆'}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
