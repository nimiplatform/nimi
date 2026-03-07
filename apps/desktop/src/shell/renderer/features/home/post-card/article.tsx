import type { RefObject } from 'react';
import type { PostDto } from '@nimiplatform/sdk/realm';
import { PostMediaType } from '@nimiplatform/sdk/realm';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
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
  onOpenDeleteConfirm: () => void;
  onOpenBlockConfirm: () => void;
  onOpenReportModal: () => void;
  onToggleLike: () => void;
  onChat: () => void;
  onOpenGift: () => void;
};

export function PostCardArticle(props: PostCardArticleProps) {
  const authorName = props.post.author?.displayName || 'Unknown';
  const authorHandle = props.post.author?.handle || '';
  const isRecent = new Date().getTime() - new Date(props.post.createdAt).getTime() < 3600000; // 1 hour
  return (
    <article className="overflow-hidden rounded-[1.5rem] border border-white/40 bg-white/70 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.03)] transition-all duration-500 hover:shadow-[0_12px_48px_rgba(78,204,163,0.12)] hover:-translate-y-1 group">
      <div className="flex items-start justify-between px-6 py-5">
        <div className="flex items-center gap-4">
          <div className="relative">
            <button
              type="button"
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
              {isRecent && (
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
                title="Add friend"
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
                  <span>@{authorHandle}</span>
                </div>
              ) : null}
            </button>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
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
          <span className="text-[9px] uppercase tracking-[0.2em] text-slate-400 font-medium">
            {new Date(props.post.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </div>
      </div>

      {props.firstMediaType === PostMediaType.VIDEO && props.videoSource?.mode === 'iframe' ? (
        <div className="px-4 pb-2"><CloudflareVideoPlayer src={props.videoSource.src} /></div>
      ) : props.firstMediaType === PostMediaType.VIDEO && props.videoSource?.mode === 'native' ? (
        <div className="px-4 pb-2"><NativeVideoPlayer src={props.videoSource.src} poster={props.firstMediaThumbnail} /></div>
      ) : props.firstMediaType === PostMediaType.IMAGE && props.firstMediaUrl ? (
        <div className="relative overflow-hidden mx-4 rounded-2xl bg-slate-50 shadow-inner">
          <img
            src={props.firstMediaUrl}
            alt=""
            className="w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
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
