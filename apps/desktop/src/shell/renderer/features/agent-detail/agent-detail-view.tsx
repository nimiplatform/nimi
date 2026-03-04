import { useTranslation } from 'react-i18next';
import type { AgentDetailData } from './agent-detail-model';
import { getAgentInitial } from './agent-detail-model';

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

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50">
      {/* Header bar */}
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
        <div className="mx-auto max-w-md px-6 py-8">
          {/* Profile Card */}
          <div className="relative rounded-[24px] bg-white shadow-lg overflow-hidden">
            {/* Banner Background */}
            <div className="relative h-32 w-full overflow-hidden">
              {agent.worldBannerUrl ? (
                <img
                  src={agent.worldBannerUrl}
                  alt="World Banner"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-purple-400 via-pink-300 to-blue-300" />
              )}
              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-white/20" />
            </div>

            {/* Add Button - Top Right */}
            <button
              type="button"
              onClick={props.onAddFriend}
              disabled={props.canAddFriend === false || props.isFriend}
              className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow-md hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 transition-all z-10"
              title={props.isFriend ? t('Contacts.friends') : t('AgentDetail.addFriend')}
            >
              {props.isFriend ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              )}
            </button>

            {/* Avatar Section */}
            <div className="relative -mt-12 flex flex-col items-center px-6">
              {/* Avatar with gradient ring */}
              <div className="relative">
                <div 
                  className="h-24 w-24 rounded-full p-1"
                  style={{
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 25%, #f093fb 50%, #f5576c 75%, #4facfe 100%)',
                  }}
                >
                  <div className="h-full w-full rounded-full bg-white p-1">
                    {agent.avatarUrl ? (
                      <img
                        src={agent.avatarUrl}
                        alt={agent.displayName}
                        className="h-full w-full rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-purple-100 to-pink-100 text-2xl font-semibold text-purple-600">
                        {getAgentInitial(agent.displayName)}
                      </div>
                    )}
                  </div>
                </div>
                {agent.isOnline && (
                  <span className="absolute bottom-1 right-1 h-4 w-4 rounded-full border-2 border-white bg-green-400" />
                )}
              </div>

              {/* Name and Handle */}
              <h2 className="mt-4 text-xl font-bold text-gray-900">
                {agent.displayName}
              </h2>
              <p className="text-sm text-gray-500">@{agent.handle}</p>

              {/* Bio */}
              {agent.bio ? (
                <p className="mt-3 text-center text-sm text-gray-600 max-w-xs">
                  {agent.bio}
                </p>
              ) : null}

              {/* Stats */}
              <div className="mt-6 flex w-full items-center justify-around px-4 py-4 bg-gray-50 rounded-2xl">
                <div className="text-center">
                  <p className="text-lg font-bold text-gray-900">
                    {props.memoryStats ? props.memoryStats.coreCount : 0}
                  </p>
                  <p className="text-xs text-gray-500">{t('AgentDetail.memoryCore')}</p>
                </div>
                <div className="w-px h-10 bg-gray-200" />
                <div className="text-center">
                  <p className="text-lg font-bold text-gray-900">
                    {props.memoryStats ? props.memoryStats.e2eCount : 0}
                  </p>
                  <p className="text-xs text-gray-500">{t('AgentDetail.memoryE2E')}</p>
                </div>
                <div className="w-px h-10 bg-gray-200" />
                <div className="text-center">
                  <p className="text-lg font-bold text-gray-900">
                    {props.memoryStats ? props.memoryStats.profileCount : 0}
                  </p>
                  <p className="text-xs text-gray-500">{t('AgentDetail.memoryProfiles')}</p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-6 flex items-center justify-center gap-4 pb-6">
                <button
                  type="button"
                  onClick={props.onChat}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                  title={t('AgentDetail.chat')}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={props.onSendGift}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                  title={t('AgentDetail.sendGift')}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="8" width="18" height="4" rx="1" />
                    <path d="M12 8v13" />
                    <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
                    <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
                  </svg>
                </button>
                {agent.worldId ? (
                  <button
                    type="button"
                    onClick={props.onOpenWorld}
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                    title={t('AgentDetail.openWorld')}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="2" y1="12" x2="22" y2="12" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {/* Additional Info Cards */}
          <div className="mt-4 space-y-3">
            {/* Tags */}
            {agent.tags.length > 0 ? (
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('AgentDetail.tags')}</h3>
                <div className="flex flex-wrap gap-2">
                  {agent.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Metadata */}
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('AgentDetail.title')}</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('AgentDetail.metaCategory')}</span>
                  <span className="font-medium text-gray-900">{agent.category}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('AgentDetail.metaOrigin')}</span>
                  <span className="font-medium text-gray-900">{agent.origin}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('AgentDetail.metaTier')}</span>
                  <span className="font-medium text-gray-900">{agent.tier}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('AgentDetail.metaWakeStrategy')}</span>
                  <span className="font-medium text-gray-900">{agent.wakeStrategy}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
