import { useEffect, useState } from 'react';

interface PostMediaDto {
  type: 'IMAGE' | 'VIDEO' | 'AUDIO';
  url?: string;
  thumbnail?: string;
  width?: number;
  height?: number;
}

interface UserLiteDto {
  handle?: string;
  displayName?: string;
  avatarUrl?: string;
}

interface PostDto {
  id: string;
  caption?: string;
  media: PostMediaDto[];
  author?: UserLiteDto;
  createdAt?: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; post: PostDto }
  | { status: 'not_found' }
  | { status: 'error' };

export function PostPermalinkPage({ postId }: { postId: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/world/posts/public/${encodeURIComponent(postId)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setState({ status: 'not_found' });
          return;
        }
        if (!res.ok) {
          setState({ status: 'error' });
          return;
        }
        const post = (await res.json()) as PostDto;
        setState({ status: 'ok', post });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [postId]);

  return (
    <div className="min-h-screen flex flex-col items-center bg-[#f8fafc] px-4 py-12">
      <div className="w-full max-w-lg">
        <a href="/" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 mb-8">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          nimi
        </a>

        {state.status === 'loading' && (
          <div className="flex justify-center py-24">
            <div className="w-6 h-6 rounded-full border-2 border-slate-300 border-t-transparent animate-spin" />
          </div>
        )}

        {state.status === 'not_found' && (
          <div className="text-center py-24">
            <p className="text-slate-500 text-lg">This post is not available.</p>
          </div>
        )}

        {state.status === 'error' && (
          <div className="text-center py-24">
            <p className="text-slate-500 text-lg">Something went wrong. Please try again later.</p>
          </div>
        )}

        {state.status === 'ok' && (
          <PostCard post={state.post} />
        )}
      </div>
    </div>
  );
}

function PostCard({ post }: { post: PostDto }) {
  const firstMedia = post.media[0];

  return (
    <article className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      {firstMedia && <PostMedia media={firstMedia} />}

      <div className="p-5">
        {post.author && (
          <div className="flex items-center gap-3 mb-4">
            {post.author.avatarUrl ? (
              <img
                src={post.author.avatarUrl}
                alt={post.author.displayName ?? post.author.handle ?? 'Author'}
                className="w-9 h-9 rounded-full object-cover"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-slate-400 text-sm font-semibold">
                {(post.author.displayName ?? post.author.handle ?? '?')[0]?.toUpperCase()}
              </div>
            )}
            <div>
              {post.author.displayName && (
                <p className="text-sm font-semibold text-slate-800 leading-tight">{post.author.displayName}</p>
              )}
              {post.author.handle && (
                <p className="text-xs text-slate-500">@{post.author.handle}</p>
              )}
            </div>
          </div>
        )}

        {post.caption && (
          <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap">{post.caption}</p>
        )}

        <div className="mt-5 pt-5 border-t border-slate-100">
          <a
            href="https://nimi.xyz/download"
            className="block w-full text-center py-2.5 px-4 rounded-xl bg-[#4ecca3] hover:bg-[#2bb88e] text-white text-sm font-semibold transition-colors"
          >
            Open in Nimi
          </a>
        </div>
      </div>
    </article>
  );
}

function PostMedia({ media }: { media: PostMediaDto }) {
  if (media.type === 'VIDEO') {
    return (
      <div className="relative bg-black w-full aspect-square">
        {media.thumbnail && (
          <video
            src={media.url}
            poster={media.thumbnail}
            controls
            className="w-full h-full object-contain"
          />
        )}
        {!media.thumbnail && media.url && (
          <video
            src={media.url}
            controls
            className="w-full h-full object-contain"
          />
        )}
      </div>
    );
  }

  if (media.type === 'IMAGE' && media.url) {
    return (
      <div className="w-full bg-slate-100">
        <img
          src={media.url}
          alt="Post image"
          className="w-full object-cover"
          style={media.width && media.height ? { aspectRatio: `${media.width}/${media.height}` } : { aspectRatio: '1/1' }}
        />
      </div>
    );
  }

  return null;
}
