import type { ReactNode, RefObject } from 'react';
import type { PostDto } from '@nimiplatform/sdk/realm';
import { PostMediaType } from '@nimiplatform/sdk/realm';
import { formatLocaleDate, i18n } from '@renderer/i18n';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { ChatIcon, GiftIcon, HeartIcon } from './icons';
import { CloudflareVideoPlayer, NativeVideoPlayer } from './video-players';
import type { VideoPlaybackSource } from './utils';

export type PostCardArticleProps = {
  post: PostDto;
  authorId: string;
  isFriend: boolean;
  isOwnPost: boolean;
  showAddFriendBadge?: boolean;
  isLiked: boolean;
  isLikePending?: boolean;
  showPostMenu: boolean;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  firstMediaType: PostMediaType | null;
  firstMediaUrl?: string;
  firstMediaThumbnail?: string;
  videoSource: VideoPlaybackSource | null;
  onOpenAuthorProfile: () => void;
  onOpenAddFriendModal: () => void;
  onTogglePostMenu: () => void;
  onOpenEditPost: () => void;
  onOpenEditVisibility: () => void;
  onOpenDeleteConfirm: () => void;
  onOpenBlockConfirm: () => void;
  onOpenReportModal: () => void;
  onCopyLink: () => void;
  onSavePost: () => void;
  isSavedPost: boolean;
  onToggleLike: () => void;
  onChat: () => void;
  showChatButton?: boolean;
  onOpenGift: () => void;
};

export function PostCardArticle(props: PostCardArticleProps) {
  const authorName = props.post.author?.displayName || i18n.t('Common.unknown', { defaultValue: 'Unknown' });
  const authorHandle = props.post.author?.handle || '';
  const SHOW_AVATAR_STATUS_INDICATOR = false;
  const isRecent = new Date().getTime() - new Date(props.post.createdAt).getTime() < 3600000; // 1 hour
  return (
    <article className="group isolate overflow-hidden rounded-[1.5rem] border border-white/40 bg-white/70 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.03)] transition-all duration-500 [backface-visibility:hidden] [transform:translateZ(0)] hover:-translate-y-1 hover:shadow-[0_12px_48px_rgba(78,204,163,0.12)]">
      <div className="flex items-start justify-between px-6 py-5">
        <div className="flex items-center gap-4">
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
                imageUrl={props.post.author?.avatarUrl}
                name={authorName}
                kind={props.post.author?.isAgent ? 'agent' : 'human'}
                sizeClassName="h-12 w-12"
                className={`shrink-0 transition-transform duration-500 group-hover:scale-105 ${props.post.author?.isAgent ? '' : 'ring-1 ring-black/5'}`}
                fallbackClassName={props.post.author?.isAgent ? undefined : 'bg-slate-100 text-slate-600 ring-1 ring-black/5'}
                textClassName={props.post.author?.isAgent ? 'text-white text-sm font-semibold' : 'text-sm font-semibold'}
              />
              
              {/* Live Pulse Indicator */}
              {SHOW_AVATAR_STATUS_INDICATOR && isRecent && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#4ECCA3] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-[#4ECCA3]"></span>
                </span>
              )}
            </button>
            {props.showAddFriendBadge !== false && !props.isFriend && !props.isOwnPost ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onOpenAddFriendModal();
                }}
                className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#4ECCA3] text-white shadow-md border-2 border-white transition-transform hover:scale-110"
                title={i18n.t('Contacts.addContact', { defaultValue: 'Add Friend' })}
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
              <div className="flex items-center gap-1.5">
                <span className="text-[15px] font-semibold text-slate-900 tracking-tight transition-colors group-hover:text-[#3DBB94]">{authorName}</span>
              </div>
              {authorHandle ? (
                <div className="text-[11px] text-slate-400 font-light tracking-wider">
                  <span>{authorHandle}</span>
                </div>
              ) : null}
            </button>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="relative">
            <button
              ref={props.menuButtonRef}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                props.onTogglePostMenu();
              }}
              className="rounded-full p-2 text-slate-300 transition-all hover:bg-black/5 hover:text-slate-600"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
              </svg>
            </button>
            {props.showPostMenu ? (
              <div className="absolute right-0 top-full z-20 mt-2 w-44 overflow-hidden rounded-2xl border border-gray-100 bg-white/95 py-1.5 shadow-[0_18px_48px_rgba(15,23,42,0.16)] backdrop-blur-xl">
                {props.isOwnPost ? (
                  <>
                    <MenuAction label={i18n.t('Home.edit', { defaultValue: 'Edit' })} icon={<EditIcon className="h-4 w-4" />} onClick={props.onOpenEditPost} />
                    <MenuAction label={i18n.t('Home.modifyVisibility', { defaultValue: 'Modify visibility' })} icon={<EyeIcon className="h-4 w-4" />} onClick={props.onOpenEditVisibility} />
                    <MenuAction label={i18n.t('Home.delete', { defaultValue: 'Delete' })} icon={<TrashIcon className="h-4 w-4" />} onClick={props.onOpenDeleteConfirm} tone="danger" />
                  </>
                ) : (
                  <>
                    <MenuAction label={i18n.t('Home.copyLink', { defaultValue: 'Copy link' })} icon={<LinkIcon className="h-4 w-4" />} onClick={props.onCopyLink} />
                    <MenuAction
                      label={props.isSavedPost
                        ? i18n.t('Home.saved', { defaultValue: 'Saved' })
                        : i18n.t('Home.savePost', { defaultValue: 'Save post' })}
                      icon={<SaveIcon className="h-4 w-4" filled={props.isSavedPost} />}
                      onClick={props.onSavePost}
                    />
                    <MenuAction label={i18n.t('Home.block', { defaultValue: 'Block' })} icon={<BlockIcon className="h-4 w-4" />} onClick={props.onOpenBlockConfirm} tone="danger" />
                    <MenuAction label={i18n.t('Home.report', { defaultValue: 'Report' })} icon={<ReportIcon className="h-4 w-4" />} onClick={props.onOpenReportModal} tone="danger" />
                  </>
                )}
              </div>
            ) : null}
          </div>
          {props.isOwnPost && props.post.visibility !== 'PUBLIC' ? (
            <span className="flex items-center gap-1 text-[9px] text-slate-400" title={props.post.visibility === 'FRIENDS' ? 'Friends only' : 'Private'}>
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
          <span className="text-[9px] uppercase tracking-[0.2em] text-slate-400 font-medium">
            {formatLocaleDate(props.post.createdAt, { month: 'short', day: 'numeric' })}
          </span>
        </div>
      </div>

      {props.firstMediaType === PostMediaType.VIDEO && props.videoSource?.mode === 'iframe' ? (
        <div className="px-4 pb-2"><CloudflareVideoPlayer src={props.videoSource.src} /></div>
      ) : props.firstMediaType === PostMediaType.VIDEO && props.videoSource?.mode === 'native' ? (
        <div className="px-4 pb-2"><NativeVideoPlayer src={props.videoSource.src} poster={props.firstMediaThumbnail} /></div>
      ) : props.firstMediaType === PostMediaType.IMAGE && props.firstMediaUrl ? (
        <div className="relative mx-4 overflow-hidden rounded-2xl bg-slate-50 shadow-inner aspect-[4/5]">
          <img
            src={props.firstMediaUrl}
            alt=""
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
          />
        </div>
      ) : null}

      <div className="px-6 py-5">
        {props.post.caption ? (
          <p className="text-[14px] leading-[1.7] text-slate-700 font-light tracking-wide">{props.post.caption}</p>
        ) : null}

        <div className="mt-6 flex items-center justify-between border-t border-black/5 pt-5">
          <div className="flex items-center gap-8">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                props.onToggleLike();
              }}
              disabled={props.isLikePending}
              className={`flex items-center gap-2 transition-all ${
                props.isLiked ? 'text-rose-500 scale-110' : 'text-slate-400 hover:text-rose-500'
              } disabled:opacity-50`}
            >
              <HeartIcon size={18} filled={props.isLiked} />
            </button>
          </div>

          {!props.isOwnPost ? (
            <div className="flex items-center gap-3">
              {props.showChatButton !== false ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onChat();
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-[#4ECCA3]/10 text-[#3DBB94] shadow-sm transition-all hover:bg-[#4ECCA3] hover:text-white hover:shadow-md active:scale-95"
                >
                  <ChatIcon size={18} />
                </button>
              ) : null}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onOpenGift();
                }}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[#4ECCA3]/10 text-[#3DBB94] shadow-sm transition-all hover:bg-[#4ECCA3] hover:text-white hover:shadow-md active:scale-95"
              >
                <GiftIcon size={18} />
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {props.post.tags && props.post.tags.length > 0 && (
        <div className="flex flex-wrap gap-2 px-6 pb-6">
          {props.post.tags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] font-bold uppercase tracking-widest text-[#3DBB94] opacity-50 hover:opacity-100 transition-opacity cursor-pointer"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function MenuAction(input: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  tone?: 'default' | 'danger';
}) {
  const className = input.tone === 'danger'
    ? 'text-red-600 hover:bg-red-50'
    : 'text-slate-700 hover:bg-slate-50';

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        input.onClick();
      }}
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition ${className}`}
    >
      <span className="shrink-0">{input.icon}</span>
      {input.label}
    </button>
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

function LinkIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function SaveIcon({ className = '', filled = false }: { className?: string; filled?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
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
