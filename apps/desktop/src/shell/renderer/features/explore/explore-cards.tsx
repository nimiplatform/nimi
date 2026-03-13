import { useTranslation } from 'react-i18next';
import { i18n } from '@renderer/i18n';
import { getSemanticAgentPalette } from '@renderer/components/agent-theme.js';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';

export const EXPLORE_COLORS = {
  brand50: '#ecfeff',
  brand100: '#cefafe',
  brand200: '#a2f4fd',
  brand700: '#007595',
  green100: '#dcfce7',
  green200: '#bbf7d0',
  green700: '#15803d',
  blue100: '#dbeafe',
  blue200: '#bfdbfe',
  blue700: '#1d4ed8',
  gray100: '#f3f4f6',
  gray200: '#e5e7eb',
  gray600: '#4b5563',
  gray900: '#111827',
} as const;

export type ExploreAgentCardData = {
  // Basic contact info
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
  isAgent: boolean;
  // World info
  worldId: string | null;
  worldName: string | null;
  worldBannerUrl: string | null;
  // Agent specific fields
  category?: string;
  origin?: string;
  tier?: string;
  state?: string;
  ownershipType?: string;
  wakeStrategy?: string;
  isPublic?: boolean;
  isOnline?: boolean;
  // Social/Stats
  tags: string[];
  friendsCount?: number;
  postsCount?: number;
  likesCount?: number;
  giftStats?: Record<string, number>;
  // World score for progress bar
  worldScoreEwma?: number;
};

export type ExplorePostCardData = {
  id: string;
  authorId: string;
  authorIsAgent: boolean;
  authorName: string;
  authorHandle: string;
  authorAvatarUrl: string | null;
  isVerified?: boolean;
  caption: string;
  tags: string[];
  mediaPreviewUrl: string | null;
  createdAtText: string;
  likes?: number;
  isLiked?: boolean;
};

export type FeaturedWorldCardData = {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string | null;
  gradient: string;
  isPublic: boolean;
  creatorAvatarUrl: string | null;
};

function PublicBadge({ size = 'normal' }: { size?: 'normal' | 'small' }) {
  const dotSize = size === 'small' ? 'h-1 w-1' : 'h-1.5 w-1.5';
  const textSize = size === 'small' ? 'text-[9px]' : 'text-[10px]';
  const padding = size === 'small' ? 'px-1.5 py-0.5' : 'px-2 py-0.5';
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full ${padding} ${textSize} font-medium`}
      style={{
        backgroundColor: EXPLORE_COLORS.green100,
        border: `1px solid ${EXPLORE_COLORS.green200}`,
        color: EXPLORE_COLORS.green700,
      }}
    >
      <span className={`${dotSize} rounded-full`} style={{ backgroundColor: EXPLORE_COLORS.green700 }} />
      {i18n.t('AgentDetail.publicBadge', { defaultValue: 'Public' })}
    </span>
  );
}

function ChatIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function FeaturedWorldCard({
  world,
  onClick,
}: {
  world: FeaturedWorldCardData;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative h-44 w-full overflow-hidden rounded-xl text-left"
    >
      <div className="absolute inset-0" style={{ background: world.gradient }}>
        {world.imageUrl && (
          <img src={world.imageUrl} alt={world.title} className="h-full w-full object-cover" />
        )}
      </div>
      <div className="absolute inset-0 bg-black/20 transition-colors group-hover:bg-black/30" />
      <div className="relative flex h-full flex-col justify-between p-4">
        <div>
          <h3 className="text-lg font-bold leading-snug text-white">
            {world.title}:
          </h3>
          <p className="text-sm text-white/80">{world.subtitle}</p>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-white/70">
              {i18n.t('AgentDetail.publicBadge', { defaultValue: 'Public' })}
            </span>
            <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
          </div>
          <div className="relative">
            {world.creatorAvatarUrl ? (
              <img
                src={world.creatorAvatarUrl}
                alt=""
                className="h-8 w-8 rounded-full object-cover ring-2 ring-white/30"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-xs font-bold text-white ring-2 ring-white/30">
                {world.title.charAt(0)}
              </div>
            )}
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-green-400 ring-2 ring-white/30" />
          </div>
        </div>
      </div>
    </button>
  );
}

export function ExploreAgentCard({
  agent,
  onOpen,
  onChat,
  onFollow,
}: {
  agent: ExploreAgentCardData;
  onOpen?: () => void;
  onChat?: () => void;
  onFollow?: () => void;
}) {
  const { t } = useTranslation();

  const handleOpen = () => {
    if (agent.id && onOpen) {
      onOpen();
    }
  };
  const bioText = agent.bio || (agent.category ? `${agent.category} agent` : 'Public agent');

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <button 
          type="button" 
          disabled={!agent.id || !onOpen}
          className="shrink-0 cursor-pointer disabled:cursor-default" 
          onClick={handleOpen}
        >
          <EntityAvatar
            imageUrl={agent.avatarUrl}
            name={agent.name}
            kind="agent"
            sizeClassName="h-12 w-12"
            textClassName="text-sm font-bold"
          />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <button 
              type="button" 
              disabled={!agent.id || !onOpen}
              className="min-w-0 cursor-pointer text-left disabled:cursor-default" 
              onClick={handleOpen}
            >
              <span className="block truncate text-sm font-bold text-gray-800">{agent.name}</span>
              <span className="block truncate text-xs text-gray-400">@{agent.handle}</span>
            </button>
            {agent.isPublic !== false && <PublicBadge />}
          </div>
        </div>
      </div>

      <p className="mt-3 line-clamp-2 text-sm text-gray-600">{bioText}</p>

      <div className="mt-auto flex items-center gap-2 pt-4">
        <button
          type="button"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-mint-500 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-mint-600"
          onClick={onChat}
        >
          <ChatIcon size={16} />
          {t('Explore.chatButton')}
        </button>
        {onFollow && (
          <button
            type="button"
            className="flex items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-500 transition-colors hover:bg-rose-100"
            onClick={onFollow}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {t('Explore.follow', { defaultValue: 'Follow' })}
          </button>
        )}
      </div>
    </div>
  );
}

// Compact Agent Card for horizontal scrolling recommendation section
export function AgentRecommendationCard({
  agent,
  onAddFriend,
  onOpen,
}: {
  agent: ExploreAgentCardData;
  onAddFriend?: () => void;
  onOpen?: () => void;
}) {
  const fallbackBio = agent.category ? `${agent.category} agent` : 'Public agent';
  const palette = getSemanticAgentPalette({
    category: agent.category,
    origin: agent.origin,
    description: agent.bio || fallbackBio,
    worldName: agent.worldName,
    tags: agent.tags,
  });
  const bioText = agent.bio || fallbackBio || i18n.t('Explore.noBioYet', { defaultValue: 'No bio yet' });
  const worldText = agent.worldName || agent.origin || agent.category || i18n.t('Profile.unknownWorld', { defaultValue: 'Unknown world' });
  const themeLabel = agent.category || agent.tags[0] || agent.origin || 'General';

  return (
    <div 
      className="group relative w-full min-w-0 cursor-pointer overflow-hidden rounded-2xl border border-white/70 px-4 pb-3 pt-3 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md"
      style={{ background: palette.background }}
      onClick={() => onOpen?.()}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.7),transparent_42%)]" />

      {/* Add Button - Top Right */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAddFriend?.();
        }}
        className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-mint-500 text-white shadow-sm transition-all hover:scale-110 hover:bg-mint-600"
        aria-label={i18n.t('Contacts.addContact', { defaultValue: 'Add Friend' })}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      <div className="relative z-[1]">
        <div className="mb-2.5 flex items-start justify-between gap-2">
          <span
            className="inline-flex max-w-[132px] truncate rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
            style={{ backgroundColor: palette.badgeBg, color: palette.badgeText }}
          >
            {themeLabel}
          </span>
          {agent.isPublic !== false && <PublicBadge size="small" />}
        </div>

      {/* Avatar */}
      <div className="relative mx-auto mb-2.5 flex justify-center">
        <EntityAvatar
          imageUrl={agent.avatarUrl}
          name={agent.name}
          kind="agent"
          sizeClassName="h-20 w-20"
          textClassName="text-lg font-semibold"
        />
        <OnlineIndicator isOnline={agent.isOnline} />
      </div>

      {/* Content */}
      <div className="text-center">
        <h3 className="truncate text-[15px] font-bold text-gray-900 transition-colors group-hover:text-mint-600">{agent.name}</h3>
        <p className="mt-1 truncate text-[12px] font-mono text-gray-500">{agent.handle}</p>

        <div className="mt-1.5 flex items-center justify-center gap-1 text-[11px] text-gray-500">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M2 12h20" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <span className="truncate max-w-[148px]">{worldText}</span>
        </div>

        <p className="mt-2 line-clamp-2 min-h-[34px] text-[12px] leading-[17px] text-gray-600">
          {bioText}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
          {agent.state && (
            <span className="rounded-full bg-green-50 px-1.5 py-0.5 text-[9px] font-medium text-green-600">
              {agent.state}
            </span>
          )}
          {agent.tier && (
            <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium text-blue-600">
              {agent.tier}
            </span>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

// World score progress bar with rainbow gradient
function ScoreProgressBar({ score = 0 }: { score?: number }) {
  const percentage = Math.min(100, Math.max(0, score));
  
  return (
    <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
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

// Agent state badge with color coding
function AgentStateBadge({ state }: { state?: string }) {
  if (!state) return null;
  
  const getStateStyles = (s: string) => {
    switch (s.toUpperCase()) {
      case 'ACTIVE':
        return { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' };
      case 'READY':
        return { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' };
      case 'INCUBATING':
        return { bg: 'bg-yellow-100', text: 'text-yellow-700', dot: 'bg-yellow-500' };
      case 'SUSPENDED':
        return { bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500' };
      case 'FAILED':
        return { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' };
      default:
        return { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' };
    }
  };
  
  const styles = getStateStyles(state);
  
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${styles.bg} ${styles.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${styles.dot}`} />
      {state}
    </span>
  );
}

// Online status indicator
function OnlineIndicator({ isOnline }: { isOnline?: boolean }) {
  const SHOW_AVATAR_ONLINE_INDICATOR = false;
  if (!SHOW_AVATAR_ONLINE_INDICATOR || !isOnline) return null;
  return (
    <span
      className="absolute bottom-1 right-1 w-4 h-4 bg-green-500 border-2 border-white rounded-full"
      title={i18n.t('ChatTimeline.online', { defaultValue: 'Online' })}
    />
  );
}

// Tier badge
function TierBadge({ tier }: { tier?: string }) {
  if (!tier) return null;
  const tierColors: Record<string, { bg: string; text: string }> = {
    'COMMUNITY': { bg: 'bg-blue-50', text: 'text-blue-600' },
    'VERIFIED': { bg: 'bg-purple-50', text: 'text-purple-600' },
    'PREMIUM': { bg: 'bg-amber-50', text: 'text-amber-600' },
    'OFFICIAL': { bg: 'bg-emerald-50', text: 'text-emerald-600' },
  };
  const colors = tierColors[tier] || { bg: 'bg-gray-50', text: 'text-gray-600' };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${colors.bg} ${colors.text}`}>
      {tier}
    </span>
  );
}

// Ownership badge
function OwnershipBadge({ ownershipType }: { ownershipType?: string }) {
  if (!ownershipType) return null;
  const isMasterOwned = ownershipType === 'MASTER_OWNED';
  return (
    <span 
      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
        isMasterOwned ? 'bg-purple-50 text-purple-600' : 'bg-cyan-50 text-cyan-600'
      }`}
      title={isMasterOwned
        ? i18n.t('Explore.ownedByYou', { defaultValue: 'Owned by you' })
        : i18n.t('Explore.worldOwned', { defaultValue: 'World owned' })}
    >
      {isMasterOwned
        ? i18n.t('Contacts.tabMyAgents', { defaultValue: 'My Agents' })
        : i18n.t('Common.world', { defaultValue: 'World' })}
    </span>
  );
}

export function TopAgentCard({
  agent,
  onAddFriend,
  onSendGift,
  onOpen,
}: {
  agent: ExploreAgentCardData;
  onAddFriend?: () => void;
  onSendGift?: () => void;
  onOpen?: () => void;
}) {
  const fallbackBio = agent.category ? `${agent.category} agent` : 'Public agent';
  const palette = getSemanticAgentPalette({
    category: agent.category,
    origin: agent.origin,
    description: agent.bio || fallbackBio,
    worldName: agent.worldName,
    tags: agent.tags,
  });
  const backgroundUrl = agent.worldBannerUrl;
  const friendsCount = typeof agent.friendsCount === 'number' ? agent.friendsCount : 0;
  const postsCount = typeof agent.postsCount === 'number' ? agent.postsCount : 0;
  const likesCount = typeof agent.likesCount === 'number' ? agent.likesCount : 0;
  const worldScore = agent.worldScoreEwma ?? 0;
  const themeLabel = agent.tags[0] || agent.category || agent.origin || 'community';
  const bioText = agent.bio || fallbackBio || i18n.t('Explore.noBioYet', { defaultValue: 'No bio yet' });
  const worldText = agent.worldName || i18n.t('Profile.unknownWorld', { defaultValue: 'Unknown world' });
  const originText = agent.origin || agent.category || 'GENERAL';

  const formatNumber = (num: number | null): string => {
    if (num === null) return '--';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  const backgroundStyle = backgroundUrl
    ? { backgroundImage: `url(${backgroundUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: palette.ring };

  return (
    <div className="overflow-hidden rounded-[24px] border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className="relative h-32" style={backgroundStyle}>
        {themeLabel && (
          <div className="absolute top-3 left-3">
            <span
              className="rounded-full px-2.5 py-1 text-[10px] font-medium capitalize backdrop-blur-sm"
              style={{ backgroundColor: palette.badgeBg, color: palette.badgeText }}
            >
              {themeLabel}
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={onAddFriend}
          className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-mint-500 text-white shadow-sm transition-all hover:scale-105 hover:bg-mint-600 hover:shadow-md"
          aria-label={i18n.t('Contacts.addContact', { defaultValue: 'Add Friend' })}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-white/25" />
      </div>

      <div className="relative -mt-12 flex justify-center">
        <button
          type="button"
          disabled={!agent.id || !onOpen}
          onClick={() => {
            if (agent.id && onOpen) {
              onOpen();
            }
          }}
          className="relative inline-block cursor-pointer border-0 bg-transparent p-0 disabled:cursor-default"
        >
          <EntityAvatar
            imageUrl={agent.avatarUrl}
            name={agent.name}
            kind="agent"
            sizeClassName="h-24 w-24"
            textClassName="text-2xl font-semibold"
            className="shadow-lg"
          />
          <OnlineIndicator isOnline={agent.isOnline} />
        </button>
      </div>

      <div className="px-5 pb-5 pt-4">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            disabled={!agent.id || !onOpen}
            onClick={() => {
              if (agent.id && onOpen) {
                onOpen();
              }
            }}
            className="m-0 cursor-pointer border-0 bg-transparent p-0 disabled:cursor-default"
          >
            <h3 className="text-lg font-bold text-gray-900 transition-colors hover:text-mint-600">{agent.name}</h3>
          </button>
          <AgentStateBadge state={agent.state} />
          <TierBadge tier={agent.tier} />
        </div>

        <div className="mt-1 flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={!agent.id || !onOpen}
            onClick={() => {
              if (agent.id && onOpen) {
                onOpen();
              }
            }}
            className="m-0 cursor-pointer border-0 bg-transparent p-0 disabled:cursor-default"
          >
            <p className="mt-0.5 font-mono text-sm transition-colors hover:text-mint-500" style={{ color: palette.accent }}>
              {agent.handle}
            </p>
          </button>
          <OwnershipBadge ownershipType={agent.ownershipType} />
        </div>

        <div className="mt-2.5 flex items-center justify-center gap-1 text-[11px] font-medium" style={{ color: palette.accent }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M2 12h20" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <span className="max-w-[168px] truncate">{worldText}</span>
        </div>

        <p className="mx-auto mt-2 line-clamp-2 min-h-[38px] max-w-[90%] text-center text-[13px] leading-[19px] text-gray-600">
          {bioText}
        </p>

        <div className="mt-2 flex items-center justify-center gap-2 text-[11px] font-medium" style={{ color: palette.badgeText }}>
          <span>{originText}</span>
          {agent.category && agent.category !== originText ? (
            <>
              <span>|</span>
              <span>{agent.category}</span>
            </>
          ) : null}
        </div>

        <div className="mt-3.5 flex items-center gap-3">
          <span className="whitespace-nowrap text-xs font-medium text-gray-500">
            {i18n.t('Explore.score', { defaultValue: 'Score' })}
          </span>
          <ScoreProgressBar score={worldScore} />
        </div>

        <div className="mt-3.5 flex items-center justify-around rounded-2xl bg-gray-50 px-3 py-3">
          <div className="flex-1 text-center">
            <div className="text-lg font-bold text-gray-900">{formatNumber(friendsCount)}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wider text-gray-400">
              {i18n.t('ProfileView.friends', { defaultValue: 'Friends' })}
            </div>
          </div>
          <div className="h-8 w-px bg-gray-200" />
          <div className="flex-1 text-center">
            <div className="text-lg font-bold text-gray-900">{formatNumber(postsCount)}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wider text-gray-400">
              {i18n.t('ProfileView.posts', { defaultValue: 'Posts' })}
            </div>
          </div>
          <div className="h-8 w-px bg-gray-200" />
          <div className="flex-1 text-center">
            <div className="text-lg font-bold text-gray-900">{formatNumber(likesCount)}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wider text-gray-400">
              {i18n.t('Home.likes', { defaultValue: 'Likes' })}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddFriend?.();
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-700 transition-colors hover:bg-gray-200"
            title={i18n.t('Contacts.addContact', { defaultValue: 'Add Friend' })}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSendGift?.();
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-700 transition-colors hover:bg-gray-200"
            title={i18n.t('ProfileView.sendGift', { defaultValue: 'Send Gift' })}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="8" width="18" height="4" rx="1" />
              <path d="M12 8v13" />
              <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
              <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
