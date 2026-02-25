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
  isPublic?: boolean;
  age?: number | null;
  location?: string | null;
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

export function TopAgentCard({
  agent,
  onChat,
}: {
  agent: ExploreAgentCardData;
  onChat?: () => void;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-center gap-3">
        {agent.avatarUrl ? (
          <img
            src={agent.avatarUrl}
            alt={agent.name}
            className="h-10 w-10 rounded object-cover"
            style={{
              boxShadow: '0 0 0 1.5px #a855f7, 0 0 4px 2px rgba(168, 85, 247, 0.4)',
            }}
          />
        ) : (
          <div
            className="flex h-10 w-10 items-center justify-center rounded bg-slate-100 text-xs font-bold text-slate-700"
            style={{
              boxShadow: '0 0 0 1.5px #a855f7, 0 0 4px 2px rgba(168, 85, 247, 0.4)',
            }}
          >
            {agent.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-gray-800">{agent.name}</span>
            {agent.isPublic !== false && <PublicBadge size="small" />}
          </div>
          <span className="block truncate text-xs text-gray-400">@{agent.handle}</span>
        </div>
      </div>

      <p className="mt-2 line-clamp-1 text-xs text-gray-500">{agent.description}</p>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-mint-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-mint-600"
          onClick={onChat}
        >
          <ChatIcon size={14} />
          Chat
        </button>
      </div>
    </div>
  );
}
