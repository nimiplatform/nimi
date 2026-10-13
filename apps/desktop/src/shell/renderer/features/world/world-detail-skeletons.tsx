import type { CSSProperties, ReactNode } from 'react';
import { LoadingSkeleton, Surface } from '@nimiplatform/kit/ui';
import {
  WORLD_DETAIL_PAPER_CONTENT_PADDING,
  worldDetailPaperContentFrameStyle,
} from './world-detail-layout.js';

// Loading skeletons for the world detail root page and its subpages
// (relationship explorer / people archive / lore library). Block tones resolve
// through Nimi surface tokens so the pulse reads as unfilled cards rather than
// a foreign overlay.
const SKELETON_CARD = 'var(--nimi-surface-card)';
const SKELETON_SOFT = 'color-mix(in srgb, var(--nimi-surface-card) 60%, transparent)';

function SkeletonBlock({
  height,
  width,
  radius = 14,
  tone = 'card',
  style,
}: {
  height: number | string;
  width?: number | string;
  radius?: number | string;
  tone?: 'card' | 'soft';
  style?: CSSProperties;
}) {
  return (
    <div
      className="animate-pulse"
      style={{
        height,
        width,
        borderRadius: radius,
        background: tone === 'card' ? SKELETON_CARD : SKELETON_SOFT,
        ...style,
      }}
    />
  );
}

export function WorldDetailPageSkeleton() {
  return (
    <div data-testid="world-detail-page-skeleton" aria-busy="true" className="@container mx-auto w-full max-w-[1440px] space-y-5 p-4">
      <Surface tone="card" padding="lg"><LoadingSkeleton lines={5} /></Surface>
      <LoadingSkeleton lines={1} className="max-w-64" />
      <div className="grid grid-cols-1 gap-4 @min-[640px]:grid-cols-2 @min-[1120px]:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Surface key={index} tone="card" padding="lg"><LoadingSkeleton lines={5} /></Surface>)}
      </div>
    </div>
  );
}

function SkeletonPersonRow() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <SkeletonBlock height={40} width={40} radius="50%" tone="soft" />
      <div style={{ display: 'grid', gap: 6, flex: 1, minWidth: 0 }}>
        <SkeletonBlock height={12} width="72%" radius={999} tone="soft" />
        <SkeletonBlock height={10} width="48%" radius={999} tone="soft" />
      </div>
    </div>
  );
}

export function WorldRelationshipExplorerSkeleton() {
  return (
    <div
      data-testid="world-relationship-explorer-skeleton"
      aria-busy="true"
      aria-live="polite"
      style={{ minHeight: '100%', padding: WORLD_DETAIL_PAPER_CONTENT_PADDING, boxSizing: 'border-box' }}
    >
      <header
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(170px,auto) minmax(0,1fr) auto',
          alignItems: 'center',
          gap: 18,
          padding: '9px 18px',
          minHeight: 58,
        }}
      >
        <SkeletonBlock height={32} width={112} radius={999} />
        <div style={{ display: 'grid', gap: 6, justifyItems: 'center' }}>
          <SkeletonBlock height={14} width={180} radius={999} />
          <SkeletonBlock height={10} width={132} radius={999} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 22 }}>
          {Array.from({ length: 3 }).map((_, index) => (
            <SkeletonBlock key={index} height={36} width={52} radius={10} />
          ))}
        </div>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(212px,244px) minmax(0,1fr)',
          gap: 12,
          alignItems: 'start',
          padding: 12,
        }}
      >
        <div
          style={{
            display: 'grid',
            gap: 14,
            padding: 16,
            borderRadius: 18,
            background: SKELETON_CARD,
          }}
        >
          <SkeletonBlock height={34} radius={10} tone="soft" />
          {Array.from({ length: 6 }).map((_, index) => (
            <SkeletonPersonRow key={index} />
          ))}
        </div>
        <SkeletonBlock height={560} radius={18} />
      </div>
    </div>
  );
}

function SubpageSkeletonShell({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div data-testid={testId} aria-busy="true" aria-live="polite" style={{ position: 'relative', minHeight: '100%' }}>
      <div style={worldDetailPaperContentFrameStyle()}>
        <div style={{ marginBottom: 14 }}>
          <SkeletonBlock height={34} width={148} radius={999} />
        </div>
        <div style={{ display: 'grid', gap: 18 }}>{children}</div>
      </div>
    </div>
  );
}

export function WorldPeopleArchiveSkeleton() {
  return (
    <SubpageSkeletonShell testId="world-detail-people-archive-skeleton">
      <SkeletonBlock height={128} radius={20} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(232px,1fr))', gap: 13 }}>
        {Array.from({ length: 8 }).map((_, index) => (
          <SkeletonBlock key={index} height={150} />
        ))}
      </div>
    </SubpageSkeletonShell>
  );
}

export function WorldLoreLibrarySkeleton() {
  return (
    <SubpageSkeletonShell testId="world-detail-lore-library-skeleton">
      <SkeletonBlock height={168} radius={20} />
      {Array.from({ length: 4 }).map((_, index) => (
        <SkeletonBlock key={index} height={96} radius={16} />
      ))}
    </SubpageSkeletonShell>
  );
}

export function WorldResourceReferencesSkeleton() {
  return (
    <SubpageSkeletonShell testId="world-detail-resource-references-skeleton">
      <SkeletonBlock height={168} radius={20} />
      {Array.from({ length: 3 }).map((_, index) => (
        <SkeletonBlock key={index} height={108} radius={16} />
      ))}
    </SubpageSkeletonShell>
  );
}
