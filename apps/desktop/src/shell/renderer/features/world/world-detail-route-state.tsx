type WorldDetailPanelModule = typeof import('@renderer/features/world/world-detail-active-panel');

export async function loadWorldDetailPanelModule(): Promise<WorldDetailPanelModule> {
  return import('@renderer/features/world/world-detail-active-panel');
}

export function prefetchWorldDetailPanel(): void {
  void loadWorldDetailPanelModule();
}

export function WorldDetailSkeletonPage() {
  return (
    <div className="min-h-screen bg-[#0a0f0c] text-[#e8f5ee] relative overflow-x-hidden">
      {/* Background layer */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0d1f16] via-[#0a0f0c] to-[#050705]" />
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: `radial-gradient(circle, rgba(78, 204, 163, 0.3) 1px, transparent 1px)`,
            backgroundSize: '50px 50px',
          }}
        />
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `radial-gradient(circle, rgba(78, 204, 163, 0.5) 0.5px, transparent 0.5px)`,
            backgroundSize: '25px 25px',
          }}
        />
      </div>

      <div className="relative z-10 w-[min(1400px,calc(100vw-48px))] mx-auto py-6 flex flex-col gap-5">
        {/* Hero Banner skeleton */}
        <section className="relative overflow-hidden rounded-[20px] border border-[#4ECCA3]/20 animate-pulse">
          <div className="relative w-full h-[380px] bg-[#0f1612]">
            {/* Back button placeholder */}
            <div className="absolute left-4 top-4 w-10 h-10 rounded-full bg-[#173422]" />
            {/* Badge placeholder */}
            <div className="absolute top-4 right-4 w-36 h-8 rounded-full bg-[#173422]" />

            {/* Bottom content */}
            <div className="absolute bottom-0 left-0 right-0 p-8">
              <div className="flex items-end justify-between gap-6">
                <div className="flex items-start gap-6 flex-1 min-w-0">
                  {/* Icon */}
                  <div className="w-24 h-24 rounded-2xl bg-[#173422] flex-shrink-0" />
                  {/* Title + desc */}
                  <div className="flex-1 min-w-0 space-y-3">
                    <div className="h-3 w-32 rounded bg-[#173422]" />
                    <div className="h-[42px] w-64 rounded bg-[#173422]" />
                    <div className="h-4 w-full max-w-2xl rounded bg-[#173422]" />
                    <div className="h-4 w-4/5 max-w-2xl rounded bg-[#173422]" />
                  </div>
                </div>
                {/* Flow dynamics placeholder */}
                <div className="flex-shrink-0 w-[120px] h-[120px] rounded-full bg-[#173422]" />
              </div>
            </div>
          </div>
        </section>

        {/* 3-column grid skeleton */}
        <div className="grid grid-cols-[1fr_1.2fr_1fr] gap-5">
          <div className="h-[420px] animate-pulse rounded-[16px] bg-[#0f1612] border border-[#4ECCA3]/10" />
          <div className="h-[420px] animate-pulse rounded-[16px] bg-[#0f1612] border border-[#4ECCA3]/10" />
          <div className="h-[420px] animate-pulse rounded-[16px] bg-[#0f1612] border border-[#4ECCA3]/10" />
        </div>

        {/* Agents section skeleton */}
        <section className="relative overflow-hidden rounded-[16px] border border-[#4ECCA3]/15 bg-[#0f1612]/80 backdrop-blur-sm p-5">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/50 to-transparent" />
          {/* Section title placeholder */}
          <div className="h-4 w-20 rounded bg-[#173422] animate-pulse mb-5" />
          {/* Agent card grid */}
          <div className="grid grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[174px] rounded-xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/60 p-4 animate-pulse"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-14 h-14 rounded-[10px] bg-[#173422]" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-24 rounded bg-[#173422]" />
                    <div className="h-3 w-16 rounded bg-[#173422]" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="h-3 w-full rounded bg-[#173422]" />
                  <div className="h-3 w-5/6 rounded bg-[#173422]" />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export function WorldDetailRouteLoading() {
  return <WorldDetailSkeletonPage />;
}
