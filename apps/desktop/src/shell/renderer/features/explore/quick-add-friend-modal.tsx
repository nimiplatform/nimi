import { useState } from 'react';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import type { ExploreAgentCardData } from './explore-cards';

type QuickAddFriendModalProps = {
  open: boolean;
  agent: ExploreAgentCardData | null;
  agentLimit: {
    used: number;
    limit: number;
    canAdd: boolean;
    reason: string | null;
  } | null;
  onClose: () => void;
  onAdd: (agentId: string, message?: string) => Promise<void>;
};

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const next = error.message.trim();
    if (next) {
      return next;
    }
  }
  return fallback;
}

export function QuickAddFriendModal(props: QuickAddFriendModalProps) {
  const [message, setMessage] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!props.open || !props.agent) {
    return null;
  }

  const agent = props.agent;
  const canAdd = props.agentLimit?.canAdd !== false;

  const handleAdd = async () => {
    if (!canAdd || adding) return;
    
    setAdding(true);
    setError(null);
    
    try {
      await props.onAdd(agent.id, message.trim() || undefined);
      setMessage('');
      props.onClose();
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to add friend'));
    } finally {
      setAdding(false);
    }
  };

  const handleClose = () => {
    if (!adding) {
      setMessage('');
      setError(null);
      props.onClose();
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm" 
      onClick={handleClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Add Friend</h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={adding}
            className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-5 pb-5">
          {/* Agent Info */}
          <div className="flex flex-col items-center">
            {/* Avatar */}
            <EntityAvatar
              imageUrl={agent.avatarUrl}
              name={agent.name}
              kind="agent"
              sizeClassName="h-16 w-16"
              textClassName="text-xl font-bold"
            />
            
            {/* Name */}
            <h3 className="mt-3 text-lg font-bold text-gray-900">{agent.name}</h3>
            
            {/* Handle */}
            <p className="text-sm text-gray-500">@{agent.handle}</p>
            
            {/* Tag */}
            <span className="mt-2 inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600">
              AI Agent
            </span>
          </div>

          {/* Message Input */}
          <div className="mt-4">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Say Hello..."
              rows={3}
              maxLength={200}
              disabled={adding}
              className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-mint-300 focus:bg-white focus:ring-2 focus:ring-mint-100 disabled:opacity-50"
            />
          </div>

          {/* Error */}
          {error ? (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          ) : null}

          {/* Limit Warning */}
          {!canAdd && props.agentLimit?.reason ? (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {props.agentLimit.reason}
            </div>
          ) : null}

          {/* Buttons */}
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={adding}
              className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!canAdd || adding}
              className="flex-1 rounded-xl bg-mint-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-mint-600 hover:shadow-md disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none"
            >
              {adding ? (
                <span className="flex items-center justify-center gap-1.5">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeDasharray="60" strokeDashoffset="20" />
                  </svg>
                  Adding...
                </span>
              ) : (
                'Add Friend'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
