import { useTranslation } from 'react-i18next';
import { getSemanticAgentPalette } from '@renderer/components/agent-theme.js';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import { APP_PAGE_TITLE_CLASS } from '@renderer/components/typography.js';
import type { AgentDetailData } from './agent-detail-model';
import { getStateBadgeColor } from './agent-detail-model';

type AgentDetailViewProps = {
  agent: AgentDetailData;
  memoryStats: { coreCount: number; e2eCount: number; profileCount: number } | null;
  stats?: { friendsCount: number; postsCount: number; likesCount: number } | null;
  worldScore?: number;
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

// Score progress bar with rainbow gradient
function ScoreProgressBar({ score = 0 }: { score?: number }) {
  const percentage = Math.min(100, Math.max(0, score));
  
  return (
    <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
      <div 
        className="h-full rounded-full"
        style={{ 
          width: `${percentage}%`,
          background: 'linear-gradient(90deg, #ff6b6b, #feca57, #48dbfb, #ff9ff3, #54a0ff)',
        }}
      />
    </div>
  );
}

// Agent state badge
function AgentStateBadge({ state }: { state?: string }) {
  if (!state) return null;
  const colors = getStateBadgeColor(state);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${colors.bg} ${colors.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
      {state}
    </span>
  );
}

// Tier badge
function TierBadge({ tier }: { tier?: string }) {
  if (!tier) return null;
  const tierColors: Record<string, { bg: string; text: string; dot: string }> = {
    'COMMUNITY': { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' },
    'VERIFIED': { bg: 'bg-purple-100', text: 'text-purple-700', dot: 'bg-purple-500' },
    'PREMIUM': { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' },
    'OFFICIAL': { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  };
  const colors = tierColors[tier] || { bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-500' };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${colors.bg} ${colors.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
      {tier}
    </span>
  );
}

// Ownership badge
function OwnershipBadge({ ownershipType }: { ownershipType?: string }) {
  if (!ownershipType) return null;
  const isMasterOwned = ownershipType === 'MASTER_OWNED';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${isMasterOwned ? 'bg-purple-100 text-purple-700' : 'bg-cyan-100 text-cyan-700'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isMasterOwned ? 'bg-purple-500' : 'bg-cyan-500'}`} />
      {isMasterOwned ? 'My Agent' : 'World Owned'}
    </span>
  );
}

// Breathing online indicator
function OnlineIndicator({ isOnline }: { isOnline?: boolean }) {
  const SHOW_AVATAR_ONLINE_INDICATOR = false;
  if (!SHOW_AVATAR_ONLINE_INDICATOR || !isOnline) return null;
  
  return (
    <span className="absolute bottom-1 right-1 h-4 w-4">
      {/* Breathing glow effect using Tailwind animate-pulse */}
      <span className="absolute inset-0 rounded-full bg-green-400 animate-pulse opacity-75" />
      {/* Core dot with border */}
      <span className="absolute inset-0 rounded-full border-2 border-white bg-green-400" />
    </span>
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
  const palette = getSemanticAgentPalette({
    category: agent.category,
    origin: agent.origin,
    description: agent.bio || agent.category,
    tags: agent.tags,
  });

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
        <h1 className={APP_PAGE_TITLE_CLASS}>{t('AgentDetail.title')}</h1>
      </div>

      <ScrollShell
        className="flex-1 bg-gray-50"
        viewportClassName="bg-gray-50"
        contentClassName="mx-auto max-w-md px-6 py-8"
      >
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
                <div className="w-full h-full" style={{ background: palette.ring }} />
              )}
              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-white/20" />
              
              {/* Tag Pill - Top Left */}
              {agent.tags.length > 0 && (
                <div className="absolute top-4 left-4">
                  <span
                    className="inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur-sm"
                    style={{ backgroundColor: palette.badgeBg, color: palette.badgeText }}
                  >
                    {agent.tags[0]}
                  </span>
                </div>
              )}
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
                <EntityAvatar
                  imageUrl={agent.avatarUrl}
                  name={agent.displayName}
                  kind="agent"
                  sizeClassName="h-24 w-24"
                  textClassName="text-2xl font-semibold"
                />
                <OnlineIndicator isOnline={agent.isOnline} />
              </div>

              {/* Name and Badges */}
              <div className="mt-4 flex items-center gap-2 flex-wrap justify-center">
                <h2 className="text-xl font-bold text-gray-900">
                  {agent.displayName}
                </h2>
                <AgentStateBadge state={agent.state} />
                <TierBadge tier={agent.tier} />
              </div>
              
              {/* Handle with ownership badge */}
              <div className="flex items-center gap-2 mt-1">
                <p className="text-sm text-gray-500 font-mono">{agent.handle}</p>
                <OwnershipBadge ownershipType={agent.ownershipType} />
              </div>

              {/* Bio */}
              {agent.bio ? (
                <p className="mt-3 text-center text-sm text-gray-600 max-w-xs">
                  {agent.bio}
                </p>
              ) : null}

              {/* Category & Origin */}
              {(agent.category || agent.origin) && (
                <p className="mt-2 text-xs" style={{ color: palette.accent }}>
                  {agent.category}{agent.category && agent.origin ? ' • ' : ''}{agent.origin ? `Origin: ${agent.origin}` : ''}
                </p>
              )}

              {/* Score Progress Bar */}
              <div className="mt-5 w-full px-4">
                <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 font-medium whitespace-nowrap">
                      {t('AgentDetail.score', { defaultValue: 'Score' })}
                    </span>
                  <ScoreProgressBar score={props.worldScore} />
                </div>
              </div>

              {/* Stats - Friends / Posts / Likes */}
              <div className="mt-5 flex w-full items-center justify-around px-4 py-4 bg-gray-50 rounded-2xl">
                <div className="text-center">
                  <p className="text-xl font-bold text-gray-900">
                    {props.stats?.friendsCount ?? '--'}
                  </p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">
                    {t('AgentDetail.friends', { defaultValue: 'Friends' })}
                  </p>
                </div>
                <div className="w-px h-10 bg-gray-200" />
                <div className="text-center">
                  <p className="text-xl font-bold text-gray-900">
                    {props.stats?.postsCount ?? '--'}
                  </p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">
                    {t('AgentDetail.posts', { defaultValue: 'Posts' })}
                  </p>
                </div>
                <div className="w-px h-10 bg-gray-200" />
                <div className="text-center">
                  <p className="text-xl font-bold text-gray-900">
                    {props.stats?.likesCount ?? '--'}
                  </p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">
                    {t('AgentDetail.likes', { defaultValue: 'Likes' })}
                  </p>
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


      </ScrollShell>
    </div>
  );
}
