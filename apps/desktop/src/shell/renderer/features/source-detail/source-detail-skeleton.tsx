// Match the 1120px banner, portrait identity grid, and 60/40 restrained layout.
export function SourceDetailSkeleton({ variant = 'standalone' }: { variant?: 'standalone' | 'partner' } = {}) {
  const partner = variant === 'partner';
  return (
    <div
      data-testid="source-detail-skeleton"
      data-skeleton-variant={variant}
      aria-busy="true"
      aria-live="polite"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div aria-hidden="true" className={`mx-auto w-full max-w-[1120px] ${partner ? 'px-0' : 'px-8 pt-6 max-[720px]:px-5 max-[720px]:pt-4'}`}>
        <div className={`w-full animate-pulse rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-active)] ${partner ? 'h-[176px]' : 'h-[240px] max-[720px]:h-[176px]'}`} />
      </div>
      <div aria-hidden="true" className={`mx-auto w-full max-w-[1120px] pb-12 ${partner ? 'px-0' : 'px-8 max-[720px]:px-5'}`}>
        <div className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-6 gap-y-4 max-[760px]:grid-cols-[auto_minmax(0,1fr)] ${partner ? 'pl-6 max-[720px]:pl-5' : 'pl-8 max-[720px]:pl-5'}`}>
          <div className={`relative shrink-0 animate-pulse rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-panel)] ring-4 ring-[var(--nimi-surface-card)] ${partner ? '-mt-12 h-24 w-24' : '-mt-16 h-32 w-32 max-[720px]:-mt-10 max-[720px]:h-22 max-[720px]:w-22'}`} />
          <div className="grid min-w-0 max-w-md gap-2.5 pt-4 max-[760px]:pt-2">
            <div className="h-9 w-48 animate-pulse rounded-lg bg-[var(--nimi-surface-active)]" />
            <div className="h-4 w-72 max-w-full animate-pulse rounded bg-[var(--nimi-surface-active)]" />
            <div className="h-3.5 w-40 animate-pulse rounded bg-[var(--nimi-surface-panel)]" />
          </div>
          <div className="pt-4 max-[760px]:col-span-full max-[760px]:pt-1">
            <div className="h-10 w-32 animate-pulse rounded-[var(--nimi-radius-action)] bg-[var(--nimi-surface-active)]" />
          </div>
        </div>
        <div className="mt-10 grid gap-12 min-[960px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="grid content-start gap-10">
            <div className="grid gap-3">
              <div className="h-5 w-32 animate-pulse rounded bg-[var(--nimi-surface-active)]" />
              <div className="h-4 animate-pulse rounded bg-[var(--nimi-surface-active)]" />
              <div className="h-4 w-5/6 animate-pulse rounded bg-[var(--nimi-surface-active)]" />
            </div>
            <div className="h-60 animate-pulse rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-panel)]" />
          </div>
          <div className="h-[400px] animate-pulse rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-panel)]" />
        </div>
      </div>
    </div>
  );
}
