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
      className="flex min-h-0 flex-1 flex-col bg-gray-50"
    >
      <div className="mx-auto w-full max-w-[1180px] flex-1 px-5 py-6">
        <div className="grid gap-5">
          <div className="relative h-[410px] animate-pulse overflow-hidden rounded-[24px] bg-gray-200/80">
            <div className="absolute bottom-12 left-14 flex items-end gap-5 max-[900px]:left-8">
              <div className="h-[104px] w-[104px] rounded-[20px] bg-white/60" />
              <div className="grid gap-3 pb-1">
                <div className="h-10 w-64 rounded-full bg-white/60" />
                <div className="h-4 w-40 rounded-full bg-white/50" />
              </div>
            </div>
          </div>
          <div className="grid gap-5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="h-64 animate-pulse rounded-[20px] bg-gray-200/80" />
            <div className="h-64 animate-pulse rounded-[20px] bg-gray-200/80" />
          </div>
          <div className="h-44 animate-pulse rounded-[20px] bg-gray-200/80" />
        </div>
      </div>
    </div>
  );
}
