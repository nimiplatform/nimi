import { useEffect, useState } from 'react';
import { createPlatformClient, type PlatformClient } from '@nimiplatform/sdk';

type PostDto = NonNullable<Awaited<ReturnType<PlatformClient['domains']['publicContent']['getPublicPost']>>>;
type PostAttachmentDto = PostDto['attachments'][number];

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; post: PostDto }
  | { status: 'not_found' }
  | { status: 'error' };

export function PostPermalinkPage({ postId }: { postId: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const baseUrl = String(import.meta.env.VITE_NIMI_REALM_BASE_URL || import.meta.env.NIMI_REALM_URL || '').trim();
    if (!baseUrl) {
      setState({ status: 'error' });
      return () => {
        cancelled = true;
      };
    }

    createPlatformClient({
      appId: 'nimi.web',
      realmBaseUrl: baseUrl,
      allowAnonymousRealm: true,
      runtimeTransport: null,
    })
      .then((client) => client.domains.publicContent.getPublicPost(postId))
      .then((post) => {
        if (!cancelled) {
          setState(post ? { status: 'ok', post } : { status: 'not_found' });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: 'error' });
        }
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
  const firstAttachment = post.attachments[0];

  return (
    <article className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      {firstAttachment && <PostAttachment attachment={firstAttachment} />}

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
            href="https://github.com/nimiplatform/nimi/releases"
            className="block w-full text-center py-2.5 px-4 rounded-xl bg-[#4ecca3] hover:bg-[#2bb88e] text-white text-sm font-semibold transition-colors"
          >
            Open in Nimi
          </a>
        </div>
      </div>
    </article>
  );
}

function resolveRenderableAttachment(attachment: PostAttachmentDto): PostAttachmentDto | null {
  if (attachment.displayKind === 'CARD') {
    return attachment.preview ?? null;
  }
  return attachment;
}

function PostAttachment({ attachment }: { attachment: PostAttachmentDto }) {
  const renderable = resolveRenderableAttachment(attachment);
  if (!renderable) {
    return null;
  }

  if (renderable.displayKind === 'VIDEO' && renderable.url) {
    return (
      <div className="relative bg-black w-full aspect-square">
        {renderable.thumbnail && (
          <video
            src={renderable.url}
            poster={renderable.thumbnail}
            controls
            className="w-full h-full object-contain"
          />
        )}
        {!renderable.thumbnail && (
          <video
            src={renderable.url}
            controls
            className="w-full h-full object-contain"
          />
        )}
      </div>
    );
  }

  if (renderable.displayKind === 'IMAGE' && renderable.url) {
    return (
      <div className="w-full bg-slate-100">
        <img
          src={renderable.url}
          alt="Post image"
          className="w-full object-cover"
          style={
            renderable.width && renderable.height
              ? { aspectRatio: `${renderable.width}/${renderable.height}` }
              : { aspectRatio: '1/1' }
          }
        />
      </div>
    );
  }

  return null;
}
