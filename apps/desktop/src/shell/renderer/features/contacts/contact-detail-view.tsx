import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PostDto } from '@nimiplatform/sdk/realm';
import { getSemanticAgentPalette } from '@renderer/components/agent-theme.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { CollectionsTab } from '@renderer/features/profile/components/collections-tab';
import { GiftsTab } from '@renderer/features/profile/components/gifts-tab';
import { MediaLightbox } from '@renderer/features/profile/components/media-lightbox';
import { MediaTab } from '@renderer/features/profile/components/media-tab';
import { PostsTab } from '@renderer/features/profile/components/posts-tab';
import { formatProfileDate, type ProfileData, type ProfileTab } from '@renderer/features/profile/profile-model';

type ContactDetailViewProps = {
  profile: ProfileData;
  loading: boolean;
  error: boolean;
  onClose: () => void;
  onMessage: () => void;
  onSendGift: () => void;
  onBlock?: () => void;
  onRemove?: () => void;
  showMessageButton?: boolean;
  fullBleed?: boolean;
};

type MediaSelection = {
  post: PostDto;
  mediaIndex: number;
};

type TabIndicator = {
  left: number;
  width: number;
};

const CONTACT_DETAIL_TABS: ProfileTab[] = ['Posts', 'Media', 'Collections', 'Gifts'];

export function ContactDetailView(props: ContactDetailViewProps) {
  const { t } = useTranslation();
  const navigateToWorld = useAppStore((state) => state.navigateToWorld);
  const setSelectedProfileId = useAppStore((state) => state.setSelectedProfileId);
  const setSelectedProfileIsAgent = useAppStore((state) => state.setSelectedProfileIsAgent);
  const [activeTab, setActiveTab] = useState<ProfileTab>('Posts');
  const [selectedMedia, setSelectedMedia] = useState<MediaSelection | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [tabIndicator, setTabIndicator] = useState<TabIndicator>({ left: 0, width: 24 });
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const tabButtonRefs = useRef<Partial<Record<ProfileTab, HTMLButtonElement | null>>>({});

  useEffect(() => {
    if (!showMenu) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        menuButtonRef.current &&
        !menuButtonRef.current.contains(event.target as Node)
      ) {
        setShowMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  useLayoutEffect(() => {
    const updateIndicator = () => {
      const activeButton = tabButtonRefs.current[activeTab];
      const tabList = tabListRef.current;
      if (!activeButton || !tabList) {
        return;
      }

      const compactWidth = Math.min(28, Math.max(20, activeButton.offsetWidth - 22));
      const left = activeButton.offsetLeft + ((activeButton.offsetWidth - compactWidth) / 2);
      setTabIndicator({ left, width: compactWidth });
    };

    updateIndicator();
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  }, [activeTab]);

  if (props.loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#f3f6f8]">
        <div className="flex flex-col items-center gap-3 text-sm text-slate-500">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-slate-200 border-t-[#1f8f69]" />
          {t('ProfileView.loading')}
        </div>
      </div>
    );
  }

  if (props.error) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#f3f6f8]">
        <div className="rounded-[28px] border border-red-100 bg-white px-8 py-10 text-center shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500">
            <AlertIcon className="h-5 w-5" />
          </div>
          <p className="mt-4 text-sm font-medium text-red-600">{t('ProfileView.error')}</p>
          <button
            type="button"
            onClick={props.onClose}
            className="mt-5 rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            {t('Common.back')}
          </button>
        </div>
      </div>
    );
  }

  const { profile } = props;
  const friendCount = profile.stats?.friendsCount ?? 0;
  const postCount = profile.stats?.postsCount ?? 0;
  const likesCount = profile.stats?.likesCount ?? 0;
  const palette = getSemanticAgentPalette({
    category: profile.agentCategory,
    origin: profile.agentOrigin,
    description: profile.bio,
    tags: profile.tags,
  });
  const headerStyle = profile.worldBannerUrl
    ? {
        backgroundImage: `linear-gradient(120deg, rgba(7, 20, 17, 0.58), rgba(7, 20, 17, 0.18)), url(${profile.worldBannerUrl})`,
        backgroundPosition: 'center',
        backgroundSize: 'cover',
      }
    : {
        background: profile.isAgent
          ? palette.ring
          : 'linear-gradient(135deg, #dff8ef 0%, #ecfffb 40%, #f8fcff 100%)',
      };
  const locationLabel = profile.city && profile.countryCode
    ? `${profile.city}, ${profile.countryCode.toUpperCase()}`
    : profile.city || profile.countryCode?.toUpperCase() || 'Unknown region';
  const originLabel = profile.agentOrigin || 'Unknown origin';
  const joinedLabel = formatProfileDate(profile.createdAt) || 'Unknown joined date';
  const worldLabel = profile.worldName || 'Unknown world';
  const worldNavigationId = profile.agentOwnerWorldId || profile.agentWorldId || '';
  const canVisitWorld = Boolean(worldNavigationId);
  const headline = profile.bio || (profile.isAgent
    ? 'This contact has no public profile summary yet.'
    : 'No profile summary has been added yet.');

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-[linear-gradient(180deg,#eef3f4_0%,#f7fafb_48%,#fcfefd_100%)]">
      <div className="flex-1 overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
        <div className={`${props.fullBleed ? 'flex min-h-full w-full flex-col' : 'mx-auto flex min-h-full w-full max-w-[1440px] flex-col px-6 py-6'}`}>
          <section className="relative overflow-hidden rounded-[34px] border border-white/70 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.10)]">
            <div className="relative h-[220px] px-8 py-7" style={headerStyle}>
              {canVisitWorld ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedProfileId(profile.id);
                    setSelectedProfileIsAgent(profile.isAgent);
                    navigateToWorld(worldNavigationId);
                  }}
                  className="absolute inset-x-0 top-0 z-10 h-[140px] cursor-pointer"
                  aria-label={`Visit ${worldLabel}`}
                />
              ) : null}
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.28),transparent_32%)]" />
              <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-white via-white/82 to-transparent" />

              <div className="relative z-10 flex items-start justify-between gap-4">
                <span />
                {(props.onBlock || props.onRemove) ? (
                  <div className="relative">
                    <button
                      ref={menuButtonRef}
                      type="button"
                      onClick={() => setShowMenu((value) => !value)}
                      className="flex h-11 w-11 items-center justify-center rounded-full border border-white/35 bg-white/15 text-white backdrop-blur-md transition hover:bg-white/22"
                      title="More options"
                    >
                      <DotsIcon className="h-4 w-4" />
                    </button>
                    {showMenu ? (
                      <div
                        ref={menuRef}
                        className="absolute right-0 top-full z-20 mt-2 w-44 rounded-2xl border border-slate-100 bg-white py-1.5 shadow-[0_22px_64px_rgba(15,23,42,0.18)]"
                      >
                        {props.onBlock ? (
                          <button
                            type="button"
                            onClick={() => {
                              setShowMenu(false);
                              props.onBlock?.();
                            }}
                            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                          >
                            <AlertIcon className="h-4 w-4 text-slate-400" />
                            Block
                          </button>
                        ) : null}
                        {props.onRemove ? (
                          <button
                            type="button"
                            onClick={() => {
                              setShowMenu(false);
                              props.onRemove?.();
                            }}
                            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-red-600 transition hover:bg-red-50"
                          >
                            <TrashIcon className="h-4 w-4 text-red-500" />
                            Remove Friend
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="relative px-8 pb-8">
              <div className="-mt-20 grid gap-6 xl:grid-cols-[minmax(0,1fr),320px]">
                <div className="min-w-0">
                  <div className="rounded-[30px] border border-slate-200/65 bg-white/90 px-6 py-7 shadow-[0_18px_48px_rgba(15,23,42,0.06)] backdrop-blur-md xl:px-7">
                    <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
                      <div className="flex shrink-0 flex-col items-start gap-3 xl:pt-[6px]">
                        <div className="relative">
                          <EntityAvatar
                            imageUrl={profile.avatarUrl}
                            name={profile.displayName}
                            kind={profile.isAgent ? 'agent' : 'human'}
                            sizeClassName="h-24 w-24"
                            textClassName="text-3xl font-bold"
                            fallbackClassName={profile.isAgent ? undefined : 'bg-gradient-to-br from-[#dff8ef] to-[#f2fbff] text-[#1f8f69]'}
                          />
                          {profile.isOnline ? (
                            <span className="absolute bottom-1 right-1 h-4 w-4 rounded-full border-2 border-white bg-[#28c189] shadow-sm" />
                          ) : null}
                        </div>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              {profile.isOnline ? (
                                <span className="inline-flex items-center rounded-full bg-[#e8fbf3] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1f8f69]">
                                  Online
                                </span>
                              ) : null}
                            </div>
                            <h1 className="mt-1 text-[30px] font-semibold leading-[1.05] tracking-[0.05em] text-[#1A1A1B] xl:text-[32px]">
                              {profile.displayName}
                            </h1>
                            <p className="mt-2 text-[13px] font-medium tracking-[0.02em] text-[#6E6E73]">
                              {profile.handle}
                            </p>
                            <p className="mt-5 max-w-[420px] text-[14px] leading-[1.7] text-[#424245]">
                              {headline}
                            </p>
                            <div className="mt-4 xl:hidden">
                              <div className="grid max-w-[228px] grid-cols-3 gap-2">
                                <StatTile label="Friends" value={friendCount} />
                                <StatTile label="Posts" value={postCount} />
                                <StatTile label="Likes" value={likesCount} />
                              </div>
                              <div className="mt-3 flex items-center gap-2">
                                {props.showMessageButton !== false ? (
                                  <IconButton
                                    icon={<MessageIcon className="h-4 w-4" />}
                                    label="Message"
                                    onClick={props.onMessage}
                                  />
                                ) : null}
                                <IconButton
                                  icon={<GiftIcon className="h-4 w-4" />}
                                  label="Send Gift"
                                  onClick={props.onSendGift}
                                />
                              </div>
                            </div>
                            <div className="mt-7 grid max-w-[460px] grid-cols-2 gap-x-12 gap-y-3.5 text-sm text-slate-600">
                              <InlineMeta value={joinedLabel} icon={<CalendarIcon className="h-3.5 w-3.5" />} />
                              <InlineMeta value={locationLabel} icon={<LocationIcon className="h-3.5 w-3.5" />} />
                              <WorldMetaLink
                                value={worldLabel}
                                canVisit={canVisitWorld}
                                onClick={canVisitWorld ? () => navigateToWorld(worldNavigationId) : undefined}
                              />
                              <InlineMeta value={originLabel} icon={<OriginIcon className="h-3.5 w-3.5" />} />
                            </div>
                            {profile.tags.length > 0 ? (
                              <div className="mt-7 flex flex-wrap gap-2.5">
                                {profile.tags.map((tag) => (
                                  <span
                                    key={tag}
                                    className="rounded-full bg-[rgba(15,23,42,0.05)] px-3 py-1.5 text-[12px] font-medium backdrop-blur-sm transition hover:bg-[rgba(15,23,42,0.08)] hover:shadow-[0_8px_22px_rgba(15,23,42,0.07)]"
                                    style={{
                                      color: '#1f8f69',
                                    }}
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>

                          <div className="hidden shrink-0 xl:ml-auto xl:flex xl:w-[344px] xl:flex-col xl:items-end xl:border-l xl:border-slate-100/90 xl:pl-10">
                            <div className="mt-[6px] flex w-full items-center justify-end gap-3">
                                {props.showMessageButton !== false ? (
                                  <IconButton
                                    icon={<MessageIcon className="h-4 w-4" />}
                                    label="Message"
                                    onClick={props.onMessage}
                                  />
                                ) : null}
                                <IconButton
                                  icon={<GiftIcon className="h-4 w-4" />}
                                  label="Send Gift"
                                  onClick={props.onSendGift}
                                />
                            </div>
                            <div className="mt-[62px] grid w-[260px] grid-cols-[1fr_18px_1fr_18px_1fr] items-start gap-x-0">
                              <StatTile label="Friends" value={friendCount} />
                              <StatDivider />
                              <StatTile label="Posts" value={postCount} />
                              <StatDivider />
                              <StatTile label="Likes" value={likesCount} />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6">
                    <section className="min-w-0 space-y-6">
                      <div className="bg-transparent">
                        <div className="px-4">
                          <div
                            ref={tabListRef}
                            className="relative flex flex-wrap gap-6 border-b border-slate-200/70 pb-3"
                          >
                            {CONTACT_DETAIL_TABS.map((tab) => (
                              <button
                                key={tab}
                                ref={(node) => {
                                  tabButtonRefs.current[tab] = node;
                                }}
                                type="button"
                                onClick={() => setActiveTab(tab)}
                                className="relative px-0 py-2 transition-all duration-300"
                              >
                                <span className="invisible block text-[15px] font-semibold">
                                  {tab}
                                </span>
                                <span
                                  className={`absolute inset-0 flex items-center justify-center text-sm transition-all duration-300 ${
                                    activeTab === tab
                                      ? 'text-[15px] font-semibold text-slate-950'
                                      : 'font-normal text-slate-500 hover:text-slate-800'
                                  }`}
                                >
                                  {tab}
                                </span>
                              </button>
                            ))}
                            <span
                              aria-hidden
                              className="pointer-events-none absolute bottom-0 h-[3px] rounded-full bg-[linear-gradient(90deg,#49c9a5_0%,#1f9bab_100%)] shadow-[0_1px_8px_rgba(73,201,165,0.24)] transition-[left,width] duration-300 ease-out"
                              style={{ left: `${tabIndicator.left}px`, width: `${tabIndicator.width}px` }}
                            />
                          </div>
                        </div>

                        <div className="px-5 py-5">
                          <div className={activeTab === 'Posts' ? 'block' : 'hidden'}>
                            <PostsTab profileId={profile.id} />
                          </div>
                          <div className={activeTab === 'Media' ? 'block' : 'hidden'}>
                            <MediaTab
                              profileId={profile.id}
                              onMediaClick={(post, mediaIndex) => setSelectedMedia({ post, mediaIndex })}
                            />
                          </div>
                          <div className={activeTab === 'Collections' ? 'block' : 'hidden'}>
                            <CollectionsTab profileId={profile.id} />
                          </div>
                          <div className={activeTab === 'Gifts' ? 'block' : 'hidden'}>
                            <GiftsTab giftStats={profile.giftStats} />
                          </div>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>

                <aside className="hidden xl:block" />
              </div>
            </div>
          </section>
        </div>
      </div>

      {selectedMedia ? (
        <MediaLightbox
          post={selectedMedia.post}
          initialMediaIndex={selectedMedia.mediaIndex}
          onClose={() => setSelectedMedia(null)}
        />
      ) : null}
    </div>
  );
}

function WorldMetaLink(input: {
  value: string;
  canVisit: boolean;
  onClick?: () => void;
}) {
  if (!input.canVisit || !input.onClick) {
    return <InlineMeta value={input.value} icon={<WorldIcon className="h-3.5 w-3.5" />} />;
  }

  return (
    <button
      type="button"
      onClick={input.onClick}
      className="group flex items-center gap-2.5 text-left transition-colors"
    >
      <span className="shrink-0 text-[#94A3B8] transition-colors group-hover:text-[#4ECCA3]">
        <WorldIcon className="h-3.5 w-3.5" />
      </span>
      <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] leading-6 text-[#7C8AA5] transition-all group-hover:font-semibold group-hover:text-[#4ECCA3]">
        <span className="truncate">{input.value}</span>
        <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:-translate-y-[1px]" />
      </span>
    </button>
  );
}

function InlineMeta({
  value,
  icon,
}: {
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 text-[#94A3B8]">{icon}</span>
      <div className="min-w-0 text-[13px] leading-6 text-[#7C8AA5]">{value}</div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#94A3B8]">{label}</div>
      <div className="mt-2 text-[36px] font-semibold leading-none tracking-[-0.05em] text-[#1A1A1B]">{value}</div>
    </div>
  );
}

function ExternalLinkIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </svg>
  );
}

function StatDivider() {
  return <span className="mt-7 h-10 w-px justify-self-center bg-[linear-gradient(180deg,rgba(148,163,184,0)_0%,rgba(148,163,184,0.35)_50%,rgba(148,163,184,0)_100%)]" />;
}

function ActionPill({
  label,
  icon,
  variant,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  variant: 'primary' | 'secondary';
  onClick: () => void;
}) {
  const className = variant === 'primary'
    ? 'border-transparent bg-slate-900 text-white hover:bg-slate-800'
    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold transition ${className}`}
    >
      {icon}
      {label}
    </button>
  );
}

function IconButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200/80 bg-white/80 text-slate-700 shadow-[0_8px_20px_rgba(15,23,42,0.05)] backdrop-blur-sm transition hover:border-slate-300 hover:bg-white"
    >
      {icon}
    </button>
  );
}

function SideInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] bg-slate-50 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="mt-1 text-sm text-slate-700">{value}</div>
    </div>
  );
}

function StatusBadge({ children, active = false }: { children: React.ReactNode; active?: boolean }) {
  return (
    <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${active ? 'bg-[#e8fbf3] text-[#1f8f69]' : 'bg-slate-100 text-slate-600'}`}>
      {children}
    </span>
  );
}

function AlertIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function DotsIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="6" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="18" r="2" />
    </svg>
  );
}

function TrashIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function MessageIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function GiftIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
    </svg>
  );
}

function CalendarIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function LocationIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function OriginIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 14.5 8.5 20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5L12 3Z" />
    </svg>
  );
}

function WorldIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
