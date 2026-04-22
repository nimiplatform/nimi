import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchFrontendCategoryMapping, fetchFrontendRootCategories } from '@renderer/data/frontend-taxonomy.js';

function formatCount(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }
  return value.toLocaleString('en-US');
}

export function FrontendTaxonomyPage() {
  const sectorsQuery = useQuery({
    queryKey: ['polyinfo', 'frontend-root-sectors'],
    queryFn: () => fetchFrontendRootCategories(),
    staleTime: 10 * 60 * 1000,
  });
  const sectors = sectorsQuery.data ?? [];
  const [selectedSlug, setSelectedSlug] = useState('');

  useEffect(() => {
    const firstSector = sectors[0];
    if (!selectedSlug && firstSector) {
      setSelectedSlug(firstSector.slug);
    }
  }, [selectedSlug, sectors]);

  const activeSector = useMemo(() => sectors.find((sector) => sector.slug === selectedSlug) ?? sectors[0] ?? null, [sectors, selectedSlug]);

  const mappingQuery = useQuery({
    queryKey: ['polyinfo', 'frontend-taxonomy', activeSector?.slug],
    queryFn: () => fetchFrontendCategoryMapping(activeSector!),
    enabled: Boolean(activeSector),
    staleTime: 10 * 60 * 1000,
  });

  const rows = mappingQuery.data?.rows ?? [];

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-white/10 bg-slate-950/55 p-6">
        <p className="text-xs uppercase tracking-[0.18em] text-sky-300/80">Mapping Table</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">前台分类到全量事件的映射</h2>
        <p className="mt-3 max-w-4xl text-sm leading-7 text-slate-300">
          这里直接展示我们现在采用的抓取方式：先读首页根分类，再读某个根分类下的左侧分类，最后把每个分类对应的事件分页拿全。
          右侧两列分别是页面显示的数量和我们实际抓到的数量，方便你直接核对。
        </p>
      </section>

      <section className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="rounded-md border border-white/10 bg-slate-950/55 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Root Categories</p>
          <div className="mt-3 space-y-2">
            {sectorsQuery.isLoading ? (
              <div className="rounded-md border border-white/8 bg-white/[0.03] px-3 py-4 text-sm text-slate-400">
                正在读取前台根分类…
              </div>
            ) : null}
            {sectorsQuery.isError ? (
              <div className="rounded-md border border-rose-400/20 bg-rose-400/10 px-3 py-4 text-sm text-rose-100">
                根分类读取失败：{sectorsQuery.error instanceof Error ? sectorsQuery.error.message : 'unknown error'}
              </div>
            ) : null}
            {sectors.map((sector) => (
              <button
                key={sector.slug}
                type="button"
                onClick={() => setSelectedSlug(sector.slug)}
                className={`w-full rounded-md border px-3 py-3 text-left transition-colors ${
                  activeSector?.slug === sector.slug
                    ? 'border-sky-300/60 bg-sky-300/14'
                    : 'border-white/8 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-white">{sector.label}</span>
                  <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{sector.slug}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-white/10 bg-slate-950/55 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Category Mapping</p>
              <h3 className="mt-1 text-lg font-semibold text-white">
                {activeSector ? activeSector.label : '选择一个根分类'}
              </h3>
            </div>
            {mappingQuery.data ? (
              <span className="rounded-md border border-white/8 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
                更新于 {new Date(mappingQuery.data.generatedAt).toLocaleString()}
              </span>
            ) : null}
          </div>

          {mappingQuery.isLoading ? (
            <div className="mt-4 rounded-md border border-white/8 bg-white/[0.03] px-4 py-6 text-sm text-slate-400">
              正在分页读取这个分类下面的全部事件…
            </div>
          ) : null}

          {mappingQuery.isError ? (
            <div className="mt-4 rounded-md border border-rose-400/20 bg-rose-400/10 px-4 py-6 text-sm text-rose-100">
              映射表读取失败：{mappingQuery.error instanceof Error ? mappingQuery.error.message : 'unknown error'}
            </div>
          ) : null}

          {!mappingQuery.isLoading && !mappingQuery.isError ? (
            <div className="mt-4 overflow-hidden rounded-md border border-white/8">
              <div className="grid grid-cols-[minmax(0,1.5fr)_120px_120px_110px_minmax(0,1.6fr)] gap-3 border-b border-white/8 bg-white/[0.03] px-4 py-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                <span>分类</span>
                <span>页面数量</span>
                <span>抓取数量</span>
                <span>分页数</span>
                <span>样例事件</span>
              </div>
              <div className="divide-y divide-white/8">
                {rows.map((row) => {
                  const mismatch = typeof row.category.displayedCount === 'number'
                    && row.category.displayedCount !== row.fetchedCount;
                  return (
                    <div
                      key={`${row.category.parentSlug}:${row.category.slug}`}
                      className={`grid grid-cols-[minmax(0,1.5fr)_120px_120px_110px_minmax(0,1.6fr)] gap-3 px-4 py-4 text-sm ${
                        mismatch ? 'bg-amber-400/6' : 'bg-transparent'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-white">{row.category.label}</span>
                          <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{row.category.slug}</span>
                          <Link
                            to={
                              row.category.slug === row.category.parentSlug
                                ? `/sectors/${row.category.parentSlug}`
                                : `/sectors/${row.category.parentSlug}/${row.category.slug}`
                            }
                            className="rounded-md border border-sky-300/20 bg-sky-300/10 px-2 py-1 text-[11px] text-sky-100"
                          >
                            打开
                          </Link>
                        </div>
                        {mismatch ? (
                          <p className="mt-1 text-xs text-amber-200">页面显示和抓取结果暂时不一致。</p>
                        ) : null}
                      </div>
                      <span className="text-slate-300">{formatCount(row.category.displayedCount)}</span>
                      <span className="text-slate-100">{formatCount(row.fetchedCount)}</span>
                      <span className="text-slate-300">{row.pageCount}</span>
                      <div className="min-w-0 text-xs leading-6 text-slate-400">
                        {row.sampleEvents.length === 0 ? '没有样例事件' : row.sampleEvents.map((event) => event.title).join(' / ')}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
