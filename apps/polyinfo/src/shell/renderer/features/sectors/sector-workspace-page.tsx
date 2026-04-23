import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import { getOfficialSectorCatalogQueryOptions } from '@renderer/app-shell/official-sector-query.js';
import {
  validateImportedEventRecord,
  type MarketConnectionState,
} from '@renderer/data/polymarket.js';
import type {
  AnalysisPackage,
  ImportedEventRecord,
  PreparedMarket,
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
    <div className="group relative rounded-xl border border-white/10 bg-slate-950/75 px-4 py-4">
      <button
        type="button"
        onClick={onDelete}
        className="absolute right-3 top-3 rounded-full bg-white/[0.05] px-2 py-1 text-[11px] text-slate-300 opacity-0 transition-opacity hover:bg-rose-400/12 hover:text-rose-100 group-hover:opacity-100"
      >
        Delete
      </button>
      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{eyebrow}</p>
      <p className="mt-3 text-[1.02rem] font-semibold text-white">{title}</p>
      <p className="mt-2 text-[13px] leading-6 text-slate-400">{description}</p>
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
  const [connectionStatus, setConnectionStatus] = useState<MarketConnectionState>('closed');
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

  const officialSectorsQuery = useQuery(getOfficialSectorCatalogQueryOptions());

  const activeOfficialSector = useMemo(
    () => (officialSectorsQuery.data ?? []).find((sector) => sector.slug === decodedSectorId) ?? null,
    [decodedSectorId, officialSectorsQuery.data],
  );
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
    setConnectionStatus('closed');
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

  if (officialSectorsQuery.isLoading && !activeCustomSector) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-300">
        正在读取 sector…
      </div>
    );
  }

  if (officialSectorsQuery.isError && !activeCustomSector) {
    return (
      <div className="rounded-3xl border border-rose-400/20 bg-rose-400/10 p-6 text-sm text-rose-100">
        <p>读取官方 sector 失败：{officialSectorsQuery.error instanceof Error ? officialSectorsQuery.error.message : 'unknown error'}</p>
        <button
          type="button"
          onClick={() => {
            void officialSectorsQuery.refetch();
          }}
          className="mt-4 rounded-full bg-white/10 px-3 py-2 text-xs text-white hover:bg-white/15"
        >
          重试
        </button>
      </div>
    );
  }

  if (!activeOfficialSector && !activeCustomSector) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-300">
        找不到这个 sector。
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 gap-2 overflow-hidden xl:grid-cols-[minmax(0,1fr)_352px]">
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/60">
        <div className="flex items-center justify-between border-b border-white/8 px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-[1.85rem] font-semibold text-white">{activeSectorMeta?.label} Analysis</h1>
            <span className="rounded-full bg-emerald-400/12 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-emerald-200">
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

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-5">
          <div className="grid gap-4 xl:grid-cols-2">
            <section>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Core Variables</p>
                  <button
                    type="button"
                    onClick={() => setShowCoreIssueForm((current) => !current)}
                    className="text-sm text-slate-400 hover:text-sky-200"
                  >
                    +
                  </button>
                </div>
                <span className="text-[10px] text-slate-500">Critical Logic Nodes</span>
              </div>
              <div className="space-y-3">
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
                  <div className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-[13px] text-slate-500">
                    还没有 core issue。
                  </div>
                ) : null}
                {showCoreIssueForm ? (
                  <div className="rounded-xl border border-sky-300/25 bg-sky-300/10 p-4">
                    <input
                      value={coreIssueTitle}
                      onChange={(event) => setCoreIssueTitle(event.target.value)}
                      placeholder="Core issue 标题"
                      className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-[13px] text-white outline-none"
                    />
                    <textarea
                      value={coreIssueDefinition}
                      onChange={(event) => setCoreIssueDefinition(event.target.value)}
                      rows={3}
                      placeholder="一句定义"
                      className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-[13px] text-white outline-none"
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
                        className="rounded-full bg-sky-300 px-3 py-2 text-xs font-medium text-slate-950"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowCoreIssueForm(false)}
                        className="rounded-full bg-white/[0.06] px-3 py-2 text-xs text-slate-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Active Narratives</p>
                  <button
                    type="button"
                    onClick={() => setShowNarrativeForm((current) => !current)}
                    className="text-sm text-slate-400 hover:text-sky-200"
                  >
                    +
                  </button>
                </div>
                <span className="text-[10px] text-slate-500 italic">Market Context</span>
              </div>
              <div className="space-y-3">
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
                  <div className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-[13px] text-slate-500">
                    还没有 narrative。
                  </div>
                ) : null}
                {showNarrativeForm ? (
                  <div className="rounded-xl border border-sky-300/25 bg-sky-300/10 p-4">
                    <input
                      value={narrativeTitle}
                      onChange={(event) => setNarrativeTitle(event.target.value)}
                      placeholder="Narrative 标题"
                      className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-[13px] text-white outline-none"
                    />
                    <textarea
                      value={narrativeDefinition}
                      onChange={(event) => setNarrativeDefinition(event.target.value)}
                      rows={3}
                      placeholder="一句定义"
                      className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-[13px] text-white outline-none"
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
                        className="rounded-full bg-sky-300 px-3 py-2 text-xs font-medium text-slate-950"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowNarrativeForm(false)}
                        className="rounded-full bg-white/[0.06] px-3 py-2 text-xs text-slate-300"
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
            onConnectionStatusChange={setConnectionStatus}
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
        connectionStatus={connectionStatus}
        analysisPackageRef={analysisPackageRef}
      />
    </div>
  );
}
