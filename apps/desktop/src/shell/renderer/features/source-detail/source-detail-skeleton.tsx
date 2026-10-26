// Match the edge-to-edge cover and open reading layout of the source page.
export function SourceDetailSkeleton() {
  return (
    <div
      data-testid="source-detail-skeleton"
      aria-busy="true"
      aria-live="polite"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div aria-hidden="true" className="h-[280px] shrink-0 animate-pulse bg-[var(--nimi-surface-active)] max-[720px]:h-[190px]" />
      <div aria-hidden="true" className="mx-auto w-full max-w-[1180px] px-9 pb-7 max-[720px]:px-5">
        <div className="flex items-start gap-8 max-[720px]:flex-col max-[720px]:gap-6">
          <div className="relative -mt-[80px] h-[160px] w-[160px] shrink-0 animate-pulse rounded-[var(--nimi-radius-xl)] bg-[var(--nimi-surface-panel)] max-[720px]:-mt-[60px] max-[720px]:h-[120px] max-[720px]:w-[120px]" />
          <div className="grid w-full max-w-64 gap-3 pt-6 max-[720px]:pt-0">
            <div className="h-10 animate-pulse rounded bg-[var(--nimi-surface-active)]" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--nimi-surface-active)]" />
          </div>
        </div>
        <div className="mt-7 grid gap-10 border-t border-[var(--nimi-border-subtle)] pt-7 min-[900px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {[0, 1].map((column) => (
            <div key={column} className="grid content-start gap-5">
              <div className="h-6 w-1/2 animate-pulse rounded bg-[var(--nimi-surface-active)]" />
              <div className="grid gap-3">
                {[0, 1, 2].map((line) => (
                  <div key={line} className="h-4 animate-pulse rounded bg-[var(--nimi-surface-active)] last:w-2/3" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
