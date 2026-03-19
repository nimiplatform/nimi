import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { JsonObject } from '@renderer/bridge/types.js';
import type { CreatorKeyItem } from '@renderer/hooks/use-agent-queries.js';
import { FieldGroup, formatDate } from './agent-detail-page-shared';

type KeysTabProps = {
  keys: CreatorKeyItem[];
  keysLoading: boolean;
  onCreateKey: (payload: JsonObject) => Promise<void>;
  onRevokeKey: (keyId: string) => Promise<void>;
  creatingKey: boolean;
};

export function KeysTab({
  keys,
  keysLoading,
  onCreateKey,
  onRevokeKey,
  creatingKey,
}: KeysTabProps) {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [keyName, setKeyName] = useState('');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">
            {t('agentDetail.apiKeys', 'API Keys')}
          </h3>
          <p className="mt-0.5 text-xs text-neutral-500">
            {t('agentDetail.apiKeysHint', 'Manage API keys for programmatic access to your agents.')}
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-neutral-200"
        >
          {t('agentDetail.createKey', 'Create Key')}
        </button>
      </div>

      {showForm ? (
        <div className="space-y-3 rounded-lg border border-neutral-700 bg-neutral-900 p-4">
          <FieldGroup label={t('agentDetail.keyName', 'Key Name')}>
            <input
              type="text"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder={t('agentDetail.keyNamePlaceholder', 'e.g. production-key')}
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
            />
          </FieldGroup>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setShowForm(false);
                setKeyName('');
              }}
              className="rounded px-4 py-1.5 text-sm text-neutral-400 transition-colors hover:text-white"
            >
              {t('agentDetail.cancel', 'Cancel')}
            </button>
            <button
              onClick={() => {
                if (!keyName.trim()) return;
                void onCreateKey({ name: keyName.trim() }).then(() => {
                  setKeyName('');
                  setShowForm(false);
                });
              }}
              disabled={creatingKey || !keyName.trim()}
              className="rounded-lg bg-white px-4 py-1.5 text-sm font-medium text-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
            >
              {creatingKey ? t('agentDetail.creating', 'Creating...') : t('agentDetail.create', 'Create')}
            </button>
          </div>
        </div>
      ) : null}

      {keysLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white" />
        </div>
      ) : keys.length === 0 ? (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-8 text-center">
          <p className="text-sm text-neutral-400">
            {t('agentDetail.noKeys', 'No API keys yet.')}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {keys.map((key) => (
            <div
              key={key.id}
              className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">{key.name}</p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  <code className="rounded bg-neutral-800 px-1.5 py-0.5">{key.keyPreview}</code>
                  <span className="ml-2">{t('agentDetail.createdAt', 'Created:')} {formatDate(key.createdAt)}</span>
                  {key.lastUsedAt ? <span className="ml-2">{t('agentDetail.lastUsed', 'Last used:')} {formatDate(key.lastUsedAt)}</span> : null}
                  {key.expiresAt ? <span className="ml-2">{t('agentDetail.expiresAt', 'Expires:')} {formatDate(key.expiresAt)}</span> : null}
                </p>
              </div>
              <button
                onClick={() => {
                  if (confirm(t('agentDetail.confirmRevoke', 'Revoke this key? This cannot be undone.'))) {
                    void onRevokeKey(key.id);
                  }
                }}
                className="ml-3 rounded px-3 py-1 text-xs font-medium text-red-400/70 transition-colors hover:bg-red-500/10 hover:text-red-400"
              >
                {t('agentDetail.revoke', 'Revoke')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
