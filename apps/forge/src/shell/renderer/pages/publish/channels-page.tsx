/**
 * Channels Page (FG-CONTENT-007)
 *
 * Publish identity and internal destination settings.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import {
  ForgePage,
  ForgePageHeader,
  ForgeSection,
  ForgeSectionHeading,
  ForgeErrorBanner,
} from '@renderer/components/page-layout.js';
import { LabeledSelectField } from '@renderer/components/form-fields.js';
import { ForgeSegmentControl } from '@renderer/components/segment-control.js';
import { ForgeListCard } from '@renderer/components/card-list.js';
import { ForgeStatusBadge } from '@renderer/components/status-indicators.js';
import {
  listPublishingChannels,
  updateChannel,
  type PublishChannelListItem,
  type PublishChannelUpdateInput,
} from '@renderer/data/content-data-client.js';
import { useAgentListQuery } from '@renderer/hooks/use-agent-queries.js';

const IDENTITY_OPTIONS = [
  { value: 'USER' as const, label: 'Creator' },
  { value: 'AGENT' as const, label: 'Agent' },
];

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

  const channels = channelsQuery.data ?? [];
  const settingsSource = channels[0];
  const defaultIdentity = settingsSource?.defaultIdentity || 'USER';
  const defaultAgentId = settingsSource?.defaultAgentId || '';

  const updateChannelMutation = useMutation({
    mutationFn: async (input: { channelId: PublishChannelListItem['id']; payload: PublishChannelUpdateInput }) =>
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

  function updateDefaults(payload: PublishChannelUpdateInput) {
    updateChannelMutation.mutate({ channelId: 'INTERNAL_FEED', payload });
  }

  const agentSelectOptions = [
    { value: '', label: t('channels.noDefaultAgent', 'No default agent') },
    ...(agentsQuery.data || []).map((agent) => ({
      value: agent.id,
      label: agent.displayName || agent.handle,
    })),
  ];

  return (
    <ForgePage>
      <ForgePageHeader
        title={t('pages.channels')}
        subtitle={t('channels.subtitle', 'Choose where a post appears and which identity publishes it')}
      />

      {error && <ForgeErrorBanner message={error} />}
      {notice && !error && (
        <Surface tone="card" material="glass-thin" padding="sm" className="border-[var(--nimi-status-success)]">
          <p className="text-sm text-[var(--nimi-status-success)]">{notice}</p>
        </Surface>
      )}

      <ForgeSection className="space-y-4" material="glass-regular">
        <ForgeSectionHeading
          eyebrow={t('pages.channels')}
          title={t('channels.defaultIdentity', 'Default Publish Identity')}
          description={t('channels.defaultIdentityHint', 'Choose the identity Forge preselects for new publish drafts.')}
        />
        <div className="mt-4">
          <ForgeSegmentControl
            options={IDENTITY_OPTIONS.map((o) => ({
              ...o,
              label: o.value === 'USER'
                ? t('channels.identityUser', 'Creator')
                : t('channels.identityAgent', 'Agent'),
            }))}
            value={defaultIdentity}
            onChange={(v) => updateDefaults({ defaultIdentity: v })}
            size="md"
          />
        </div>

        <div className="mt-4 max-w-sm">
          <LabeledSelectField
            label={t('channels.defaultAgent', 'Default Agent')}
            value={defaultAgentId}
            options={agentSelectOptions}
            onChange={(v) => updateDefaults({ defaultAgentId: v || null })}
          />
        </div>

        {defaultIdentity === 'AGENT' && (
          <Surface tone="card" material="glass-thin" padding="sm" className="mt-4 border-[var(--nimi-status-warning)]">
            <p className="text-xs text-[var(--nimi-status-warning)]">
              {t('channels.agentIdentityHint', 'Agent identity can be preselected now, but live agent publishing is still pending Forge-side wiring.')}
            </p>
          </Surface>
        )}
      </ForgeSection>

      <section className="space-y-3">
        {channels.map((channel) => (
          <ForgeListCard
            key={channel.id}
            title={channel.label}
            subtitle={channel.description}
            badges={
              <ForgeStatusBadge
                domain="generic"
                status={channel.enabled ? 'ENABLED' : 'DISABLED'}
                label={channel.enabled
                  ? t('channels.enabled', 'Enabled')
                  : t('channels.disabled', 'Disabled')}
                tone={channel.enabled ? 'success' : 'neutral'}
              />
            }
            actions={
              <Button
                tone="secondary"
                size="sm"
                onClick={() => updateChannelMutation.mutate({
                  channelId: channel.id,
                  payload: { enabled: !channel.enabled },
                })}
              >
                {channel.enabled
                  ? t('channels.disable', 'Disable')
                  : t('channels.enable', 'Enable')}
              </Button>
            }
          />
        ))}
      </section>
    </ForgePage>
  );
}
