/**
 * Agent Detail Page — tabbed view (FG-AGENT-001/002/003/004)
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Surface, TextField } from '@nimiplatform/nimi-kit/ui';
import {
  useAgentDetailQuery,
  useAgentSoulPrimeQuery,
  useCreatorKeysQuery,
} from '@renderer/hooks/use-agent-queries.js';
import { useAgentMutations } from '@renderer/hooks/use-agent-mutations.js';
import { useImageGeneration } from '@renderer/hooks/use-image-generation.js';
import type { ImageGenEntityContext } from '@renderer/data/image-gen-client.js';
import { uploadFileAsResource } from '@renderer/data/content-data-client.js';
import { batchUpsertWorldResourceBindings } from '@renderer/data/world-data-client.js';
import { ForgePage, ForgeLoadingSpinner, ForgeEmptyState, ForgeErrorBanner } from '@renderer/components/page-layout.js';
import { ForgeEntityAvatar } from '@renderer/components/card-list.js';
import { ForgeTabBar, type ForgeTab } from '@renderer/components/tab-bar.js';
import type { TabId } from './agent-detail-page-shared.js';
import {
  DnaTab,
  KeysTab,
  PreviewTab,
  ProfileTab,
} from './agent-detail-page-tabs.js';

const PHASE_LABELS: Record<string, string> = {
  composing_prompt: 'Composing prompt...',
  generating: 'Generating...',
  uploading: 'Uploading...',
  binding: 'Setting avatar...',
};

export default function AgentDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agentId } = useParams<{ agentId: string }>();

  const [activeTab, setActiveTab] = useState<TabId>('profile');
  const [avatarPrompt, setAvatarPrompt] = useState('');
  const [manualUploading, setManualUploading] = useState(false);
  const avatarFileRef = useRef<HTMLInputElement>(null);
  const portraitFileRef = useRef<HTMLInputElement>(null);

  const agentQuery = useAgentDetailQuery(agentId || '');
  const keysQuery = useCreatorKeysQuery();
  const mutations = useAgentMutations();
  const queryClient = useQueryClient();
  const imageGen = useImageGeneration();
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

  function buildAgentImageContext(target: 'agent-avatar' | 'agent-portrait'): ImageGenEntityContext {
    const soulPrime = soulPrimeQuery.data;
    return {
      target,
      agentDna: agent!.dna,
      agentSoulPrime: soulPrime ? {
        backstory: String(soulPrime.structured?.backstory || ''),
        coreValues: String(soulPrime.structured?.coreValues || ''),
        personalityDescription: String(soulPrime.structured?.personalityDescription || ''),
        guidelines: String(soulPrime.structured?.guidelines || ''),
        catchphrase: String(soulPrime.structured?.catchphrase || ''),
      } : null,
      agentName: agent!.displayName || agent!.handle,
      agentConcept: agent!.concept,
      userPrompt: avatarPrompt.trim() || undefined,
    };
  }

  async function handleManualAvatarUpload(file: File) {
    setManualUploading(true);
    try {
      const { url } = await uploadFileAsResource(file);
      await mutations.updateAgentMutation.mutateAsync({ agentId: agentId!, payload: { avatarUrl: url } });
      await queryClient.invalidateQueries({ queryKey: ['forge', 'agents', 'detail', agentId] });
    } finally {
      setManualUploading(false);
    }
  }

  async function handleManualPortraitUpload(file: File) {
    if (!agent!.worldId) return;
    setManualUploading(true);
    try {
      const { resourceId } = await uploadFileAsResource(file);
      await batchUpsertWorldResourceBindings(agent!.worldId, {
        bindingUpserts: [{
          objectType: 'RESOURCE',
          objectId: resourceId,
          hostType: 'AGENT',
          hostId: agentId!,
          bindingKind: 'PRESENTATION',
          bindingPoint: 'AGENT_PORTRAIT',
          priority: 0,
        }],
      });
      await queryClient.invalidateQueries({ queryKey: ['forge', 'agents', 'detail', agentId] });
    } finally {
      setManualUploading(false);
    }
  }

  return (
    <ForgePage>
      <div className="flex items-center gap-3">
        <Button tone="ghost" size="sm" onClick={() => navigate('/agents/library')}>
          &larr; {t('agents.backToList', 'Back')}
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <ForgeEntityAvatar src={agent.avatarUrl} name={agent.displayName || agent.handle} size="md" />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-[var(--nimi-text-primary)]">
              {agent.displayName || agent.handle}
            </h1>
            <p className="text-xs text-[var(--nimi-text-muted)]">@{agent.handle}</p>
          </div>
        </div>
      </div>

      {/* Avatar Generation */}
      <Surface tone="card" padding="md">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('agentDetail.avatarGeneration', 'Avatar Generation')}
          </h3>
          <div className="flex gap-2">
            <Button
              tone="primary"
              size="sm"
              onClick={() => void imageGen.generate(buildAgentImageContext('agent-avatar'))}
              disabled={imageGen.busy || manualUploading}
            >
              {imageGen.busy && imageGen.phase !== 'idle'
                ? PHASE_LABELS[imageGen.phase] || imageGen.phase
                : t('agentDetail.generateAvatar', 'Generate Avatar')}
            </Button>
            <Button
              tone="secondary"
              size="sm"
              onClick={() => void imageGen.generate(buildAgentImageContext('agent-portrait'))}
              disabled={imageGen.busy || manualUploading}
            >
              {t('agentDetail.generatePortrait', 'Generate Portrait')}
            </Button>
            <Button
              tone="ghost"
              size="sm"
              onClick={() => avatarFileRef.current?.click()}
              disabled={imageGen.busy || manualUploading}
            >
              {manualUploading ? t('agentDetail.uploading', 'Uploading...') : t('agentDetail.uploadAvatar', 'Upload Avatar')}
            </Button>
            {agent.worldId && (
              <Button
                tone="ghost"
                size="sm"
                onClick={() => portraitFileRef.current?.click()}
                disabled={imageGen.busy || manualUploading}
              >
                {t('agentDetail.uploadPortrait', 'Upload Portrait')}
              </Button>
            )}
            <input
              ref={avatarFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleManualAvatarUpload(file);
                e.target.value = '';
              }}
            />
            <input
              ref={portraitFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleManualPortraitUpload(file);
                e.target.value = '';
              }}
            />
          </div>
        </div>

        <div className="mt-3">
          <TextField
            value={avatarPrompt}
            onChange={(e) => setAvatarPrompt(e.target.value)}
            placeholder={t('agentDetail.avatarPromptPlaceholder', 'Additional prompt instructions (optional)...')}
          />
        </div>

        {imageGen.error ? (
          <ForgeErrorBanner message={imageGen.error} className="mt-3" />
        ) : null}

        {imageGen.candidates.length > 0 ? (
          <div className="mt-3 grid grid-cols-4 gap-3">
            {imageGen.candidates.map((candidate) => (
              <div
                key={candidate.id}
                className="group relative overflow-hidden rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-base)]"
              >
                <img src={candidate.url} alt="" className="aspect-square w-full object-cover" />
                <div className="absolute inset-0 flex items-end bg-black/60 p-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <div className="flex w-full gap-1.5">
                    <Button
                      tone="primary"
                      size="sm"
                      onClick={() => void imageGen.useAsAgentAvatar(agentId!, candidate)}
                      disabled={imageGen.busy}
                      className="flex-1"
                    >
                      {t('agentDetail.useAsAvatar', 'Use as Avatar')}
                    </Button>
                    <Button
                      tone="secondary"
                      size="sm"
                      onClick={() => void imageGen.saveToLibrary(candidate)}
                      disabled={imageGen.busy}
                    >
                      {t('agentDetail.save', 'Save')}
                    </Button>
                    <Button
                      tone="ghost"
                      size="sm"
                      onClick={() => imageGen.removeCandidate(candidate.id)}
                    >
                      &times;
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Surface>

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
          onAvatarChange={async (url) => {
            await mutations.updateAgentMutation.mutateAsync({
              agentId,
              payload: { avatarUrl: url },
            });
            await queryClient.invalidateQueries({ queryKey: ['forge', 'agents', 'detail', agentId] });
          }}
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
