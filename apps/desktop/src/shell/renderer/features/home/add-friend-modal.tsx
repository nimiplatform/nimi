import { useCallback, useState } from 'react';
import { Button, IconButton, OverlayShell } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';

export type PostCardAuthorPreview = {
  name: string;
  handle: string;
  avatarUrl?: string | null;
  isSource: boolean;
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
    <OverlayShell
      open={isOpen}
      kind="dialog"
      onClose={loading ? undefined : handleClose}
      className="bg-[var(--nimi-scrim-modal)]"
      title={(
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-gray-900">{t('Relationship.addContact', { defaultValue: 'Add Friend' })}</h2>
          <IconButton
            icon={(
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
            size="sm"
            disabled={loading}
            onClick={handleClose}
            aria-label={t('Home.close', { defaultValue: 'Close' })}
          />
        </div>
      )}
      footer={(
        <div className="flex items-center gap-3">
          <Button tone="secondary" fullWidth onClick={handleClose} disabled={loading}>
            {t('Common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            tone="primary"
            fullWidth
            onClick={() => {
              void handleAddFriend();
            }}
            disabled={loading}
          >
            {loading ? t('Home.adding', { defaultValue: 'Adding...' }) : t('Relationship.addContact', { defaultValue: 'Add Friend' })}
          </Button>
        </div>
      )}
    >
      <div className="flex flex-col items-center">
        <EntityAvatar
          imageUrl={author.avatarUrl}
          name={author.name}
          kind={author.isSource ? 'source' : 'human'}
          sizeClassName="h-16 w-16"
          className={author.isSource ? undefined : 'ring-4 ring-mint-100'}
          textClassName="text-xl font-bold"
          fallbackClassName={author.isSource ? undefined : 'bg-mint-100 text-mint-700'}
        />
        <h3 className="mt-3 text-lg font-bold text-gray-900">{author.name}</h3>
        <p className="text-sm text-gray-500">@{author.handle.replace(/^@/, '')}</p>
        {author.isSource ? (
          <span className="mt-2 inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600">
            {t('Relationship.sourceBadge', { defaultValue: 'Source' })}
          </span>
        ) : null}
      </div>

      <div className="mt-4">
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={t('Home.sayHello', { defaultValue: 'Say Hello...' })}
          rows={3}
          maxLength={200}
          disabled={loading}
          className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-mint-300 focus:bg-white focus:ring-2 focus:ring-mint-100 disabled:opacity-50"
        />
      </div>

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
    </OverlayShell>
  );
}
