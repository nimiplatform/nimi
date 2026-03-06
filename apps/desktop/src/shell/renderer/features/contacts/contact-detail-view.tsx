import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PostDto } from '@nimiplatform/sdk/realm';
import { getSemanticAgentPalette } from '@renderer/components/agent-theme.js';
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
};

type MediaSelection = {
  post: PostDto;
  mediaIndex: number;
};

const CONTACT_DETAIL_TABS: ProfileTab[] = ['Posts', 'Media', 'Collections', 'Gifts'];

export function ContactDetailView(props: ContactDetailViewProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ProfileTab>('Posts');
  const [selectedMedia, setSelectedMedia] = useState<MediaSelection | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

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
  const headline = profile.bio || (profile.isAgent
    ? 'This contact has no public profile summary yet.'
    : 'No profile summary has been added yet.');

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[linear-gradient(180deg,#eef3f4_0%,#f7fafb_48%,#fcfefd_100%)]">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[1440px] flex-col px-6 py-6">
          <section className="relative overflow-hidden rounded-[34px] border border-white/70 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.10)]">
            <div className="relative h-[220px] px-8 py-7" style={headerStyle}>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.28),transparent_32%)]" />
              <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-white via-white/82 to-transparent" />

              <div className="relative z-10 flex items-start justify-end">
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
                  <div className="rounded-[30px] border border-slate-200/70 bg-white/92 p-6 shadow-[0_16px_44px_rgba(15,23,42,0.08)] backdrop-blur-sm">
                    <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
                      <div className="flex shrink-0 flex-col items-start gap-3 xl:pt-[18px]">
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
                            <h1 className="mt-1 text-[34px] font-semibold tracking-[-0.04em] text-slate-900">
                              {profile.displayName}
                            </h1>
                            <p
                              className="mt-1 text-sm font-semibold"
                              style={{ color: profile.isAgent ? palette.accent : '#64748b' }}
                            >
                              {profile.handle}
                            </p>
                            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600">
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
                            <div className="mt-5 flex flex-col gap-3 text-sm text-slate-600">
                              <InlineMeta value={joinedLabel} icon={<CalendarIcon className="h-3.5 w-3.5" />} />
                              <InlineMeta value={locationLabel} icon={<LocationIcon className="h-3.5 w-3.5" />} />
                              <InlineMeta value={worldLabel} icon={<WorldIcon className="h-3.5 w-3.5" />} />
                              <InlineMeta value={originLabel} icon={<OriginIcon className="h-3.5 w-3.5" />} />
                            </div>
                          </div>

                          <div className="hidden shrink-0 xl:ml-auto xl:flex xl:w-[332px] xl:flex-col xl:items-end">
                            <div className="mt-[8px] flex w-full items-center justify-end gap-3">
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
                            <div className="mt-[68px] grid w-[250px] grid-cols-[1fr_10px_1fr_10px_1fr] items-start gap-x-0.5">
                              <StatTile label="Friends" value={friendCount} />
                              <span />
                              <StatTile label="Posts" value={postCount} />
                              <span />
                              <StatTile label="Likes" value={likesCount} />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr),280px]">
                    <section className="min-w-0 space-y-6">
                      <div className="rounded-[28px] border border-slate-200/70 bg-white shadow-[0_12px_34px_rgba(15,23,42,0.05)]">
                        <div className="border-b border-slate-100 px-4">
                          <div className="flex flex-wrap gap-1.5">
                            {CONTACT_DETAIL_TABS.map((tab) => (
                              <button
                                key={tab}
                                type="button"
                                onClick={() => setActiveTab(tab)}
                                className={`relative rounded-[14px] px-4 py-3 text-sm font-semibold transition ${
                                  activeTab === tab
                                    ? 'border border-[#b7eadb] bg-[#e8fbf3] text-[#1f8f69] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.45)]'
                                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                                }`}
                              >
                                {tab}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="bg-[linear-gradient(180deg,#fbfcfd_0%,#f5f8fa_100%)] px-5 py-5">
                          {activeTab === 'Posts' && <PostsTab profileId={profile.id} />}
                          {activeTab === 'Media' && (
                            <MediaTab
                              profileId={profile.id}
                              onMediaClick={(post, mediaIndex) => setSelectedMedia({ post, mediaIndex })}
                            />
                          )}
                          {activeTab === 'Collections' && <CollectionsTab profileId={profile.id} />}
                          {activeTab === 'Gifts' && <GiftsTab giftStats={profile.giftStats} />}
                        </div>
                      </div>
                    </section>

                    <aside className="space-y-6">
                      <div className="rounded-[28px] border border-slate-200/70 bg-[linear-gradient(180deg,#ffffff_0%,#f7fafc_100%)] p-5 shadow-[0_12px_34px_rgba(15,23,42,0.05)]">
                        <h3 className="text-sm font-semibold text-slate-900">Status</h3>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <StatusBadge active={profile.isOnline}>{profile.isOnline ? 'Online now' : 'Offline'}</StatusBadge>
                          <StatusBadge>{profile.isAgent ? 'Agent account' : 'Human account'}</StatusBadge>
                          {profile.agentTier ? <StatusBadge>{profile.agentTier}</StatusBadge> : null}
                          {profile.agentState ? <StatusBadge>{profile.agentState}</StatusBadge> : null}
                        </div>
                      </div>

                      <div className="rounded-[28px] border border-slate-200/70 bg-white p-5 shadow-[0_12px_34px_rgba(15,23,42,0.05)]">
                        <h3 className="text-sm font-semibold text-slate-900">Highlights</h3>
                        <div className="mt-4 space-y-3">
                          <SideInfoRow label="World" value={profile.agentWorldId || profile.agentOwnerWorldId || 'Not linked'} />
                          <SideInfoRow label="Origin" value={profile.agentOrigin || 'Unknown'} />
                          <SideInfoRow label="Wake Strategy" value={profile.agentWakeStrategy || 'Not set'} />
                          <SideInfoRow label="Visibility" value={profile.agentIsPublic === null ? 'Unknown' : profile.agentIsPublic ? 'Public' : 'Private'} />
                        </div>
                      </div>

                      {profile.tags.length > 0 ? (
                        <div className="rounded-[28px] border border-slate-200/70 bg-white p-5 shadow-[0_12px_34px_rgba(15,23,42,0.05)]">
                          <h3 className="text-sm font-semibold text-slate-900">Tags</h3>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {profile.tags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full border px-3 py-1.5 text-xs font-medium"
                                style={{
                                  borderColor: profile.isAgent ? `${palette.badgeText}33` : '#d8efe8',
                                  backgroundColor: profile.isAgent ? `${palette.badgeBg}` : '#eefaf6',
                                  color: profile.isAgent ? palette.badgeText : '#2f7d6b',
                                }}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </aside>
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

function InlineMeta({
  value,
  icon,
}: {
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 text-slate-400">{icon}</span>
      <div className="min-w-0 text-[13px] leading-6 text-slate-400">{value}</div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-900">{value}</div>
    </div>
  );
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
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
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
