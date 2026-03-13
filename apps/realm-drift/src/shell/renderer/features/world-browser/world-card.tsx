import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import type { WorldSummary } from './world-browser-data.js';

type WorldCardProps = {
  world: WorldSummary;
  onClick: (worldId: string) => void;
};

export function WorldCard({ world, onClick }: WorldCardProps) {
  const { t } = useTranslation();
  const marbleJob = useAppStore((s) => s.marbleJobs[world.id]);

  return (
    <button
      onClick={() => onClick(world.id)}
      className="group flex flex-col rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden text-left transition-colors hover:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-white/20"
    >
      {/* Banner 16:9 */}
      <div className="relative aspect-video w-full bg-neutral-800 overflow-hidden">
        {world.bannerUrl ? (
          <img
            src={world.bannerUrl}
            alt={world.name}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-neutral-600 text-sm">
            {world.name.charAt(0).toUpperCase()}
          </div>
        )}
        {marbleJob && (
          <div className="absolute top-2 right-2">
            {marbleJob.status === 'completed' && (
              <span className="rounded-full bg-emerald-500/80 px-2 py-0.5 text-xs text-white backdrop-blur-sm">
                {t('browser.marbleReady')}
              </span>
            )}
            {marbleJob.status === 'generating' && (
              <span className="rounded-full bg-amber-500/80 px-2 py-0.5 text-xs text-white backdrop-blur-sm animate-pulse">
                {t('browser.marbleGenerating')}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex flex-col gap-1.5 p-3">
        <h3 className="text-sm font-semibold text-white truncate">{world.name}</h3>
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          {world.genre && <span>{world.genre}</span>}
          {world.genre && world.era && <span className="text-neutral-600">·</span>}
          {world.era && <span>{world.era}</span>}
        </div>
        {world.themes && world.themes.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {world.themes.slice(0, 3).map((theme) => (
              <span key={theme} className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400">
                {theme}
              </span>
            ))}
          </div>
        )}
        <div className="text-xs text-neutral-500">
          {t('browser.agents', { count: world.agentCount })}
        </div>
      </div>
    </button>
  );
}
