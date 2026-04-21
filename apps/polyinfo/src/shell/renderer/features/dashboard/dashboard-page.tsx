import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchSectorTags } from '@renderer/data/polymarket.js';
import { useAppStore } from '@renderer/app-shell/app-store.js';

export function DashboardPage() {
  const snapshotsBySector = useAppStore((state) => state.snapshotsBySector);
  const tagsQuery = useQuery({
    queryKey: ['polyinfo', 'sectors'],
    queryFn: () => fetchSectorTags(),
    staleTime: 10 * 60 * 1000,
  });

  const latestSnapshots = Object.values(snapshotsBySector)
    .flat()
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 8);

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-white/10 bg-slate-950/55 p-6">
        <p className="text-xs uppercase tracking-[0.18em] text-sky-300/80">Workbench</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">只看下注，不看新闻</h2>
        <p className="mt-3 max-w-4xl text-sm leading-7 text-slate-300">
          先进入一个 sector，再让内置分析师结合当前盘口变化、你定义过的 narrative 和 core variable 给出判断。
          如果你不同意，就继续在同一个聊天里争论，并把新的结构直接确认进去。
        </p>
        <div className="mt-5 flex flex-wrap gap-3 text-xs text-slate-400">
          <span className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
            实时价格来自 Polymarket
          </span>
          <span className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
            账号和运行时走 nimi 现有体系
          </span>
          <span className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
            结构修改在聊天里提出，再手动确认
          </span>
          <Link to="/mapping" className="rounded-md border border-sky-300/20 bg-sky-300/10 px-3 py-2 text-sky-100">
            查看前台分类映射表
          </Link>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-md border border-white/10 bg-slate-950/55 p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-white">Sectors</h3>
            <span className="text-xs text-slate-500">
              {tagsQuery.data?.length ?? 0} 个前台根分类
            </span>
          </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {tagsQuery.isError ? (
              <div className="md:col-span-2 xl:col-span-3 rounded-md border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100">
                板块列表读取失败：{tagsQuery.error instanceof Error ? tagsQuery.error.message : 'unknown error'}
              </div>
            ) : null}
            {(tagsQuery.data ?? []).slice(0, 18).map((tag) => (
              <Link
                key={tag.id}
                to={`/sectors/${tag.slug}`}
                className="rounded-md border border-white/8 bg-white/[0.03] p-4 transition-colors hover:border-sky-300/35 hover:bg-sky-300/8"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-white">{tag.label}</span>
                  <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                    {tag.slug}
                  </span>
                </div>
                <p className="mt-3 text-xs leading-6 text-slate-400">
                  进入这个前台板块，读取实时盘口和你已有的分析结构，直接开始讨论。
                </p>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-white/10 bg-slate-950/55 p-6">
          <h3 className="text-lg font-semibold text-white">Latest Analyst Output</h3>
          <div className="mt-4 space-y-3">
            {latestSnapshots.length === 0 ? (
              <div className="rounded-md border border-white/8 bg-white/[0.03] p-4 text-sm text-slate-400">
                还没有分析历史。打开一个 sector 后，系统会保存每次完成的分析结论。
              </div>
            ) : latestSnapshots.map((snapshot) => (
              <Link
                key={snapshot.id}
                to={`/sectors/${snapshot.sectorSlug}`}
                className="block rounded-md border border-white/8 bg-white/[0.03] p-4 transition-colors hover:border-sky-300/35 hover:bg-sky-300/8"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-white">{snapshot.sectorLabel}</span>
                  <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                    {snapshot.window}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-200">{snapshot.headline}</p>
                <p className="mt-2 text-xs leading-6 text-slate-400">{snapshot.summary}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
