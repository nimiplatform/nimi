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
import { useWorldAssetOps } from '@renderer/hooks/use-world-asset-ops.js';
import { useWorldDetailQuery } from '@renderer/hooks/use-world-queries.js';
import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

const WORLD_ASSET_CARD_COPY = {
  'world-icon': {
    description: 'Review emblem and square identity candidates for the world catalog entry.',
    studioTarget: 'world-icon',
  },
  'world-cover': {
    description: 'Review wide-format cover candidates for the world presentation slot.',
    studioTarget: 'world-banner',
  },
  'world-background': {
    description: 'Review ambient backdrop candidates for world shell and immersive presentation surfaces.',
    studioTarget: 'world-background',
  },
  'world-scene': {
    description: 'Review key-art scene candidates that depict the world as a narrative environment.',
    studioTarget: 'world-scene',
  },
} as const;

const COMPLETENESS_TONE = {
  MISSING: 'danger',
  CONFIRMED: 'warning',
  BOUND: 'success',
} as const;

export default function WorldAssetsPage() {
  const navigate = useNavigate();
  const { worldId = '' } = useParams<{ worldId: string }>();
  const worldQuery = useWorldDetailQuery(worldId);
  const assetOps = useWorldAssetOps(worldId);

  const world = worldQuery.data;
  const queueCount = useMemo(
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

  if (!worldId) {
    return <ForgeEmptyState message="No world ID provided." />;
  }

  if (worldQuery.isLoading || assetOps.bindingsQuery.isLoading) {
    return <ForgeLoadingSpinner />;
  }

  if (!world) {
    return <ForgeEmptyState message="World not found." />;
  }

  return (
    <ForgePage maxWidth="max-w-6xl">
      <ForgePageHeader
        title={`${world.name} Asset Ops`}
        subtitle={world.description || 'Canonical world asset review, confirmation, and bind flows for icon and cover families.'}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button tone="ghost" size="sm" onClick={() => navigate(`/worlds/${worldId}`)}>
              Back to World
            </Button>
            <Button tone="secondary" size="sm" onClick={() => navigate('/content/library')}>
              Open Library
            </Button>
          </div>
        )}
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <ForgeStatCard
          label="Families"
          value={assetOps.familySummaries.length}
          detail="Current world asset families admitted into canonical ops."
        />
        <ForgeStatCard
          label="Confirmed Families"
          value={assetOps.summary.completeFamilyCount}
          detail="Families with a confirmed or bound winner."
        />
        <ForgeStatCard
          label="Bound Families"
          value={assetOps.summary.boundFamilyCount}
          detail="Families already written through the world binding seam."
        />
        <ForgeStatCard
          label="Review Queue"
          value={queueCount}
          detail="Candidates still moving through review, confirmation, or bind."
        />
      </div>

      <ForgeSection className="space-y-4">
        <ForgeSectionHeading
          eyebrow="Hub"
          title="World Asset Families"
          description="Image Studio and the content library feed these family-owned review surfaces. World detail remains inspection-only."
        />
        <div className="grid gap-4 xl:grid-cols-2">
          {assetOps.familySummaries.map((family) => (
            <WorldAssetHubCard
              key={family.family}
              family={family}
              worldId={worldId}
              worldName={world.name}
              fallbackPreviewUrl={family.family === 'world-icon'
                ? world.iconUrl
                : family.family === 'world-cover'
                  ? world.bannerUrl
                  : null}
            />
          ))}
        </div>
      </ForgeSection>
    </ForgePage>
  );
}

function WorldAssetHubCard({
  family,
  worldId,
  worldName,
  fallbackPreviewUrl,
}: {
  family: ReturnType<typeof useWorldAssetOps>['familySummaries'][number];
  worldId: string;
  worldName: string;
  fallbackPreviewUrl: string | null;
}) {
  const navigate = useNavigate();
  const previewUrl = family.activeItem?.previewUrl || fallbackPreviewUrl;
  const cardCopy = WORLD_ASSET_CARD_COPY[family.family];
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
            {cardCopy.description}
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
        <img
          src={previewUrl}
          alt=""
          className={`w-full rounded-[var(--nimi-radius-md)] object-cover ${family.family === 'world-icon' ? 'aspect-square max-h-56' : 'aspect-video'}`}
        />
      ) : (
        <div className={`flex items-center justify-center rounded-[var(--nimi-radius-md)] border border-dashed border-[var(--nimi-border-subtle)] ${family.family === 'world-icon' ? 'aspect-square max-h-56' : 'aspect-video'}`}>
          <ForgeEntityAvatar name={worldName} size="lg" />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <MiniCard
          label="Current Winner"
          value={family.currentBoundItem ? 'Bound' : family.confirmedItem ? 'Confirmed' : 'Missing'}
          detail={family.activeItem?.resourceId ? `Resource ${family.activeItem.resourceId.slice(0, 8)}` : 'No winner selected yet.'}
        />
        <MiniCard
          label="Review Queue"
          value={reviewQueueCount}
          detail="Candidates awaiting approval, confirmation, or bind."
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button tone="primary" size="sm" onClick={() => navigate(`/worlds/${worldId}/assets/${family.family}`)}>
          Open Family Review
        </Button>
        <Button
          tone="secondary"
          size="sm"
          onClick={() =>
            navigate(`/content/images?target=${cardCopy.studioTarget}&worldId=${worldId}&worldName=${encodeURIComponent(worldName)}`)
          }
        >
          Generate Candidate
        </Button>
      </div>
    </Surface>
  );
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
