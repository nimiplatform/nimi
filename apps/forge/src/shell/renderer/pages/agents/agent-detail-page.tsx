/**
 * Agent Detail Page — tabbed view (FG-AGENT-001/002/003/004)
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@nimiplatform/nimi-kit/ui';
import { ForgeActionCard } from '@renderer/components/card-list.js';
import {
  useAgentDetailQuery,
  useAgentSoulPrimeQuery,
  useCreatorKeysQuery,
} from '@renderer/hooks/use-agent-queries.js';
import { useAgentMutations } from '@renderer/hooks/use-agent-mutations.js';
import {
  ForgePage,
  ForgePageHeader,
  ForgeSection,
  ForgeSectionHeading,
  ForgeLoadingSpinner,
  ForgeEmptyState,
} from '@renderer/components/page-layout.js';
import { ForgeEntityAvatar } from '@renderer/components/card-list.js';
import { ForgeTabBar, type ForgeTab } from '@renderer/components/tab-bar.js';
import type { TabId } from './agent-detail-page-shared.js';
import {
  DnaTab,
  KeysTab,
  PreviewTab,
  ProfileTab,
} from './agent-detail-page-tabs.js';

export default function AgentDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agentId } = useParams<{ agentId: string }>();

  const [activeTab, setActiveTab] = useState<TabId>('profile');

  const agentQuery = useAgentDetailQuery(agentId || '');
  const keysQuery = useCreatorKeysQuery();
  const mutations = useAgentMutations();
  const queryClient = useQueryClient();
  const tabs: ForgeTab<TabId>[] = [
    { value: 'profile', label: t('agentDetail.tabProfile', 'Profile') },
    { value: 'dna', label: t('agentDetail.tabDna', 'DNA') },
    { value: 'preview', label: t('agentDetail.tabPreview', 'Preview') },
    { value: 'keys', label: t('agentDetail.tabKeys', 'Keys') },
  ];

  const agent = agentQuery.data;
  const soulPrimeQuery = useAgentSoulPrimeQuery(agent?.worldId || '', agentId || '');

  if (!agentId) {
    return (
      <ForgeEmptyState message={t('agentDetail.noAgentId', 'No agent ID provided')} />
    );
  }

  if (agentQuery.isLoading) {
    return <ForgeLoadingSpinner />;
  }

  if (!agent) {
    return (
      <ForgeEmptyState message={t('agentDetail.notFound', 'Agent not found')} />
    );
  }

  return (
    <ForgePage>
      <ForgePageHeader
        title={agent.displayName || agent.handle}
        subtitle={`@${agent.handle}`}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button tone="ghost" size="sm" onClick={() => navigate('/agents/library')}>
              &larr; {t('agents.backToList', 'Back')}
            </Button>
            <Button tone="secondary" size="sm" onClick={() => navigate(`/agents/${agentId}/assets`)}>
              Open Asset Ops
            </Button>
          </div>
        )}
      />

      <ForgeSection className="flex items-center gap-3">
        <ForgeEntityAvatar src={agent.avatarUrl} name={agent.displayName || agent.handle} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">
            {agent.displayName || agent.handle}
          </p>
          <p className="text-xs text-[var(--nimi-text-muted)]">
            {agent.worldId ? `${t('agentDetail.worldLabel', 'World:')} ${agent.worldId}` : t('agentDetail.ownerMaster', 'Master owned')}
          </p>
        </div>
      </ForgeSection>

      <ForgeSection className="space-y-4" material="glass-regular">
        <ForgeSectionHeading
          eyebrow={t('agentDetail.avatarGeneration', 'Asset Ops')}
          title={t('agentDetail.avatarAssets', 'Agent Asset Handoff')}
          description={t('agentDetail.avatarAssetsHint', 'Route avatar, cover, greeting, and voice-demo review into the dedicated asset ops flow instead of owning those actions inside the detail page.')}
        />
        <div className="grid gap-3 md:grid-cols-2">
          <ForgeActionCard
            title={t('agentDetail.generateAvatar', 'Open Agent Asset Ops')}
            description={t('agentDetail.avatarAssetsHint', 'Review avatar, cover, greeting, and voice-demo families from their canonical ops hub.')}
            onClick={() => navigate(`/agents/${agentId}/assets`)}
          />
          <ForgeActionCard
            title={t('agentDetail.generatePortrait', 'Open Image Studio')}
            description={t('agentDetail.avatarPromptPlaceholder', 'Generate new image candidates in Image Studio, then save them into the library for review from the asset family pages.')}
            onClick={() => {
              const params = new URLSearchParams({
                target: 'agent-avatar',
                agentId,
                agentName: agent.displayName || agent.handle,
              });
              if (agent.worldId) {
                params.set('worldId', agent.worldId);
              }
              navigate(`/content/images?${params.toString()}`);
            }}
          />
        </div>
        {agent.worldId ? (
          <p className="text-xs leading-5 text-[var(--nimi-text-muted)]">
            World-owned truth editing still routes through the workbench, but asset review stays available from the standalone `/agents/:agentId/assets` surfaces.
          </p>
        ) : (
          <p className="text-xs leading-5 text-[var(--nimi-text-muted)]">
            Keep this page focused on profile, DNA, preview, and keys. Asset review now lives on the dedicated agent asset ops routes.
          </p>
        )}
      </ForgeSection>

      <ForgeTabBar tabs={tabs} value={activeTab} onChange={setActiveTab} />

      {activeTab === 'profile' ? (
        <ProfileTab
          agent={agent}
          onSave={async (updates) => {
            await mutations.updateAgentMutation.mutateAsync({
              agentId,
              payload: updates,
            });
            await queryClient.invalidateQueries({ queryKey: ['forge', 'agents', 'detail', agentId] });
          }}
          onOpenAvatarReview={() => navigate(`/agents/${agentId}/assets/agent-avatar`)}
          onOpenGreetingReview={() => navigate(`/agents/${agentId}/assets/agent-greeting-primary`)}
          saving={mutations.updateAgentMutation.isPending}
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
    </ForgePage>
  );
}
