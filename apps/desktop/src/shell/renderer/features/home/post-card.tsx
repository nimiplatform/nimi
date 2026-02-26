import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PostDto } from '@nimiplatform/sdk/realm';
import { PostMediaType } from '@nimiplatform/sdk/realm';

function normalizeMediaType(type: unknown): PostMediaType | null {
  const normalized = String(type || '').toUpperCase();
  if (normalized === PostMediaType.IMAGE || normalized === PostMediaType.VIDEO) {
    return normalized as PostMediaType;
  }
  return null;
}

function resolveMediaUrl(media: PostDto['media'][number] | null | undefined): string | undefined {
  if (!media) {
    return undefined;
  }
  if (typeof media.url === 'string' && media.url.trim()) {
    return media.url.trim();
  }
  const maybeUid = (media as Record<string, unknown>).uid;
  if (typeof maybeUid === 'string' && maybeUid.trim()) {
    return maybeUid.trim();
  }
  return undefined;
}

function resolveVideoPlaybackSource(rawUrl?: string): { mode: 'iframe' | 'native'; src: string } | null {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }

  let token: string | null = null;
  let uid: string | null = null;

  try {
    const parsed = new URL(rawUrl);
    token = parsed.searchParams.get('token');
    const uidMatch = parsed.pathname.match(/^\/([a-zA-Z0-9]+)\/manifest\/video\.m3u8$/);
    if (uidMatch?.[1]) {
      uid = uidMatch[1];
    }
  } catch {
    const tokenMatch = rawUrl.match(/[?&]token=([^&]+)/);
    if (tokenMatch?.[1]) {
      token = decodeURIComponent(tokenMatch[1]);
    }
    const uidMatch = rawUrl.match(/videodelivery\.net\/([a-zA-Z0-9]+)\/manifest\/video\.m3u8/);
    if (uidMatch?.[1]) {
      uid = uidMatch[1];
    }
  }

  if (token) {
    return { mode: 'iframe', src: `https://iframe.videodelivery.net/${token}` };
  }
  if (uid) {
    return { mode: 'iframe', src: `https://iframe.videodelivery.net/${uid}` };
  }
  if (/^[a-zA-Z0-9]{8,}$/.test(rawUrl.trim())) {
    return { mode: 'iframe', src: `https://iframe.videodelivery.net/${rawUrl.trim()}` };
  }
  return { mode: 'native', src: rawUrl };
}

// Gift types
const GIFTS = [
  { id: 'candy', name: 'Candy', emoji: '🍬', price: 5 },
  { id: 'cookie', name: 'Cookie', emoji: '🍪', price: 10 },
  { id: 'coffee', name: 'Coffee', emoji: '☕', price: 100 },
  { id: 'rose', name: 'Rose', emoji: '🌹', price: 200 },
  { id: 'gem', name: 'Gem', emoji: '💎', price: 500 },
  { id: 'rocket', name: 'Rocket', emoji: '🚀', price: 1000 },
] as const;

// Add Friend Modal Component
function AddFriendModal({
  author,
  isOpen,
  onClose,
  onAddFriend,
}: {
  author: { name: string; handle: string; avatarUrl?: string | null; isAgent: boolean };
  isOpen: boolean;
  onClose: () => void;
  onAddFriend: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const initial = author.name.charAt(0).toUpperCase();

  const handleAddFriend = useCallback(() => {
    setLoading(true);
    // Simulate API call with message
    setTimeout(() => {
      setLoading(false);
      setMessage('');
      onAddFriend();
    }, 500);
  }, [onAddFriend]);

  const handleClose = useCallback(() => {
    if (!loading) {
      setMessage('');
      onClose();
    }
  }, [onClose, loading]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={handleClose}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-bold text-gray-900">Add Friend</h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-8 flex flex-col items-center">
          {/* Avatar */}
          <div className="relative">
            {author.avatarUrl ? (
              <img
                src={author.avatarUrl}
                alt={author.name}
                className={`h-20 w-20 object-cover ${
                  author.isAgent ? 'rounded-lg' : 'rounded-full ring-4 ring-mint-100'
                }`}
                style={author.isAgent ? {
                  boxShadow: '0 0 0 2px #a855f7, 0 0 8px 3px rgba(168, 85, 247, 0.5), 0 0 16px 6px rgba(124, 58, 237, 0.3)'
                } : undefined}
              />
            ) : (
              <div 
                className={`flex h-20 w-20 items-center justify-center text-2xl font-bold ${
                  author.isAgent 
                    ? 'rounded-lg bg-slate-100 text-slate-700' 
                    : 'rounded-full bg-mint-100 text-mint-700 ring-4 ring-mint-100'
                }`}
                style={author.isAgent ? {
                  boxShadow: '0 0 0 2px #a855f7, 0 0 8px 3px rgba(168, 85, 247, 0.5), 0 0 16px 6px rgba(124, 58, 237, 0.3)'
                } : undefined}
              >
                {initial}
              </div>
            )}
          </div>

          {/* Name & Handle */}
          <h3 className="mt-4 text-xl font-bold text-gray-900">{author.name}</h3>
          <p className="mt-1 text-sm text-gray-500">@{author.handle.replace(/^@/, '')}</p>

          {author.isAgent && (
            <span className="mt-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600">
              AI Agent
            </span>
          )}

          {/* Message Input */}
          <div className="w-full mt-4">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Say Hello..."
              className="w-full h-20 px-4 py-3 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-mint-500 focus:border-transparent placeholder:text-gray-400"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 bg-gray-50 flex gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAddFriend}
            disabled={loading}
            className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-mint-500 hover:bg-mint-600 transition-colors shadow-sm flex items-center justify-center gap-2 disabled:opacity-70"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Adding...
              </>
            ) : (
              'Add Friend'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Send Gift Modal Component
function SendGiftModal({
  author,
  isOpen,
  onClose,
}: {
  author: { name: string; handle: string; avatarUrl?: string | null };
  isOpen: boolean;
  onClose: () => void;
}) {
  const [selectedGift, setSelectedGift] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  
  const initial = author.name.charAt(0).toUpperCase();
  
  const handleSend = useCallback(() => {
    setSelectedGift(null);
    setMessage('');
    onClose();
  }, [onClose]);
  
  const handleClose = useCallback(() => {
    setSelectedGift(null);
    setMessage('');
    onClose();
  }, [onClose]);
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={handleClose}>
      <div className="relative mx-4 flex w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5">
          <h2 className="text-lg font-semibold text-gray-900">Send a Gift</h2>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 pb-6">
          {/* User Info */}
          <div className="flex flex-col items-center pb-6">
            <div className="relative">
              {author.avatarUrl ? (
                <img 
                  src={author.avatarUrl} 
                  alt={author.name} 
                  className="h-20 w-20 rounded-full object-cover ring-4 ring-[#E0F7F4]" 
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-[#E0F7F4] to-[#C5F0E8] text-2xl font-bold text-[#4ECCA3] ring-4 ring-[#E0F7F4]">
                  {initial}
                </div>
              )}
            </div>
            <h3 className="mt-3 text-lg font-semibold text-gray-900">{author.name}</h3>
            <p className="text-sm text-gray-500">{author.handle}</p>
          </div>

          {/* Gift Grid */}
          <div className="grid grid-cols-3 gap-3">
            {GIFTS.map((gift) => (
              <button
                key={gift.id}
                type="button"
                onClick={() => setSelectedGift(gift.id)}
                className={`flex flex-col items-center rounded-2xl border-2 px-3 py-4 text-center transition ${
                  selectedGift === gift.id
                    ? 'border-[#4ECCA3] bg-[#4ECCA3]/5'
                    : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50'
                }`}
              >
                <span className="text-3xl">{gift.emoji}</span>
                <span className="mt-2 text-sm font-medium text-gray-800">{gift.name}</span>
                <span className="text-xs font-semibold text-[#4ECCA3]">${gift.price}</span>
              </button>
            ))}
          </div>

          {/* Message Input */}
          <div className="mt-6">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-400">
              Message (Optional)
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Add a nice message..."
              className="w-full resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-[#4ECCA3] focus:bg-white focus:ring-2 focus:ring-[#4ECCA3]/20"
            />
            <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
              <LockIcon className="h-3.5 w-3.5" />
              <span>Only recipient can see</span>
            </div>
          </div>

          {/* Send Button */}
          <button
            type="button"
            onClick={handleSend}
            disabled={!selectedGift}
            className={`mt-6 flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-semibold transition ${
              selectedGift
                ? 'bg-[#4ECCA3] text-white hover:bg-[#3DBA92] hover:shadow-lg hover:shadow-[#4ECCA3]/25'
                : 'bg-[#E8EAED] text-gray-400 cursor-not-allowed opacity-60'
            }`}
          >
            {selectedGift ? (
              <>
                <span>Proceed</span>
                <span className="opacity-60">|</span>
                <span>${GIFTS.find(g => g.id === selectedGift)?.price}</span>
                <SendIcon className="h-4 w-4" />
              </>
            ) : (
              <>
                <span>Send Gift</span>
                <SendIcon className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function CloseIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function LockIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function SendIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

// Icon Components
function ChatIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function HeartIcon({ size = 18, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? '#EF4444' : 'none'}
      stroke={filled ? '#EF4444' : 'currentColor'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function GiftIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="18" height="13" rx="2" />
      <path d="M12 8v13" />
      <path d="M8 8a4 4 0 0 1 4-4v0a4 4 0 0 1 4 4" />
      <path d="M16 8a4 4 0 0 0-4-4v0a4 4 0 0 0-4 4" />
    </svg>
  );
}

// Native video player with custom small play button
function NativeVideoPlayer({ src, poster }: { src: string; poster?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const handlePlayClick = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleVideoClick = () => {
    handlePlayClick();
  };

  return (
    <div className="relative overflow-hidden bg-gray-900 rounded-lg group">
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        playsInline
        preload="metadata"
        className="w-full aspect-[4/5] object-cover cursor-pointer [&::-webkit-media-controls-start-playback-button]:hidden [&::-webkit-media-controls]:hidden"
        onClick={handleVideoClick}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />
      {/* Custom small play button overlay - shown when paused */}
      {!isPlaying && (
        <button
          type="button"
          onClick={handlePlayClick}
          className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors"
        >
          <div className="w-8 h-8 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-lg hover:scale-105 transition-transform">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#1A1A1A" className="ml-0.5">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </button>
      )}
    </div>
  );
}

export function PostCard({ post }: { post: PostDto }) {
  const navigate = useNavigate();
  const hasMedia = post.media && post.media.length > 0;
  const firstMedia = hasMedia
    ? post.media.find((m) => {
        const mediaType = normalizeMediaType(m.type);
        return mediaType === PostMediaType.IMAGE || mediaType === PostMediaType.VIDEO;
      })
    : null;
  const firstMediaType = normalizeMediaType(firstMedia?.type);
  const firstMediaUrl = resolveMediaUrl(firstMedia);
  const videoSource =
    firstMediaType === PostMediaType.VIDEO ? resolveVideoPlaybackSource(firstMediaUrl) : null;
  const authorRecord = (
    post.author && typeof post.author === 'object'
  ) ? (post.author as Record<string, unknown>) : null;

  const [isLiked, setIsLiked] = useState(false);
  const [isSendGiftOpen, setIsSendGiftOpen] = useState(false);
  const [isFriend, setIsFriend] = useState(authorRecord?.isFriend === true);
  const [showAddFriendModal, setShowAddFriendModal] = useState(false);

  const handleLike = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsLiked(!isLiked);
  };

  const handleChat = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const userId = post.author?.id || (post.author as unknown as { _id?: string })?._id;
    if (userId) {
      navigate('/chat', { state: { userId } });
    } else {
      // Fallback: just navigate to chat page
      navigate('/chat');
    }
  };

  return (
    <>
      <article className="rounded-2xl border border-gray-100 bg-white shadow-sm hover:shadow-md transition-shadow duration-300 overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <button
                type="button"
                onClick={() => navigate(`/profile/${post.author?.id || ''}`)}
                className="p-0 m-0 bg-transparent border-0 cursor-pointer"
              >
                {post.author?.avatarUrl ? (
                  <img
                    src={post.author.avatarUrl}
                    alt=""
                    className={`h-11 w-11 shrink-0 object-cover ${
                      post.author?.isAgent ? 'rounded-lg' : 'rounded-xl ring-2 ring-gray-50'
                    }`}
                    style={post.author?.isAgent ? {
                      boxShadow: '0 0 0 1.5px #a855f7, 0 0 4px 2px rgba(168, 85, 247, 0.4), 0 0 8px 3px rgba(124, 58, 237, 0.2)'
                    } : undefined}
                  />
                ) : (
                  <div 
                    className={`flex h-11 w-11 shrink-0 items-center justify-center text-sm font-semibold ${
                      post.author?.isAgent 
                        ? 'rounded-lg bg-slate-100 text-slate-700' 
                        : 'rounded-xl bg-mint-100 text-mint-700 ring-2 ring-gray-50'
                    }`}
                    style={post.author?.isAgent ? {
                      boxShadow: '0 0 0 1.5px #a855f7, 0 0 4px 2px rgba(168, 85, 247, 0.4), 0 0 8px 3px rgba(124, 58, 237, 0.2)'
                    } : undefined}
                  >
                    {(post.author?.displayName || '?').charAt(0)}
                  </div>
                )}
              </button>
              {/* Add Friend Badge - only show if not friend */}
              {!isFriend && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAddFriendModal(true);
                  }}
                  className="absolute -bottom-0.5 -right-0.5 h-4 w-4 bg-mint-500 rounded-full flex items-center justify-center hover:bg-mint-600 transition-colors shadow-sm"
                  title="Add friend"
                >
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-gray-900">{post.author?.displayName || 'Unknown'}</span>
              </div>
              {post.author?.handle ? (
                <div className="text-xs text-gray-400">
                  <span>@{post.author.handle}</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col justify-between h-11">
            <button
              type="button"
              className="p-1.5 -mr-1.5 -mt-1.5 text-gray-300 hover:text-gray-500 hover:bg-gray-50 rounded-lg transition-colors self-end"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="1" />
                <circle cx="19" cy="12" r="1" />
                <circle cx="5" cy="12" r="1" />
              </svg>
            </button>
            <span className="text-xs text-gray-400 self-end">
              {new Date(post.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </div>
        </div>

        {/* Media */}
        {firstMediaType === PostMediaType.VIDEO && videoSource?.mode === 'iframe' ? (
          <div className="relative overflow-hidden bg-gray-900 rounded-lg">
            <iframe
              src={videoSource.src}
              allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
              allowFullScreen
              className="w-full aspect-[4/5] border-0"
              title="Post video"
            />
          </div>
        ) : firstMediaType === PostMediaType.VIDEO && videoSource?.mode === 'native' ? (
          <NativeVideoPlayer src={videoSource.src} poster={firstMedia?.thumbnail} />
        ) : firstMediaType === PostMediaType.IMAGE && firstMediaUrl ? (
          <div className="relative overflow-hidden bg-gray-50 rounded-lg">
            <img
              src={firstMediaUrl}
              alt=""
              className="w-full aspect-[4/5] object-cover"
            />
          </div>
        ) : null}

        {/* Caption & Actions */}
        <div className="px-5 pt-3 flex items-start justify-between gap-4">
          {post.caption ? (
            <p className="text-sm text-gray-700 leading-relaxed flex-1">{post.caption}</p>
          ) : (
            <div className="flex-1" />
          )}
          {/* Action Buttons */}
          <div className="flex items-center gap-4 shrink-0 pt-0.5">
            <button
              type="button"
              onClick={(e) => handleLike(e)}
              className={`flex items-center justify-center transition-colors ${
                isLiked ? 'text-red-500' : 'text-gray-400 hover:text-red-500'
              }`}
            >
              <HeartIcon size={18} filled={isLiked} />
            </button>
            <button
              type="button"
              onClick={(e) => handleChat(e)}
              className="flex items-center justify-center text-gray-400 hover:text-mint-600 transition-colors"
            >
              <ChatIcon size={18} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsSendGiftOpen(true);
              }}
              className="flex items-center justify-center text-gray-400 hover:text-mint-600 transition-colors"
            >
              <GiftIcon size={18} />
            </button>
          </div>
        </div>

        {/* Tags */}
        {post.tags && post.tags.length > 0 ? (
          <div className="px-5 pb-5 pt-3 flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <span 
                key={tag} 
                className="inline-flex items-center px-2.5 py-1 rounded-lg bg-mint-50 text-xs font-medium text-mint-600 hover:bg-mint-100 transition-colors cursor-pointer"
              >
                #{tag}
              </span>
            ))}
          </div>
        ) : <div className="pb-5" />}
      </article>

      {/* Send Gift Modal */}
      <SendGiftModal
        author={{
          name: post.author?.displayName || 'Unknown',
          handle: post.author?.handle || '',
          avatarUrl: post.author?.avatarUrl,
        }}
        isOpen={isSendGiftOpen}
        onClose={() => setIsSendGiftOpen(false)}
      />

      {/* Add Friend Modal */}
      <AddFriendModal
        author={{
          name: post.author?.displayName || 'Unknown',
          handle: post.author?.handle || '',
          avatarUrl: post.author?.avatarUrl,
          isAgent: post.author?.isAgent || false,
        }}
        isOpen={showAddFriendModal}
        onClose={() => setShowAddFriendModal(false)}
        onAddFriend={() => {
          setIsFriend(true);
          setShowAddFriendModal(false);
        }}
      />
    </>
  );
}
