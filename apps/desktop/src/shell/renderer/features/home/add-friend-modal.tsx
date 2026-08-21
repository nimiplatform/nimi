import { useCallback, useState } from 'react';
import { Button, IconButton, OverlayShell } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '../../components/entity-avatar.js';
import { InlineFeedback } from '../../ui/feedback/inline-feedback';

export type PostCardHumanAuthorPreview = {
  name: string;
  handle: string;
  avatarUrl?: string | null;
};

export function AddFriendModal({
  author,
  isOpen,
  onClose,
  onAddFriend,
}: {
  author: PostCardHumanAuthorPreview;
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
          <h2 className="text-base font-semibold text-[var(--nimi-text-primary)]">{t('Relationship.addContact', { defaultValue: 'Add Friend' })}</h2>
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
          kind="human"
          sizeClassName="h-16 w-16"
          className="ring-4 ring-[color-mix(in_srgb,var(--nimi-action-primary-bg)_20%,transparent)]"
          textClassName="text-xl font-bold"
          fallbackClassName="bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,var(--nimi-surface-card))] text-[var(--nimi-action-primary-bg)]"
        />
        <h3 className="mt-3 text-lg font-bold text-[var(--nimi-text-primary)]">{author.name}</h3>
        <p className="text-sm text-[var(--nimi-text-muted)]">@{author.handle.replace(/^@/, '')}</p>
      </div>

      <div className="mt-4">
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={t('Home.sayHello', { defaultValue: 'Say Hello...' })}
          rows={3}
          maxLength={200}
          disabled={loading}
          className="w-full resize-none rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-4 py-3 text-sm text-[var(--nimi-text-primary)] outline-none transition-all placeholder:text-[var(--nimi-text-muted)] focus:border-[var(--nimi-field-focus)] focus:bg-[var(--nimi-surface-card)] focus:ring-1 focus:ring-[var(--nimi-focus-ring-color)] disabled:opacity-50"
        />
      </div>

      {error ? (
        <InlineFeedback className="mt-3" feedback={{ kind: 'error', message: error }} />
      ) : null}
    </OverlayShell>
  );
}
