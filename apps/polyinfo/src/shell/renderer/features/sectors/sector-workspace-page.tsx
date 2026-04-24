import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import { getOfficialRootSectorsQueryOptions } from '@renderer/app-shell/official-sector-query.js';
import { validateImportedEventRecord } from '@renderer/data/polymarket.js';
import type {
  AnalysisPackage,
  FrontendCategoryItem,
  ImportedEventRecord,
  PreparedMarket,
  SectorTag,
} from '@renderer/data/types.js';
import { AnalystSidebar, MarketBoardPanel } from './sector-workspace-panels.js';

function StructureCard({
  eyebrow,
  title,
  description,
  onDelete,
}: {
  eyebrow: string;
  title: string;
  description: string;
  onDelete: () => void;
}) {
  return (
    <div className="group relative border-l border-white/10 bg-white/[0.025] px-3 py-2.5 transition-colors hover:border-teal-300/35 hover:bg-white/[0.04]">
      <button
        type="button"
        onClick={onDelete}
        className="absolute right-2.5 top-2.5 rounded-md bg-white/[0.06] px-1.5 py-1 text-[10px] text-slate-300 opacity-0 transition-opacity hover:bg-rose-400/12 hover:text-rose-100 group-hover:opacity-100"
      >
        Delete
      </button>
      <p className="text-[9px] uppercase tracking-[0.14em] text-teal-200/50">{eyebrow}</p>
      <p className="mt-2 pr-12 text-[13px] font-semibold leading-5 text-white">{title}</p>
      <p className="mt-1.5 text-[12px] leading-5 text-slate-400">{description}</p>
    </div>
  );
}

function collectImportedMarkets(events: ImportedEventRecord[]): PreparedMarket[] {
  const seen = new Set<string>();
  const markets: PreparedMarket[] = [];
  for (const event of events) {
    for (const market of event.cachedEventPayload.markets) {
      if (seen.has(market.id)) {
        continue;
      }
      seen.add(market.id);
      markets.push(market);
    }
  }
  return markets;
}

export function SectorWorkspacePage() {
  const { sectorId = '' } = useParams<{ sectorId: string }>();
  const decodedSectorId = decodeURIComponent(sectorId);
  const [marketDataRequestedBySector, setMarketDataRequestedBySector] = useState<Record<string, boolean>>({});
  const [showNarrativeForm, setShowNarrativeForm] = useState(false);
  const [showCoreIssueForm, setShowCoreIssueForm] = useState(false);
  const [narrativeTitle, setNarrativeTitle] = useState('');
  const [narrativeDefinition, setNarrativeDefinition] = useState('');
  const [coreIssueTitle, setCoreIssueTitle] = useState('');
  const [coreIssueDefinition, setCoreIssueDefinition] = useState('');
  const [analysisReady, setAnalysisReady] = useState(false);
  const validatedCustomSectorSignatureRef = useRef<string>('');
  const analysisPackageRef = useRef<AnalysisPackage | null>(null);

  const activeWindow = useAppStore((state) => state.activeWindow);
  const customSectors = useAppStore((state) => state.customSectors);
  const importedEventsBySector = useAppStore((state) => state.importedEventsBySector);
  const setLastActiveSectorId = useAppStore((state) => state.setLastActiveSectorId);
  const ensureSectorTaxonomy = useAppStore((state) => state.ensureSectorTaxonomy);
  const addNarrativeRecord = useAppStore((state) => state.addNarrativeRecord);
  const removeNarrativeRecord = useAppStore((state) => state.removeNarrativeRecord);
  const addCoreVariableRecord = useAppStore((state) => state.addCoreVariableRecord);
  const removeCoreVariableRecord = useAppStore((state) => state.removeCoreVariableRecord);
  const upsertImportedEvent = useAppStore((state) => state.upsertImportedEvent);
  const taxonomy = useAppStore((state) => state.taxonomyBySector[decodedSectorId]);

  const queryClient = useQueryClient();
  const officialRootSectorsQuery = useQuery(getOfficialRootSectorsQueryOptions());

  const activeOfficialSector = useMemo((): SectorTag | null => {
    const activeRoot = (officialRootSectorsQuery.data ?? []).find((sector) => sector.slug === decodedSectorId);
    if (activeRoot) {
      return {
        id: activeRoot.id,
        label: activeRoot.label,
        slug: activeRoot.slug,
        description: activeRoot.description,
      };
    }

    const cachedSubsectorEntries = queryClient.getQueriesData<FrontendCategoryItem[]>({
      queryKey: ['polyinfo', 'official-subsectors'],
    });
    for (const [, subsectors] of cachedSubsectorEntries) {
      const activeSubsector = subsectors?.find((sector) => sector.slug === decodedSectorId);
      if (activeSubsector) {
        return {
          id: activeSubsector.id,
          label: activeSubsector.label,
          slug: activeSubsector.slug,
          parentSlug: activeSubsector.parentSlug,
          displayedCount: activeSubsector.displayedCount,
        };
      }
    }

    return null;
  }, [decodedSectorId, officialRootSectorsQuery.data, queryClient]);
  const activeCustomSector = customSectors[decodedSectorId] ?? null;
  const isCustomSector = Boolean(activeCustomSector);
  const activeImportedEvents = importedEventsBySector[decodedSectorId] ?? [];
  const activeImportedMarkets = useMemo(
    () => collectImportedMarkets(activeImportedEvents.filter((event) => event.staleState === 'active')),
    [activeImportedEvents],
  );
  const marketDataRequested = marketDataRequestedBySector[decodedSectorId] ?? false;

  useEffect(() => {
    if (!decodedSectorId) {
      return;
    }
    ensureSectorTaxonomy(decodedSectorId);
    setLastActiveSectorId(decodedSectorId);
    analysisPackageRef.current = null;
    setAnalysisReady(false);
  }, [decodedSectorId, ensureSectorTaxonomy, setLastActiveSectorId]);

  useEffect(() => {
    if (!decodedSectorId) {
      return;
    }
    setShowNarrativeForm(false);
    setShowCoreIssueForm(false);
    setNarrativeTitle('');
    setNarrativeDefinition('');
    setCoreIssueTitle('');
    setCoreIssueDefinition('');
  }, [decodedSectorId]);

  useEffect(() => {
    if (!isCustomSector) {
      validatedCustomSectorSignatureRef.current = '';
      return;
    }
    const signature = activeImportedEvents.map((event) => `${event.id}:${event.cachedEventPayload.slug}`).join('|');
    if (!signature || validatedCustomSectorSignatureRef.current === signature) {
      return;
    }
    validatedCustomSectorSignatureRef.current = signature;
    let cancelled = false;
    void (async () => {
      const validatedEvents = await Promise.all(activeImportedEvents.map((event) => validateImportedEventRecord(event)));
      if (cancelled) {
        return;
      }
      validatedEvents.forEach((event) => upsertImportedEvent(decodedSectorId, event));
    })();
    return () => {
      cancelled = true;
    };
  }, [activeImportedEvents, decodedSectorId, isCustomSector, upsertImportedEvent]);

  const overlay = taxonomy ?? {
    narratives: [],
    coreVariables: [],
  };

  const activeSectorMeta = activeCustomSector
    ? { id: activeCustomSector.id, label: activeCustomSector.title, description: '自建 sector 使用本地缓存的 event 集合，进入后会校验上游是否已过期。' }
    : activeOfficialSector
      ? { id: activeOfficialSector.slug, label: activeOfficialSector.label, description: activeOfficialSector.description ?? '官方 sector 直接继承 Polymarket 的前台分类。' }
      : null;

  if (!decodedSectorId) {
    return <Navigate to="/" replace />;
  }

  if (officialRootSectorsQuery.isLoading && !activeCustomSector) {
    return (
      <div className="polyinfo-surface rounded-2xl p-6 text-sm text-slate-300">
        正在读取 sector…
      </div>
    );
  }

  if (officialRootSectorsQuery.isError && !activeCustomSector) {
    return (
      <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-6 text-sm text-rose-100">
        <p>读取官方 sector 失败：{officialRootSectorsQuery.error instanceof Error ? officialRootSectorsQuery.error.message : 'unknown error'}</p>
        <button
          type="button"
          disabled={officialRootSectorsQuery.isFetching}
          onClick={() => {
            void officialRootSectorsQuery.refetch();
          }}
          className="mt-4 rounded-full bg-white/10 px-3 py-2 text-xs text-white hover:bg-white/15 disabled:opacity-50"
        >
          {officialRootSectorsQuery.isFetching ? '重试中…' : '重试'}
        </button>
      </div>
    );
  }

  if (!activeOfficialSector && !activeCustomSector) {
    return (
      <div className="polyinfo-surface rounded-2xl p-6 text-sm text-slate-300">
        找不到这个 sector。
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 gap-3 overflow-hidden xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="polyinfo-surface flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b polyinfo-hairline px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.16em] text-teal-200/60">Sector workspace</p>
              <h1 className="mt-1 truncate text-[1.7rem] font-semibold text-white">{activeSectorMeta?.label}</h1>
            </div>
            <span className="rounded-xl bg-teal-300/12 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-teal-100">
              {isCustomSector ? 'Custom' : 'Active'}
            </span>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">System Status</p>
            <p className="text-sm text-slate-200">
              {marketDataRequested
                ? (analysisReady ? 'Prices ready' : 'Loading prices…')
                : 'Event feed ready'}
            </p>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-5">
          <div className="grid h-[232px] shrink-0 gap-4 overflow-hidden xl:grid-cols-2">
            <section className="flex min-h-0 flex-col overflow-hidden">
              <div className="mb-2 flex shrink-0 items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Core Variables</p>
                  <button
                    type="button"
                    onClick={() => setShowCoreIssueForm((current) => !current)}
                    className="rounded-md border border-white/10 px-1.5 py-0.5 text-xs text-slate-400 hover:border-teal-300/30 hover:text-teal-100"
                  >
                    +
                  </button>
                </div>
                <span className="text-[9px] text-slate-500">Critical Logic Nodes</span>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto border-l polyinfo-hairline pl-3 pr-1">
                {overlay.coreVariables.map((item) => (
                  <StructureCard
                    key={item.id}
                    eyebrow="Active Node"
                    title={item.title}
                    description={item.definition}
                    onDelete={() => removeCoreVariableRecord(decodedSectorId, item.id)}
                  />
                ))}
                {overlay.coreVariables.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] px-3 py-4 text-[12px] text-slate-500">
                    还没有 core issue。
                  </div>
                ) : null}
                {showCoreIssueForm ? (
                  <div className="rounded-lg border border-teal-300/25 bg-teal-300/10 p-3">
                    <input
                      value={coreIssueTitle}
                      onChange={(event) => setCoreIssueTitle(event.target.value)}
                      placeholder="Core issue 标题"
                      className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-2.5 py-1.5 text-[12px] text-white outline-none focus:border-teal-300/50"
                    />
                    <textarea
                      value={coreIssueDefinition}
                      onChange={(event) => setCoreIssueDefinition(event.target.value)}
                      rows={3}
                      placeholder="一句定义"
                      className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/70 px-2.5 py-1.5 text-[12px] text-white outline-none focus:border-teal-300/50"
                    />
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (!coreIssueTitle.trim() || !coreIssueDefinition.trim()) {
                            return;
                          }
                          addCoreVariableRecord(decodedSectorId, {
                            title: coreIssueTitle,
                            definition: coreIssueDefinition,
                          });
                          setCoreIssueTitle('');
                          setCoreIssueDefinition('');
                          setShowCoreIssueForm(false);
                        }}
                        className="rounded-md bg-teal-300 px-2.5 py-1.5 text-xs font-medium text-slate-950"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowCoreIssueForm(false)}
                        className="rounded-md bg-white/[0.06] px-2.5 py-1.5 text-xs text-slate-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="flex min-h-0 flex-col overflow-hidden">
              <div className="mb-2 flex shrink-0 items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Active Narratives</p>
                  <button
                    type="button"
                    onClick={() => setShowNarrativeForm((current) => !current)}
                    className="rounded-md border border-white/10 px-1.5 py-0.5 text-xs text-slate-400 hover:border-teal-300/30 hover:text-teal-100"
                  >
                    +
                  </button>
                </div>
                <span className="text-[9px] text-slate-500 italic">Market Context</span>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto border-l polyinfo-hairline pl-3 pr-1">
                {overlay.narratives.map((item) => (
                  <StructureCard
                    key={item.id}
                    eyebrow="Narrative"
                    title={item.title}
                    description={item.definition}
                    onDelete={() => removeNarrativeRecord(decodedSectorId, item.id)}
                  />
                ))}
                {overlay.narratives.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] px-3 py-4 text-[12px] text-slate-500">
                    还没有 narrative。
                  </div>
                ) : null}
                {showNarrativeForm ? (
                  <div className="rounded-lg border border-teal-300/25 bg-teal-300/10 p-3">
                    <input
                      value={narrativeTitle}
                      onChange={(event) => setNarrativeTitle(event.target.value)}
                      placeholder="Narrative 标题"
                      className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-2.5 py-1.5 text-[12px] text-white outline-none focus:border-teal-300/50"
                    />
                    <textarea
                      value={narrativeDefinition}
                      onChange={(event) => setNarrativeDefinition(event.target.value)}
                      rows={3}
                      placeholder="一句定义"
                      className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/70 px-2.5 py-1.5 text-[12px] text-white outline-none focus:border-teal-300/50"
                    />
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (!narrativeTitle.trim() || !narrativeDefinition.trim()) {
                            return;
                          }
                          addNarrativeRecord(decodedSectorId, {
                            title: narrativeTitle,
                            definition: narrativeDefinition,
                          });
                          setNarrativeTitle('');
                          setNarrativeDefinition('');
                          setShowNarrativeForm(false);
                        }}
                        className="rounded-md bg-teal-300 px-2.5 py-1.5 text-xs font-medium text-slate-950"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowNarrativeForm(false)}
                        className="rounded-md bg-white/[0.06] px-2.5 py-1.5 text-xs text-slate-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          <MarketBoardPanel
            sectorId={decodedSectorId}
            activeOfficialSector={activeOfficialSector}
            activeSectorMeta={activeSectorMeta}
            activeImportedEvents={activeImportedEvents}
            activeImportedMarkets={activeImportedMarkets}
            isCustomSector={isCustomSector}
            marketDataRequested={marketDataRequested}
            activeWindow={activeWindow}
            overlay={overlay}
            onRequestMarketData={() => {
              setMarketDataRequestedBySector((current) => ({
                ...current,
                [decodedSectorId]: true,
              }));
            }}
            onAnalysisReadyChange={setAnalysisReady}
            analysisPackageRef={analysisPackageRef}
          />
        </div>
      </div>

      <AnalystSidebar
        sectorId={decodedSectorId}
        sectorLabel={activeSectorMeta?.label ?? decodedSectorId}
        activeWindow={activeWindow}
        marketDataRequested={marketDataRequested}
        analysisReady={analysisReady}
        overlay={overlay}
        analysisPackageRef={analysisPackageRef}
      />
    </div>
  );
}
