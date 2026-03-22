/**
 * Agent Detail Page — tabbed view (FG-AGENT-001/002/003/004)
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  useAgentDetailQuery,
  useAgentSoulPrimeQuery,
  useCreatorKeysQuery,
} from '@renderer/hooks/use-agent-queries.js';
import { useAgentMutations } from '@renderer/hooks/use-agent-mutations.js';
import {
  DnaTab,
  KeysTab,
  PreviewTab,
  ProfileTab,
} from './agent-detail-page-tabs.js';

type TabId = 'profile' | 'dna' | 'preview' | 'keys';

export default function AgentDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agentId } = useParams<{ agentId: string }>();

  const [activeTab, setActiveTab] = useState<TabId>('profile');

  const agentQuery = useAgentDetailQuery(agentId || '');
  const keysQuery = useCreatorKeysQuery();
  const mutations = useAgentMutations();
  const queryClient = useQueryClient();
  const tabs: { id: TabId; label: string }[] = [
    { id: 'profile', label: t('agentDetail.tabProfile', 'Profile') },
    { id: 'dna', label: t('agentDetail.tabDna', 'DNA') },
    { id: 'preview', label: t('agentDetail.tabPreview', 'Preview') },
    { id: 'keys', label: t('agentDetail.tabKeys', 'Keys') },
  ];

  const agent = agentQuery.data;
  const soulPrimeQuery = useAgentSoulPrimeQuery(agent?.worldId || '', agentId || '');

  if (!agentId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-neutral-400">{t('agentDetail.noAgentId', 'No agent ID provided')}</p>
      </div>
    );
  }

  if (agentQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-neutral-400">{t('agentDetail.notFound', 'Agent not found')}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/agents/library')}
            className="rounded px-2 py-1 text-sm text-neutral-400 transition-colors hover:text-white"
          >
            &larr; {t('agents.backToList', 'Back')}
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-800">
              {agent.avatarUrl ? (
                <img src={agent.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-lg text-neutral-500">
                  {(agent.displayName || agent.handle || '?')[0]?.toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold text-white">
                {agent.displayName || agent.handle}
              </h1>
              <p className="text-xs text-neutral-500">@{agent.handle}</p>
            </div>
          </div>
        </div>

        <div className="flex border-b border-neutral-800">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-white text-white'
                  : 'border-transparent text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'profile' ? (
          <ProfileTab
            agent={agent}
            onSave={async (updates) => {
              await mutations.updateDnaMutation.mutateAsync({
                agentId,
                dna: updates,
              });
              await queryClient.invalidateQueries({ queryKey: ['forge', 'agents', 'detail', agentId] });
            }}
            saving={mutations.updateDnaMutation.isPending}
          />
        ) : null}

        {activeTab === 'dna' ? (
          <DnaTab
            agentId={agentId}
            dna={agent.dna}
            soulPrime={soulPrimeQuery.data || null}
            soulPrimeLoading={soulPrimeQuery.isLoading}
            onSaveDna={async (dna) => {
              await mutations.updateDnaMutation.mutateAsync({ agentId, dna });
              await queryClient.invalidateQueries({ queryKey: ['forge', 'agents', 'detail', agentId] });
            }}
            onSaveSoulPrime={async (soulPrime) => {
              if (!agent.worldId) {
                throw new Error('FORGE_AGENT_WORLD_ID_REQUIRED');
              }
              await mutations.updateSoulPrimeMutation.mutateAsync({
                worldId: agent.worldId,
                agentId,
                soulPrime,
              });
              await queryClient.invalidateQueries({
                queryKey: ['forge', 'agents', 'soul-prime', agent.worldId, agentId],
              });
            }}
            savingDna={mutations.updateDnaMutation.isPending}
            savingSoulPrime={mutations.updateSoulPrimeMutation.isPending}
          />
        ) : null}

        {activeTab === 'preview' ? <PreviewTab agent={agent} /> : null}

        {activeTab === 'keys' ? (
          <KeysTab
            keys={keysQuery.data || []}
            keysLoading={keysQuery.isLoading}
            onCreateKey={async (payload) => {
              await mutations.createKeyMutation.mutateAsync(payload);
              await queryClient.invalidateQueries({ queryKey: ['forge', 'creator', 'keys'] });
            }}
            onRevokeKey={async (keyId) => {
              await mutations.revokeKeyMutation.mutateAsync(keyId);
              await queryClient.invalidateQueries({ queryKey: ['forge', 'creator', 'keys'] });
            }}
            creatingKey={mutations.createKeyMutation.isPending}
          />
        ) : null}
      </div>
    </div>
  );
}
