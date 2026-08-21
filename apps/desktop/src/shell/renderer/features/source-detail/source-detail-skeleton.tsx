// Loading skeleton for the source detail page. The world-character dossier is
// the dominant layout on this surface, so the skeleton approximates its
// cover-hero + content-card structure; the compact persona card resolves fast
// enough that the same silhouette reads correctly for it too.
export function SourceDetailSkeleton() {
  return (
    <div
      data-testid="source-detail-skeleton"
      aria-busy="true"
      aria-live="polite"
      className="flex min-h-0 flex-1 flex-col bg-[var(--nimi-surface-canvas)]"
    >
      <div className="mx-auto w-full max-w-[1180px] flex-1 px-5 py-6">
        <div className="grid gap-5">
          <div className="relative h-[410px] animate-pulse overflow-hidden rounded-[24px] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_80%,transparent)]">
            <div className="absolute bottom-12 left-14 flex items-end gap-5 max-[900px]:left-8">
              <div className="h-[104px] w-[104px] rounded-[20px] bg-[color-mix(in_srgb,var(--nimi-surface-card)_60%,transparent)]" />
              <div className="grid gap-3 pb-1">
                <div className="h-10 w-64 rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_60%,transparent)]" />
                <div className="h-4 w-40 rounded-full bg-[color-mix(in_srgb,var(--nimi-surface-card)_50%,transparent)]" />
              </div>
            </div>
          </div>
          <div className="grid gap-5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="h-64 animate-pulse rounded-[20px] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_80%,transparent)]" />
            <div className="h-64 animate-pulse rounded-[20px] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_80%,transparent)]" />
          </div>
          <div className="h-44 animate-pulse rounded-[20px] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_80%,transparent)]" />
        </div>
      </div>
    </div>
  );
}
