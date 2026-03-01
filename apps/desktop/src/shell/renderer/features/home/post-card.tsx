import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { PostDto } from '@nimiplatform/sdk/realm';
import { PostMediaType } from '@nimiplatform/sdk/realm';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { dataSync } from '@runtime/data-sync';
import { useTranslation } from 'react-i18next';

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
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
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
                className={`h-20 w-20 object-cover rounded-2xl ${
                  author.isAgent ? '' : 'ring-4 ring-mint-100'
                }`}
                style={author.isAgent ? {
                  boxShadow: '0 0 0 2px #a855f7, 0 0 8px 3px rgba(168, 85, 247, 0.5), 0 0 16px 6px rgba(124, 58, 237, 0.3)'
                } : undefined}
              />
            ) : (
              <div 
                className={`flex h-20 w-20 items-center justify-center text-2xl font-bold rounded-2xl ${
                  author.isAgent 
                    ? 'bg-gradient-to-br from-[#4ECCA3] to-[#3DBB94] text-white' 
                    : 'bg-mint-100 text-mint-700 ring-4 ring-mint-100'
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
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  
  const initial = author.name.charAt(0).toUpperCase();
  
  const handleAmountChange = (value: string) => {
    const numericValue = value.replace(/[^0-9]/g, '');
    const cleanedValue = numericValue.replace(/^0+/, '') || '';
    setAmount(cleanedValue);
  };
  
  const gemAmount = parseInt(amount, 10) || 0;
  
  const handleSend = useCallback(async () => {
    if (gemAmount <= 0) return;
    setSending(true);
    // TODO: Implement actual API call when author ID is available
    setTimeout(() => {
      setAmount('');
      setMessage('');
      setSending(false);
      onClose();
    }, 500);
  }, [gemAmount, onClose]);
  
  const handleClose = useCallback(() => {
    setAmount('');
    setMessage('');
    onClose();
  }, [onClose]);
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={handleClose}>
      <div className="relative mx-4 w-full max-w-sm rounded-3xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5">
          <h2 className="text-lg font-semibold text-gray-900">{t('sendGem') || 'Send Gem'}</h2>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 pb-6">
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

          {/* Gem Amount Input */}
          <div className={`rounded-2xl bg-white p-6 border-2 transition-colors duration-200 border-[#4ECCA3] ${
            gemAmount > 0 ? 'shadow-[0_0_0_4px_rgba(78,204,163,0.1)]' : ''
          }`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#4ECCA3]/20">
                <GemIcon className="h-6 w-6 text-[#4ECCA3]" />
              </div>
              <span className="font-medium text-[#4ECCA3]">{t('gemAmount') || 'Gem Amount'}</span>
            </div>
            <div>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={amount}
                onChange={(e) => handleAmountChange(e.target.value)}
                placeholder="0"
                className={`w-full bg-transparent text-4xl font-bold outline-none transition-colors duration-200 ${
                  gemAmount > 0 ? 'text-[#4ECCA3]' : 'text-gray-800 placeholder:text-gray-300'
                }`}
                autoFocus
              />
            </div>
            <p className="mt-2 text-xs text-[#4ECCA3]/70">
              {t('minSendAmount') || 'Min: 1 GEM'}
            </p>
          </div>

          {/* Message Input */}
          <div className="mt-6">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-400">
              {t('messageOptional') || 'Message (Optional)'}
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('addNiceMessage') || 'Add a nice message...'}
              className="w-full resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-[#4ECCA3] focus:bg-white focus:ring-2 focus:ring-[#4ECCA3]/20"
            />
            <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
              <LockIcon className="h-3.5 w-3.5" />
              <span>{t('onlyRecipientCanSee') || 'Only recipient can see'}</span>
            </div>
          </div>

          {/* Send Button */}
          <button
            type="button"
            onClick={handleSend}
            disabled={gemAmount <= 0 || sending}
            className={`mt-6 flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-semibold transition ${
              gemAmount > 0 && !sending
                ? 'bg-[#4ECCA3] text-white hover:bg-[#3DBA92] hover:shadow-lg hover:shadow-[#4ECCA3]/25'
                : 'bg-[#E8EAED] text-gray-400 cursor-not-allowed opacity-60'
            }`}
          >
            {sending ? (
              <>
                <LoadingSpinner className="h-4 w-4" />
                {t('sending') || 'Sending...'}
              </>
            ) : gemAmount > 0 ? (
              <>
                <span>{t('sendGem') || 'Send Gem'}</span>
                <span className="opacity-60">|</span>
                <span>{gemAmount} GEM</span>
                <SendIcon className="h-4 w-4" />
              </>
            ) : (
              <>
                {t('sendGem') || 'Send Gem'}
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

// Report reasons
const REPORT_REASONS = [
  { value: 'SPAM', label: 'Spam' },
  { value: 'HARASSMENT', label: 'Harassment or bullying' },
  { value: 'INAPPROPRIATE_CONTENT', label: 'Inappropriate content' },
  { value: 'MISINFORMATION', label: 'Misinformation' },
  { value: 'HATE_SPEECH', label: 'Hate speech' },
  { value: 'VIOLENCE', label: 'Violence or dangerous content' },
  { value: 'COPYRIGHT', label: 'Copyright infringement' },
  { value: 'OTHER', label: 'Other' },
];

// Report Modal Component
function ReportModal({
  post,
  onClose,
  onSubmit,
}: {
  post: PostDto;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [selectedReason, setSelectedReason] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!selectedReason) return;
    setIsSubmitting(true);
    try {
      await onSubmit(selectedReason);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Report Post</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        
        <p className="text-sm text-gray-500 mb-4">
          Why are you reporting this post by <span className="font-medium text-gray-700">{post.author?.displayName || post.author?.handle}</span>?
        </p>

        <div className="space-y-2 mb-4">
          {REPORT_REASONS.map((reason) => (
            <button
              key={reason.value}
              type="button"
              onClick={() => setSelectedReason(reason.value)}
              className={`w-full text-left px-4 py-3 rounded-xl text-sm transition-colors ${
                selectedReason === reason.value
                  ? 'bg-[#4ECCA3]/10 text-[#4ECCA3] border-2 border-[#4ECCA3]'
                  : 'bg-gray-50 text-gray-700 border-2 border-transparent hover:bg-gray-100'
              }`}
            >
              {reason.label}
            </button>
          ))}
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Additional details (optional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Please provide more details about your report..."
            rows={3}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#4ECCA3] focus:ring-1 focus:ring-[#4ECCA3] resize-none"
          />
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selectedReason || isSubmitting}
            className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-[#4ECCA3] hover:bg-[#3dbb92] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Submitting...' : 'Submit Report'}
          </button>
        </div>
      </div>
    </div>
  );
}

function GemIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function LoadingSpinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
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

// Cloudflare iframe video player — loads iframe with controls=false to show first frame
// without native play button, overlays custom 56px play button, switches to autoplay on click.
function CloudflareVideoPlayer({ src }: { src: string }) {
  const [activated, setActivated] = useState(false);

  // Before click: controls=false hides Cloudflare native UI, preload=auto shows first frame
  // After click: autoplay=true&controls=true for normal playback
  const iframeSrc = activated
    ? `${src}?autoplay=true&controls=true`
    : `${src}?controls=false&preload=auto`;

  return (
    <div className="relative overflow-hidden rounded-lg">
      <iframe
        src={iframeSrc}
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
        allowFullScreen
        className="w-full aspect-[4/5] border-0"
        title="Post video"
      />
      {!activated && (
        <button
          type="button"
          onClick={() => setActivated(true)}
          className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors"
        >
          <div className="w-14 h-14 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-lg hover:scale-105 transition-transform">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="#1A1A1A" className="ml-0.5">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </button>
      )}
    </div>
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

export function PostCard({ post, onDelete }: { post: PostDto; onDelete?: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setSelectedChatId = useAppStore((state) => state.setSelectedChatId);
  const setRuntimeFields = useAppStore((state) => state.setRuntimeFields);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const openModWorkspaceTab = useAppStore((state) => state.openModWorkspaceTab);
  const currentUserId = useAppStore((state) => state.auth.user?.id);
  const hasMedia = post.media && post.media.length > 0;
  
  // Check if this is the current user's post
  const isOwnPost = Boolean(currentUserId && post.author?.id && post.author.id === currentUserId);
  

  
  // State declarations
  const [isLiked, setIsLiked] = useState(post.likedByCurrentUser || false);
  const [isSendGiftOpen, setIsSendGiftOpen] = useState(false);
  const [isFriend, setIsFriend] = useState(false);
  const [showAddFriendModal, setShowAddFriendModal] = useState(false);
  const [showPostMenu, setShowPostMenu] = useState(false);
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!showPostMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (!menuButtonRef.current?.contains(e.target as Node)) {
        setShowPostMenu(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showPostMenu]);

  const handleBlockUser = async () => {
    if (!post.author?.id) return;
    setIsBlocking(true);
    try {
      await dataSync.blockUser({
        id: post.author.id,
        displayName: post.author.displayName || '',
        handle: post.author.handle || '',
        avatarUrl: post.author.avatarUrl,
      });
      setStatusBanner({
        kind: 'success',
        message: `Blocked ${post.author.displayName || post.author.handle}`,
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to block user',
      });
    } finally {
      setIsBlocking(false);
      setShowBlockConfirm(false);
    }
  };

  const handleReportPost = async (reason: string) => {
    try {
      // Using the SDK's report API
      await (dataSync as unknown as { createReport: (params: { targetType: string; targetId: string; reason: string }) => Promise<void> }).createReport({
        targetType: 'POST',
        targetId: post.id,
        reason,
      });
      setStatusBanner({
        kind: 'success',
        message: 'Report submitted successfully',
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to submit report',
      });
    } finally {
      setShowReportModal(false);
    }
  };
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

  // Update isFriend when authorRecord changes
  useEffect(() => {
    setIsFriend(authorRecord?.isFriend === true);
  }, [authorRecord?.isFriend]);

  const handleLike = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsLiked((prev) => !prev);
  };

  const handleDeletePost = async () => {
    if (!post.id) return;
    setIsDeleting(true);
    try {
      await dataSync.deletePost(post.id);
      setStatusBanner({
        kind: 'success',
        message: 'Post deleted successfully',
      });
      // Notify parent to refresh the feed
      onDelete?.();
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to delete post',
      });
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleChat = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    const userId = post.author?.id || (post.author as unknown as { _id?: string })?._id;
    if (!userId) {
      setStatusBanner({
        kind: 'error',
        message: 'Cannot start chat: user ID not found',
      });
      return;
    }

    // Check if author is an agent
    const isAgent = post.author?.isAgent;
    
    if (isAgent) {
      // For agents, use local-chat
      let worldId = '';
      try {
        const profile = await dataSync.loadUserProfile(userId);
        const payload = profile as Record<string, unknown>;
        const direct = String(payload.worldId || '').trim();
        if (direct) {
          worldId = direct;
        } else {
          const agent = payload.agent && typeof payload.agent === 'object'
            ? (payload.agent as Record<string, unknown>)
            : null;
          const fromAgent = String(agent?.worldId || '').trim();
          if (fromAgent) {
            worldId = fromAgent;
          }
        }
      } catch {
        // keep fallback empty worldId
      }

      setRuntimeFields({
        targetType: 'AGENT',
        targetAccountId: userId,
        agentId: userId,
        targetId: userId,
        worldId,
      });
      // Open mod workspace tab before setting active tab
      openModWorkspaceTab('mod:local-chat', 'Local Chat', 'local-chat');
      setActiveTab('mod:local-chat');
      return;
    }

    // For regular users, start a chat
    try {
      // First, start/create the chat
      const result = await dataSync.startChat(userId);
      if (!result?.chatId) {
        throw new Error('Failed to create chat');
      }
      const chatId = String(result.chatId);
      
      // Set runtime fields before switching tab
      setRuntimeFields({
        targetType: 'FRIEND',
        targetAccountId: userId,
        agentId: '',
        worldId: '',
      });
      
      // Invalidate and refresh chat list
      await queryClient.invalidateQueries({ queryKey: ['chats'] });
      
      // Switch to chat tab
      setActiveTab('chat');
      
      // Set the selected chat ID after a small delay to ensure ChatList has loaded
      setTimeout(() => {
        setSelectedChatId(chatId);
      }, 100);
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to open chat',
      });
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
                    className={`h-11 w-11 shrink-0 object-cover rounded-xl ${
                      post.author?.isAgent ? '' : 'ring-2 ring-gray-50'
                    }`}
                    style={post.author?.isAgent ? {
                      boxShadow: '0 0 0 1.5px #a855f7, 0 0 4px 2px rgba(168, 85, 247, 0.4), 0 0 8px 3px rgba(124, 58, 237, 0.2)'
                    } : undefined}
                  />
                ) : (
                  <div 
                    className={`flex h-11 w-11 shrink-0 items-center justify-center text-sm font-semibold rounded-xl ${
                      post.author?.isAgent 
                        ? 'bg-gradient-to-br from-[#4ECCA3] to-[#3DBB94] text-white' 
                        : 'bg-mint-100 text-mint-700 ring-2 ring-gray-50'
                    }`}
                    style={post.author?.isAgent ? {
                      boxShadow: '0 0 0 1.5px #a855f7, 0 0 4px 2px rgba(168, 85, 247, 0.4), 0 0 8px 3px rgba(124, 58, 237, 0.2)'
                    } : undefined}
                  >
                    {(post.author?.displayName || '?').charAt(0)}
                  </div>
                )}
              </button>
              {/* Add Friend Badge - only show if not friend and not own post */}
              {!isFriend && !isOwnPost && (
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

          <div className="flex flex-col justify-between h-11 relative">
            <button
              ref={menuButtonRef}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowPostMenu(!showPostMenu);
              }}
              className="p-1.5 -mr-1.5 -mt-1.5 text-gray-300 hover:text-gray-500 hover:bg-gray-50 rounded-lg transition-colors self-end"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="1" />
                <circle cx="19" cy="12" r="1" />
                <circle cx="5" cy="12" r="1" />
              </svg>
            </button>
            
            {/* Post Menu Dropdown */}
            {showPostMenu && (
              <div className="absolute right-0 top-8 z-30 w-40 rounded-xl border border-gray-100 bg-white shadow-lg overflow-hidden">
                {isOwnPost ? (
                  <>
                    {/* Own post: Edit and Delete */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowPostMenu(false);
                        setTimeout(() => {
                          setStatusBanner({
                            kind: 'info',
                            message: 'Edit post feature coming soon',
                          });
                        }, 0);
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-mint-50 hover:text-mint-700 transition-colors rounded-t-xl"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                      Edit Post
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowPostMenu(false);
                        setTimeout(() => setShowDeleteConfirm(true), 0);
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors rounded-b-xl"
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
                    {/* Other's post: Block and Report */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowPostMenu(false);
                        setTimeout(() => setShowBlockConfirm(true), 0);
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-mint-50 hover:text-mint-700 transition-colors rounded-t-xl"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                      </svg>
                      Block User
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowPostMenu(false);
                        setTimeout(() => setShowReportModal(true), 0);
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-mint-50 hover:text-mint-700 transition-colors rounded-b-xl"
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
            )}
            <span className="text-xs text-gray-400 self-end">
              {new Date(post.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </div>
        </div>

        {/* Media */}
        {firstMediaType === PostMediaType.VIDEO && videoSource?.mode === 'iframe' ? (
          <CloudflareVideoPlayer src={videoSource.src} />
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
            {/* Like Button */}
            <button
              type="button"
              onClick={(e) => handleLike(e)}
              className={`flex items-center justify-center transition-colors ${
                isLiked ? 'text-red-500' : 'text-gray-400 hover:text-red-500'
              }`}
            >
              <HeartIcon size={18} filled={isLiked} />
            </button>
            {/* Chat and Gift buttons - only show for other users' posts */}
            {!isOwnPost && (
              <>
                {/* Chat button - hide for agents */}
                {!post.author?.isAgent && (
                  <button
                    type="button"
                    onClick={(e) => handleChat(e)}
                    className="flex items-center justify-center text-gray-400 hover:text-mint-600 transition-colors"
                  >
                    <ChatIcon size={18} />
                  </button>
                )}
                {/* Gift button - show for all */}
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
              </>
            )}
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

      {/* Block Confirm Modal */}
      {showBlockConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowBlockConfirm(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Block User</h3>
            <p className="text-sm text-gray-500 mb-6">
              Are you sure you want to block <span className="font-medium text-gray-700">{post.author?.displayName || post.author?.handle}</span>? You won't see their posts anymore.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowBlockConfirm(false)}
                className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBlockUser}
                disabled={isBlocking}
                className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {isBlocking ? 'Blocking...' : 'Block'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report Modal */}
      {showReportModal && (
        <ReportModal
          post={post}
          onClose={() => setShowReportModal(false)}
          onSubmit={handleReportPost}
        />
      )}

      {/* Delete Confirm Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowDeleteConfirm(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Post</h3>
            <p className="text-sm text-gray-500 mb-6">
              Are you sure you want to delete this post? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeletePost}
                disabled={isDeleting}
                className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
