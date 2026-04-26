import { useAppStore } from '@renderer/app-shell/app-store.js';
import type {
  AnalysisPackageMarket,
  AnalystMessage,
  PreparedMarket,
} from '@renderer/data/types.js';

export type OfficialEventCard = {
  id: string;
  sourceEventId: string;
  title: string;
  eventSlug?: string;
  markets: PreparedMarket[];
  staleState: 'active';
  staleReason?: string;
};

export function formatProbability(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
export function formatDelta(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
}
export function getDeltaTone(value: number): string {
  if (value > 0) return 'text-emerald-300';
  if (value < 0) return 'text-rose-300';
  return 'text-slate-400';
}
export function formatCompactMoney(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(0);
}
export function isStaleRuntimeBridgeError(message: string | null | undefined): boolean {
  const normalized = String(message || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized.includes('tauri-ipc transport is unavailable')
    || normalized.includes('missing window.__tauri__.event.listen')
    || normalized.includes('command open_external_url not found');
}
export function createMessage(role: AnalystMessage['role'], content: string, id?: string): AnalystMessage {
  return {
    id: id ?? `${role}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    role,
    content,
    createdAt: Date.now(),
    status: role === 'assistant' ? 'streaming' : 'complete',
  };
}
export function ProposalCard({ sectorSlug }: { sectorSlug: string }) {
  const draftProposal = useAppStore((state) => state.chatsBySector[sectorSlug]?.draftProposal ?? null);
  const confirmDraft = useAppStore((state) => state.confirmSectorDraftProposal);
  const dismissDraft = useAppStore((state) => state.dismissSectorDraftProposal);
  if (!draftProposal) {
    return null;
  }
  return (
    <div className="rounded-lg border border-teal-300/25 bg-teal-300/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-teal-200">Pending Change</p>
          <h3 className="mt-1 text-[13px] font-medium text-white">{draftProposal.title}</h3>
        </div>
        <span className="rounded-full bg-white/10 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-slate-200">
          {draftProposal.action}
        </span>
      </div>
      {draftProposal.definition ? (
        <p className="mt-2 text-sm leading-6 text-slate-200">{draftProposal.definition}</p>
      ) : null}
      {draftProposal.note ? (
        <p className="mt-2 text-xs leading-5 text-slate-300">{draftProposal.note}</p>
      ) : null}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => confirmDraft(sectorSlug)}
          className="rounded-lg bg-teal-300 px-3 py-2 text-xs font-medium text-slate-950 hover:bg-teal-200"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={() => dismissDraft(sectorSlug)}
          className="rounded-lg bg-white/8 px-3 py-2 text-xs text-slate-300 hover:bg-white/12"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
export function summarizeEventLogic(input: {
  eventMarkets: PreparedMarket[];
  analysisMarketsById: Map<string, AnalysisPackageMarket>;
  overlay: { narratives: Array<{ title: string }>; coreVariables: Array<{ title: string }> };
}): { narrativeTitle?: string; coreIssueTitle?: string } {
  const { eventMarkets, analysisMarketsById, overlay } = input;
  for (const market of eventMarkets) {
    const analyzedMarket = analysisMarketsById.get(market.id);
    if (analyzedMarket?.narrativeTitle || analyzedMarket?.coreVariableTitles[0]) {
      return {
        narrativeTitle: analyzedMarket.narrativeTitle,
        coreIssueTitle: analyzedMarket.coreVariableTitles[0],
      };
    }
  }
  return {
    narrativeTitle: overlay.narratives[0]?.title,
    coreIssueTitle: overlay.coreVariables[0]?.title,
  };
}
export function groupOfficialEvents(markets: PreparedMarket[]): OfficialEventCard[] {
  const groups = new Map<string, OfficialEventCard>();
  for (const market of markets) {
    const key = market.eventId || market.eventTitle;
    const existing = groups.get(key);
    if (existing) {
      existing.markets.push(market);
      continue;
    }
    groups.set(key, {
      id: key,
      sourceEventId: key,
      title: market.eventTitle,
      eventSlug: market.eventSlug,
      markets: [market],
      staleState: 'active',
    });
  }
  return [...groups.values()];
}
