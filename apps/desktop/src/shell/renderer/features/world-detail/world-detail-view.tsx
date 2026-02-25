import { useState } from 'react';
import type { WorldData } from './world-detail-model';
import {
  formatWorldDate,
  formatWorldDateTime,
  getStatusBadgeStyle,
  getTransitStatusBadgeStyle,
  getWorldInitial,
} from './world-detail-model';

type WorldTransitAgentOption = {
  id: string;
  displayName: string;
  worldId: string | null;
};

type WorldTransitCheckpointStatus = 'PASSED' | 'FAILED' | 'SKIPPED';

type WorldTransitSessionData = {
  startedAt: string;
  endedAt?: string;
  reason?: string;
  checkpoints?: Array<{
    name: string;
    timestamp: string;
    status: WorldTransitCheckpointStatus;
  }>;
};

type WorldTransitDetail = {
  id: string;
  transitType: 'INBOUND' | 'OUTBOUND' | 'RETURN';
  status: 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
  fromWorldId: string | null;
  toWorldId: string;
  departedAt: string;
  arrivedAt: string | null;
  sessionData: WorldTransitSessionData | null;
};

type WorldSceneQuota = {
  used: number;
  quota: number;
  tier: 'FREE' | 'PRO' | 'MAX';
};

type WorldLevelAuditItem = {
  id: string;
  eventType: string;
  reasonCode: string | null;
  occurredAt: string;
};

type WorldTransitRuntimeViewModel = {
  loading: boolean;
  mutating: boolean;
  selectedAgentId: string;
  agents: WorldTransitAgentOption[];
  sceneQuota: WorldSceneQuota | null;
  activeTransit: WorldTransitDetail | null;
  history: WorldTransitDetail[];
  audits: WorldLevelAuditItem[];
  operationError: string | null;
  onSelectAgent: (agentId: string) => void;
  onStartTransit: () => void;
  onStartSession: () => void;
  onCompleteTransit: () => void;
  onAbandonTransit: () => void;
  onAddCheckpoint: (input: { name: string; status: WorldTransitCheckpointStatus }) => void;
  onRefresh: () => void;
};

type WorldDetailViewProps = {
  world: WorldData;
  loading: boolean;
  error: boolean;
  transitRuntime: WorldTransitRuntimeViewModel;
  onBack: () => void;
  onRetry?: () => void;
};

function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-10 shrink-0 text-right text-xs font-medium text-gray-500">{label}</span>
      <div className="h-2 flex-1 rounded-full bg-gray-100">
        <div
          className="h-2 rounded-full bg-brand-400"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-12 text-xs text-gray-500">{value.toFixed(1)}</span>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center rounded-[10px] border border-gray-200 bg-white px-4 py-3">
      <span className="text-lg font-semibold text-gray-900">{value}</span>
      <span className="mt-0.5 text-[11px] text-gray-500">{label}</span>
    </div>
  );
}

function renderQuotaText(quota: WorldSceneQuota | null): string {
  if (!quota) return '--';
  return `${quota.used}/${quota.quota} (${quota.tier})`;
}

function TransitStatusBadge({ status }: { status: WorldTransitDetail['status'] }) {
  const style = getTransitStatusBadgeStyle(status);
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}>
      {status}
    </span>
  );
}

export function WorldDetailView(props: WorldDetailViewProps) {
  const [checkpointName, setCheckpointName] = useState('');
  const [checkpointStatus, setCheckpointStatus] = useState<WorldTransitCheckpointStatus>('PASSED');

  if (props.loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
        Loading world details...
      </div>
    );
  }

  if (props.error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-600">Failed to load world details</p>
        {props.onRetry ? (
          <button
            type="button"
            onClick={props.onRetry}
            className="rounded-[10px] bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            Retry
          </button>
        ) : null}
        <button
          type="button"
          onClick={props.onBack}
          className="rounded-[10px] bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
        >
          Go Back
        </button>
      </div>
    );
  }

  const { world } = props;
  const statusStyle = getStatusBadgeStyle(world.status);
  const transit = props.transitRuntime;
  const activeCheckpoints = transit.activeTransit?.sessionData?.checkpoints || [];
  const canStartTransit = Boolean(
    transit.selectedAgentId
    && !transit.activeTransit
    && !transit.loading
    && !transit.mutating,
  );
  const canStartSession = Boolean(
    transit.activeTransit
    && !transit.activeTransit.sessionData?.startedAt
    && !transit.mutating,
  );
  const canCompleteOrAbandon = Boolean(transit.activeTransit && !transit.mutating);
  const canAddCheckpoint = Boolean(
    transit.activeTransit
    && checkpointName.trim()
    && !transit.mutating,
  );
  const auditRows = transit.audits.slice(0, 6);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-6">
        <button
          type="button"
          onClick={props.onBack}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="text-lg font-semibold tracking-tight text-gray-900">World</h1>
      </div>

      <div className="flex-1 overflow-y-auto bg-gray-50">
        {/* Banner */}
        {world.bannerUrl ? (
          <div className="h-40 w-full overflow-hidden">
            <img src={world.bannerUrl} alt={world.name} className="h-full w-full object-cover" />
          </div>
        ) : (
          <div className="h-40 w-full" style={{ background: 'linear-gradient(135deg, #0e7490, #6366f1)' }} />
        )}

        <div className="mx-auto max-w-2xl px-6">
          {/* World Header - overlaps banner */}
          <div className="-mt-12 flex flex-col items-center rounded-[10px] border border-gray-200 bg-white px-6 pt-0 pb-6">
            <div className="-mt-10 mb-4">
              {world.iconUrl ? (
                <img
                  src={world.iconUrl}
                  alt={world.name}
                  className="h-20 w-20 rounded-[16px] border-4 border-white object-cover shadow-sm"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-[16px] border-4 border-white bg-brand-100 text-2xl font-bold text-brand-700 shadow-sm">
                  {getWorldInitial(world.name)}
                </div>
              )}
            </div>

            <h2 className="text-xl font-semibold tracking-tight text-gray-900">{world.name}</h2>

            {/* Badges */}
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><circle cx="4" cy="4" r="4" /></svg>
                {world.status}
              </span>
              <span className="inline-flex items-center rounded-full border border-brand-200 bg-brand-100 px-2.5 py-0.5 text-xs font-medium text-brand-700">
                {world.type === 'MAIN' ? 'Main World' : 'Sub World'}
              </span>
              <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                Lv.{world.level}
              </span>
              {world.freezeReason ? (
                <span className="inline-flex items-center rounded-full border border-red-200 bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                  Frozen: {world.freezeReason}
                </span>
              ) : null}
            </div>

            {world.description ? (
              <p className="mt-4 max-w-lg text-center text-sm text-gray-600">{world.description}</p>
            ) : null}
          </div>

          {/* Stats Grid */}
          <div className="mt-4 grid grid-cols-4 gap-3">
            <MetaItem label="Agents" value={world.agentCount} />
            <MetaItem label="Agent Limit" value={world.nativeAgentLimit} />
            <MetaItem label="Transit Limit" value={world.transitInLimit} />
            <MetaItem label="Time Flow" value={`${world.timeFlowRatio}x`} />
          </div>

          {/* Governance Scores (Q/C/A/E) */}
          <div className="mt-4 rounded-[10px] border border-gray-200 bg-white px-6 py-4">
            <h3 className="text-sm font-semibold text-gray-700">Governance Scores</h3>
            <div className="mt-3 flex flex-col gap-2.5">
              <ScoreBar label="Q" value={world.scores.q} max={100} />
              <ScoreBar label="C" value={world.scores.c} max={100} />
              <ScoreBar label="A" value={world.scores.a} max={100} />
              <ScoreBar label="E" value={world.scores.e} max={100} />
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-2">
              <span className="text-xs text-gray-500">EWMA Score</span>
              <span className="text-sm font-semibold text-gray-900">{world.scores.ewma.toFixed(2)}</span>
            </div>
          </div>

          {/* World Config */}
          <div className="mt-4 rounded-[10px] border border-gray-200 bg-white px-6 py-4">
            <h3 className="text-sm font-semibold text-gray-700">Configuration</h3>
            <div className="mt-2 divide-y divide-gray-100">
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-gray-500">Native Creation</span>
                <span className={`text-sm font-medium ${world.nativeCreationState === 'OPEN' ? 'text-green-600' : 'text-red-600'}`}>
                  {world.nativeCreationState === 'OPEN' ? 'Open' : 'Frozen'}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-gray-500">Lorebook Limit</span>
                <span className="text-sm font-medium text-gray-900">{world.lorebookEntryLimit}</span>
              </div>
              {world.createdAt ? (
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-gray-500">Created</span>
                  <span className="text-sm font-medium text-gray-900">{formatWorldDate(world.createdAt)}</span>
                </div>
              ) : null}
            </div>
          </div>

          {/* Worldview */}
          <div className="mt-4 rounded-[10px] border border-gray-200 bg-white px-6 py-4">
            <h3 className="text-sm font-semibold text-gray-700">Worldview</h3>
            {!world.hasWorldview ? (
              <p className="mt-2 text-sm text-amber-700">No worldview is bound to this world yet.</p>
            ) : (
              <div className="mt-2 divide-y divide-gray-100">
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-gray-500">Lifecycle</span>
                  <span className="text-sm font-medium text-gray-900">{world.worldviewLifecycle || 'Unknown'}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-gray-500">Version</span>
                  <span className="text-sm font-medium text-gray-900">{world.worldviewVersion ?? '--'}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-gray-500">Modules</span>
                  <span className="text-sm font-medium text-gray-900">{world.worldviewModuleCount}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-gray-500">Events</span>
                  <span className="text-sm font-medium text-gray-900">{world.worldviewEventCount}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-gray-500">Snapshots</span>
                  <span className="text-sm font-medium text-gray-900">{world.worldviewSnapshotCount}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-gray-500">Latest Event</span>
                  <span className="text-sm font-medium text-gray-900">
                    {world.latestWorldviewEventAt ? formatWorldDate(world.latestWorldviewEventAt) : '--'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Transit Runtime */}
          <div className="mt-4 rounded-[10px] border border-gray-200 bg-white px-6 py-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">Transit Protocol</h3>
              <button
                type="button"
                onClick={transit.onRefresh}
                className="rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"
                disabled={transit.loading || transit.mutating}
              >
                Refresh
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <MetaItem label="Scene Quota" value={renderQuotaText(transit.sceneQuota)} />
              <MetaItem label="Transit History" value={transit.history.length} />
            </div>

            <div className="mt-3 flex flex-col gap-2">
              <label className="text-xs font-medium text-gray-600">Carrier Agent</label>
              <select
                value={transit.selectedAgentId}
                onChange={(event) => transit.onSelectAgent(event.target.value)}
                className="h-9 rounded-[10px] border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                disabled={transit.loading || transit.mutating || transit.agents.length <= 0}
              >
                {transit.agents.length <= 0 ? (
                  <option value="">No available agents</option>
                ) : null}
                {transit.agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.displayName}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={transit.onStartTransit}
                disabled={!canStartTransit}
                className="rounded-[10px] bg-brand-500 px-3 py-2 text-xs font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                Start Transit
              </button>
              <button
                type="button"
                onClick={transit.onStartSession}
                disabled={!canStartSession}
                className="rounded-[10px] bg-blue-500 px-3 py-2 text-xs font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                Start Session
              </button>
              <button
                type="button"
                onClick={transit.onCompleteTransit}
                disabled={!canCompleteOrAbandon}
                className="rounded-[10px] bg-emerald-500 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                Complete
              </button>
              <button
                type="button"
                onClick={transit.onAbandonTransit}
                disabled={!canCompleteOrAbandon}
                className="rounded-[10px] bg-rose-500 px-3 py-2 text-xs font-medium text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                Abandon
              </button>
            </div>

            {transit.activeTransit ? (
              <div className="mt-4 rounded-[10px] border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-gray-800">Active Transit</div>
                  <TransitStatusBadge status={transit.activeTransit.status} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-600">
                  <span>Type: {transit.activeTransit.transitType}</span>
                  <span>Departed: {formatWorldDateTime(transit.activeTransit.departedAt)}</span>
                  <span>Arrived: {formatWorldDateTime(transit.activeTransit.arrivedAt)}</span>
                  <span>From: {transit.activeTransit.fromWorldId || '--'}</span>
                </div>

                <div className="mt-3 flex flex-col gap-2">
                  <label className="text-xs font-medium text-gray-600">Checkpoint</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={checkpointName}
                      onChange={(event) => setCheckpointName(event.target.value)}
                      placeholder="checkpoint name"
                      className="h-9 min-w-[180px] rounded-[10px] border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    />
                    <select
                      value={checkpointStatus}
                      onChange={(event) => setCheckpointStatus(event.target.value as WorldTransitCheckpointStatus)}
                      className="h-9 rounded-[10px] border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    >
                      <option value="PASSED">PASSED</option>
                      <option value="FAILED">FAILED</option>
                      <option value="SKIPPED">SKIPPED</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        transit.onAddCheckpoint({
                          name: checkpointName.trim(),
                          status: checkpointStatus,
                        });
                        setCheckpointName('');
                      }}
                      disabled={!canAddCheckpoint}
                      className="rounded-[10px] bg-gray-800 px-3 py-2 text-xs font-medium text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:bg-gray-300"
                    >
                      Add Checkpoint
                    </button>
                  </div>
                </div>

                {activeCheckpoints.length > 0 ? (
                  <div className="mt-3 space-y-1.5">
                    {activeCheckpoints.slice(-5).map((checkpoint) => (
                      <div key={`${checkpoint.timestamp}-${checkpoint.name}`} className="flex items-center justify-between rounded-md bg-white px-2.5 py-1.5 text-xs">
                        <span className="font-medium text-gray-700">{checkpoint.name}</span>
                        <span className="text-gray-500">{checkpoint.status} · {formatWorldDateTime(checkpoint.timestamp)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-xs text-gray-500">
                No active transit. Start one to enforce `ACTIVE to COMPLETED/ABANDONED` lifecycle.
              </p>
            )}

            {transit.operationError ? (
              <p className="mt-3 text-xs text-rose-600">{transit.operationError}</p>
            ) : null}
          </div>

          {/* World Level Audit */}
          <div className="mt-4 rounded-[10px] border border-gray-200 bg-white px-6 py-4">
            <h3 className="text-sm font-semibold text-gray-700">World Level Audit</h3>
            {auditRows.length <= 0 ? (
              <p className="mt-2 text-xs text-gray-500">No audit records</p>
            ) : (
              <div className="mt-2 space-y-2">
                {auditRows.map((audit) => (
                  <div key={audit.id} className="rounded-[10px] border border-gray-100 bg-gray-50 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-700">{audit.eventType}</span>
                      <span className="text-[11px] text-gray-500">{formatWorldDateTime(audit.occurredAt)}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-gray-500">Reason: {audit.reasonCode || '--'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Lore */}
          {world.lore ? (
            <div className="mt-4 mb-8 rounded-[10px] border border-gray-200 bg-white px-6 py-4">
              <h3 className="text-sm font-semibold text-gray-700">Lore</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">{world.lore}</p>
            </div>
          ) : null}

          {/* Bottom spacer */}
          {!world.lore ? <div className="h-8" /> : null}
        </div>
      </div>
    </div>
  );
}
