/**
 * World Detail Page — shows world info with banner/icon upload (FG-WORLD-004)
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { useWorldDetailQuery } from '@renderer/hooks/use-world-queries.js';
import { uploadFileAsResource } from '@renderer/data/content-data-client.js';
import { batchUpsertWorldResourceBindings } from '@renderer/data/world-data-client.js';
import {
  ForgePage,
  ForgePageHeader,
  ForgeSection,
  ForgeSectionHeading,
  ForgeLoadingSpinner,
  ForgeEmptyState,
  ForgeStatCard,
} from '@renderer/components/page-layout.js';
import { ForgeEntityAvatar } from '@renderer/components/card-list.js';
import { ForgeStatusBadge } from '@renderer/components/status-indicators.js';
import { formatDate } from '@renderer/components/format-utils.js';

export default function WorldDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { worldId } = useParams<{ worldId: string }>();
  const queryClient = useQueryClient();

  const worldQuery = useWorldDetailQuery(worldId || '');
  const world = worldQuery.data;

  const bannerInputRef = useRef<HTMLInputElement>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [uploadingIcon, setUploadingIcon] = useState(false);

  async function handleBannerUpload(file: File) {
    if (!worldId) return;
    setUploadingBanner(true);
    try {
      const { resourceId } = await uploadFileAsResource(file);
      await batchUpsertWorldResourceBindings(worldId, {
        bindingUpserts: [{
          objectType: 'RESOURCE',
          objectId: resourceId,
          hostType: 'WORLD',
          hostId: worldId,
          bindingKind: 'PRESENTATION',
          bindingPoint: 'WORLD_BANNER',
          priority: 0,
        }],
      });
      await queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'detail', worldId] });
    } finally {
      setUploadingBanner(false);
    }
  }

  async function handleIconUpload(file: File) {
    if (!worldId) return;
    setUploadingIcon(true);
    try {
      const { resourceId } = await uploadFileAsResource(file);
      await batchUpsertWorldResourceBindings(worldId, {
        bindingUpserts: [{
          objectType: 'RESOURCE',
          objectId: resourceId,
          hostType: 'WORLD',
          hostId: worldId,
          bindingKind: 'PRESENTATION',
          bindingPoint: 'WORLD_ICON',
          priority: 0,
        }],
      });
      await queryClient.invalidateQueries({ queryKey: ['forge', 'world', 'detail', worldId] });
    } finally {
      setUploadingIcon(false);
    }
  }

  if (!worldId) {
    return (
      <ForgeEmptyState message={t('worldDetail.noWorldId', 'No world ID provided')} />
    );
  }

  if (worldQuery.isLoading) {
    return <ForgeLoadingSpinner />;
  }

  if (!world) {
    return (
      <ForgeEmptyState message={t('worldDetail.notFound', 'World not found')} />
    );
  }

  return (
    <ForgePage>
      <ForgePageHeader
        title={world.name}
        subtitle={world.description || t('worldDetail.subtitle', 'Manage world presentation assets and inspect current world metadata.')}
        actions={(
          <Button tone="ghost" size="sm" onClick={() => navigate('/worlds/library')}>
            &larr; {t('worlds.backToList', 'Back')}
          </Button>
        )}
      />

      <ForgeSection className="space-y-5" material="glass-regular">
        <ForgeSectionHeading
          eyebrow={t('worldDetail.presentation', 'Presentation')}
          title={t('worldDetail.presentationAssets', 'World Presentation Assets')}
          description={t('worldDetail.presentationAssetsHint', 'Update the banner and icon without leaving the world detail surface.')}
        />
        <input
          ref={bannerInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleBannerUpload(file);
            e.target.value = '';
          }}
        />
        {world.bannerUrl ? (
          <Surface tone="card" material="glass-thin" padding="none" className="group relative overflow-hidden rounded-lg">
            <img
              src={world.bannerUrl}
              alt=""
              className="aspect-video w-full object-cover"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
              <Button
                tone="secondary"
                size="sm"
                onClick={() => bannerInputRef.current?.click()}
                disabled={uploadingBanner}
              >
                {uploadingBanner
                  ? t('worldDetail.uploading', 'Uploading...')
                  : t('worldDetail.changeBanner', 'Change Banner')}
              </Button>
            </div>
          </Surface>
        ) : (
          <Surface
            tone="card"
            material="glass-thin"
            padding="none"
            interactive
            onClick={() => bannerInputRef.current?.click()}
            className="border-2 border-dashed border-[var(--nimi-border-subtle)] transition-colors hover:border-[var(--nimi-text-muted)]"
          >
            <div className="flex aspect-video w-full items-center justify-center rounded-lg">
              <span className="text-sm text-[var(--nimi-text-muted)]">
                {uploadingBanner
                  ? t('worldDetail.uploading', 'Uploading...')
                  : t('worldDetail.uploadBanner', 'Upload Banner')}
              </span>
            </div>
          </Surface>
        )}
      </ForgeSection>

      <ForgeSection className="flex items-center gap-4">
        <div className="relative">
          <input
            ref={iconInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleIconUpload(file);
              e.target.value = '';
            }}
          />
          <Surface
            tone="card"
            material="glass-thin"
            padding="none"
            interactive
            className="group relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-full"
            onClick={() => iconInputRef.current?.click()}
          >
            {world.iconUrl ? (
              <img src={world.iconUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <ForgeEntityAvatar name={world.name} size="lg" />
            )}
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
              <span className="text-xs font-medium text-white">
                {uploadingIcon ? '...' : t('worldDetail.edit', 'Edit')}
              </span>
            </div>
          </Surface>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-bold text-[var(--nimi-text-primary)]">
              {world.name}
            </h1>
            <ForgeStatusBadge domain="world" status={world.status} />
          </div>
          {world.description && (
            <p className="mt-1 text-sm text-[var(--nimi-text-muted)]">{world.description}</p>
          )}
        </div>
      </ForgeSection>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <ForgeStatCard
          label={t('worldDetail.agentCount', 'Agents')}
          value={world.agentCount}
        />
        <ForgeStatCard
          label={t('worldDetail.contentRating', 'Content Rating')}
          value={world.contentRating}
        />
        <ForgeStatCard
          label={t('worldDetail.updatedAt', 'Last Updated')}
          value={formatDate(world.updatedAt)}
        />
      </div>

      {/* World info section */}
      <ForgeSection className="space-y-4">
        <ForgeSectionHeading
          eyebrow={t('worldDetail.worldInfo', 'World Info')}
          title={t('worldDetail.metadata', 'Metadata')}
        />
        <div className="space-y-4">
          {world.genre && (
            <InfoRow label={t('worldDetail.genre', 'Genre')} value={world.genre} />
          )}
          {world.era && (
            <InfoRow label={t('worldDetail.era', 'Era')} value={world.era} />
          )}
          {world.motto && (
            <InfoRow label={t('worldDetail.motto', 'Motto')} value={world.motto} />
          )}
          {world.overview && (
            <InfoRow label={t('worldDetail.overview', 'Overview')} value={world.overview} />
          )}
          {!world.genre && !world.era && !world.motto && !world.overview && (
            <p className="text-sm text-[var(--nimi-text-muted)]">
              {t('worldDetail.noInfo', 'No additional world information available.')}
            </p>
          )}
        </div>
      </ForgeSection>
    </ForgePage>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-[var(--nimi-text-muted)]">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-[var(--nimi-text-primary)]">{value}</dd>
    </div>
  );
}
