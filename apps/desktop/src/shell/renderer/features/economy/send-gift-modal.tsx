import { useEffect, useState } from 'react';
import { dataSync } from '@runtime/data-sync';

type SendGiftModalProps = {
  open: boolean;
  receiverId: string;
  receiverName: string;
  receiverHandle?: string;
  receiverAvatarUrl?: string | null;
  onClose: () => void;
  onSent?: () => void;
};

// Unified gift list - same across all modals
const GIFTS = [
  { id: 'candy', name: 'Candy', emoji: '🍬', price: 5 },
  { id: 'cookie', name: 'Cookie', emoji: '🍪', price: 10 },
  { id: 'coffee', name: 'Coffee', emoji: '☕', price: 100 },
  { id: 'rose', name: 'Rose', emoji: '🌹', price: 200 },
  { id: 'gem', name: 'Gem', emoji: '💎', price: 500 },
  { id: 'rocket', name: 'Rocket', emoji: '🚀', price: 1000 },
] as const;

function getProfileInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

export function SendGiftModal(props: SendGiftModalProps) {
  const [selectedGiftId, setSelectedGiftId] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    if (!selectedGiftId && GIFTS.length > 0) {
      const firstGift = GIFTS[0];
      if (firstGift) {
        setSelectedGiftId(firstGift.id);
      }
    }
  }, [props.open, selectedGiftId]);

  useEffect(() => {
    if (!props.open) {
      setSelectedGiftId('');
      setMessage('');
      setSending(false);
      setError(null);
    }
  }, [props.open]);

  const handleSend = async () => {
    if (!selectedGiftId || !props.receiverId) {
      return;
    }
    setSending(true);
    setError(null);
    try {
      await dataSync.sendGift({
        receiverId: props.receiverId,
        giftId: selectedGiftId,
        message: message.trim() || undefined,
      });
      props.onSent?.();
      props.onClose();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Failed to send gift');
    } finally {
      setSending(false);
    }
  };

  if (!props.open) {
    return null;
  }

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" 
      onClick={props.onClose}
    >
      <div
        className="relative mx-4 flex w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5">
          <h2 className="text-lg font-semibold text-gray-900">Send a Gift</h2>
          <button
            type="button"
            onClick={props.onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 pb-6">
          {/* User Info */}
          <div className="flex flex-col items-center pb-6">
            <div className="relative">
              {props.receiverAvatarUrl ? (
                <img
                  src={props.receiverAvatarUrl}
                  alt={props.receiverName}
                  className="h-20 w-20 rounded-full object-cover ring-4 ring-[#E0F7F4]"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-[#E0F7F4] to-[#C5F0E8] text-2xl font-bold text-[#4ECCA3] ring-4 ring-[#E0F7F4]">
                  {getProfileInitial(props.receiverName)}
                </div>
              )}
            </div>
            <h3 className="mt-3 text-lg font-semibold text-gray-900">{props.receiverName}</h3>
            <p className="text-sm text-gray-500">{props.receiverHandle || ''}</p>
          </div>

          {/* Gift Grid */}
          <div className="grid grid-cols-3 gap-3">
            {GIFTS.map((gift) => (
              <button
                key={gift.id}
                type="button"
                onClick={() => setSelectedGiftId(gift.id)}
                className={`flex flex-col items-center rounded-2xl border-2 px-3 py-4 text-center transition ${
                  selectedGiftId === gift.id
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
              onChange={(event) => setMessage(event.target.value.slice(0, 200))}
              rows={3}
              placeholder="Add a nice message..."
              className="w-full resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-[#4ECCA3] focus:bg-white focus:ring-2 focus:ring-[#4ECCA3]/20"
            />
            <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
              <LockIcon className="h-3.5 w-3.5" />
              <span>Only recipient can see</span>
            </div>
          </div>

          {/* Error */}
          {error ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          ) : null}

          {/* Send Button */}
          <button
            type="button"
            onClick={() => { void handleSend(); }}
            disabled={!selectedGiftId || sending}
            className={`mt-6 flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-semibold transition ${
              selectedGiftId && !sending
                ? 'bg-[#4ECCA3] text-white hover:bg-[#3DBA92] hover:shadow-lg hover:shadow-[#4ECCA3]/25'
                : 'bg-[#E8EAED] text-gray-400 cursor-not-allowed opacity-60'
            }`}
          >
            {sending ? (
              <>
                <LoadingSpinner className="h-4 w-4" />
                Sending...
              </>
            ) : selectedGiftId ? (
              <>
                <span>Proceed</span>
                <span className="opacity-60">|</span>
                <span>${GIFTS.find(g => g.id === selectedGiftId)?.price}</span>
                <SendIcon className="h-4 w-4" />
              </>
            ) : (
              <>
                Send Gift
                <SendIcon className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Icons
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

function LoadingSpinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}
