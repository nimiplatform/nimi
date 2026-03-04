import type { RefObject } from 'react';
import type { PostDto } from '@nimiplatform/sdk/realm';
import { PostMediaType } from '@nimiplatform/sdk/realm';
import { ChatIcon, GiftIcon, HeartIcon } from './icons';
import { CloudflareVideoPlayer, NativeVideoPlayer } from './video-players';
import type { VideoPlaybackSource } from './utils';

export type PostCardArticleProps = {
  post: PostDto;
  authorId: string;
  isFriend: boolean;
  isOwnPost: boolean;
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

  return (
    <article className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md">
      <div className="flex items-start justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                props.onOpenAuthorProfile();
              }}
              className="m-0 cursor-pointer border-0 bg-transparent p-0"
            >
              {props.post.author?.avatarUrl ? (
                <img
                  src={props.post.author.avatarUrl}
                  alt=""
                  className={`h-11 w-11 shrink-0 rounded-xl object-cover ${
                    props.post.author?.isAgent ? '' : 'ring-2 ring-gray-50'
                  }`}
                  style={props.post.author?.isAgent
                    ? {
                      boxShadow: '0 0 0 1.5px #a855f7, 0 0 4px 2px rgba(168, 85, 247, 0.4), 0 0 8px 3px rgba(124, 58, 237, 0.2)',
                    }
                    : undefined}
                />
              ) : (
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-semibold ${
                    props.post.author?.isAgent
                      ? 'bg-gradient-to-br from-[#4ECCA3] to-[#3DBB94] text-white'
                      : 'bg-mint-100 text-mint-700 ring-2 ring-gray-50'
                  }`}
                  style={props.post.author?.isAgent
                    ? {
                      boxShadow: '0 0 0 1.5px #a855f7, 0 0 4px 2px rgba(168, 85, 247, 0.4), 0 0 8px 3px rgba(124, 58, 237, 0.2)',
                    }
                    : undefined}
                >
                  {authorName.charAt(0)}
                </div>
              )}
            </button>
            {!props.isFriend && !props.isOwnPost ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onOpenAddFriendModal();
                }}
                className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-mint-500 shadow-sm transition-colors hover:bg-mint-600"
                title="Add friend"
              >
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            ) : null}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-gray-900">{authorName}</span>
            </div>
            {authorHandle ? (
              <div className="text-xs text-gray-400">
                <span>@{authorHandle}</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="relative flex h-11 flex-col justify-between">
          <button
            ref={props.menuButtonRef}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              props.onTogglePostMenu();
            }}
            className="-mr-1.5 -mt-1.5 self-end rounded-lg p-1.5 text-gray-300 transition-colors hover:bg-gray-50 hover:text-gray-500"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="1" />
              <circle cx="19" cy="12" r="1" />
              <circle cx="5" cy="12" r="1" />
            </svg>
          </button>

          {props.showPostMenu ? (
            <div className="absolute right-0 top-8 z-30 w-40 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-lg">
              {props.isOwnPost ? (
                <>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onOpenEditPost();
                    }}
                    className="flex w-full items-center gap-2 rounded-t-xl px-4 py-2.5 text-sm text-gray-700 transition-colors hover:bg-mint-50 hover:text-mint-700"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    Edit Post
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onOpenDeleteConfirm();
                    }}
                    className="flex w-full items-center gap-2 rounded-b-xl px-4 py-2.5 text-sm text-red-600 transition-colors hover:bg-red-50"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                    Delete Post
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onOpenBlockConfirm();
                    }}
                    className="flex w-full items-center gap-2 rounded-t-xl px-4 py-2.5 text-sm text-gray-700 transition-colors hover:bg-mint-50 hover:text-mint-700"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                    </svg>
                    Block User
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onOpenReportModal();
                    }}
                    className="flex w-full items-center gap-2 rounded-b-xl px-4 py-2.5 text-sm text-gray-700 transition-colors hover:bg-mint-50 hover:text-mint-700"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    Report Post
                  </button>
                </>
              )}
            </div>
          ) : null}
          <span className="self-end text-xs text-gray-400">
            {new Date(props.post.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </div>
      </div>

      {props.firstMediaType === PostMediaType.VIDEO && props.videoSource?.mode === 'iframe' ? (
        <CloudflareVideoPlayer src={props.videoSource.src} />
      ) : props.firstMediaType === PostMediaType.VIDEO && props.videoSource?.mode === 'native' ? (
        <NativeVideoPlayer src={props.videoSource.src} poster={props.firstMediaThumbnail} />
      ) : props.firstMediaType === PostMediaType.IMAGE && props.firstMediaUrl ? (
        <div className="relative overflow-hidden rounded-lg bg-gray-50">
          <img
            src={props.firstMediaUrl}
            alt=""
            className="aspect-[4/5] w-full object-cover"
          />
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-4 px-5 pt-3">
        {props.post.caption ? (
          <p className="flex-1 text-sm leading-relaxed text-gray-700">{props.post.caption}</p>
        ) : (
          <div className="flex-1" />
        )}
        <div className="shrink-0 flex items-center gap-4 pt-0.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              props.onToggleLike();
            }}
            disabled={props.isLikePending}
            className={`flex items-center justify-center transition-colors ${
              props.isLiked ? 'text-red-500' : 'text-gray-400 hover:text-red-500'
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <HeartIcon size={18} filled={props.isLiked} />
          </button>

          {!props.isOwnPost ? (
            <>
              {!props.post.author?.isAgent ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onChat();
                  }}
                  className="flex items-center justify-center text-gray-400 transition-colors hover:text-mint-600"
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
                className="flex items-center justify-center text-gray-400 transition-colors hover:text-mint-600"
              >
                <GiftIcon size={18} />
              </button>
            </>
          ) : null}
        </div>
      </div>

      {props.post.tags && props.post.tags.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-5 pb-5 pt-3">
          {props.post.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex cursor-pointer items-center rounded-lg bg-mint-50 px-2.5 py-1 text-xs font-medium text-mint-600 transition-colors hover:bg-mint-100"
            >
              #{tag}
            </span>
          ))}
        </div>
      ) : <div className="pb-5" />}
    </article>
  );
}
