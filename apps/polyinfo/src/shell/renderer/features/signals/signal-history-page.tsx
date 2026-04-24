import { Link } from 'react-router-dom';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import { buildSectorPath } from '@renderer/app-shell/workspace-routes.js';

export function SignalHistoryPage() {
  const snapshots = Object.values(useAppStore((state) => state.snapshotsBySector))
    .flat()
    .sort((left, right) => right.createdAt - left.createdAt);

  return (
    <div className="polyinfo-surface flex h-full min-h-0 flex-col rounded-2xl p-6">
      <div className="flex items-start justify-between gap-4 border-b polyinfo-hairline pb-5">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-teal-200/60">Signal desk</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Signal History</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            这里保留每个 sector 最近完成的分析结论，方便你回看不同时间窗口下市场判断是怎么变的。
          </p>
        </div>
        <span className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
          <span className="text-white">{snapshots.length}</span> 条记录
        </span>
      </div>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
        {snapshots.length === 0 ? (
          <div className="flex min-h-[300px] items-center justify-center rounded-2xl border border-dashed border-white/12 bg-white/[0.025] p-8 text-center">
            <div>
              <div className="mx-auto h-12 w-12 rounded-2xl border border-teal-300/25 bg-teal-300/10 shadow-[0_0_30px_rgba(45,212,191,0.08)]" />
              <p className="mt-5 text-base font-medium text-slate-100">还没有分析历史</p>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                进入任意 sector 聊一次，完成后的结论会自动沉淀到这里。
              </p>
            </div>
          </div>
        ) : snapshots.map((snapshot) => {
          const route = buildSectorPath(snapshot.sectorSlug);
          return (
          <Link
            key={snapshot.id}
            to={route}
            className="mb-3 block rounded-2xl border border-white/10 bg-white/[0.035] p-4 transition-colors hover:border-teal-300/35 hover:bg-teal-300/8"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">{snapshot.sectorLabel}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {new Date(snapshot.createdAt).toLocaleString('zh-CN')} | {snapshot.window}
                </p>
              </div>
              <span className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] uppercase tracking-[0.14em] text-slate-500">
                open
              </span>
            </div>
            <p className="mt-4 text-sm font-medium text-slate-100">{snapshot.headline}</p>
            <p className="mt-2 text-xs leading-6 text-slate-400">{snapshot.summary}</p>
          </Link>
          );
        })}
      </div>
    </div>
  );
}
