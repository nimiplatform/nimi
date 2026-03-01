import { useTranslation } from 'react-i18next';
import type { AgentDetailData } from './agent-detail-model';
import { getAgentInitial, getStateBadgeColor } from './agent-detail-model';

type AgentDetailViewProps = {
  agent: AgentDetailData;
  memoryStats: { coreCount: number; e2eCount: number; profileCount: number } | null;
  loading: boolean;
  error: boolean;
  onBack: () => void;
  onChat: () => void;
  onOpenWorld: () => void;
  onAddFriend: () => void;
  canAddFriend?: boolean;
  addFriendHint?: string | null;
  onSendGift: () => void;
  isFriend?: boolean;
};

function MetadataCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-gray-200 bg-white px-4 py-3">
      <span className="text-gray-400">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-gray-400">{label}</p>
        <p className="truncate text-sm font-medium text-gray-900">{value}</p>
      </div>
    </div>
  );
}

export function AgentDetailView(props: AgentDetailViewProps) {
  const { t } = useTranslation();

  if (props.loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
        {t('AgentDetail.loading')}
      </div>
    );
  }

  if (props.error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-600">{t('AgentDetail.error')}</p>
        <button
          type="button"
          onClick={props.onBack}
          className="rounded-[10px] bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
        >
          {t('Common.back')}
        </button>
      </div>
    );
  }

  const { agent } = props;
  const stateColor = getStateBadgeColor(agent.state);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 bg-white px-6">
        <button
          type="button"
          onClick={props.onBack}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="text-lg font-semibold tracking-tight text-gray-900">{t('AgentDetail.title')}</h1>
      </div>

      <div className="flex-1 overflow-y-auto bg-gray-50">
        <div className="mx-auto max-w-2xl px-6 py-8">
          {/* Hero Section */}
          <div className="flex flex-col items-center rounded-[10px] border border-gray-200 bg-white px-6 py-8">
            <div className="relative">
              {agent.avatarUrl ? (
                <img
                  src={agent.avatarUrl}
                  alt={agent.displayName}
                  className="h-24 w-24 rounded-[16px] object-cover ring-4 ring-gray-100"
                />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-[16px] bg-brand-100 text-2xl font-semibold text-brand-700 ring-4 ring-gray-100">
                  {getAgentInitial(agent.displayName)}
                </div>
              )}
              {agent.isOnline ? (
                <span className="absolute right-0 bottom-0 h-4 w-4 rounded-full border-2 border-white bg-green-400" />
              ) : null}
            </div>

            <h2 className="mt-4 text-xl font-semibold tracking-tight text-gray-900">
              {agent.displayName}
            </h2>
            <p className="mt-1 text-sm text-gray-500">{agent.handle}</p>

            {/* State + Type Badges */}
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${stateColor.bg} ${stateColor.text}`}>
                <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                  <circle cx="4" cy="4" r="4" />
                </svg>
                {agent.state}
              </span>
              <span className="inline-flex items-center rounded-full border border-brand-200 bg-brand-100 px-2.5 py-0.5 text-xs font-medium text-brand-700">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                  <rect x="9" y="9" width="6" height="6" />
                </svg>
                {t('AgentDetail.agentBadge')}
              </span>
              {agent.isPublic ? (
                <span className="inline-flex items-center rounded-full border border-green-200 bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                  {t('AgentDetail.publicBadge')}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                  {t('AgentDetail.privateBadge')}
                </span>
              )}
            </div>

            {agent.bio ? (
              <p className="mt-4 max-w-md text-center text-sm text-gray-600">{agent.bio}</p>
            ) : null}

            {/* Actions */}
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={props.onChat}
                className="flex items-center gap-2 rounded-[10px] bg-brand-500 px-5 py-2 text-sm font-medium text-white hover:bg-brand-600"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                {t('AgentDetail.chat')}
              </button>
              {!props.isFriend && (
                <button
                  type="button"
                  onClick={props.onAddFriend}
                  disabled={props.canAddFriend === false}
                  className="flex items-center gap-2 rounded-[10px] border border-gray-200 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="8.5" cy="7" r="4" />
                    <line x1="20" y1="8" x2="20" y2="14" />
                    <line x1="23" y1="11" x2="17" y2="11" />
                  </svg>
                  {t('AgentDetail.addFriend')}
                </button>
              )}
              <button
                type="button"
                onClick={props.onSendGift}
                className="flex items-center gap-2 rounded-[10px] border border-gray-200 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="8" width="18" height="4" rx="1" />
                  <path d="M12 8v13" />
                  <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
                  <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
                </svg>
                {t('AgentDetail.sendGift')}
              </button>
              {agent.worldId ? (
                <button
                  type="button"
                  onClick={props.onOpenWorld}
                  className="flex items-center gap-2 rounded-[10px] border border-gray-200 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  {t('AgentDetail.openWorld')}
                </button>
              ) : null}
            </div>
            {props.addFriendHint ? (
              <p className="mt-2 text-xs text-amber-700">{props.addFriendHint}</p>
            ) : null}
          </div>

          {/* Metadata Grid */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <MetadataCard
              label={t('AgentDetail.metaCategory')}
              value={agent.category}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
                </svg>
              }
            />
            <MetadataCard
              label={t('AgentDetail.metaOrigin')}
              value={agent.origin}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              }
            />
            <MetadataCard
              label={t('AgentDetail.metaVerification')}
              value={agent.tier}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2z" />
                </svg>
              }
            />
            <MetadataCard
              label={t('AgentDetail.metaWakeStrategy')}
              value={agent.wakeStrategy}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
              }
            />
            <MetadataCard
              label={t('AgentDetail.metaOwnership')}
              value={agent.ownershipType}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 21h18" />
                  <path d="M5 21V7l7-4 7 4v14" />
                </svg>
              }
            />
            <MetadataCard
              label={t('AgentDetail.metaWorldId')}
              value={agent.worldId || 'N/A'}
              icon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              }
            />
          </div>

          {/* Tags */}
          {agent.tags.length > 0 ? (
            <div className="mt-4 rounded-[10px] border border-gray-200 bg-white px-6 py-4">
              <h3 className="text-sm font-semibold text-gray-700">{t('AgentDetail.tags')}</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {agent.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {/* Memory Stats */}
          {props.memoryStats ? (
            <div className="mt-4 rounded-[10px] border border-gray-200 bg-white px-6 py-4">
              <h3 className="text-sm font-semibold text-gray-700">{t('AgentDetail.memory')}</h3>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <div className="text-center">
                  <p className="text-lg font-semibold text-gray-900">{props.memoryStats.coreCount}</p>
                  <p className="text-[11px] text-gray-500">{t('AgentDetail.memoryCore')}</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-semibold text-gray-900">{props.memoryStats.e2eCount}</p>
                  <p className="text-[11px] text-gray-500">{t('AgentDetail.memoryE2E')}</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-semibold text-gray-900">{props.memoryStats.profileCount}</p>
                  <p className="text-[11px] text-gray-500">{t('AgentDetail.memoryProfiles')}</p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
