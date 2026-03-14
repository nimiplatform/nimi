import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import { APP_DISPLAY_SECTION_TITLE_CLASS, APP_PAGE_TITLE_CLASS } from '@renderer/components/typography.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { prefetchWorldDetailAndEvents, worldListQueryKey } from './world-detail-queries';
import { prefetchWorldDetailPanel } from './world-detail-route-state';
import { isMainWorldType } from './shared';

const ICON_SEARCH = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export type WorldAgentItem = {
  id: string;
  name: string;
  handle?: string;
  bio?: string;
  avatarUrl?: string | null;
  createdAt?: string;
};

export type WorldListItem = {
  id: string;
  name: string;
  description: string | null;
  tagline?: string | null;
  motto?: string | null;
  overview?: string | null;
  contentRating?: string | null;
  genre: string | null;
  themes: string[];
  era: string | null;
  iconUrl: string | null;
  bannerUrl: string | null;
  type: string;
  status: string;
  level: number;
  levelUpdatedAt: string | null;
  agentCount: number;
  createdAt: string;
  updatedAt: string | null;
  creatorId: string | null;
  freezeReason: string | null;
  lorebookEntryLimit: number;
  nativeAgentLimit: number;
  nativeCreationState: string;
  scoreA: number;
  scoreC: number;
  scoreE: number;
  scoreEwma: number;
  scoreQ: number;
  timeFlowRatio: number;
  transitInLimit: number;
  timeModel?: Record<string, unknown> | null;
  clockConfig?: Record<string, unknown> | null;
  languages?: Record<string, unknown> | null;
  agents?: WorldAgentItem[];
};

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readNumberField(source: Record<string, unknown> | null | undefined, keys: string[]): number | null {
  if (!source) {
    return null;
  }
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function readStringField(source: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  if (!source) {
    return null;
  }
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function resolveTimeFlowRatio(timeModel: Record<string, unknown> | null | undefined): number {
  const ratio = readNumberField(timeModel, ['timeFlowRatio']);
  return ratio && ratio > 0 ? ratio : 1;
}

function resolveCurrentWorldDate(
  clockConfig: Record<string, unknown> | null | undefined,
  timeFlowRatio: number,
  nowMs: number,
): Date | null {
  const realAnchorRaw = readStringField(clockConfig, ['anchorRealTime']);
  const worldAnchorRaw = readStringField(clockConfig, ['pausedAt', 'anchorWorldTime']);
  if (!realAnchorRaw || !worldAnchorRaw) {
    return null;
  }
  const realAnchor = new Date(realAnchorRaw);
  const worldAnchor = new Date(worldAnchorRaw);
  if (Number.isNaN(realAnchor.getTime()) || Number.isNaN(worldAnchor.getTime())) {
    return null;
  }
  if (clockConfig?.isPaused === true) {
    return worldAnchor;
  }
  const elapsedRealMs = Math.max(0, nowMs - realAnchor.getTime());
  return new Date(worldAnchor.getTime() + elapsedRealMs * Math.max(0.0001, timeFlowRatio));
}

function formatWorldDate(
  worldDate: Date,
  clockConfig: Record<string, unknown> | null | undefined,
): string {
  const timeFormat = readRecord(clockConfig?.timeFormat);
  const datePattern = readStringField(timeFormat, ['datePattern']) ?? '{year}-{month}-{day}';
  return datePattern
    .replaceAll('{year}', String(worldDate.getUTCFullYear()))
    .replaceAll('{month}', String(worldDate.getUTCMonth() + 1))
    .replaceAll('{day}', String(worldDate.getUTCDate()))
    .replaceAll('{hour}', String(worldDate.getUTCHours()).padStart(2, '0'))
    .replaceAll('{minute}', String(worldDate.getUTCMinutes()).padStart(2, '0'))
    .replaceAll('{second}', String(worldDate.getUTCSeconds()).padStart(2, '0'));
}

function resolveWorldType(raw: Record<string, unknown>): string {
  return (
    readString(raw.type) ??
    readString(raw.worldType) ??
    readString(raw.world_type) ??
    'CREATOR'
  );
}

function resolveCreatorId(raw: Record<string, unknown>): string | null {
  return (
    readString(raw.creatorId) ??
    readString(raw.worldCreatorId) ??
    readString(raw.world_creator_id) ??
    null
  );
}

function isMainWorld(item: Pick<WorldListItem, 'type' | 'creatorId'>): boolean {
  return isMainWorldType(item.type) || !item.creatorId;
}

export function toWorldListItem(raw: Record<string, unknown>): WorldListItem {
  let parsedAgents: WorldAgentItem[] | undefined;
  if (Array.isArray(raw.agents)) {
    parsedAgents = raw.agents.map((a: unknown) => {
      const agent = a as Record<string, unknown>;
      return {
        id: String(agent.id || ''),
        name: String(agent.name || 'Unknown'),
        handle: typeof agent.handle === 'string' ? agent.handle : undefined,
        bio: typeof agent.bio === 'string' ? agent.bio : undefined,
        avatarUrl: typeof agent.avatarUrl === 'string' ? agent.avatarUrl : null,
        createdAt: typeof agent.createdAt === 'string' ? agent.createdAt : undefined,
      };
    });
  }

  return {
    id: String(raw.id || ''),
    name: String(raw.name || 'Unknown World'),
    description: typeof raw.description === 'string' ? raw.description : null,
    tagline: typeof raw.tagline === 'string' ? raw.tagline : null,
    motto: typeof raw.motto === 'string' ? raw.motto : null,
    overview: typeof raw.overview === 'string' ? raw.overview : null,
    contentRating: typeof raw.contentRating === 'string' ? raw.contentRating : null,
    genre: typeof raw.genre === 'string' ? raw.genre : null,
    themes: Array.isArray(raw.themes)
      ? raw.themes.filter((t): t is string => typeof t === 'string')
      : [],
    era: typeof raw.era === 'string' ? raw.era : null,
    iconUrl: typeof raw.iconUrl === 'string' ? raw.iconUrl : null,
    bannerUrl: typeof raw.bannerUrl === 'string' ? raw.bannerUrl : null,
    type: resolveWorldType(raw),
    status: typeof raw.status === 'string' ? raw.status : 'DRAFT',
    level: typeof raw.level === 'number' ? raw.level : 1,
    levelUpdatedAt: typeof raw.levelUpdatedAt === 'string' ? raw.levelUpdatedAt : null,
    agentCount: typeof raw.agentCount === 'number' ? raw.agentCount : 0,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    creatorId: resolveCreatorId(raw),
    freezeReason: typeof raw.freezeReason === 'string' ? raw.freezeReason : null,
    lorebookEntryLimit: typeof raw.lorebookEntryLimit === 'number' ? raw.lorebookEntryLimit : 0,
    nativeAgentLimit: typeof raw.nativeAgentLimit === 'number' ? raw.nativeAgentLimit : 0,
    nativeCreationState:
      typeof raw.nativeCreationState === 'string' ? raw.nativeCreationState : 'OPEN',
    scoreA: typeof raw.scoreA === 'number' ? raw.scoreA : 0,
    scoreC: typeof raw.scoreC === 'number' ? raw.scoreC : 0,
    scoreE: typeof raw.scoreE === 'number' ? raw.scoreE : 0,
    scoreEwma: typeof raw.scoreEwma === 'number' ? raw.scoreEwma : 0,
    scoreQ: typeof raw.scoreQ === 'number' ? raw.scoreQ : 0,
    timeFlowRatio: resolveTimeFlowRatio(readRecord(raw.timeModel)),
    transitInLimit: typeof raw.transitInLimit === 'number' ? raw.transitInLimit : 0,
    timeModel: readRecord(raw.timeModel),
    clockConfig: readRecord(raw.clockConfig),
    languages: readRecord(raw.languages),
    agents: parsedAgents,
  };
}

const DEFAULT_TAG_STYLE: { bg: string; text: string } = { bg: 'bg-gray-100', text: 'text-gray-600' };

// Morandi color palette for tags
const tagStyles: Record<string, { bg: string; text: string }> = {
  genre: { bg: 'bg-slate-100', text: 'text-slate-600' },
  era: { bg: 'bg-stone-100', text: 'text-stone-600' },
  theme: DEFAULT_TAG_STYLE,
  active: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
  draft: { bg: 'bg-amber-50', text: 'text-amber-600' },
  frozen: { bg: 'bg-rose-50', text: 'text-rose-600' },
  open: { bg: 'bg-teal-50', text: 'text-teal-600' },
  closed: { bg: 'bg-orange-50', text: 'text-orange-600' },
};

function getTagStyle(type: string, value?: string): { bg: string; text: string } {
  const key = value?.toLowerCase() || type.toLowerCase();
  return tagStyles[key] ?? DEFAULT_TAG_STYLE;
}

function formatCompactStat(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }
  if (value >= 1000) {
    const compact = (value / 1000).toFixed(value >= 10000 ? 0 : 1);
    return `${compact.replace(/\.0$/, '')}k`;
  }
  return String(Math.round(value));
}

function getWorldAgentTotal(world: WorldListItem): string {
  return formatCompactStat(world.agentCount);
}

function getWorldScoring(world: WorldListItem): string {
  const score = world.scoreQ || world.scoreEwma || Math.round((world.scoreA + world.scoreC + world.scoreE) / 3);
  return Number.isFinite(score) ? `${Math.round(score)}` : '0';
}

function formatWorldClock(world: WorldListItem): string {
  const clockConfig = readRecord(world.clockConfig);
  const worldDate = resolveCurrentWorldDate(clockConfig, world.timeFlowRatio, Date.now());
  if (!worldDate) {
    return 'N/A';
  }
  return formatWorldDate(worldDate, clockConfig);
}

type WorldChronoPanelState = {
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  flowRatio: number;
  dateLabel: string;
  compactDateLabel: string;
  progress: number;
};

function resolveWorldChronoPanelState(world: WorldListItem, nowMs: number): WorldChronoPanelState | null {
  const clockConfig = readRecord(world.clockConfig);
  const flowRatio = Math.max(0.0001, world.timeFlowRatio);
  const worldDate = resolveCurrentWorldDate(clockConfig, flowRatio, nowMs);
  if (!worldDate) {
    return null;
  }
  const hour = worldDate.getUTCHours();
  const minute = worldDate.getUTCMinutes();
  const second = worldDate.getUTCSeconds();
  const millisecond = worldDate.getUTCMilliseconds();
  const dateLabel = formatWorldDate(worldDate, clockConfig);

  return {
    hour,
    minute,
    second,
    millisecond,
    flowRatio,
    dateLabel,
    compactDateLabel: `${worldDate.getUTCFullYear()}.${String(worldDate.getUTCMonth() + 1).padStart(2, '0')}.${String(worldDate.getUTCDate()).padStart(2, '0')}`,
    progress: Math.max(8, Math.min(100, (Math.log10(flowRatio + 1) / Math.log10(1000 + 1)) * 100)),
  };
}

function WorldChronoPanel({ world, compact = false }: { world: WorldListItem; compact?: boolean }) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 80);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const chrono = resolveWorldChronoPanelState(world, nowMs);
  if (!chrono) {
    return null;
  }

  const flowPulse = (chrono.millisecond / 999) * 48;
  const flowWidth = Math.min(100, Math.max(18, chrono.progress * 0.42 + flowPulse));

  return (
    <div
      className={`${compact ? 'min-w-[150px] max-w-[180px] px-3 py-2.5' : 'min-w-[300px] max-w-[340px] px-6 py-5'} rounded-[16px] text-white`}
        style={{
          background: 'rgba(255, 255, 255, 0.03)',
          backdropFilter: compact ? 'blur(18px)' : 'blur(18px)',
          WebkitBackdropFilter: compact ? 'blur(18px)' : 'blur(18px)',
          border: '1px solid rgba(255, 255, 255, 0.14)',
          boxShadow: 'none',
        }}
      >
      <div className="mb-2 flex items-center justify-between gap-4">
        <span className={`${compact ? 'text-[7px]' : 'text-[10px]'} uppercase tracking-[0.2em] text-[#56D3B2]/85`}>WORLD SYNC</span>
        <span
          className={`text-right ${compact ? 'text-[10px]' : 'text-[13px]'} font-medium tracking-[0.08em] text-white/92`}
          style={{ textShadow: '1.5px 0 rgba(255,0,255,0.55), -1px 0 rgba(86,211,178,0.8)' }}
        >
          {chrono.compactDateLabel}
        </span>
      </div>

      <div className={`${compact ? 'mt-1.5' : 'mt-3'} flex items-end text-white`}>
        <div className={`font-mono ${compact ? 'text-[18px]' : 'text-[38px]'} font-black leading-none tracking-[-0.04em]`}>
          {String(chrono.hour).padStart(2, '0')}:{String(chrono.minute).padStart(2, '0')}
        </div>
        <div className={`${compact ? 'ml-1.5' : 'ml-3'} flex flex-col pb-0.5`}>
          <span className={`${compact ? 'text-[11px]' : 'text-lg'} leading-none text-[#56D3B2]`}>:{String(chrono.second).padStart(2, '0')}</span>
          <span className={`${compact ? 'mt-0.5 text-[8px]' : 'mt-1 text-[11px]'} font-mono leading-none text-fuchsia-300/80`}>
            {String(chrono.millisecond).padStart(3, '0')}
          </span>
        </div>
      </div>

      <div className={`${compact ? 'mt-2' : 'mt-4'}`}>
        <span className={`mb-1.5 block ${compact ? 'text-[7px]' : 'text-[9px]'} uppercase tracking-[0.16em] text-[#8EF0D8]`}>
          CHRONO FLOW: {chrono.flowRatio.toFixed(1)}X
        </span>
        <div className="relative h-[2px] overflow-hidden bg-white/10">
          <div
            className="absolute inset-y-0 left-0 bg-[#56D3B2] shadow-[0_0_10px_rgba(86,211,178,0.9)]"
            style={{ width: `${flowWidth}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export function WorldList() {
  const { t } = useTranslation();
  const navigateToWorld = useAppStore((state) => state.navigateToWorld);
  const [searchText, setSearchText] = useState('');

  const openWorldDetail = (worldId: string) => {
    prefetchWorldDetailPanel();
    prefetchWorldDetailAndEvents(worldId);
    navigateToWorld(worldId);
  };

  const worldsQuery = useQuery({
    queryKey: worldListQueryKey(),
    queryFn: async () => {
      const result = await dataSync.loadWorlds();
      return Array.isArray(result)
        ? result.map((item) => toWorldListItem(item as Record<string, unknown>))
        : [];
    },
  });

  const worlds = worldsQuery.data || [];

  const filteredWorlds = searchText.trim()
    ? worlds.filter(
        (w) =>
          w.name.toLowerCase().includes(searchText.toLowerCase()) ||
          (w.description && w.description.toLowerCase().includes(searchText.toLowerCase())),
      )
    : worlds;

  const mainWorld = worlds.find((w) => isMainWorld(w));
  const subWorlds = filteredWorlds.filter((w) => !isMainWorld(w));

  if (worldsQuery.isPending) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" style={{ backgroundColor: '#F0F4F8' }}>
        <div className="shrink-0 px-6 py-4">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="h-8 w-36 animate-pulse rounded-xl bg-white/80" />
              <div className="h-3 w-24 animate-pulse rounded bg-white/70" />
            </div>
            <div className="h-11 w-[300px] animate-pulse rounded-full bg-white/80" />
          </div>
        </div>
        <ScrollShell className="flex-1" contentClassName="px-6 py-6">
          <div className="mx-auto max-w-6xl space-y-8">
            <div className="space-y-4">
              <div className="h-6 w-28 animate-pulse rounded-lg bg-white/80" />
              <div className="rounded-3xl bg-white p-6 shadow-sm">
                <div className="mb-5 h-40 animate-pulse rounded-[1.5rem] bg-slate-100" />
                <div className="flex items-start gap-5">
                  <div className="h-20 w-20 animate-pulse rounded-2xl bg-slate-100" />
                  <div className="flex-1 space-y-3">
                    <div className="h-6 w-56 animate-pulse rounded bg-slate-100" />
                    <div className="h-4 w-28 animate-pulse rounded bg-slate-100" />
                    <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                    <div className="flex gap-2">
                      <div className="h-7 w-20 animate-pulse rounded-full bg-slate-100" />
                      <div className="h-7 w-24 animate-pulse rounded-full bg-slate-100" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="h-6 w-32 animate-pulse rounded-lg bg-white/80" />
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="rounded-3xl bg-white p-5 shadow-sm">
                    <div className="mb-4 h-32 animate-pulse rounded-[1.5rem] bg-slate-100" />
                    <div className="space-y-3">
                      <div className="h-5 w-40 animate-pulse rounded bg-slate-100" />
                      <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                      <div className="h-4 w-3/4 animate-pulse rounded bg-slate-100" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ScrollShell>
      </div>
    );
  }

  if (worldsQuery.isError) {
    return (
      <div className="flex h-full items-center justify-center" style={{ backgroundColor: '#F0F4F8' }}>
        <span className="text-sm text-red-600">{t('World.loadError')}</span>
      </div>
    );
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
      style={{ background: 'linear-gradient(180deg, #1B1530 0%, #231E3B 14%, #312A4F 36%, #E7EDF6 100%)' }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(circle_at_top,_rgba(125,211,252,0.18),_transparent_42%),radial-gradient(circle_at_18%_20%,_rgba(168,85,247,0.16),_transparent_28%),radial-gradient(circle_at_82%_18%,_rgba(56,189,248,0.14),_transparent_24%)]" />
      {/* Header bar */}
      <div className="relative shrink-0 px-6 py-6">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className={APP_PAGE_TITLE_CLASS} style={{ color: '#F8FAFF' }}>{t('World.title')}</h1>
            <span className="text-xs" style={{ color: 'rgba(226,232,240,0.78)' }}>
              {t('World.syncedFromDesktop', { defaultValue: 'Synced from Desktop' })}
            </span>
          </div>
          <div className="w-[340px] shrink-0">
            <div className="group relative">
              <span className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-white/45 transition-colors group-focus-within:text-emerald-300">
                {ICON_SEARCH}
              </span>
              <input
                type="search"
                value={searchText}
                onChange={(event) => {
                  setSearchText(event.target.value);
                }}
                placeholder={t('World.searchByNameOrDescription', {
                  defaultValue: 'Search worlds by name or description...',
                })}
                className="w-full rounded-full border border-white/12 bg-white/10 py-2.5 pl-11 pr-5 text-sm text-white placeholder:text-white/45 shadow-[0_18px_40px_rgba(6,10,24,0.22)] outline-none backdrop-blur-xl transition-all focus:border-emerald-300/40 focus:bg-white/14 focus:shadow-[0_18px_50px_rgba(16,185,129,0.14)] focus:ring-4 focus:ring-emerald-300/10"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <ScrollShell className="flex-1" viewportClassName="" contentClassName="px-6 pb-10 pt-2">
        <div className="mx-auto max-w-6xl">
          {/* Main World Card */}
          {mainWorld && !searchText && (
            <div className="mb-24">
              <h2 className={`${APP_DISPLAY_SECTION_TITLE_CLASS} mb-4`} style={{ fontFamily: 'var(--font-display)', color: '#F8FAFF' }}>{t('World.mainWorld')}</h2>
                <div
                  onClick={() => openWorldDetail(mainWorld.id)}
                  className="group relative cursor-pointer transition-all duration-500 hover:-translate-y-1"
                  style={{
                    boxShadow: 'none',
                  }}
                >
                  {mainWorld.bannerUrl ? (
                    <div className="relative h-[470px] overflow-visible">
                      <div className="absolute inset-x-0 top-0 bottom-[48px] overflow-hidden rounded-[34px] border border-white/10 [clip-path:inset(0_round_34px)]">
                        <img
                          src={mainWorld.bannerUrl}
                          alt={mainWorld.name}
                          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                        />
                        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(24,16,44,0.20)_0%,rgba(24,16,44,0.07)_26%,rgba(24,16,44,0.10)_50%,rgba(24,16,44,0.32)_84%,rgba(24,16,44,0.48)_100%)]" />
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_65%_18%,rgba(255,255,255,0.14),transparent_18%),radial-gradient(circle_at_28%_18%,rgba(167,139,250,0.18),transparent_26%),radial-gradient(circle_at_76%_24%,rgba(103,232,249,0.16),transparent_22%)]" />
                      </div>

                    <div className="absolute bottom-[-8px] left-1/2 z-10 w-[calc(100%-1.5rem)] max-w-[1000px] -translate-x-1/2">
                        <div
                          className="rounded-[28px] border px-7 py-6 backdrop-blur-[56px] transition-transform duration-500 group-hover:translate-y-[-2px]"
                          style={{
                          background:
                            'linear-gradient(180deg, rgba(30,27,50,0.0008) 0%, rgba(41,35,67,0.003) 100%)',
                          borderColor: 'rgba(255,255,255,0.035)',
                          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.006)',
                          }}
                        >
                        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                          <div className="flex min-w-0 flex-1 items-start gap-5">
                            <div className="relative shrink-0">
                              {mainWorld.iconUrl ? (
                                <img
                                  src={mainWorld.iconUrl}
                                  alt={mainWorld.name}
                                  className="h-24 w-24 rounded-[24px] object-cover shadow-[0_12px_24px_rgba(0,0,0,0.24)] ring-1 ring-white/12"
                                />
                              ) : (
                                <div
                                  className="flex h-24 w-24 items-center justify-center rounded-[24px] text-4xl font-bold text-white shadow-[0_12px_24px_rgba(0,0,0,0.24)]"
                                  style={{ background: 'linear-gradient(135deg, #7C6BFF 0%, #A855F7 50%, #F0ABFC 100%)' }}
                                >
                                  {mainWorld.name.charAt(0).toUpperCase()}
                                </div>
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-3">
                                <h3 className="truncate text-[42px] font-semibold leading-none tracking-[-0.03em] text-white">
                                  {mainWorld.name}
                                </h3>
                                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-white/72">
                                  <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <path d="M16 16c-1.5-1.5-3-2-4-2s-2.5.5-4 2" />
                                    <path d="M8 10a4 4 0 1 1 8 0" />
                                    <path d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0Z" />
                                  </svg>
                                  {mainWorld.agentCount}
                                </span>
                              </div>

                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <span
                                  className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-emerald-200"
                                  style={{ background: 'rgba(52,211,153,0.14)' }}
                                >
                                  {mainWorld.status}
                                </span>
                                <span
                                  className="rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-cyan-100"
                                  style={{ background: 'rgba(125,211,252,0.12)' }}
                                >
                                  {mainWorld.nativeCreationState}
                                </span>
                              </div>

                              {(mainWorld.genre || mainWorld.era || mainWorld.themes.length > 0) && (
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  {mainWorld.genre && (
                                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/82">
                                      {mainWorld.genre}
                                    </span>
                                  )}
                                  {mainWorld.era && (
                                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/82">
                                      {mainWorld.era}
                                    </span>
                                  )}
                                  {mainWorld.themes.slice(0, 5).map((theme, idx) => (
                                    <span key={idx} className="rounded-full bg-white/8 px-3 py-1 text-xs font-medium text-white/76">
                                      {theme}
                                    </span>
                                  ))}
                                  {mainWorld.themes.length > 5 && (
                                    <span className="rounded-full bg-white/6 px-3 py-1 text-xs font-medium text-white/64">
                                      +{mainWorld.themes.length - 5}
                                    </span>
                                  )}
                                </div>
                              )}

                              {mainWorld.description ? (
                                <p className="mt-4 text-base leading-7 text-white/72">{mainWorld.description}</p>
                              ) : null}

                            </div>
                          </div>

                          <div className="shrink-0 lg:pt-1">
                            <WorldChronoPanel world={mainWorld} />
                          </div>
                        </div>

                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* Sub Worlds Grid */}
          <div className="pt-8">
            <h2 className={`${APP_DISPLAY_SECTION_TITLE_CLASS} mb-6`} style={{ fontFamily: 'var(--font-display)', color: searchText ? '#1A1A1A' : '#F8FAFF' }}>
              {searchText ? t('World.searchResults') : t('World.subWorlds')}
            </h2>
            {subWorlds.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16" style={{ color: '#888888' }}>
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                  className="mb-4 opacity-30"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                <p className="text-sm">
                  {searchText ? t('World.noSearchResults') : t('World.noWorlds')}
                </p>
              </div>
            ) : (
              <div className="grid gap-x-7 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
                {subWorlds.map((world) => {
                  return (
                    <div
                      key={world.id}
                      onClick={() => openWorldDetail(world.id)}
                      className="group cursor-pointer overflow-hidden rounded-[24px] border border-white/10 p-5 transition-all duration-300 hover:-translate-y-1"
                      style={{ 
                        background: searchText ? '#FFFFFF' : 'linear-gradient(180deg, rgba(255,255,255,0.92), rgba(245,247,252,0.90))',
                        boxShadow: searchText ? '0 8px 24px rgba(0, 0, 0, 0.04)' : '0 14px 36px rgba(12,14,26,0.14)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.boxShadow = searchText
                          ? '0 12px 32px rgba(0, 0, 0, 0.08)'
                          : '0 20px 44px rgba(12,14,26,0.2)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.boxShadow = searchText
                          ? '0 8px 24px rgba(0, 0, 0, 0.04)'
                          : '0 14px 36px rgba(12,14,26,0.14)';
                      }}
                    >
                      {world.bannerUrl && (
                        <div className="relative -mx-5 -mt-5 mb-4 h-24 overflow-hidden rounded-t-[24px]">
                          <img
                            src={world.bannerUrl}
                            alt={world.name}
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                            <div className="absolute right-3 top-0 z-10">
                              <WorldChronoPanel world={world} compact />
                            </div>
                        </div>
                      )}

                      <div className="flex items-start gap-3">
                        <div className="relative shrink-0">
                          {world.iconUrl ? (
                            <img
                              src={world.iconUrl}
                              alt={world.name}
                              className="h-14 w-14 rounded-xl object-cover shadow-sm"
                            />
                          ) : (
                            <div className="flex h-14 w-14 items-center justify-center rounded-xl text-xl font-bold text-white shadow-sm"
                              style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)' }}>
                              {world.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h3 className="font-semibold truncate" style={{ color: '#1A1A1A', fontWeight: 600 }}>{world.name}</h3>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <span
                              className={`inline-block px-2.5 py-0.5 text-[10px] font-medium ${getTagStyle('status', world.status).bg} ${getTagStyle('status', world.status).text}`}
                              style={{ borderRadius: '9999px' }}
                            >
                              {world.status}
                            </span>
                            <span
                              className={`inline-block px-2.5 py-0.5 text-[10px] font-medium ${getTagStyle('creation', world.nativeCreationState).bg} ${getTagStyle('creation', world.nativeCreationState).text}`}
                              style={{ borderRadius: '9999px' }}
                            >
                              {world.nativeCreationState}
                            </span>
                          </div>
                          {(world.genre || world.era || world.themes.length > 0) && (
                            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                              {world.genre && (
                                <span 
                                  className={`inline-block px-2.5 py-0.5 text-[10px] font-medium ${getTagStyle('genre').bg} ${getTagStyle('genre').text}`}
                                  style={{ borderRadius: '9999px' }}
                                >
                                  {world.genre}
                                </span>
                              )}
                              {world.era && (
                                <span 
                                  className={`inline-block px-2.5 py-0.5 text-[10px] font-medium ${getTagStyle('era').bg} ${getTagStyle('era').text}`}
                                  style={{ borderRadius: '9999px' }}
                                >
                                  {world.era}
                                </span>
                              )}
                              {world.themes.slice(0, 2).map((theme, idx) => (
                                <span
                                  key={idx}
                                  className={`inline-block px-2.5 py-0.5 text-[10px] font-medium ${getTagStyle('theme').bg} ${getTagStyle('theme').text}`}
                                  style={{ borderRadius: '9999px' }}
                                >
                                  {theme}
                                </span>
                              ))}
                              {world.themes.length > 2 && (
                                <span 
                                  className="inline-block px-2.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500"
                                  style={{ borderRadius: '9999px' }}
                                >
                                  +{world.themes.length - 2}
                                </span>
                              )}
                            </div>
                          )}

                          {world.description && (
                            <p 
                              className="mt-2.5 text-xs line-clamp-2"
                              style={{ color: '#666666', lineHeight: 1.5 }}
                            >
                              {world.description}
                            </p>
                          )}

                          {world.freezeReason && (
                            <div className="mt-1 text-[10px]" style={{ color: '#e11d48' }}>
                              {t('WorldDetail.freezeReason', { reason: world.freezeReason })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </ScrollShell>
    </div>
  );
}
