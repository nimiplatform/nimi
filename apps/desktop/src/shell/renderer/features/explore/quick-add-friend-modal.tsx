import { useState } from 'react';
import { Button, IconButton } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { OverlayShell } from '@renderer/components/overlay.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
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
  const { t } = useTranslation();
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
      setError(toErrorMessage(err, t('Home.failedToAddFriend', { defaultValue: 'Failed to add friend' })));
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
    <OverlayShell
      open={props.open && Boolean(props.agent)}
      kind="dialog"
      onClose={adding ? undefined : handleClose}
      dataTestId={E2E_IDS.exploreQuickAddFriendDialog}
      title={(
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-gray-900">{t('Contacts.addContact', { defaultValue: 'Add Friend' })}</h2>
          <IconButton
            icon={(
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
            size="sm"
            disabled={adding}
            onClick={handleClose}
            aria-label={t('Home.close', { defaultValue: 'Close' })}
          />
        </div>
      )}
      footer={(
        <div className="flex items-center gap-3">
          <Button tone="secondary" fullWidth onClick={handleClose} disabled={adding}>
            {t('World.createAgent.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button tone="primary" fullWidth onClick={handleAdd} disabled={!canAdd || adding}>
            {adding ? t('Home.adding', { defaultValue: 'Adding...' }) : t('Contacts.addContact', { defaultValue: 'Add Friend' })}
          </Button>
        </div>
      )}
    >
      <div className="flex flex-col items-center">
        <EntityAvatar
          imageUrl={agent.avatarUrl}
          name={agent.name}
          kind="agent"
          sizeClassName="h-16 w-16"
          textClassName="text-xl font-bold"
        />
        <h3 className="mt-3 text-lg font-bold text-gray-900">{agent.name}</h3>
        <p className="text-sm text-gray-500">@{agent.handle.replace(/^@/, '')}</p>
        <span className="mt-2 inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600">
          {t('Contacts.agentBadge', { defaultValue: 'Agent' })}
        </span>
      </div>

      <div className="mt-4">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t('Home.sayHello', { defaultValue: 'Say Hello...' })}
          rows={3}
          maxLength={200}
          disabled={adding}
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
    </OverlayShell>
  );
}
