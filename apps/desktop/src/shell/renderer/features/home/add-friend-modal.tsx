import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';

export type PostCardAuthorPreview = {
  name: string;
  handle: string;
  avatarUrl?: string | null;
  isAgent: boolean;
};

export function AddFriendModal({
  author,
  isOpen,
  onClose,
  onAddFriend,
}: {
  author: PostCardAuthorPreview;
  isOpen: boolean;
  onClose: () => void;
  onAddFriend: (message?: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const handleAddFriend = useCallback(async () => {
    if (loading) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onAddFriend(message.trim() || undefined);
      setMessage('');
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('Home.failedToAddFriend', { defaultValue: 'Failed to add friend' }));
    } finally {
      setLoading(false);
    }
  }, [loading, message, onAddFriend, onClose, t]);

  const handleClose = useCallback(() => {
    if (!loading) {
      setMessage('');
      setError(null);
      onClose();
    }
  }, [loading, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-[var(--nimi-scrim-modal)] backdrop-blur-sm"
        onClick={handleClose}
      />
      <div className="relative mx-4 w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-bold text-gray-900">{t('Contacts.addContact', { defaultValue: 'Add Friend' })}</h2>
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

        <div className="flex flex-col items-center px-6 py-8">
          <div className="relative">
            <EntityAvatar
              imageUrl={author.avatarUrl}
              name={author.name}
              kind={author.isAgent ? 'agent' : 'human'}
              sizeClassName="h-20 w-20"
              className={author.isAgent ? undefined : 'ring-4 ring-mint-100'}
              textClassName="text-2xl font-bold"
              fallbackClassName={author.isAgent ? undefined : 'bg-mint-100 text-mint-700'}
            />
          </div>

          <h3 className="mt-4 text-xl font-bold text-gray-900">{author.name}</h3>
          <p className="mt-1 text-sm text-gray-500">@{author.handle.replace(/^@/, '')}</p>

          {author.isAgent ? (
            <span className="mt-2 inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600">
              {t('Contacts.agentBadge', { defaultValue: 'Agent' })}
            </span>
          ) : null}

          <div className="mt-4 w-full">
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={t('Home.sayHello', { defaultValue: 'Say Hello...' })}
              className="h-20 w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-mint-500"
            />
          </div>
          {error ? (
            <div className="mt-3 w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex gap-3 bg-gray-50 px-6 py-4">
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {t('World.createAgent.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            onClick={() => {
              void handleAddFriend();
            }}
            disabled={loading}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-mint-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-mint-600 disabled:opacity-70"
          >
            {loading ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                {t('Home.adding', { defaultValue: 'Adding...' })}
              </>
            ) : (
              t('Contacts.addContact', { defaultValue: 'Add Friend' })
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
