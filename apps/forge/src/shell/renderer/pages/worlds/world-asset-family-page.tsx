import { useMemo } from 'react';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { ForgeEntityAvatar } from '@renderer/components/card-list.js';
import { formatDate } from '@renderer/components/format-utils.js';
import {
  ForgeEmptyState,
  ForgeErrorBanner,
  ForgeLoadingSpinner,
  ForgePage,
  ForgePageHeader,
  ForgeSection,
  ForgeSectionHeading,
  ForgeStatCard,
} from '@renderer/components/page-layout.js';
import { ForgeStatusBadge } from '@renderer/components/status-indicators.js';
import { useResourcesQuery, type ResourceSummary } from '@renderer/hooks/use-content-queries.js';
import {
  useWorldAssetOps,
  type WorldAssetOpsCandidateView,
  type WorldAssetOpsFamily,
} from '@renderer/hooks/use-world-asset-ops.js';
import { useWorldDetailQuery } from '@renderer/hooks/use-world-queries.js';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

const FAMILY_COPY: Record<WorldAssetOpsFamily, {
  title: string;
  studioTarget: 'world-icon' | 'world-banner' | 'world-background' | 'world-scene';
  description: string;
}> = {
  'world-icon': {
    title: 'World Icon Review',
    studioTarget: 'world-icon',
    description: 'Review square emblem candidates, confirm a winner, and bind it into the world icon slot.',
  },
  'world-cover': {
    title: 'World Cover Review',
    studioTarget: 'world-banner',
    description: 'Review wide-format cover candidates, confirm a winner, and bind it into the world cover slot.',
  },
  'world-background': {
    title: 'World Background Review',
    studioTarget: 'world-background',
    description: 'Review ambient background candidates, confirm a winner, and bind it into the world background slot.',
  },
  'world-scene': {
    title: 'World Scene Review',
    studioTarget: 'world-scene',
    description: 'Review world key-art scene candidates, confirm a winner, and bind it into the world scene slot.',
  },
};

const LIFECYCLE_TONE = {
  generated: 'info',
  candidate: 'warning',
  approved: 'success',
  rejected: 'danger',
  confirmed: 'warning',
  bound: 'success',
  superseded: 'neutral',
} as const;

export default function WorldAssetFamilyPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { worldId = '', family = '' } = useParams<{ worldId: string; family: string }>();
  const worldQuery = useWorldDetailQuery(worldId);
  const resourcesQuery = useResourcesQuery(Boolean(worldId));
  const assetOps = useWorldAssetOps(worldId);

  if (!worldId) {
    return <ForgeEmptyState message="No world ID provided." />;
  }

  if (
    family !== 'world-icon'
    && family !== 'world-cover'
    && family !== 'world-background'
    && family !== 'world-scene'
  ) {
    return <ForgeEmptyState message="Unsupported world asset family." />;
  }

  const world = worldQuery.data;
  const familyCopy = FAMILY_COPY[family];
  const familyState = assetOps.getFamilyState(family);
  const highlightedResourceId = searchParams.get('candidateResourceId') || '';

  const libraryImages = useMemo(() => {
    const existingResourceIds = new Set(familyState.candidateList.map((candidate) => candidate.resourceId));
    return (resourcesQuery.data || [])
      .filter((resource) => resource.resourceType === 'IMAGE' && Boolean(resource.url))
      .filter((resource) => !existingResourceIds.has(resource.id))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
  }, [familyState.candidateList, resourcesQuery.data]);

  if (worldQuery.isLoading || resourcesQuery.isLoading || assetOps.bindingsQuery.isLoading) {
    return <ForgeLoadingSpinner />;
  }

  if (!world) {
    return <ForgeEmptyState message="World not found." />;
  }

  const previewUrl =
    familyState.activeItem?.previewUrl
    || (family === 'world-icon'
      ? world.iconUrl
      : family === 'world-cover'
        ? world.bannerUrl
        : null);

  return (
    <ForgePage maxWidth="max-w-6xl">
      <ForgePageHeader
        title={familyCopy.title}
        subtitle={familyCopy.description}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button tone="ghost" size="sm" onClick={() => navigate(`/worlds/${worldId}/assets`)}>
              Back to Asset Hub
            </Button>
            <Button
              tone="secondary"
              size="sm"
              onClick={() =>
                navigate(`/content/images?target=${familyCopy.studioTarget}&worldId=${worldId}&worldName=${encodeURIComponent(world.name)}`)
              }
            >
              Generate Candidate
            </Button>
          </div>
        )}
      />

      {assetOps.bindConfirmedMutation.isError ? (
        <ForgeErrorBanner
          message={
            assetOps.bindConfirmedMutation.error instanceof Error
              ? assetOps.bindConfirmedMutation.error.message
              : 'Failed to bind the confirmed candidate.'
          }
        />
      ) : null}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <ForgeStatCard
          label="Current Winner"
          value={familyState.currentBoundItem ? 'Bound' : familyState.confirmedItem ? 'Confirmed' : 'Missing'}
          detail="The active family winner from confirmation and bind state."
        />
        <ForgeStatCard
          label="Candidate Queue"
          value={familyState.counts.generated + familyState.counts.candidate + familyState.counts.approved + familyState.counts.confirmed}
          detail="Candidates still moving through review, confirmation, or bind."
        />
        <ForgeStatCard
          label="Rejected"
          value={familyState.counts.rejected}
          detail="Explicitly rejected candidates still retained for audit visibility."
        />
        <ForgeStatCard
          label="Library Intake"
          value={libraryImages.length}
          detail="Image resources not yet queued into this family."
        />
      </div>

      <ForgeSection className="space-y-4">
        <ForgeSectionHeading
          eyebrow="Current"
          title="Active Family Posture"
          description="This page owns review, confirmation, and bind. World detail remains inspection-only."
        />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Surface tone="card" material="glass-regular" elevation="raised" padding="md" className="space-y-4">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt=""
                className={`w-full rounded-[var(--nimi-radius-md)] object-cover ${family === 'world-icon' ? 'aspect-square max-h-[320px]' : 'aspect-video'}`}
              />
            ) : (
              <div className={`flex items-center justify-center rounded-[var(--nimi-radius-md)] border border-dashed border-[var(--nimi-border-subtle)] ${family === 'world-icon' ? 'aspect-square max-h-[320px]' : 'aspect-video'}`}>
                <ForgeEntityAvatar name={world.name} size="lg" />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <ForgeStatusBadge
                domain="generic"
                status={familyState.currentBoundItem ? 'BOUND' : familyState.confirmedItem ? 'PRESENT' : 'MISSING'}
                label={familyState.currentBoundItem ? 'Bound' : familyState.confirmedItem ? 'Confirmed' : 'Missing'}
                tone={familyState.currentBoundItem ? 'success' : familyState.confirmedItem ? 'warning' : 'danger'}
              />
              {familyState.activeItem?.resourceId ? (
                <ForgeStatusBadge
                  domain="generic"
                  status="PRESENT"
                  label={`Resource ${familyState.activeItem.resourceId.slice(0, 8)}`}
                  tone="info"
                />
              ) : null}
            </div>
          </Surface>

          <Surface tone="card" material="glass-thin" elevation="base" padding="md" className="space-y-3">
            <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">Lifecycle Grammar</p>
            <p className="text-sm text-[var(--nimi-text-muted)]">
              `candidate` enters review, `approved` marks acceptable quality, `confirmed` selects the winner, and `bound` proves the world binding seam changed.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <LifecycleCounter label="Generated" value={familyState.counts.generated} />
              <LifecycleCounter label="Candidate" value={familyState.counts.candidate} />
              <LifecycleCounter label="Approved" value={familyState.counts.approved} />
              <LifecycleCounter label="Confirmed" value={familyState.counts.confirmed} />
            </div>
          </Surface>
        </div>
      </ForgeSection>

      <ForgeSection className="space-y-4">
        <ForgeSectionHeading
          eyebrow="Review"
          title={`Candidate Review Queue (${familyState.candidateList.length})`}
          description="Use explicit lifecycle actions here instead of direct bind helpers."
        />
        {familyState.candidateList.length === 0 ? (
          <ForgeEmptyState message="No candidates are queued yet. Generate one in Image Studio or add one from the library below." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {familyState.candidateList.map((candidate) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                family={family}
                worldName={world.name}
                highlighted={candidate.resourceId === highlightedResourceId}
                onReview={() => assetOps.reviewGeneratedCandidate(candidate.id)}
                onApprove={() => assetOps.approveCandidate(candidate.id)}
                onReject={() => assetOps.rejectCandidate(candidate.id)}
                onConfirm={() => assetOps.confirmCandidate(candidate.id)}
                onBind={() => void assetOps.bindConfirmed({ family, candidateId: candidate.id })}
                bindingBusy={assetOps.bindConfirmedMutation.isPending}
              />
            ))}
          </div>
        )}
      </ForgeSection>

      <ForgeSection className="space-y-4">
        <ForgeSectionHeading
          eyebrow="Library"
          title={`Add From Library (${libraryImages.length})`}
          description="Content library inventory is not family truth until you explicitly queue a resource into this review flow."
        />
        {libraryImages.length === 0 ? (
          <ForgeEmptyState message="No additional image resources are available to queue into this family." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {libraryImages.slice(0, 12).map((resource) => (
              <LibraryCard
                key={resource.id}
                resource={resource}
                family={family}
                onQueue={() =>
                  assetOps.addFromLibrary({
                    family,
                    resourceId: resource.id,
                    previewUrl: resource.url,
                  })
                }
              />
            ))}
          </div>
        )}
      </ForgeSection>
    </ForgePage>
  );
}

function CandidateCard({
  candidate,
  family,
  worldName,
  highlighted,
  onReview,
  onApprove,
  onReject,
  onConfirm,
  onBind,
  bindingBusy,
}: {
  candidate: WorldAssetOpsCandidateView;
  family: WorldAssetOpsFamily;
  worldName: string;
  highlighted: boolean;
  onReview: () => void;
  onApprove: () => void;
  onReject: () => void;
  onConfirm: () => void;
  onBind: () => void;
  bindingBusy: boolean;
}) {
  const previewUrl = candidate.previewUrl;

  return (
    <Surface
      tone="card"
      material={highlighted ? 'glass-regular' : 'glass-thin'}
      elevation={highlighted ? 'raised' : 'base'}
      padding="md"
      className="space-y-4"
    >
      {previewUrl ? (
        <img
          src={previewUrl}
          alt=""
          className={`w-full rounded-[var(--nimi-radius-md)] object-cover ${family === 'world-icon' ? 'aspect-square' : 'aspect-video'}`}
        />
      ) : (
        <div className={`flex items-center justify-center rounded-[var(--nimi-radius-md)] border border-dashed border-[var(--nimi-border-subtle)] ${family === 'world-icon' ? 'aspect-square' : 'aspect-video'}`}>
          <ForgeEntityAvatar name={worldName} size="lg" />
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
              Resource {candidate.resourceId.slice(0, 8)}
            </p>
            <p className="text-xs text-[var(--nimi-text-muted)]">
              Updated {formatDate(candidate.updatedAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {highlighted ? (
              <ForgeStatusBadge domain="generic" status="PRESENT" label="Studio Handoff" tone="info" />
            ) : null}
            <ForgeStatusBadge
              domain="generic"
              status={candidate.effectiveLifecycle.toUpperCase()}
              label={candidate.effectiveLifecycle}
              tone={LIFECYCLE_TONE[candidate.effectiveLifecycle]}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {candidate.effectiveLifecycle === 'generated' || candidate.effectiveLifecycle === 'rejected' || candidate.effectiveLifecycle === 'superseded' ? (
            <Button tone="ghost" size="sm" onClick={onReview}>
              Return to Review
            </Button>
          ) : (
            <Button tone="ghost" size="sm" disabled>
              Review Ready
            </Button>
          )}

          {candidate.effectiveLifecycle === 'candidate' ? (
            <Button tone="secondary" size="sm" onClick={onApprove}>
              Approve
            </Button>
          ) : (
            <Button tone="secondary" size="sm" disabled>
              Approve
            </Button>
          )}

          {candidate.effectiveLifecycle === 'candidate' || candidate.effectiveLifecycle === 'approved' ? (
            <Button tone="ghost" size="sm" onClick={onReject}>
              Reject
            </Button>
          ) : (
            <Button tone="ghost" size="sm" disabled>
              Reject
            </Button>
          )}

          {candidate.effectiveLifecycle === 'approved' ? (
            <Button tone="secondary" size="sm" onClick={onConfirm}>
              Confirm
            </Button>
          ) : candidate.effectiveLifecycle === 'confirmed' ? (
            <Button tone="primary" size="sm" onClick={onBind} disabled={bindingBusy}>
              {bindingBusy ? 'Binding...' : 'Bind'}
            </Button>
          ) : candidate.effectiveLifecycle === 'bound' ? (
            <Button tone="primary" size="sm" disabled>
              Bound
            </Button>
          ) : (
            <Button tone="secondary" size="sm" disabled>
              Confirm
            </Button>
          )}
        </div>

        <p className="text-xs text-[var(--nimi-text-muted)]">
          {candidate.isSynthetic
            ? 'This row was synthesized from current binding truth because the bound resource is not yet in local candidate state.'
            : `Origin: ${candidate.origin}. Candidate id ${candidate.id}.`}
        </p>
      </div>
    </Surface>
  );
}

function LibraryCard({
  resource,
  family,
  onQueue,
}: {
  resource: ResourceSummary;
  family: WorldAssetOpsFamily;
  onQueue: () => void;
}) {
  return (
    <Surface tone="card" material="glass-thin" elevation="base" padding="md" className="space-y-4">
      {resource.url ? (
        <img
          src={resource.url}
          alt={resource.title || resource.label || resource.id}
          className={`w-full rounded-[var(--nimi-radius-md)] object-cover ${family === 'world-icon' ? 'aspect-square' : 'aspect-video'}`}
        />
      ) : null}
      <div>
        <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {resource.title || resource.label || `Resource ${resource.id.slice(0, 8)}`}
        </p>
        <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
          Updated {formatDate(resource.updatedAt)}
        </p>
      </div>
      <Button tone="secondary" size="sm" onClick={onQueue}>
        Queue Candidate
      </Button>
    </Surface>
  );
}

function LifecycleCounter({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <Surface tone="card" material="glass-thin" elevation="base" padding="sm">
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--nimi-text-muted)]">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold text-[var(--nimi-text-primary)]">{value}</p>
    </Surface>
  );
}
