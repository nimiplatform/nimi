import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorldData, WorldAgent } from './world-detail-model';
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
  worldAgents: WorldAgent[];
  transitRuntime: WorldTransitRuntimeViewModel;
  onBack: () => void;
  onRetry?: () => void;
};

function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-10 shrink-0 text-right text-xs font-bold text-gray-500">{label}</span>
      <div className="h-2 flex-1 rounded-full bg-gray-100">
        <div
          className="h-2 rounded-full bg-[#4ECCA3]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-12 text-xs font-medium text-gray-600">{value.toFixed(1)}</span>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-white/60 bg-white/40 px-4 py-3 backdrop-blur-xl shadow-[0_4px_16px_rgba(0,0,0,0.04)]">
      <span className="text-lg font-bold text-gray-800">{value}</span>
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
  const { t } = useTranslation();
  const [checkpointName, setCheckpointName] = useState('');
  const [checkpointStatus, setCheckpointStatus] = useState<WorldTransitCheckpointStatus>('PASSED');

  if (props.loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
        {t('WorldDetail.loading')}
      </div>
    );
  }

  if (props.error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-600">{t('WorldDetail.error')}</p>
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
    <div className="flex min-h-0 flex-1 flex-col bg-[#F0F4F8]">
      {/* Top bar - 使用 Profile 风格 */}
      <div className="flex h-14 shrink-0 items-center bg-white/70 px-6 backdrop-blur-xl">
        <h1 className="text-lg font-semibold tracking-tight text-gray-800">World</h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-6">
          {/* 顶部合并的 World 信息卡片 */}
          <div className="relative overflow-hidden rounded-3xl border border-white/60 bg-white/40 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl mb-6">
            <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-[#4ECCA3]/5 pointer-events-none" />
            
            <div className="relative flex gap-6">
              {/* 左侧：头像和主要信息 */}
              <div className="flex flex-col items-center shrink-0 w-48">
                {/* 头像 */}
                <div className="relative">
                  <div className="rounded-3xl bg-gradient-to-br from-[#E0F7F4] to-[#C5F0E8] p-1">
                    {world.iconUrl ? (
                      <img
                        src={world.iconUrl}
                        alt={world.name}
                        className="h-24 w-24 rounded-2xl object-cover"
                      />
                    ) : (
                      <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-gradient-to-br from-[#4ECCA3]/20 to-[#4ECCA3]/5 text-3xl font-bold text-[#4ECCA3]">
                        {getWorldInitial(world.name)}
                      </div>
                    )}
                  </div>
                </div>

                {/* 名称 */}
                <h2 className="mt-4 text-lg font-semibold tracking-tight text-gray-800">{world.name}</h2>
                
                {/* 标签 */}
                <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                    <svg width="6" height="6" viewBox="0 0 8 8" fill="currentColor"><circle cx="4" cy="4" r="4" /></svg>
                    {world.status}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-[#4ECCA3]/10 px-2.5 py-0.5 text-xs font-medium text-[#2A9D8F]">
                    {world.type === 'MAIN' ? t('WorldDetail.mainWorld') : t('WorldDetail.subWorld')}
                  </span>
                </div>

                {/* 等级 */}
                <div className="mt-3 flex items-center gap-2">
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
                    Level {world.level}
                  </span>
                  {world.freezeReason ? (
                    <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">
                      Frozen
                    </span>
                  ) : null}
                </div>
              </div>

              {/* 中间：描述和 About */}
              <div className="flex-1 min-w-0 border-l border-gray-100 pl-6">
                {/* 描述 */}
                {world.description ? (
                  <p className="text-sm text-gray-600 leading-relaxed mb-4">{world.description}</p>
                ) : null}

                {/* Genre / Era / Themes */}
                {(world.genre || world.era || world.themes.length > 0) && (
                  <div className="flex flex-wrap items-center gap-2 mb-4">
                    {world.genre && (
                      <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                        {world.genre}
                      </span>
                    )}
                    {world.era && (
                      <span className="inline-flex items-center rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-medium text-purple-700">
                        {world.era}
                      </span>
                    )}
                    {world.themes.slice(0, 3).map((theme, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700"
                      >
                        {theme}
                      </span>
                    ))}
                    {world.themes.length > 3 && (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                        +{world.themes.length - 3}
                      </span>
                    )}
                  </div>
                )}

                {/* About 信息 */}
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-gray-600">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#4ECCA3] shrink-0">
                      <rect x="3" y="4" width="18" height="18" rx="2" />
                      <path d="M16 2v4M8 2v4M3 10h18" />
                    </svg>
                    <span>Created {formatWorldDate(world.createdAt)}</span>
                  </div>
                  {world.updatedAt && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#4ECCA3] shrink-0">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                      </svg>
                      <span>Updated {formatWorldDate(world.updatedAt)}</span>
                    </div>
                  )}
                  {world.reviewedAt && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#4ECCA3] shrink-0">
                        <path d="M9 12l2 2 4-4" />
                        <circle cx="12" cy="12" r="10" />
                      </svg>
                      <span>
                        Reviewed {formatWorldDate(world.reviewedAt)}
                        {world.reviewedBy && (
                          <span className="text-gray-500"> by {world.reviewedBy.substring(0, 8)}...</span>
                        )}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-gray-600">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#4ECCA3] shrink-0">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    </svg>
                    <span>Native Creation: <span className={world.nativeCreationState === 'OPEN' ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>{world.nativeCreationState === 'OPEN' ? 'Open' : 'Frozen'}</span></span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-600">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#4ECCA3] shrink-0">
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    </svg>
                    <span>Lorebook Limit: {world.lorebookEntryLimit}</span>
                  </div>
                </div>
              </div>

              {/* 右侧：Worldview 信息 */}
              <div className="w-48 shrink-0 border-l border-gray-100 pl-6">
                <h3 className="text-sm font-semibold text-gray-800 mb-3">Worldview</h3>
                {!world.hasWorldview ? (
                  <p className="text-sm text-amber-600">No worldview bound</p>
                ) : (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between text-gray-600">
                      <span>Lifecycle</span>
                      <span className="font-medium text-gray-800">{world.worldviewLifecycle || 'Unknown'}</span>
                    </div>
                    <div className="flex justify-between text-gray-600">
                      <span>Version</span>
                      <span className="font-medium text-gray-800">{world.worldviewVersion ?? '--'}</span>
                    </div>
                    <div className="flex justify-between text-gray-600">
                      <span>Modules</span>
                      <span className="font-medium text-gray-800">{world.worldviewModuleCount}</span>
                    </div>
                    <div className="flex justify-between text-gray-600">
                      <span>Events</span>
                      <span className="font-medium text-gray-800">{world.worldviewEventCount}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 下方内容区 */}
          <div className="space-y-4">
            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-3">
              <MetaItem label="Agents" value={world.agentCount} />
              <MetaItem label="Agent Limit" value={world.nativeAgentLimit} />
              <MetaItem label="Transit Limit" value={world.transitInLimit} />
              <MetaItem label="Time Flow" value={`${world.timeFlowRatio}x`} />
            </div>

            {/* Time Configuration */}
            {(world.clockConfig || world.sceneTimeConfig) && (
              <div className="relative overflow-hidden rounded-3xl border border-white/60 bg-white/40 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
                <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-[#4ECCA3]/5 pointer-events-none" />
                <div className="relative">
                  <h3 className="text-sm font-semibold text-gray-800 mb-4">Time Configuration</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    {world.clockConfig && (
                      <div>
                        <label className="text-xs text-gray-500 uppercase tracking-wider">Clock Config</label>
                        <pre className="mt-2 text-xs bg-white/60 rounded-xl p-3 overflow-auto max-h-40 text-gray-700">
                          {JSON.stringify(world.clockConfig, null, 2)}
                        </pre>
                      </div>
                    )}
                    {world.sceneTimeConfig && (
                      <div>
                        <label className="text-xs text-gray-500 uppercase tracking-wider">Scene Time Config</label>
                        <pre className="mt-2 text-xs bg-white/60 rounded-xl p-3 overflow-auto max-h-40 text-gray-700">
                          {JSON.stringify(world.sceneTimeConfig, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

              {/* Governance Scores (Q/C/A/E) */}
              <div className="relative overflow-hidden rounded-3xl border border-white/60 bg-white/40 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
                <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-[#4ECCA3]/5 pointer-events-none" />
                <div className="relative">
                  <h3 className="text-sm font-semibold text-gray-800 mb-4">Governance Scores</h3>
                  <div className="flex flex-col gap-3">
                    <ScoreBar label="Q" value={world.scores.q} max={100} />
                    <ScoreBar label="C" value={world.scores.c} max={100} />
                    <ScoreBar label="A" value={world.scores.a} max={100} />
                    <ScoreBar label="E" value={world.scores.e} max={100} />
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-gray-100/60 pt-3">
                    <span className="text-xs text-gray-500">EWMA Score</span>
                    <span className="text-sm font-bold text-gray-800">{world.scores.ewma.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* World Agents */}
              <div className="relative overflow-hidden rounded-3xl border border-white/60 bg-white/40 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
                <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-[#4ECCA3]/5 pointer-events-none" />
                <div className="relative">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-gray-800">World Agents</h3>
                    <span className="text-xs text-gray-500">
                      {props.worldAgents.length} / {world.nativeAgentLimit}
                    </span>
                  </div>
                  
                  {props.worldAgents.length === 0 ? (
                    <p className="text-sm text-gray-500">No agents in this world</p>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {props.worldAgents.map((agent) => (
                        <div
                          key={agent.id}
                          className="flex items-center gap-3 p-2 rounded-xl border border-white/60 bg-white/60 hover:bg-white/80 transition-colors"
                        >
                          {agent.avatarUrl ? (
                            <img
                              src={agent.avatarUrl}
                              alt={agent.displayName}
                              className="h-10 w-10 rounded-xl object-cover"
                            />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#4ECCA3]/20 to-[#4ECCA3]/5 text-sm font-bold text-[#4ECCA3]">
                              {agent.displayName.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-800 truncate">
                                {agent.displayName}
                              </span>
                              {agent.tier && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600">
                                  {agent.tier}
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-gray-500">@{agent.handle}</span>
                          </div>
                          {agent.isPublic && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-50 text-green-600">
                              Public
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Transit Runtime */}
              <div className="relative overflow-hidden rounded-3xl border border-white/60 bg-white/40 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
                <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-[#4ECCA3]/5 pointer-events-none" />
                <div className="relative">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-800">Transit Protocol</h3>
                    <button
                      type="button"
                      onClick={transit.onRefresh}
                      className="rounded-lg bg-white/60 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-white/80 border border-white/60"
                      disabled={transit.loading || transit.mutating}
                    >
                      Refresh
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <MetaItem label="Scene Quota" value={renderQuotaText(transit.sceneQuota)} />
                    <MetaItem label="Transit History" value={transit.history.length} />
                  </div>

                  <div className="mt-4 flex flex-col gap-2">
                    <label className="text-xs font-medium text-gray-600">Carrier Agent</label>
                    <select
                      value={transit.selectedAgentId}
                      onChange={(event) => transit.onSelectAgent(event.target.value)}
                      className="h-10 rounded-xl border border-gray-200/60 bg-white/60 px-3 text-sm text-gray-800 outline-none focus:border-[#4ECCA3] focus:ring-1 focus:ring-[#4ECCA3]/30"
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

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={transit.onStartTransit}
                      disabled={!canStartTransit}
                      className="rounded-xl bg-[#4ECCA3] px-4 py-2 text-xs font-medium text-white shadow-[0_4px_14px_rgba(78,204,163,0.35)] hover:bg-[#3DBA92] hover:shadow-[0_6px_20px_rgba(78,204,163,0.45)] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none transition-all"
                    >
                      Start Transit
                    </button>
                    <button
                      type="button"
                      onClick={transit.onStartSession}
                      disabled={!canStartSession}
                      className="rounded-xl bg-blue-500 px-4 py-2 text-xs font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300 transition-all"
                    >
                      Start Session
                    </button>
                    <button
                      type="button"
                      onClick={transit.onCompleteTransit}
                      disabled={!canCompleteOrAbandon}
                      className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-gray-300 transition-all"
                    >
                      Complete
                    </button>
                    <button
                      type="button"
                      onClick={transit.onAbandonTransit}
                      disabled={!canCompleteOrAbandon}
                      className="rounded-xl bg-rose-500 px-4 py-2 text-xs font-medium text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-gray-300 transition-all"
                    >
                      Abandon
                    </button>
                  </div>

                  {transit.activeTransit ? (
                    <div className="mt-4 rounded-xl border border-white/60 bg-white/60 px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold text-gray-800">Active Transit</div>
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
                            className="h-10 min-w-[180px] rounded-xl border border-gray-200/60 bg-white/60 px-3 text-sm text-gray-800 outline-none focus:border-[#4ECCA3] focus:ring-1 focus:ring-[#4ECCA3]/30"
                          />
                          <select
                            value={checkpointStatus}
                            onChange={(event) => setCheckpointStatus(event.target.value as WorldTransitCheckpointStatus)}
                            className="h-10 rounded-xl border border-gray-200/60 bg-white/60 px-3 text-sm text-gray-800 outline-none focus:border-[#4ECCA3] focus:ring-1 focus:ring-[#4ECCA3]/30"
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
                            className="rounded-xl bg-gray-800 px-4 py-2 text-xs font-medium text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:bg-gray-300 transition-all"
                          >
                            Add Checkpoint
                          </button>
                        </div>
                      </div>

                      {activeCheckpoints.length > 0 ? (
                        <div className="mt-3 space-y-1.5">
                          {activeCheckpoints.slice(-5).map((checkpoint) => (
                            <div key={`${checkpoint.timestamp}-${checkpoint.name}`} className="flex items-center justify-between rounded-lg bg-white/60 px-3 py-2 text-xs border border-white/60">
                              <span className="font-medium text-gray-700">{checkpoint.name}</span>
                              <span className="text-gray-500">{checkpoint.status} · {formatWorldDateTime(checkpoint.timestamp)}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-4 text-xs text-gray-500">
                      No active transit. Start one to enforce `ACTIVE to COMPLETED/ABANDONED` lifecycle.
                    </p>
                  )}

                  {transit.operationError ? (
                    <p className="mt-3 text-xs text-rose-600">{transit.operationError}</p>
                  ) : null}
                </div>
              </div>

              {/* World Level Audit */}
              <div className="relative overflow-hidden rounded-3xl border border-white/60 bg-white/40 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-xl">
                <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-[#4ECCA3]/5 pointer-events-none" />
                <div className="relative">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">World Level Audit</h3>
                  {auditRows.length <= 0 ? (
                    <p className="text-xs text-gray-500">No audit records</p>
                  ) : (
                    <div className="space-y-2">
                      {auditRows.map((audit) => (
                        <div key={audit.id} className="rounded-xl border border-white/60 bg-white/60 px-3 py-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-gray-700">{audit.eventType}</span>
                            <span className="text-[11px] text-gray-500">{formatWorldDateTime(audit.occurredAt)}</span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-gray-500">Reason: {audit.reasonCode || '--'}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
  );
}
