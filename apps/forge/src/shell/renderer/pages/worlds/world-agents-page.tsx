import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { ForgeEntityAvatar } from '@renderer/components/card-list.js';
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
  buildAgentRosterPageStatItems,
  buildAgentRosterStatusBadge,
  buildAgentDeliverableCardItems,
  formatAgentRosterCompletenessLine,
  buildAgentRosterSummaryBadgeItems,
} from '@renderer/features/asset-ops/deliverable-presentation.js';
import type { DeliverableCurrentState, WorldOwnedAgentRosterItem } from '@renderer/hooks/use-agent-queries.js';
import { useWorldOwnedAgentRosterQuery } from '@renderer/hooks/use-agent-queries.js';
import { useWorldDetailQuery } from '@renderer/hooks/use-world-queries.js';
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

export default function WorldAgentsPage() {
  const navigate = useNavigate();
  const { worldId = '' } = useParams<{ worldId: string }>();
  const worldQuery = useWorldDetailQuery(worldId);
  const rosterQuery = useWorldOwnedAgentRosterQuery(worldId, Boolean(worldId));

  if (!worldId) {
    return <ForgeEmptyState message="No world ID provided." />;
  }

  if (worldQuery.isLoading || rosterQuery.isLoading) {
    return <ForgeLoadingSpinner />;
  }

  if (!worldQuery.data) {
    return <ForgeEmptyState message="World not found." />;
  }

  const roster = rosterQuery.data;
  const summary = roster?.summary;
  const items = roster?.items ?? [];

  return (
    <ForgePage maxWidth="max-w-6xl">
      <ForgePageHeader
        title={`${worldQuery.data.name} Agents`}
        subtitle={worldQuery.data.description || 'Inspect the world-owned roster and current deliverable posture for each agent.'}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button tone="ghost" size="sm" onClick={() => navigate(`/worlds/${worldId}`)}>
              Back to World
            </Button>
            <Button tone="secondary" size="sm" onClick={() => navigate(`/worlds/${worldId}/maintain`)}>
              Open Maintain
            </Button>
          </div>
        )}
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {buildAgentRosterPageStatItems({
          agentCount: summary?.agentCount || 0,
          currentCompleteCount: summary?.currentCompleteCount || 0,
          opsCompleteCount: summary?.opsCompleteCount || 0,
          unverifiedRequiredFamilyCount: summary?.unverifiedRequiredFamilyCount || 0,
        }).map((stat) => (
          <ForgeStatCard
            key={stat.key}
            label={stat.label}
            value={stat.value}
            detail={stat.detail}
          />
        ))}
      </div>

      <ForgeSection className="space-y-4">
        <ForgeSectionHeading
          eyebrow="Roster"
          title={AGENT_ROSTER_COMPLETENESS_COPY.completenessOverviewTitle}
          description={AGENT_ROSTER_COMPLETENESS_COPY.completenessOverviewDescription}
        />
        <div className="flex flex-wrap gap-2">
          {buildAgentRosterSummaryBadgeItems(summary?.familyCoverage).map((deliverable) => (
            <DeliverableSummaryBadge
              key={deliverable.family}
              label={deliverable.label}
              value={deliverable.value}
              state={deliverable.state}
            />
          ))}
          <DeliverableSummaryBadge
            label={AGENT_ROSTER_COMPLETENESS_COPY.missingRequiredLabel}
            value={summary?.missingRequiredFamilyCount || 0}
            state="MISSING"
          />
        </div>
      </ForgeSection>

      <ForgeSection className="space-y-4">
        <ForgeSectionHeading
          eyebrow="Agents"
          title={`World Agent Roster (${items.length})`}
          description="Open truth editing from the roster without collapsing the catalog surface into a workbench redirect."
        />
        {items.length === 0 ? (
          <ForgeEmptyState message="This world does not own any agents yet." />
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <WorldAgentRosterCard
                key={item.id}
                item={item}
                onOpenTruth={() => navigate(`/agents/${item.id}`)}
                onOpenAssetOps={() => navigate(`/agents/${item.id}/assets`)}
              />
            ))}
          </div>
        )}
      </ForgeSection>
    </ForgePage>
  );
}

function WorldAgentRosterCard({
  item,
  onOpenTruth,
  onOpenAssetOps,
}: {
  item: WorldOwnedAgentRosterItem;
  onOpenTruth: () => void;
  onOpenAssetOps: () => void;
}) {
  const rosterStatus = buildAgentRosterStatusBadge({
    currentState: item.completeness.currentState,
    opsState: item.completeness.opsState,
  });

  return (
    <Surface tone="card" material="glass-thin" elevation="base" padding="md" className="space-y-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <ForgeEntityAvatar src={item.avatarUrl} name={item.displayName} size="md" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">
                {item.displayName}
              </p>
              <ForgeStatusBadge
                domain="ownership"
                status={item.ownershipType}
                label={item.ownershipType === 'WORLD_OWNED' ? 'WORLD' : 'MASTER'}
              />
              <ForgeStatusBadge domain="agent" status={item.status} />
              <ForgeStatusBadge
                domain="generic"
                status={rosterStatus.state}
                label={rosterStatus.label}
                tone={DELIVERABLE_STATE_TONE[rosterStatus.state]}
              />
            </div>
            <p className="text-xs text-[var(--nimi-text-muted)]">
              @{item.handle} · Updated {formatDate(item.updatedAt)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button tone="ghost" size="sm" onClick={onOpenAssetOps}>
            Open Asset Ops
          </Button>
          <Button tone="secondary" size="sm" onClick={onOpenTruth}>
            Open Truth
          </Button>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {buildAgentDeliverableCardItems(item.deliverables, { includeOptional: true }).map((deliverable) => (
          <DeliverableStateCard
            key={deliverable.family}
            label={deliverable.label}
            detail={deliverable.detail}
            state={deliverable.state}
          />
        ))}
      </div>

      <p className="text-xs leading-5 text-[var(--nimi-text-muted)]">
        {formatAgentRosterCompletenessLine({
          currentState: item.completeness.currentState,
          opsState: item.completeness.opsState,
        })}
      </p>
    </Surface>
  );
}

function DeliverableStateCard({
  label,
  detail,
  state,
}: {
  label: string;
  detail: string;
  state: DeliverableCurrentState;
}) {
  return (
    <Surface tone="card" material="glass-regular" elevation="raised" padding="sm" className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--nimi-text-muted)]">
          {label}
        </p>
        <ForgeStatusBadge
          domain="generic"
          status={state}
          label={DELIVERABLE_STATE_LABEL[state]}
          tone={DELIVERABLE_STATE_TONE[state]}
        />
      </div>
      <p className="text-xs text-[var(--nimi-text-muted)]">{detail}</p>
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
