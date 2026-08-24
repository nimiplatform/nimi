import { useDesktopI18nResource } from '../../i18n/i18n-context';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import {
  ActionMenu,
  AppCardSurface,
  Popover,
  PopoverContent,
  PopoverTrigger,
  type NimiMenuItem,
} from '@nimiplatform/kit/ui';
import { EntityAvatar } from '../../components/entity-avatar.js';
import { E2E_IDS } from '../../testability/e2e-ids';
import { ChatIcon, HeartIcon } from './icons';
import { CloudflareVideoPlayer, NativeVideoPlayer } from './video-players';
import type { MediaDisplayKind, VideoPlaybackSource } from './utils';

type PostDto = RealmModel<'PostDto'>;

export type PostCardArticleProps = {
  post: PostDto;
  authorId: string;
  authorName: string;
  authorHandle: string;
  authorAvatarUrl?: string | null;
  authorKind: 'human' | 'character';
  canUseHumanAuthorActions: boolean;
  isFriend: boolean;
  isOwnPost: boolean;
  canEditPost?: boolean;
  canEditVisibility?: boolean;
  showAddFriendBadge?: boolean;
  isLiked: boolean;
  isLikePending?: boolean;
  showPostMenu: boolean;
  firstMediaType: MediaDisplayKind | null;
  firstMediaUrl?: string;
  firstMediaThumbnail?: string;
  videoSource: VideoPlaybackSource | null;
  onOpenAuthorProfile: () => void;
  onOpenAddFriendModal: () => void;
  onPostMenuOpenChange: (open: boolean) => void;
  onOpenEditPost: () => void;
  onOpenEditVisibility: () => void;
  onOpenDeleteConfirm: () => void;
  onOpenBlockConfirm: () => void;
  onOpenReportModal: () => void;
  onToggleLike: () => void;
  onChat: () => void;
  showChatButton?: boolean;
};

export function PostCardArticle(props: PostCardArticleProps) {
  const i18nResource = useDesktopI18nResource();
  const i18n = i18nResource.instance;
  const authorName = props.authorName || i18n.t('Common.unknown', { defaultValue: 'Unknown' });
  const authorHandle = props.authorHandle || '';
  const SHOW_AVATAR_STATUS_INDICATOR = false;
  const isRecent = i18nResource.now() - new Date(props.post.createdAt).getTime() < 3600000; // 1 hour
  const postMenuLabel = i18n.t('Home.postMenu', { defaultValue: 'Post menu' });
  const postMenuItems: NimiMenuItem[] = props.isOwnPost
    ? [
      ...(props.canEditPost !== false ? [{
        id: 'edit',
        label: i18n.t('Home.edit', { defaultValue: 'Edit' }),
        icon: <EditIcon className="h-4 w-4" />,
        onSelect: props.onOpenEditPost,
      }] : []),
      ...(props.canEditVisibility !== false ? [{
        id: 'edit-visibility',
        label: i18n.t('Home.modifyVisibility', { defaultValue: 'Modify visibility' }),
        icon: <EyeIcon className="h-4 w-4" />,
        onSelect: props.onOpenEditVisibility,
      }] : []),
      {
        id: 'delete',
        label: i18n.t('Home.delete', { defaultValue: 'Delete' }),
        icon: <TrashIcon className="h-4 w-4" />,
        tone: 'danger' as const,
        onSelect: props.onOpenDeleteConfirm,
      },
    ]
    : [
      ...(props.canUseHumanAuthorActions ? [{
        id: 'block',
        label: i18n.t('Home.block', { defaultValue: 'Block' }),
        icon: <BlockIcon className="h-4 w-4" />,
        tone: 'danger' as const,
        onSelect: props.onOpenBlockConfirm,
      }] : []),
      {
        id: 'report',
        label: i18n.t('Home.report', { defaultValue: 'Report' }),
        icon: <ReportIcon className="h-4 w-4" />,
        tone: 'danger' as const,
        onSelect: props.onOpenReportModal,
      },
    ];
  return (
    <AppCardSurface
      kind="promoted-glass"
      as="article"
      className="group isolate overflow-hidden border-white/70 transition-all duration-300 [backface-visibility:hidden] [transform:translateZ(0)] hover:-translate-y-0.5 hover:shadow-[0_20px_52px_rgba(15,23,42,0.09)]"
    >
      <div className="flex items-start justify-between gap-4 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="relative">
            <button
              type="button"
              data-testid={props.post.id ? E2E_IDS.feedPostAuthor(props.post.id) : undefined}
              disabled={!props.authorId}
              onClick={(event) => {
                event.stopPropagation();
                if (props.authorId) {
                  props.onOpenAuthorProfile();
                }
              }}
              className="m-0 cursor-pointer border-0 bg-transparent p-0 disabled:cursor-default relative"
            >
              <EntityAvatar
                imageUrl={props.authorAvatarUrl}
                name={authorName}
                kind={props.authorKind === 'character' ? 'source' : 'human'}
                sizeClassName="h-11 w-11"
                className="shrink-0 ring-1 ring-black/5 transition-transform duration-500 group-hover:scale-105"
                fallbackClassName="bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-secondary)] ring-1 ring-black/5"
                textClassName="text-sm font-semibold"
              />

              {/* Live Pulse Indicator */}
              {SHOW_AVATAR_STATUS_INDICATOR && isRecent && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--nimi-action-primary-bg)] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-[var(--nimi-action-primary-bg)]"></span>
                </span>
              )}
            </button>
            {props.canUseHumanAuthorActions && props.showAddFriendBadge !== false && !props.isFriend && !props.isOwnPost ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onOpenAddFriendModal();
                }}
                className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)] shadow-md border-2 border-white transition-transform hover:scale-110"
                title={i18n.t('Relationship.addContact', { defaultValue: 'Add Friend' })}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            ) : null}
          </div>
          <div className="min-w-0">
            <button
              type="button"
              disabled={!props.authorId}
              onClick={(event) => {
                event.stopPropagation();
                if (props.authorId) {
                  props.onOpenAuthorProfile();
                }
              }}
              className="block text-left m-0 cursor-pointer border-0 bg-transparent p-0 disabled:cursor-default"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[15px] font-semibold text-[var(--nimi-text-primary)] transition-colors group-hover:text-[var(--nimi-action-primary-bg)]">{authorName}</span>
              </div>
              {authorHandle ? (
                <div className="mt-0.5 truncate text-[12px] font-medium text-[var(--nimi-text-muted)]">
                  <span>{authorHandle}</span>
                </div>
              ) : null}
            </button>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <Popover open={props.showPostMenu} onOpenChange={props.onPostMenuOpenChange}>
            <PopoverTrigger asChild>
              <button
                type="button"
                onClick={(event) => event.stopPropagation()}
                className="rounded-full p-2 text-[var(--nimi-text-muted)] transition-all hover:bg-[color-mix(in_srgb,var(--nimi-surface-active)_60%,transparent)] hover:text-[var(--nimi-text-primary)]"
                aria-label={postMenuLabel}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
                </svg>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={6} className="w-44 p-1">
              <ActionMenu items={postMenuItems} ariaLabel={postMenuLabel} />
            </PopoverContent>
          </Popover>
          {props.isOwnPost && props.post.visibility !== 'PUBLIC' ? (
            <span
              className="flex items-center gap-1 text-[9px] text-[var(--nimi-text-muted)]"
              title={props.post.visibility === 'FRIENDS'
                ? i18n.t('Home.visibilityFriendsOnly', { defaultValue: 'Friends only' })
                : i18n.t('Home.visibilityPrivateOnly', { defaultValue: 'Private' })}
            >
              {props.post.visibility === 'PRIVATE' ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              )}
            </span>
          ) : null}
          <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_62%,transparent)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)] ring-1 ring-[var(--nimi-border-subtle)]">
            {i18nResource.formatDate(props.post.createdAt, { month: 'short', day: 'numeric' })}
          </span>
        </div>
      </div>

      {props.firstMediaType === 'VIDEO' && props.videoSource?.mode === 'iframe' ? (
        <div className="px-4 pb-2"><CloudflareVideoPlayer src={props.videoSource.src} /></div>
      ) : props.firstMediaType === 'VIDEO' && props.videoSource?.mode === 'native' ? (
        <div className="px-4 pb-2"><NativeVideoPlayer src={props.videoSource.src} poster={props.firstMediaThumbnail} /></div>
      ) : props.firstMediaType === 'IMAGE' && props.firstMediaUrl ? (
        <div className="relative mx-4 overflow-hidden rounded-xl bg-[var(--nimi-surface-panel)] shadow-inner aspect-[4/5]">
          <img
            src={props.firstMediaUrl}
            alt=""
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
          />
        </div>
      ) : null}

      <div className="px-5 py-4">
        {props.post.caption ? (
          <p className="text-[14px] leading-7 text-[var(--nimi-text-secondary)]">{props.post.caption}</p>
        ) : null}

        <div className="mt-5 flex items-center justify-between border-t border-black/5 pt-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                props.onToggleLike();
              }}
              disabled={props.isLikePending}
              className={`flex h-9 w-9 items-center justify-center rounded-full transition-all ${
                props.isLiked ? 'scale-105 bg-rose-50 text-rose-500' : 'text-[var(--nimi-text-muted)] hover:bg-rose-50 hover:text-rose-500'
              } disabled:opacity-50`}
              aria-label={i18n.t('Home.likes', { defaultValue: 'Likes' })}
            >
              <HeartIcon size={18} filled={props.isLiked} />
            </button>
          </div>

          {!props.isOwnPost ? (
            <div className="flex items-center gap-3">
              {props.canUseHumanAuthorActions && props.showChatButton !== false ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onChat();
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--nimi-action-primary-bg)]/10 text-[var(--nimi-action-primary-bg)] shadow-sm transition-[background-color,color,box-shadow,transform] hover:bg-[var(--nimi-action-primary-bg)] hover:text-[var(--nimi-action-primary-text)] hover:shadow-md active:scale-95"
                  aria-label={i18n.t('Home.openChat', { defaultValue: 'Open chat' })}
                >
                  <ChatIcon size={18} />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {props.post.tags && props.post.tags.length > 0 && (
        <div className="flex flex-wrap gap-2 px-6 pb-6">
          {props.post.tags.map((tag) => (
            <span
              key={tag}
              className="cursor-pointer rounded-full bg-[var(--nimi-action-primary-bg)]/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--nimi-action-primary-bg)] transition-opacity hover:opacity-80"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </AppCardSurface>
  );
}

function EditIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function EyeIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function TrashIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function BlockIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  );
}

function ReportIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
