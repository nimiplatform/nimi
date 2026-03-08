import { useState } from 'react';
import type { GiftCatalogItemDto } from '@nimiplatform/sdk/realm';
import { dataSync } from '@runtime/data-sync';

// Mock data for gift feed
const MOCK_GIFT_FEED = [
  {
    id: 'gift-1',
    sender: {
      id: 'user-1',
      name: 'Luna Star',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Luna',
    },
    gemAmount: 24,
    message: 'Your streams always brighten my day! Keep being amazing!',
    timestamp: '2024-01-15T10:30:00Z',
  },
  {
    id: 'gift-2',
    sender: {
      id: 'user-2',
      name: 'CyberWolf',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=CyberWolf',
    },
    gemAmount: 50,
    message: 'Thanks for the collaboration last week! Here\'s to many more creative sessions together. The project turned out amazing!',
    timestamp: '2024-01-14T18:45:00Z',
  },
  {
    id: 'gift-3',
    sender: {
      id: 'user-3',
      name: 'Moonlight',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Moonlight',
    },
    gemAmount: 12,
    message: 'Appreciate your help!',
    timestamp: '2024-01-14T09:20:00Z',
  },
  {
    id: 'gift-4',
    sender: {
      id: 'user-4',
      name: 'TechNinja',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=TechNinja',
    },
    gemAmount: 100,
    message: 'For being such an inspiration in the community! Your dedication to quality content really shows.',
    timestamp: '2024-01-13T22:15:00Z',
  },
  {
    id: 'gift-5',
    sender: {
      id: 'user-5',
      name: 'Stella',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Stella',
    },
    gemAmount: 36,
    message: 'Love your new collection! The attention to detail is incredible. Can\'t wait to see what you create next!',
    timestamp: '2024-01-12T14:30:00Z',
  },
  {
    id: 'gift-6',
    sender: {
      id: 'user-6',
      name: 'NeonDream',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=NeonDream',
    },
    gemAmount: 18,
    message: 'Small token of appreciation!',
    timestamp: '2024-01-11T08:00:00Z',
  },
];

// Mock top supporters data
const MOCK_TOP_SUPPORTERS = [
  { id: 'user-2', name: 'CyberWolf', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=CyberWolf', gems: 2450, rank: 1 },
  { id: 'user-4', name: 'TechNinja', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=TechNinja', gems: 1890, rank: 2 },
  { id: 'user-5', name: 'Stella', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Stella', gems: 1250, rank: 3 },
  { id: 'user-1', name: 'Luna Star', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Luna', gems: 890, rank: 4 },
  { id: 'user-3', name: 'Moonlight', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Moonlight', gems: 520, rank: 5 },
  { id: 'user-6', name: 'NeonDream', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=NeonDream', gems: 480, rank: 6 },
  { id: 'user-7', name: 'PixelArt', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=PixelArt', gems: 365, rank: 7 },
  { id: 'user-8', name: 'CryptoKing', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=CryptoKing', gems: 290, rank: 8 },
];

// Mock gem balance
const MOCK_GEM_BALANCE = 5840;

// Message tooltip for truncated text
function MessageTooltip({ content, children }: { content: string; children: React.ReactNode }) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div
      className="relative"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && content.length > 100 && (
        <div className="absolute bottom-full mb-2 left-0 z-50 w-[280px]">
          <div className="w-2 h-2 bg-gray-900 rotate-45 absolute -bottom-1 left-6" />
          <div className="bg-gray-900 text-white text-xs px-4 py-3 rounded-xl shadow-xl leading-relaxed">
            {content}
          </div>
        </div>
      )}
    </div>
  );
}

// Rank crown icon
function RankCrown({ rank }: { rank: number }) {
  const colors = {
    1: '#FFD700', // Gold
    2: '#C0C0C0', // Silver
    3: '#CD7F32', // Bronze
  };

  if (rank > 3) return null;

  return (
    <div
      className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center shadow-sm"
      style={{ backgroundColor: colors[rank as keyof typeof colors] }}
    >
      <svg width="8" height="8" viewBox="0 0 24 24" fill="white">
        <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"/>
      </svg>
    </div>
  );
}

// Rank badge for list
function RankBadge({ rank }: { rank: number }) {
  const colors = {
    1: { bg: 'bg-gradient-to-br from-yellow-300 to-yellow-500', text: 'text-yellow-900' },
    2: { bg: 'bg-gradient-to-br from-gray-300 to-gray-400', text: 'text-gray-800' },
    3: { bg: 'bg-gradient-to-br from-orange-300 to-orange-500', text: 'text-orange-900' },
  };

  if (rank > 3) {
    return (
      <span className="text-xs font-semibold text-gray-400 w-6 text-center">
        #{rank}
      </span>
    );
  }

  const style = colors[rank as keyof typeof colors];
  return (
    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${style.bg} ${style.text}`}>
      {rank}
    </span>
  );
}

// Premium 3D Gem Crystal Icon
function GemCrystal({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <defs>
        {/* Main gradient - rich sapphire blue */}
        <linearGradient id="gemGradient" x1="32" y1="0" x2="32" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#7DD3FC" />
          <stop offset="30%" stopColor="#38BDF8" />
          <stop offset="60%" stopColor="#0284C7" />
          <stop offset="100%" stopColor="#0C4A6E" />
        </linearGradient>
        
        {/* Top facet gradient - lighter */}
        <linearGradient id="topFacet" x1="32" y1="0" x2="32" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#BAE6FD" />
          <stop offset="100%" stopColor="#7DD3FC" />
        </linearGradient>
        
        {/* Side facet gradient */}
        <linearGradient id="sideFacetLeft" x1="8" y1="20" x2="32" y2="50" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#0284C7" />
        </linearGradient>
        
        <linearGradient id="sideFacetRight" x1="56" y1="20" x2="32" y2="50" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0EA5E9" />
          <stop offset="100%" stopColor="#0369A1" />
        </linearGradient>
        
        {/* Highlight shine */}
        <linearGradient id="shine" x1="20" y1="8" x2="32" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="50%" stopColor="#E0F2FE" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#7DD3FC" stopOpacity="0" />
        </linearGradient>
        
        {/* Drop shadow */}
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#0284C7" floodOpacity="0.3" />
        </filter>
        
        {/* Glow effect */}
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      
      {/* Outer glow */}
      <ellipse cx="32" cy="58" rx="18" ry="4" fill="#0284C7" opacity="0.2" filter="url(#glow)" />
      
      {/* Main gem body - lower hexagonal shape */}
      <path
        d="M32 4L54 18L48 46L32 58L16 46L10 18L32 4Z"
        fill="url(#gemGradient)"
        filter="url(#shadow)"
      />
      
      {/* Top table facet */}
      <path
        d="M32 4L44 12L32 20L20 12L32 4Z"
        fill="url(#topFacet)"
      />
      
      {/* Upper facets */}
      <path d="M32 4L44 12L54 18L32 20L32 4Z" fill="#60A5FA" opacity="0.8" />
      <path d="M32 4L20 12L10 18L32 20L32 4Z" fill="#93C5FD" opacity="0.8" />
      
      {/* Side facets - left */}
      <path d="M10 18L32 20L32 58L16 46L10 18Z" fill="url(#sideFacetLeft)" />
      
      {/* Side facets - right */}
      <path d="M54 18L32 20L32 58L48 46L54 18Z" fill="url(#sideFacetRight)" />
      
      {/* Center vertical facet */}
      <path d="M32 20L32 58" stroke="#0EA5E9" strokeWidth="0.5" opacity="0.4" />
      
      {/* Horizontal highlight line */}
      <path d="M16 46L48 46" stroke="#38BDF8" strokeWidth="0.5" opacity="0.3" />
      
      {/* Top shine reflection */}
      <ellipse cx="32" cy="12" rx="8" ry="4" fill="url(#shine)" opacity="0.8" />
      
      {/* Corner sparkles */}
      <circle cx="22" cy="14" r="2" fill="#FFFFFF" opacity="0.6" />
      <circle cx="28" cy="10" r="1.5" fill="#E0F2FE" opacity="0.8" />
      <circle cx="36" cy="16" r="1" fill="#BAE6FD" opacity="0.7" />
      
      {/* Bottom facet reflections */}
      <path d="M16 46L24 50L32 58L40 50L48 46" stroke="#7DD3FC" strokeWidth="0.5" opacity="0.2" fill="none" />
    </svg>
  );
}

// Reply Form Component
function ReplyForm({ 
  senderName, 
  onSubmit, 
  onCancel 
}: { 
  senderName: string; 
  onSubmit: (message: string) => void;
  onCancel: () => void;
}) {
  const [message, setMessage] = useState('');

  return (
    <div className="mt-3 rounded-2xl bg-[#F0FAF7] p-4">
      <p className="text-xs text-[#4ECCA3] font-medium mb-2">Reply to {senderName}</p>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Write your reply..."
        rows={3}
        className="w-full rounded-xl border border-[#4ECCA3]/20 bg-white px-3 py-2.5 text-sm text-gray-700 placeholder-gray-400 outline-none focus:border-[#4ECCA3]/50 focus:ring-2 focus:ring-[#4ECCA3]/10 transition-all resize-none"
      />
      <div className="flex items-center justify-end gap-2 mt-3">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            if (message.trim()) {
              onSubmit(message);
              setMessage('');
            }
          }}
          disabled={!message.trim()}
          className="px-4 py-1.5 rounded-lg bg-[#4ECCA3] text-xs font-semibold text-white hover:bg-[#3DBB94] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          Send Reply
        </button>
      </div>
    </div>
  );
}

// Gift Feed Card Component
function GiftFeedCard({ gift }: { gift: typeof MOCK_GIFT_FEED[0] }) {
  const [liked, setLiked] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const [replyMessage, setReplyMessage] = useState<string | null>(null);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const isLongMessage = gift.message.length > 100;
  const displayMessage = isLongMessage 
    ? gift.message.slice(0, 100) + '...' 
    : gift.message;

  const handleReplySubmit = (message: string) => {
    setReplyMessage(message);
    setShowReply(false);
  };

  return (
    <div className="rounded-[24px] border border-gray-100 bg-white p-5 shadow-[0_4px_20px_rgba(15,23,42,0.04)] transition-all hover:shadow-[0_8px_32px_rgba(78,204,163,0.12)]">
      {/* Info Bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button className="relative">
            <img
              src={gift.sender.avatar}
              alt={gift.sender.name}
              className="w-10 h-10 rounded-full border border-gray-100 object-cover"
            />
          </button>
          <div>
            <button className="text-sm font-semibold text-gray-900 hover:text-[#4ECCA3] transition-colors">
              {gift.sender.name}
            </button>
            <p className="text-[11px] text-gray-400">{formatDate(gift.timestamp)}</p>
          </div>
        </div>
        
        {/* Gem Amount Badge */}
        <div className="px-3 py-1.5 rounded-full bg-[#56CFA1] text-white text-xs font-semibold flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L4 9l8 13 8-13-8-7z"/>
          </svg>
          +{gift.gemAmount}
        </div>
      </div>

      {/* Message */}
      <MessageTooltip content={gift.message}>
        <div className="rounded-2xl bg-[#F0FAF7] p-4 mb-4">
          <p className="text-[14px] text-[#666666] leading-relaxed line-clamp-3">
            "{displayMessage}"
          </p>
        </div>
      </MessageTooltip>

      {/* Reply Message (if sent) */}
      {replyMessage && (
        <div className="mb-4 rounded-xl bg-[#E8F5F0] p-3 border-l-3 border-[#4ECCA3]">
          <p className="text-xs text-[#4ECCA3] font-medium mb-1">Your reply</p>
          <p className="text-sm text-gray-600">{replyMessage}</p>
        </div>
      )}

      {/* Divider */}
      <div className="h-px bg-gray-100 mb-3" />

      {/* Actions */}
      <div className="flex items-center justify-end gap-4">
        <button
          onClick={() => setLiked(!liked)}
          className={`flex items-center gap-1.5 text-xs transition-colors ${
            liked ? 'text-red-500' : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          {liked ? 'Liked' : 'Like'}
        </button>
        <button
          onClick={() => setShowReply(!showReply)}
          className={`flex items-center gap-1.5 text-xs transition-colors ${
            showReply || replyMessage ? 'text-[#4ECCA3]' : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {replyMessage ? 'Replied' : 'Reply'}
        </button>
      </div>

      {/* Reply Form */}
      {showReply && (
        <ReplyForm
          senderName={gift.sender.name}
          onSubmit={handleReplySubmit}
          onCancel={() => setShowReply(false)}
        />
      )}
    </div>
  );
}

// Skeleton loader
function GiftFeedSkeleton() {
  return (
    <div className="rounded-[24px] border border-gray-100 bg-white p-5 animate-pulse">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gray-200" />
          <div>
            <div className="h-4 w-20 rounded bg-gray-200 mb-1" />
            <div className="h-3 w-12 rounded bg-gray-100" />
          </div>
        </div>
        <div className="h-6 w-16 rounded-full bg-gray-200" />
      </div>
      <div className="h-20 rounded-2xl bg-gray-100 mb-4" />
      <div className="h-px bg-gray-100 mb-3" />
      <div className="flex justify-end gap-4">
        <div className="h-4 w-12 rounded bg-gray-100" />
        <div className="h-4 w-12 rounded bg-gray-100" />
      </div>
    </div>
  );
}

// Top Supporters Modal
function TopSupportersModal({ 
  isOpen, 
  onClose 
}: { 
  isOpen: boolean; 
  onClose: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-md bg-white rounded-[28px] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Top Supporters</h2>
              <p className="text-xs text-gray-400 mt-0.5">This month&apos;s biggest contributors</p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Supporters List */}
        <div className="max-h-[400px] overflow-y-auto">
          {MOCK_TOP_SUPPORTERS.map((supporter, index) => (
            <div 
              key={supporter.id}
              className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-b-0"
            >
              <RankBadge rank={supporter.rank} />
              
              <img
                src={supporter.avatar}
                alt={supporter.name}
                className="w-10 h-10 rounded-full border-2 border-white shadow-sm object-cover"
              />
              
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {supporter.name}
                </p>
                <p className="text-xs text-gray-400">
                  Ranked #{supporter.rank} this month
                </p>
              </div>
              
              <div className="text-right">
                <p className="text-sm font-bold text-[#4ECCA3]">
                  {supporter.gems.toLocaleString()}
                </p>
                <p className="text-[10px] text-gray-400 uppercase">Gems</p>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
          <p className="text-xs text-gray-400 text-center">
            Total {MOCK_TOP_SUPPORTERS.reduce((sum, s) => sum + s.gems, 0).toLocaleString()} Gems from {MOCK_TOP_SUPPORTERS.length} supporters
          </p>
        </div>
      </div>
    </div>
  );
}

export function GiftsTab() {
  const [showSupportersModal, setShowSupportersModal] = useState(false);

  return (
    <div className="space-y-6">
      {/* Asset Header */}
      <div className="rounded-[28px] border border-gray-100 bg-white p-6 shadow-[0_6px_24px_rgba(15,23,42,0.05)]">
        <div className="grid grid-cols-[1fr_auto] gap-6">
          {/* Left: Gem Balance */}
          <div className="flex items-center gap-5">
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center">
                <GemCrystal size={52} />
              </div>
              {/* Glow effect */}
              <div className="absolute inset-0 rounded-2xl bg-blue-400/20 blur-xl -z-10" />
            </div>
            
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-3xl font-bold text-gray-900 tracking-tight">
                  {MOCK_GEM_BALANCE.toLocaleString()}
                </span>
              </div>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Total Received</p>
            </div>
          </div>

          {/* Right: Top Supporters - Clickable */}
          <button 
            onClick={() => setShowSupportersModal(true)}
            className="hidden sm:block text-left hover:opacity-80 transition-opacity"
          >
            <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-3">This Month&apos;s Top Givers</p>
            <div className="flex items-center gap-2">
              {MOCK_TOP_SUPPORTERS.slice(0, 5).map((supporter) => (
                <div key={supporter.id} className="relative group">
                  <div className="relative">
                    <img
                      src={supporter.avatar}
                      alt={supporter.name}
                      className="w-9 h-9 rounded-full border-2 border-white shadow-sm object-cover transition-transform group-hover:scale-110"
                    />
                    <RankCrown rank={supporter.rank} />
                  </div>
                  
                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    <div className="bg-gray-900 text-white text-[10px] px-2 py-1.5 rounded-lg whitespace-nowrap">
                      <p className="font-medium">{supporter.name}</p>
                      <p className="text-gray-400">{supporter.gems.toLocaleString()} Gems</p>
                    </div>
                    <div className="w-2 h-2 bg-gray-900 rotate-45 absolute -bottom-1 left-1/2 -translate-x-1/2" />
                  </div>
                </div>
              ))}
            </div>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {MOCK_GIFT_FEED.map((gift) => (
          <GiftFeedCard key={gift.id} gift={gift} />
        ))}
      </div>

      {/* Top Supporters Modal */}
      <TopSupportersModal 
        isOpen={showSupportersModal}
        onClose={() => setShowSupportersModal(false)}
      />
    </div>
  );
}



