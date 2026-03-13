/**
 * Channels Page (FG-CONTENT-007)
 *
 * Publish identity and internal destination settings.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  listPublishingChannels,
  updateChannel,
} from '@renderer/data/content-data-client.js';
import { useAgentListQuery } from '@renderer/hooks/use-agent-queries.js';

type PublishChannelRow = {
  id: 'INTERNAL_FEED' | 'INTERNAL_AGENT_PROFILE';
  type: 'INTERNAL_FEED' | 'INTERNAL_AGENT_PROFILE';
  label: string;
  description: string;
  enabled: boolean;
  defaultIdentity?: 'USER' | 'AGENT';
  defaultAgentId?: string | null;
};

export default function ChannelsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const channelsQuery = useQuery({
    queryKey: ['forge', 'publish', 'channels'],
    retry: false,
    queryFn: async () => await listPublishingChannels(),
  });
  const agentsQuery = useAgentListQuery(true);

  const channels = (Array.isArray(channelsQuery.data) ? channelsQuery.data : []) as PublishChannelRow[];
  const settingsSource = channels[0];
  const defaultIdentity = settingsSource?.defaultIdentity || 'USER';
  const defaultAgentId = settingsSource?.defaultAgentId || '';

  const updateChannelMutation = useMutation({
    mutationFn: async (input: { channelId: PublishChannelRow['id']; payload: Record<string, unknown> }) =>
      await updateChannel(input.channelId, input.payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['forge', 'publish', 'channels'] });
      setNotice(t('channels.saved', 'Publish settings saved.'));
      setError(null);
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to update publish settings.');
      setNotice(null);
    },
  });

  function updateDefaults(payload: Record<string, unknown>) {
    updateChannelMutation.mutate({ channelId: 'INTERNAL_FEED', payload });
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('pages.channels')}</h1>
          <p className="mt-1 text-sm text-neutral-400">
            {t('channels.subtitle', 'Choose where a post appears and which identity publishes it')}
          </p>
        </div>

        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3">
          <p className="text-sm text-yellow-400 font-medium mb-1">
            {t('channels.backendNotice', 'Publish Identity Workflow Not Wired Yet')}
          </p>
          <p className="text-xs text-yellow-400/70">
            {t('channels.backendNoticeDetail', 'Internal destinations are Forge UI semantics over existing post primitives. No separate publishing backend module is required for them.')}
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
        {notice && !error && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            {notice}
          </div>
        )}

        <section className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
          <h2 className="text-sm font-semibold text-white">
            {t('channels.defaultIdentity', 'Default Publish Identity')}
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            {t('channels.defaultIdentityHint', 'Choose the identity Forge preselects for new publish drafts.')}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {(['USER', 'AGENT'] as const).map((option) => (
              <button
                key={option}
                onClick={() => updateDefaults({ defaultIdentity: option })}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  defaultIdentity === option
                    ? 'bg-white text-black'
                    : 'bg-neutral-800 text-neutral-300 hover:text-white'
                }`}
              >
                {option === 'USER'
                  ? t('channels.identityUser', 'Creator')
                  : t('channels.identityAgent', 'Agent')}
              </button>
            ))}
          </div>

          <div className="mt-4 max-w-sm">
            <label className="mb-1 block text-xs text-neutral-400">
              {t('channels.defaultAgent', 'Default Agent')}
            </label>
            <select
              value={defaultAgentId}
              onChange={(event) => updateDefaults({ defaultAgentId: event.target.value || null })}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-500"
            >
              <option value="">{t('channels.noDefaultAgent', 'No default agent')}</option>
              {(agentsQuery.data || []).map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.displayName || agent.handle}
                </option>
              ))}
            </select>
          </div>

          {defaultIdentity === 'AGENT' && (
            <div className="mt-4 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-xs text-yellow-300">
              {t('channels.agentIdentityHint', 'Agent identity can be preselected now, but live agent publishing is still pending Forge-side wiring.')}
            </div>
          )}
        </section>

        <section className="space-y-3">
          {channels.map((channel) => (
            <div
              key={channel.id}
              className="flex flex-col gap-4 rounded-lg border border-neutral-800 bg-neutral-900/50 px-5 py-4 lg:flex-row lg:items-center lg:justify-between"
            >
              <div>
                <p className="text-sm font-medium text-white">{channel.label}</p>
                <p className="mt-1 text-xs text-neutral-500">{channel.description}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                  channel.enabled
                    ? 'bg-emerald-500/10 text-emerald-300'
                    : 'bg-neutral-800 text-neutral-400'
                }`}>
                  {channel.enabled
                    ? t('channels.enabled', 'Enabled')
                    : t('channels.disabled', 'Disabled')}
                </span>
                <button
                  onClick={() => updateChannelMutation.mutate({
                    channelId: channel.id,
                    payload: { enabled: !channel.enabled },
                  })}
                  className="rounded-lg border border-neutral-700 px-3 py-2 text-xs font-medium text-neutral-200"
                >
                  {channel.enabled
                    ? t('channels.disable', 'Disable')
                    : t('channels.enable', 'Enable')}
                </button>
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
