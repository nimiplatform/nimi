import { useTranslation } from 'react-i18next';

type WorldDetailPanelModule = typeof import('@renderer/features/world/world-detail-active-panel');

export async function loadWorldDetailPanelModule(): Promise<WorldDetailPanelModule> {
  return import('@renderer/features/world/world-detail-active-panel');
}

export function prefetchWorldDetailPanel(): void {
  void loadWorldDetailPanelModule();
}

export function WorldDetailRouteLoading() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#0a0f0c]">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0d1f16] via-[#0a0f0c] to-[#050705]" />
        <div
          className="absolute -top-28 right-[-7rem] h-[22rem] w-[22rem] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(78, 204, 163, 0.18) 0%, transparent 72%)' }}
        />
        <div
          className="absolute bottom-[-8rem] left-[-6rem] h-[24rem] w-[24rem] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(78, 204, 163, 0.12) 0%, transparent 72%)' }}
        />
      </div>
      <div className="relative z-10 flex flex-col items-center gap-3 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#4ECCA3]/30 border-t-[#4ECCA3]" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-[#e8f5ee]">{t('WorldDetail.loading')}</p>
          <p className="text-xs text-[#e8f5ee]/45">
            {t('WorldDetail.loadingStateMessage', {
              defaultValue: 'Preparing world canvas and latest state',
            })}
          </p>
        </div>
      </div>
    </div>
  );
}
