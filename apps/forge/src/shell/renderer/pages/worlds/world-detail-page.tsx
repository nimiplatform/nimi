import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { ForgeActionCard, ForgeEntityAvatar } from '@renderer/components/card-list.js';
import { formatDate } from '@renderer/components/format-utils.js';
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
import {
  AGENT_ROSTER_COMPLETENESS_COPY,
  buildAgentDeliverableCardItems,
  buildAgentRosterSummaryBadgeItems,
  buildWorldAgentHeroStatus,
  buildWorldAgentSummaryKpiItems,
  buildWorldVisualCardItems,
} from '@renderer/features/asset-ops/deliverable-presentation.js';
import type { DeliverableCurrentState, WorldOwnedAgentRosterItem } from '@renderer/hooks/use-agent-queries.js';
import { useWorldOwnedAgentRosterQuery } from '@renderer/hooks/use-agent-queries.js';
import { useWorldDetailQuery, useWorldResourceQueries } from '@renderer/hooks/use-world-queries.js';
import { useNavigate, useParams } from 'react-router-dom';

const DELIVERABLE_STATE_LABEL: Record<DeliverableCurrentState, string> = {
  MISSING: 'Missing',
  PRESENT: 'Present',
  BOUND: 'Bound',
};

const DELIVERABLE_STATE_TONE = {
  MISSING: 'danger',
  PRESENT: 'warning',
  BOUND: 'success',
} as const;

type WorldVisualStatus = 'MISSING' | 'PRESENT';

const WORLD_VISUAL_LABEL: Record<WorldVisualStatus, string> = {
  MISSING: 'Missing',
  PRESENT: 'Present',
};

const WORLD_VISUAL_TONE = {
  MISSING: 'danger',
  PRESENT: 'warning',
} as const;

export default function WorldDetailPage() {
  const navigate = useNavigate();
  const { worldId = '' } = useParams<{ worldId: string }>();
  const worldQuery = useWorldDetailQuery(worldId);
  const rosterQuery = useWorldOwnedAgentRosterQuery(worldId, Boolean(worldId));
  const {
    stateQuery,
    historyQuery,
    lorebooksQuery,
  } = useWorldResourceQueries({
    enabled: Boolean(worldId),
    worldId,
    enableBindings: false,
    enableGovernance: false,
    enableDetailSnapshot: false,
  });

  const world = worldQuery.data;
  const roster = rosterQuery.data;
  const items = roster?.items ?? [];
  const summary = roster?.summary;

  if (!worldId) {
    return <ForgeEmptyState message="No world ID provided." />;
  }

  if (worldQuery.isLoading || rosterQuery.isLoading) {
    return <ForgeLoadingSpinner />;
  }

  if (!world) {
    return <ForgeEmptyState message="World not found." />;
  }

  const maintenanceSummary = {
    stateCommits: Array.isArray(stateQuery.data?.items) ? stateQuery.data.items.length : 0,
    historyEvents: historyQuery.data?.length || 0,
    lorebooks: Array.isArray(lorebooksQuery.data?.items) ? lorebooksQuery.data.items.length : 0,
  };
  const heroStatus = buildWorldAgentHeroStatus({
    agentCount: summary?.agentCount || 0,
    currentCompleteCount: summary?.currentCompleteCount || 0,
  });
  const summaryKpis = buildWorldAgentSummaryKpiItems({
    agentCount: summary?.agentCount || 0,
    currentCompleteCount: summary?.currentCompleteCount || 0,
    voiceDemoBoundCount: summary?.familyCoverage['agent-voice-demo']?.boundCount || 0,
  });

  return (
    <ForgePage maxWidth="max-w-6xl">
      <ForgePageHeader
        title={world.name}
        subtitle={world.description || 'Inspect world identity, maintainability, and active deliverables without collapsing into the workbench.'}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button tone="ghost" size="sm" onClick={() => navigate('/worlds/library')}>
              Back to Worlds
            </Button>
            <Button tone="secondary" size="sm" onClick={() => navigate(`/worlds/${worldId}/assets`)}>
              Open Asset Ops
            </Button>
            <Button tone="secondary" size="sm" onClick={() => navigate(`/worlds/${worldId}/agents`)}>
              View Agents
            </Button>
            <Button tone="primary" size="sm" onClick={() => navigate(`/worlds/${worldId}/maintain`)}>
              Open Maintain
            </Button>
          </div>
        )}
      />

      <ForgeSection className="overflow-hidden p-0">
        {world.bannerUrl ? (
          <img
            src={world.bannerUrl}
            alt=""
            className="h-56 w-full object-cover"
          />
        ) : (
          <div className="h-40 w-full bg-[linear-gradient(135deg,color-mix(in_srgb,var(--nimi-accent-text)_18%,transparent),transparent_55%,color-mix(in_srgb,var(--nimi-text-primary)_12%,transparent))]" />
        )}
        <div className="flex flex-col gap-4 p-5 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <ForgeEntityAvatar src={world.iconUrl} name={world.name} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold text-[var(--nimi-text-primary)]">
                  {world.name}
                </h2>
                <ForgeStatusBadge domain="world" status={world.status} />
                <ForgeStatusBadge
                  domain="generic"
                  status={heroStatus.state}
                  label={heroStatus.label}
                  tone={DELIVERABLE_STATE_TONE[heroStatus.state]}
                />
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--nimi-text-muted)]">
                Last updated {formatDate(world.updatedAt)}. Use this surface to inspect current world posture before handing off to maintain or the world-owned agent roster.
              </p>
            </div>
          </div>
          <div className="grid min-w-[220px] grid-cols-2 gap-3">
            <StatCallout label="Agents" value={world.agentCount} />
            <StatCallout label="Content Rating" value={world.contentRating} />
            <StatCallout label="History Events" value={maintenanceSummary.historyEvents} />
            <StatCallout label="Lorebooks" value={maintenanceSummary.lorebooks} />
          </div>
        </div>
      </ForgeSection>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <ForgeStatCard
          label="State Commits"
          value={maintenanceSummary.stateCommits}
          detail="Committed world-state writes currently visible."
        />
        {summaryKpis.map((kpi) => (
          <ForgeStatCard
            key={kpi.key}
            label={kpi.label}
            value={kpi.value}
            detail={kpi.detail}
          />
        ))}
      </div>

      <ForgeSection className="space-y-4">
        <ForgeSectionHeading
          eyebrow="Navigation"
          title="World Handoffs"
          description="Keep inspection, truth editing, and roster review distinct."
        />
        <div className="grid gap-3 md:grid-cols-2">
          <ForgeActionCard
            title="Open Maintain Workbench"
            description="Hand off into the world truth surface for events, lorebooks, rules, and deep maintenance."
            onClick={() => navigate(`/worlds/${worldId}/maintain`)}
          />
          <ForgeActionCard
            title="Open World Asset Ops"
            description="Review icon and cover families in their canonical asset flow without turning world detail into the hidden ops owner."
            onClick={() => navigate(`/worlds/${worldId}/assets`)}
          />
          <ForgeActionCard
            title="Inspect World Agents"
            description="Review the world-owned roster, deliverable posture, and truth-entry points for every agent."
            onClick={() => navigate(`/worlds/${worldId}/agents`)}
          />
        </div>
      </ForgeSection>

      <ForgeSection className="space-y-4">
        <ForgeSectionHeading
          eyebrow="Visuals"
          title="Current World Visuals"
          description="Inspect the active icon and cover exposed by the current world record."
        />
        <div className="grid gap-3 md:grid-cols-2">
          {buildWorldVisualCardItems({
            worldName: world.name,
            iconUrl: world.iconUrl,
            bannerUrl: world.bannerUrl,
          }).map((deliverable) => (
            <WorldFamilyCard
              key={deliverable.family}
              title={deliverable.title}
              description={deliverable.description}
              previewUrl={deliverable.previewUrl}
              previewName={deliverable.previewName}
            />
          ))}
        </div>
      </ForgeSection>

      <ForgeSection className="space-y-4">
        <ForgeSectionHeading
          eyebrow="Agents"
          title={`World-Owned Agent Summary (${summary?.agentCount || 0})`}
          description={AGENT_ROSTER_COMPLETENESS_COPY.summaryDescription}
          action={(
            <Button tone="secondary" size="sm" onClick={() => navigate(`/worlds/${worldId}/agents`)}>
              Open Roster
            </Button>
          )}
        />
        {items.length === 0 ? (
          <ForgeEmptyState message="No world-owned agents are currently attached to this world." />
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <DeliverableSummaryBadge
                label={AGENT_ROSTER_COMPLETENESS_COPY.currentCompleteLabel}
                value={summary?.currentCompleteCount || 0}
                state="PRESENT"
              />
              <DeliverableSummaryBadge
                label={AGENT_ROSTER_COMPLETENESS_COPY.missingRequiredLabel}
                value={summary?.missingRequiredFamilyCount || 0}
                state="MISSING"
              />
              {buildAgentRosterSummaryBadgeItems(summary?.familyCoverage).map((badge) => (
                <DeliverableSummaryBadge key={badge.family} label={badge.label} value={badge.value} state={badge.state} />
              ))}
            </div>
            <div className="grid gap-3 xl:grid-cols-3">
              {items.slice(0, 3).map((item) => (
                <AgentSummaryCard key={item.id} item={item} />
              ))}
            </div>
          </>
        )}
      </ForgeSection>

      <ForgeSection className="space-y-4">
        <ForgeSectionHeading
          eyebrow="Metadata"
          title="World Record"
          description="Current truth projection visible from the world detail surface."
        />
        <div className="grid gap-4 md:grid-cols-2">
          <InfoRow label="Description" value={world.description || 'No description recorded yet.'} />
          <InfoRow label="Genre" value={world.genre || 'Not set'} />
          <InfoRow label="Era" value={world.era || 'Not set'} />
          <InfoRow label="Motto" value={world.motto || 'Not set'} />
          <InfoRow label="Overview" value={world.overview || 'No overview recorded yet.'} className="md:col-span-2" />
          <InfoRow label="Created" value={formatDate(world.createdAt)} />
          <InfoRow label="Updated" value={formatDate(world.updatedAt)} />
        </div>
      </ForgeSection>
    </ForgePage>
  );
}

function WorldFamilyCard({
  title,
  description,
  previewUrl,
  previewName,
}: {
  title: string;
  description: string;
  previewUrl: string | null;
  previewName: string;
}) {
  const state: WorldVisualStatus = previewUrl ? 'PRESENT' : 'MISSING';
  const detail = previewUrl
    ? 'An active visual is visible from the current world record.'
    : 'No active visual has been recorded yet.';

  return (
    <Surface tone="card" material="glass-regular" elevation="raised" padding="md" className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{title}</p>
          <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">{description}</p>
        </div>
        <ForgeStatusBadge
          domain="generic"
          status={state}
          label={WORLD_VISUAL_LABEL[state]}
          tone={WORLD_VISUAL_TONE[state]}
        />
      </div>
      {previewUrl ? (
        <img
          src={previewUrl}
          alt=""
          className="h-40 w-full rounded-[var(--nimi-radius-md)] object-cover"
        />
      ) : (
        <div className="flex h-40 items-center justify-center rounded-[var(--nimi-radius-md)] border border-dashed border-[var(--nimi-border-subtle)]">
          <ForgeEntityAvatar name={previewName} size="lg" />
        </div>
      )}
      <p className="text-xs leading-5 text-[var(--nimi-text-muted)]">{detail}</p>
    </Surface>
  );
}

function DeliverableSummaryBadge({
  label,
  value,
  state,
}: {
  label: string;
  value: number;
  state: DeliverableCurrentState;
}) {
  return (
    <ForgeStatusBadge
      domain="generic"
      status={state}
      label={`${label}: ${value}`}
      tone={DELIVERABLE_STATE_TONE[state]}
    />
  );
}

function AgentSummaryCard({ item }: { item: WorldOwnedAgentRosterItem }) {
  return (
    <Surface tone="card" material="glass-thin" elevation="base" padding="md" className="space-y-3">
      <div className="flex items-center gap-3">
        <ForgeEntityAvatar src={item.avatarUrl} name={item.displayName} size="md" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">
            {item.displayName}
          </p>
          <p className="text-xs text-[var(--nimi-text-muted)]">
            @{item.handle} · Updated {formatDate(item.updatedAt)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {buildAgentDeliverableCardItems(item.deliverables).map((deliverable) => (
          <DeliverableSummaryBadge
            key={deliverable.family}
            label={deliverable.label}
            value={deliverable.value}
            state={deliverable.state}
          />
        ))}
      </div>
    </Surface>
  );
}

function InfoRow({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--nimi-text-muted)]">
        {label}
      </dt>
      <dd className="mt-1 text-sm leading-6 text-[var(--nimi-text-primary)]">{value}</dd>
    </div>
  );
}

function StatCallout({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <Surface tone="card" material="glass-thin" elevation="raised" padding="sm">
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--nimi-text-muted)]">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold text-[var(--nimi-text-primary)]">{value}</p>
    </Surface>
  );
}
