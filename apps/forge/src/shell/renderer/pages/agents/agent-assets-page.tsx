import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { ForgeEntityAvatar } from '@renderer/components/card-list.js';
import {
  ForgeEmptyState,
  ForgeLoadingSpinner,
  ForgePage,
  ForgePageHeader,
  ForgeSection,
  ForgeSectionHeading,
  ForgeStatCard,
} from '@renderer/components/page-layout.js';
import { ForgeStatusBadge } from '@renderer/components/status-indicators.js';
import { useAgentAssetOps, type AgentAssetOpsFamilyState } from '@renderer/hooks/use-agent-asset-ops.js';
import { useWorldDetailQuery } from '@renderer/hooks/use-world-queries.js';
import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

const COMPLETENESS_TONE = {
  MISSING: 'danger',
  CONFIRMED: 'warning',
  BOUND: 'success',
} as const;

export default function AgentAssetsPage() {
  const navigate = useNavigate();
  const { agentId = '' } = useParams<{ agentId: string }>();
  const assetOps = useAgentAssetOps(agentId);
  const worldQuery = useWorldDetailQuery(assetOps.worldId);

  const agent = assetOps.agentQuery.data;
  const pendingQueueCount = useMemo(
    () => assetOps.familySummaries.reduce(
      (total, family) =>
        total
        + family.counts.generated
        + family.counts.candidate
        + family.counts.approved
        + family.counts.confirmed,
      0,
    ),
    [assetOps.familySummaries],
  );

  if (!agentId) {
    return <ForgeEmptyState message="No agent ID provided." />;
  }

  if (assetOps.agentQuery.isLoading || assetOps.bindingsQuery.isLoading || (assetOps.worldId && worldQuery.isLoading)) {
    return <ForgeLoadingSpinner />;
  }

  if (!agent) {
    return <ForgeEmptyState message="Agent not found." />;
  }

  return (
    <ForgePage maxWidth="max-w-6xl">
      <ForgePageHeader
        title={`${agent.displayName || agent.handle} Asset Ops`}
        subtitle={agent.worldId
          ? 'Canonical review and bind surfaces for avatar, cover, greeting, and voice-demo families.'
          : 'Canonical review surfaces for avatar, greeting, and any world-bound families this agent may later attach to.'}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button tone="ghost" size="sm" onClick={() => navigate('/agents/library')}>
              Back to Agents
            </Button>
            {agent.worldId ? (
              <Button tone="secondary" size="sm" onClick={() => navigate(`/worlds/${agent.worldId}/agents`)}>
                Back to World Roster
              </Button>
            ) : null}
          </div>
        )}
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <ForgeStatCard
          label="Families"
          value={assetOps.familySummaries.length}
          detail="Pack 4 admits avatar, cover, greeting, and voice demo."
        />
        <ForgeStatCard
          label="Confirmed Families"
          value={assetOps.summary.completeFamilyCount}
          detail="Families with a confirmed or bound winner."
        />
        <ForgeStatCard
          label="Bound Families"
          value={assetOps.summary.boundFamilyCount}
          detail="Families already written through an admitted bind seam."
        />
        <ForgeStatCard
          label="Review Queue"
          value={pendingQueueCount}
          detail="Candidates still moving through review, confirmation, or bind."
        />
      </div>

      <ForgeSection className="space-y-4">
        <ForgeSectionHeading
          eyebrow="Hub"
          title="Agent Asset Families"
          description="Agent detail and world roster hand off into these family-owned review surfaces. They are the only owner of lifecycle truth."
        />
        <div className="grid gap-4 xl:grid-cols-2">
          {assetOps.familySummaries.map((family) => (
            <AgentAssetHubCard
              key={family.family}
              family={family}
              agentId={agentId}
              agentName={agent.displayName || agent.handle}
              worldId={assetOps.worldId || null}
              worldName={worldQuery.data?.name || null}
              customVoiceSupported={assetOps.customVoiceSupport.supported}
              designedVoiceCount={assetOps.designedVoiceAssetsQuery.data?.length || 0}
            />
          ))}
        </div>
      </ForgeSection>
    </ForgePage>
  );
}

function AgentAssetHubCard({
  family,
  agentId,
  agentName,
  worldId,
  worldName,
  customVoiceSupported,
  designedVoiceCount,
}: {
  family: AgentAssetOpsFamilyState;
  agentId: string;
  agentName: string;
  worldId: string | null;
  worldName: string | null;
  customVoiceSupported: boolean;
  designedVoiceCount: number;
}) {
  const navigate = useNavigate();
  const previewUrl = family.activeItem?.previewUrl;
  const previewText = family.activeItem?.text;
  const reviewQueueCount =
    family.counts.generated
    + family.counts.candidate
    + family.counts.approved
    + family.counts.confirmed;

  return (
    <Surface tone="card" material="glass-regular" elevation="raised" padding="md" className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-[var(--nimi-text-primary)]">{family.label}</p>
          <p className="mt-1 text-sm text-[var(--nimi-text-muted)]">
            {describeFamily(family.family, worldName)}
          </p>
        </div>
        <ForgeStatusBadge
          domain="generic"
          status={family.completenessState}
          label={family.completenessState === 'BOUND' ? 'Bound' : family.completenessState === 'CONFIRMED' ? 'Confirmed' : 'Missing'}
          tone={COMPLETENESS_TONE[family.completenessState]}
        />
      </div>

      {previewUrl ? (
        family.family === 'agent-voice-demo' ? (
          <audio controls className="w-full">
            <source src={previewUrl} />
          </audio>
        ) : (
          <img
            src={previewUrl}
            alt=""
            className={`w-full rounded-[var(--nimi-radius-md)] object-cover ${family.family === 'agent-cover' ? 'aspect-[9/16] max-h-80' : 'aspect-square max-h-72'}`}
          />
        )
      ) : previewText ? (
        <Surface tone="card" material="glass-thin" elevation="base" padding="md" className="min-h-32">
          <p className="text-sm leading-6 text-[var(--nimi-text-primary)]">{previewText}</p>
        </Surface>
      ) : (
        <div className={`flex items-center justify-center rounded-[var(--nimi-radius-md)] border border-dashed border-[var(--nimi-border-subtle)] ${family.family === 'agent-cover' ? 'aspect-[9/16] max-h-80' : 'aspect-square max-h-72'}`}>
          <ForgeEntityAvatar name={agentName} size="lg" />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <MiniCard
          label="Current Winner"
          value={family.currentBoundItem ? 'Bound' : family.confirmedItem ? 'Confirmed' : 'Missing'}
          detail={family.activeItem?.resourceId || family.activeItem?.text || 'No winner selected yet.'}
        />
        <MiniCard
          label="Review Queue"
          value={reviewQueueCount}
          detail={family.family === 'agent-voice-demo'
            ? (customVoiceSupported
              ? `${designedVoiceCount} designed voice asset${designedVoiceCount === 1 ? '' : 's'} available for later synthesis.`
              : 'Custom voice design is unavailable until an independent voice-design binding is configured.')
            : family.bindSupport.supported
              ? 'Candidates awaiting approval, confirmation, or bind.'
              : family.bindSupport.reason || 'Bind unavailable.'}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button tone="primary" size="sm" onClick={() => navigate(`/agents/${agentId}/assets/${family.family}`)}>
          Open Family Review
        </Button>
        {family.family === 'agent-avatar' || family.family === 'agent-cover' ? (
          <Button
            tone="secondary"
            size="sm"
            onClick={() =>
              navigate(buildAgentStudioPath({
                agentId,
                worldId,
                worldName,
                target: family.family === 'agent-avatar' ? 'agent-avatar' : 'agent-portrait',
                agentName,
              }))
            }
          >
            Generate Candidate
          </Button>
        ) : null}
      </div>
    </Surface>
  );
}

function describeFamily(family: AgentAssetOpsFamilyState['family'], worldName: string | null) {
  switch (family) {
    case 'agent-avatar':
      return 'Review square avatar candidates and write the selected winner into the active agent avatar seam.';
    case 'agent-cover':
      return worldName
        ? `Review portrait cover candidates for the ${worldName} presentation seam.`
        : 'Review portrait cover candidates. Binding remains fail-closed until world context exists.';
    case 'agent-greeting-primary':
      return 'Review, confirm, and bind the primary opening line as a first-class text family.';
    case 'agent-voice-demo':
      return worldName
        ? `Review playable speech-demo candidates for ${worldName} and bind the selected winner.`
        : 'Review playable speech-demo candidates. Binding remains fail-closed until world context exists.';
  }
}

function buildAgentStudioPath(input: {
  agentId: string;
  worldId: string | null;
  target: 'agent-avatar' | 'agent-portrait';
  agentName: string;
  worldName: string | null;
}) {
  const params = new URLSearchParams({
    target: input.target,
    agentId: input.agentId,
    agentName: input.agentName,
  });
  if (input.worldId) {
    params.set('worldId', input.worldId);
  }
  if (input.worldName) {
    params.set('worldName', input.worldName);
  }
  return `/content/images?${params.toString()}`;
}

function MiniCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <Surface tone="card" material="glass-thin" elevation="base" padding="sm">
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--nimi-text-muted)]">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold text-[var(--nimi-text-primary)]">{value}</p>
      <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{detail}</p>
    </Surface>
  );
}
