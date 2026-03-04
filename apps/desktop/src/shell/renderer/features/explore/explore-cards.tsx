import { useTranslation } from 'react-i18next';

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
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  description: string;
  tags: string[];
  badgeText: string;
  worldId: string | null;
  worldBannerUrl: string | null;
  isPublic?: boolean;
  age?: number | null;
  location?: string | null;
  // Stats for display
  likes?: number;
  posts?: number;
  views?: number;
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
      Public
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
            <span className="text-xs font-medium text-white/70">Public</span>
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

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <button type="button" className="shrink-0 cursor-pointer" onClick={onOpen}>
          {agent.avatarUrl ? (
            <img
              src={agent.avatarUrl}
              alt={agent.name}
              className="h-12 w-12 rounded-lg object-cover"
              style={{
                boxShadow: '0 0 0 1.5px #a855f7, 0 0 6px 2px rgba(168, 85, 247, 0.4), 0 0 10px 3px rgba(124, 58, 237, 0.2)',
              }}
            />
          ) : (
            <div
              className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 text-sm font-bold text-slate-700"
              style={{
                boxShadow: '0 0 0 1.5px #a855f7, 0 0 6px 2px rgba(168, 85, 247, 0.4), 0 0 10px 3px rgba(124, 58, 237, 0.2)',
              }}
            >
              {agent.name.charAt(0).toUpperCase()}
            </div>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <button type="button" className="min-w-0 cursor-pointer text-left" onClick={onOpen}>
              <span className="block truncate text-sm font-bold text-gray-800">{agent.name}</span>
              <span className="block truncate text-xs text-gray-400">@{agent.handle}</span>
            </button>
            {agent.isPublic !== false && <PublicBadge />}
          </div>
        </div>
      </div>

      <p className="mt-3 line-clamp-2 text-sm text-gray-600">{agent.description}</p>

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
            Follow
          </button>
        )}
      </div>
    </div>
  );
}

// Default gradient backgrounds for agents without world banner
const DEFAULT_AGENT_BACKGROUNDS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
  'linear-gradient(135deg, #d299c2 0%, #fef9d7 100%)',
  'linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)',
];

function getDefaultBackgroundForAgent(agentId: string): string {
  // Use agentId to deterministically pick a background
  const index = agentId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % DEFAULT_AGENT_BACKGROUNDS.length;
  return DEFAULT_AGENT_BACKGROUNDS[index] || DEFAULT_AGENT_BACKGROUNDS[0]!;
}

// World score progress bar with rainbow gradient (no label)
// scoreEwma is 0-100, display as percentage
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

// Social icons component
function SocialIcons() {
  return (
    <div className="flex items-center justify-center gap-4 mt-3">
      {/* Dribbble */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="hover:stroke-gray-600 cursor-pointer transition-colors">
        <circle cx="12" cy="12" r="10" />
        <path d="M8.56 2.75c4.37 6.03 6.02 9.42 8.03 17.72m2.54-15.38c-3.72 4.35-8.94 5.66-16.88 5.85m19.5 1.9c-3.5-.93-6.63-.82-8.94 0-2.58.92-5.01 2.86-7.44 6.32" />
      </svg>
      {/* Facebook */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="hover:stroke-gray-600 cursor-pointer transition-colors">
        <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
      </svg>
      {/* Instagram */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="hover:stroke-gray-600 cursor-pointer transition-colors">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
      </svg>
      {/* Pinterest */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="hover:stroke-gray-600 cursor-pointer transition-colors">
        <line x1="12" y1="8" x2="12" y2="21" />
        <path d="M6 12a6 6 0 0 1 12 0c0 3.12-1.5 5-3 6.5" />
        <path d="M9 21c.97.66 2.15 1 3.5 1 4.14 0 7.5-3.36 7.5-7.5A7.5 7.5 0 0 0 12 7a7.5 7.5 0 0 0-7.5 7.5c0 1.82.65 3.5 1.74 4.8" />
      </svg>
    </div>
  );
}

export function TopAgentCard({
  agent,
  onAddFriend,
}: {
  agent: ExploreAgentCardData;
  onAddFriend?: () => void;
}) {
  const backgroundUrl = agent.worldBannerUrl || getDefaultBackgroundForAgent(agent.id);
  const likes = agent.likes ?? Math.floor(Math.random() * 50) + 50; // Placeholder: random between 50-100K
  const posts = agent.posts ?? Math.floor(Math.random() * 200) + 200;
  const views = agent.views ?? Math.floor(Math.random() * 200) + 300;
  const worldScore = agent.worldScoreEwma ?? 0; // 0-100 from world data

  const formatNumber = (num: number): string => {
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  };

  // Determine background style based on URL type
  const isImageUrl = backgroundUrl.startsWith('http') || backgroundUrl.startsWith('/') || backgroundUrl.startsWith('data:');
  const backgroundStyle = isImageUrl 
    ? { backgroundImage: `url(${backgroundUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: backgroundUrl };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-sm">
      {/* Header with background image */}
      <div 
        className="relative h-20"
        style={backgroundStyle}
      >
        {/* Add Friend button - circle with plus */}
        <button
          type="button"
          onClick={onAddFriend}
          className="absolute top-2 right-2 flex items-center justify-center w-8 h-8 rounded-full bg-white/90 backdrop-blur-sm shadow-sm transition-all hover:bg-white hover:shadow-md"
          aria-label="Add friend"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* Avatar - positioned to overlap the background */}
      <div className="relative px-4 -mt-8">
        <div className="relative">
          {agent.avatarUrl ? (
            <img
              src={agent.avatarUrl}
              alt={agent.name}
              className="h-16 w-16 rounded-full object-cover border-4 border-white shadow-md"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-mint-100 to-mint-50 text-lg font-bold text-mint-600 border-4 border-white shadow-md">
              {agent.name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-4 pt-2">
        {/* Name */}
        <h3 className="text-base font-bold text-gray-900">{agent.name}</h3>
        
        {/* Description */}
        <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{agent.description}</p>

        {/* World Score bar */}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[10px] text-gray-500 font-medium">Score</span>
          <ScoreProgressBar score={worldScore} />
        </div>

        {/* Divider */}
        <div className="h-px bg-gray-100 my-3" />

        {/* Stats */}
        <div className="flex items-center justify-between">
          <div className="text-center flex-1">
            <div className="text-lg font-bold text-gray-900">{formatNumber(likes)}</div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide">Likes</div>
          </div>
          <div className="text-center flex-1">
            <div className="text-lg font-bold text-gray-900">{formatNumber(posts)}</div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide">Posts</div>
          </div>
          <div className="text-center flex-1">
            <div className="text-lg font-bold text-gray-900">{formatNumber(views)}</div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide">Views</div>
          </div>
        </div>

        {/* Social icons */}
        <SocialIcons />
      </div>
    </div>
  );
}
