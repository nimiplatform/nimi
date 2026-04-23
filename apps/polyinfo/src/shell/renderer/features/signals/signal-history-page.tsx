import { Link } from 'react-router-dom';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import { buildSectorPath } from '@renderer/app-shell/workspace-routes.js';

export function SignalHistoryPage() {
  const snapshots = Object.values(useAppStore((state) => state.snapshotsBySector))
    .flat()
    .sort((left, right) => right.createdAt - left.createdAt);

  return (
    <div className="rounded-md border border-white/10 bg-slate-950/55 p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Signal History</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            这里保留每个 sector 最近完成的分析结论，方便你回看不同时间窗口下市场判断是怎么变的。
          </p>
        </div>
        <span className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-400">
          {snapshots.length} 条记录
        </span>
      </div>

      <div className="mt-6 space-y-3">
        {snapshots.length === 0 ? (
          <div className="rounded-md border border-white/8 bg-white/[0.03] p-4 text-sm text-slate-400">
            还没有可回看的分析历史。先进入任意 sector，让分析师给出一次结论。
          </div>
        ) : snapshots.map((snapshot) => {
          const route = buildSectorPath(snapshot.sectorSlug);
          return (
          <Link
            key={snapshot.id}
            to={route}
            className="block rounded-md border border-white/8 bg-white/[0.03] p-4 transition-colors hover:border-sky-300/35 hover:bg-sky-300/8"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">{snapshot.sectorLabel}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {new Date(snapshot.createdAt).toLocaleString('zh-CN')} | {snapshot.window}
                </p>
              </div>
              <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                open
              </span>
            </div>
            <p className="mt-3 text-sm text-slate-200">{snapshot.headline}</p>
            <p className="mt-2 text-xs leading-6 text-slate-400">{snapshot.summary}</p>
          </Link>
          );
        })}
      </div>
    </div>
  );
}
