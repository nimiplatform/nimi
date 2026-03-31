import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { getSemanticAgentPalette } from '@renderer/components/agent-theme.js';
import {
  DataFactCard,
  displayValue,
  formatSemanticValue,
  formatStatus,
  HeroTag,
  joinParts,
  MetricPill,
  resolveChronologyValue,
  SectionShell,
  usePrefersReducedMotion,
  type XianxiaWorldData,
} from './world-detail-primitives.js';
import type {
  WorldPublicAssetsData,
  WorldRecommendedAgent,
  WorldSemanticData,
} from './world-detail-types.js';
import { TimeFlowDynamics } from './time-flow-dynamics';
import { WorldScoringMatrix } from './world-scoring-matrix';

export { WorldCoreRulesSection } from './world-detail-core-rules-section.js';

export function WorldHeroSection({
  world,
  onBack,
  onEnterEdit,
  onCreateSubWorld,
  quickNavItems = [],
  onQuickNavSelect,
}: {
  world: XianxiaWorldData;
  onBack?: () => void;
  onEnterEdit?: () => void;
  onCreateSubWorld?: () => void;
  quickNavItems?: Array<{ id: string; label: string }>;
  onQuickNavSelect?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const prefersReducedMotion = usePrefersReducedMotion();
  const tags = [world.genre, world.era, ...(world.themes ?? [])].filter((value): value is string => Boolean(value));
  const heroTimeLine = world.currentTimeLabel || joinParts([world.eraLabel, world.currentWorldTime]);

  return (
    <section
      data-testid="world-detail-hero"
      className="relative overflow-hidden rounded-[28px] border border-[#4ECCA3]/20"
    >
      <div className="relative h-[360px]">
        <div
          className="absolute inset-0"
          style={{
            background: world.bannerUrl
              ? `url(${world.bannerUrl}) center/cover no-repeat`
              : 'linear-gradient(135deg, #102219 0%, #0a1712 52%, #050907 100%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(circle at 24% 22%, rgba(78, 204, 163, 0.18), transparent 34%),
              radial-gradient(circle at 78% 18%, rgba(78, 204, 163, 0.08), transparent 25%),
              linear-gradient(180deg, rgba(7, 12, 10, 0.28) 0%, rgba(7, 12, 10, 0.45) 48%, rgba(7, 12, 10, 0.94) 100%)
            `,
          }}
        />
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `
              linear-gradient(90deg, rgba(78, 204, 163, 0.3) 1px, transparent 1px),
              linear-gradient(0deg, rgba(78, 204, 163, 0.3) 1px, transparent 1px)
            `,
            backgroundSize: '92px 92px',
          }}
        />

        {(onBack || quickNavItems.length || onCreateSubWorld || onEnterEdit) ? (
          <div className="absolute inset-x-0 top-4 z-20 flex items-start justify-between gap-4 px-4">
            <div className="flex max-w-[calc(100%-16rem)] flex-wrap items-center gap-2">
              {onBack ? (
                <button
                  onClick={onBack}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-[#4ECCA3]/20 bg-black/45 text-[#4ECCA3] backdrop-blur-md transition-all hover:border-[#4ECCA3]/40 hover:bg-black/65"
                  aria-label={t('WorldDetail.xianxia.v2.hero.back')}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 12H5M12 19l-7-7 7-7" />
                  </svg>
                </button>
              ) : null}
              {quickNavItems.length ? (
                <div className="flex flex-wrap gap-2" data-testid="world-detail-quick-nav">
                  {quickNavItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onQuickNavSelect?.(item.id)}
                      className="rounded-full border border-[#4ECCA3]/16 bg-black/38 px-3 py-1.5 text-xs text-[#dffdf2] backdrop-blur-md transition-colors hover:bg-[#4ECCA3]/16"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {onCreateSubWorld ? (
                <button
                  onClick={onCreateSubWorld}
                  className="rounded-full border border-[#4ECCA3]/20 bg-black/40 px-4 py-2 text-xs font-medium text-[#dffdf2] backdrop-blur-sm transition-colors hover:bg-black/60"
                >
                  {t('WorldDetail.createSubWorld')}
                </button>
              ) : null}
              {onEnterEdit ? (
                <button
                  onClick={onEnterEdit}
                  className="rounded-full border border-[#4ECCA3]/28 bg-[#4ECCA3]/18 px-4 py-2 text-xs font-semibold text-[#dffdf2] transition-colors hover:bg-[#4ECCA3]/24"
                >
                  {t('WorldDetail.enterEdit')}
                </button>
              ) : null}
              <span className="inline-flex items-center rounded-full border border-[#4ECCA3]/35 bg-[#4ECCA3]/14 px-4 py-2 text-[11px] font-semibold tracking-[0.16em] text-[#86f0ca]">
                {world.type === 'OASIS' ? t('WorldDetail.xianxia.v2.hero.oasisWorld') : t('WorldDetail.xianxia.v2.hero.creatorWorld')}
              </span>
            </div>
          </div>
        ) : null}

        <div className="absolute inset-x-0 bottom-0 p-7">
          <div className="flex min-w-0 items-end gap-6">
            <div className="relative flex-shrink-0" style={{ animation: prefersReducedMotion ? undefined : 'float-card 6s ease-in-out infinite' }}>
              <div
                className="absolute inset-0 rounded-[24px]"
                style={{
                  boxShadow: '0 0 24px rgba(78, 204, 163, 0.28), 0 0 64px rgba(78, 204, 163, 0.12)',
                  animation: prefersReducedMotion ? undefined : 'pulse-glow 4.5s ease-in-out infinite',
                }}
              />
              {world.iconUrl ? (
                <img
                  src={world.iconUrl}
                  alt={world.name}
                  className="relative z-10 h-24 w-24 rounded-[24px] border-2 border-[#4ECCA3]/30 object-cover shadow-2xl"
                />
              ) : (
                <div className="relative z-10 flex h-24 w-24 items-center justify-center rounded-[24px] border-2 border-[#4ECCA3]/30 bg-[#122219] text-3xl font-serif text-[#4ECCA3]">
                  {world.name.charAt(0)}
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              {world.tagline ? (
                <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[#86f0ca]">
                  {world.tagline}
                </p>
              ) : null}
              <h1 className="mb-2 text-[40px] font-serif leading-tight tracking-wide text-white" style={{ fontFamily: '"Noto Serif SC", serif' }}>
                {displayValue(world.name)}
              </h1>
              {world.motto ? <p className="mb-3 text-sm italic text-white/78">{world.motto}</p> : null}
              <p className="max-w-3xl text-base leading-relaxed text-white/72">
                {displayValue(world.overview || world.description)}
              </p>

              {tags.length ? (
                <div className="mt-5 flex flex-wrap gap-2">
                  {tags.map((tag) => <HeroTag key={tag} label={tag} />)}
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap gap-2.5">
                <MetricPill label={t('WorldDetail.xianxia.v2.hero.status')} value={formatStatus(world.status, t)} />
                <MetricPill label={t('WorldDetail.xianxia.v2.hero.level')} value={`Lv.${world.level}`} />
                <MetricPill label={t('WorldDetail.xianxia.v2.hero.agentCount')} value={`${world.agentCount}`} />
                {heroTimeLine ? (
                  <MetricPill
                    label={t('WorldDetail.xianxia.v2.hero.worldTime')}
                    value={heroTimeLine}
                    className="min-w-0"
                    valueClassName="truncate"
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function resolveOasisRuntimeDays(createdAt: string): number | null {
  const createdTime = new Date(createdAt).getTime();
  if (!Number.isFinite(createdTime)) {
    return null;
  }
  const diffMs = Date.now() - createdTime;
  return Math.max(1, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

function resolveOasisGovernanceMode(world: XianxiaWorldData, t: (key: string) => string): string {
  if (world.status === 'ACTIVE' && world.nativeCreationState === 'OPEN') {
    return t('WorldDetail.xianxia.v2.oasisIdentity.governanceManaged');
  }
  if (world.status === 'ACTIVE') {
    return t('WorldDetail.xianxia.v2.oasisIdentity.governanceRestricted');
  }
  return t('WorldDetail.xianxia.v2.oasisIdentity.governanceLimited');
}

export function OasisIdentityCard({
  world,
  semantic,
  publicAssets,
  worldTotalCount,
}: {
  world: XianxiaWorldData;
  semantic: WorldSemanticData;
  publicAssets: WorldPublicAssetsData;
  worldTotalCount?: number | null;
}) {
  const { t } = useTranslation();
  const runtimeDays = resolveOasisRuntimeDays(world.createdAt);
  const metrics = [
    worldTotalCount != null
      ? {
          label: t('WorldDetail.xianxia.v2.oasisIdentity.totalWorlds'),
          value: String(worldTotalCount),
        }
      : null,
    {
      label: t('WorldDetail.xianxia.v2.oasisIdentity.activeAgents'),
      value: String(world.agentCount),
    },
    {
      label: t('WorldDetail.xianxia.v2.oasisIdentity.onlineScenes'),
      value: String(publicAssets.scenes.length),
    },
    runtimeDays != null
      ? {
          label: t('WorldDetail.xianxia.v2.oasisIdentity.runtimeDays'),
          value: t('WorldDetail.xianxia.v2.oasisIdentity.runtimeDaysValue', { count: runtimeDays }),
        }
      : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item));

  const bottomFacts = [
    world.eraLabel
      ? {
          label: t('WorldDetail.xianxia.v2.oasisIdentity.era'),
          value: world.eraLabel,
        }
      : null,
    world.primaryLanguage
      ? {
          label: t('WorldDetail.xianxia.v2.oasisIdentity.language'),
          value: world.primaryLanguage,
        }
      : null,
    {
      label: t('WorldDetail.xianxia.v2.oasisIdentity.governance'),
      value: resolveOasisGovernanceMode(world, t),
    },
  ].filter((item): item is { label: string; value: string } => Boolean(item));

  return (
    <section
      data-testid="world-detail-oasis-identity-card"
      className="relative overflow-hidden rounded-[24px] border border-[#4ECCA3]/18 bg-[#111a14]/86 shadow-[0_0_0_1px_rgba(78,204,163,0.08),0_0_48px_rgba(78,204,163,0.06)]"
    >
      <div className="absolute inset-[8px] rounded-[18px] border border-[#4ECCA3]/10" />
      <div
        className="absolute inset-0 opacity-55"
        style={{
          background:
            'radial-gradient(circle at 15% 20%, rgba(78,204,163,0.12), transparent 34%), radial-gradient(circle at 82% 18%, rgba(78,204,163,0.08), transparent 26%)',
        }}
      />
      <div className="relative px-6 pb-6 pt-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#86f0ca]">
          {t('WorldDetail.xianxia.v2.oasisIdentity.systemPrimeWorld')}
        </div>
        <div className="mt-3 max-w-4xl text-lg font-semibold leading-relaxed text-[#effff8]">
          {world.overview || semantic.operationDescription || world.description}
        </div>

        {metrics.length ? (
          <div className="mt-5 flex flex-wrap gap-2.5">
            {metrics.map((item) => (
              <MetricPill key={item.label} label={item.label} value={item.value} />
            ))}
          </div>
        ) : null}

        {semantic.operationRules.length ? (
          <div className="mt-6">
            <div className="text-xs font-semibold tracking-[0.14em] text-[#86f0ca]">
              {t('WorldDetail.xianxia.v2.oasisIdentity.capabilities')}
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {semantic.operationRules.slice(0, 5).map((rule) => (
                <div key={rule.key} className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/55 p-4">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">{rule.title}</div>
                  <div className="mt-2 text-sm leading-relaxed text-[#d8efe4]/72">
                    {formatSemanticValue(rule.value, t)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {bottomFacts.length ? (
          <div className="mt-5 flex flex-wrap gap-2.5 border-t border-[#4ECCA3]/10 pt-4">
            {bottomFacts.map((fact) => (
              <MetricPill key={fact.label} label={fact.label} value={fact.value} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function resolveProjectedWorldDate(
  world: Pick<XianxiaWorldData, 'currentWorldTime' | 'flowRatio' | 'isPaused'>,
  anchorNowMs: number,
  nowMs: number,
): Date | null {
  if (!world.currentWorldTime) {
    return null;
  }
  const anchor = new Date(world.currentWorldTime);
  if (Number.isNaN(anchor.getTime())) {
    return null;
  }
  if (world.isPaused) {
    return anchor;
  }
  const elapsedClientMs = Math.max(0, nowMs - anchorNowMs);
  return new Date(anchor.getTime() + elapsedClientMs * Math.max(0.0001, world.flowRatio || 1));
}

function RecommendedAgentCard({
  agent,
  onSelectAgent,
  featured = false,
}: {
  agent: WorldRecommendedAgent;
  onSelectAgent?: (agentId: string) => void;
  featured?: boolean;
}) {
  const palette = getSemanticAgentPalette({
    description: joinParts([agent.display?.role, agent.display?.faction, agent.display?.rank]),
    worldName: agent.name,
  });
  const { t } = useTranslation();
  const identityLine = joinParts([agent.display?.role, agent.display?.faction, agent.display?.rank]);
  const locationLine = joinParts([agent.display?.sceneName, agent.display?.location]);
  const entryReason = locationLine
    ? t('WorldDetail.xianxia.v2.sidebar.entryReasonScene', { value: locationLine })
    : identityLine
      ? t('WorldDetail.xianxia.v2.sidebar.entryReasonIdentity', { value: identityLine })
      : t('WorldDetail.xianxia.v2.sidebar.entryReasonDefault');
  const entryBadge = featured
    ? t('WorldDetail.xianxia.v2.sidebar.entryPrimary')
    : t('WorldDetail.xianxia.v2.sidebar.entrySecondary');

  return (
    <button
      type="button"
      onClick={() => onSelectAgent?.(agent.id)}
      className={`w-full rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 text-left transition-all hover:border-[#4ECCA3]/22 hover:bg-[#0d1511]/70 ${featured ? 'p-5' : 'p-4'}`}
    >
      <div className="flex items-start gap-3">
        <EntityAvatar
          imageUrl={agent.avatarUrl}
          name={agent.name}
          kind="agent"
          sizeClassName={featured ? 'h-16 w-16' : 'h-14 w-14'}
          radiusClassName="rounded-[12px]"
          innerRadiusClassName="rounded-[10px]"
          textClassName={featured ? 'text-xl font-serif' : 'text-lg font-serif'}
        />
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span
              className="rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]"
              style={{
                borderColor: `${palette.accent}44`,
                background: `${palette.accent}18`,
                color: palette.accent,
              }}
            >
              {entryBadge}
            </span>
            <span className="text-[11px] text-white/42">{t('WorldDetail.xianxia.v2.sidebar.inspectProfile')}</span>
          </div>
          <div className={featured ? 'text-lg font-semibold text-[#effff8]' : 'text-base font-semibold text-[#effff8]'}>{agent.name}</div>
          {identityLine ? <div className={`mt-1 ${featured ? 'text-[15px]' : 'text-sm'} text-[#d8efe4]/66`}>{identityLine}</div> : null}
          {locationLine ? <div className="mt-1 text-xs" style={{ color: palette.accent }}>{locationLine}</div> : null}
          <div className={`mt-3 rounded-xl border border-white/6 bg-white/[0.03] px-3 py-2 ${featured ? 'text-sm' : 'text-xs'} text-white/62`}>
            {entryReason}
          </div>
        </div>
      </div>
    </button>
  );
}

function WorldChronologyCard({ world }: { world: XianxiaWorldData }) {
  const { t } = useTranslation();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const anchorNowMsRef = useRef(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 80);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const chronology = resolveChronologyValue(world);
  if (!chronology) {
    return null;
  }

  const projectedDate = resolveProjectedWorldDate(world, anchorNowMsRef.current, nowMs);
  if (!projectedDate) {
    return (
      <SectionShell
        title={t('WorldDetail.xianxia.v2.sidebar.chronology')}
        subtitle={t('WorldDetail.xianxia.v2.sidebar.chronologySubtitle')}
        className="h-full"
        dataTestId="world-detail-chronology-card"
      >
        <DataFactCard label={t('WorldDetail.xianxia.v2.sidebar.currentWorldTime')} value={chronology} />
      </SectionShell>
    );
  }

  const hour = projectedDate.getUTCHours();
  const minute = projectedDate.getUTCMinutes();
  const second = projectedDate.getUTCSeconds();
  const millisecond = projectedDate.getUTCMilliseconds();
  const flowRatio = Math.max(0.0001, world.flowRatio || 1);
  const flowPulse = (millisecond / 999) * 28;
  const flowWidth = Math.min(100, Math.max(24, (Math.log10(flowRatio + 1) / Math.log10(1000 + 1)) * 52 + flowPulse));

  return (
    <SectionShell
      title={t('WorldDetail.xianxia.v2.sidebar.chronology')}
      subtitle={t('WorldDetail.xianxia.v2.sidebar.chronologySubtitle')}
      className="h-full"
      dataTestId="world-detail-chronology-card"
    >
      <div
        className="relative overflow-hidden rounded-[22px] border border-white/12 bg-[linear-gradient(135deg,rgba(15,24,19,0.96),rgba(22,31,43,0.82))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-80"
          style={{
            background: 'radial-gradient(circle at top right, rgba(255,122,245,0.18), transparent 28%), radial-gradient(circle at left center, rgba(86,211,178,0.14), transparent 26%)',
          }}
        />
        <div className="relative">
          <div className="flex items-start justify-between gap-3">
            <span className="text-[10px] uppercase tracking-[0.22em] text-[#56D3B2]/78">
              {t('World.syncTicker')}
            </span>
            <span
              className="max-w-[72%] text-right text-[13px] font-semibold leading-relaxed text-white/92"
              style={{ textShadow: '1px 0 rgba(255,0,255,0.4), -0.75px 0 rgba(86,211,178,0.45)' }}
            >
              {chronology}
            </span>
          </div>

          <div className="mt-6 flex items-end text-white">
            <div className="font-mono text-[42px] font-black leading-none tracking-[-0.05em] text-white">
              {String(hour).padStart(2, '0')}:{String(minute).padStart(2, '0')}
            </div>
            <div className="ml-3 flex flex-col pb-1">
              <span className="text-xl leading-none text-[#56D3B2]">
                :{String(second).padStart(2, '0')}
              </span>
              <span className="mt-1 font-mono text-[11px] leading-none text-fuchsia-300/78">
                {String(millisecond).padStart(3, '0')}
              </span>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            {world.eraLabel ? (
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/72 backdrop-blur-sm">
                {world.eraLabel}
              </span>
            ) : null}
            <span className="rounded-full border border-[#4ECCA3]/12 bg-[#4ECCA3]/10 px-3 py-1 text-[11px] text-[#a6f7de]">
              {t('World.chronoFlow', { value: flowRatio.toFixed(1) })}
            </span>
          </div>

          <div className="mt-4 overflow-hidden rounded-full bg-white/8">
            <div
              className="h-[3px] rounded-full bg-[linear-gradient(90deg,#56D3B2_0%,#b6fff1_38%,#f197ff_100%)] shadow-[0_0_14px_rgba(86,211,178,0.55)]"
              style={{ width: `${flowWidth}%` }}
            />
          </div>
        </div>
      </div>
    </SectionShell>
  );
}

function WorldRecommendedAgentsCard({
  agents,
  onSelectAgent,
}: {
  agents: WorldRecommendedAgent[];
  onSelectAgent?: (agentId: string) => void;
}) {
  const { t } = useTranslation();
  if (!agents.length) {
    return null;
  }
  const recommendedAgents = agents.slice(0, 4);

  return (
    <SectionShell
      title={t('WorldDetail.xianxia.v2.sidebar.recommendedAgents')}
      subtitle={t('WorldDetail.xianxia.v2.sidebar.recommendedAgentsSubtitle')}
      className="h-full"
      dataTestId="world-detail-recommended-agents-card"
    >
      <div className="grid gap-3">
        <div className="rounded-2xl border border-[#4ECCA3]/10 bg-[linear-gradient(180deg,rgba(78,204,163,0.08),rgba(10,15,12,0.24))] px-4 py-3 text-sm leading-relaxed text-[#d8efe4]/68">
          {t('WorldDetail.xianxia.v2.sidebar.recommendedAgentsHint')}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {recommendedAgents.map((agent, index) => (
            <RecommendedAgentCard
              key={agent.id}
              agent={agent}
              onSelectAgent={onSelectAgent}
              featured={index === 0}
            />
          ))}
        </div>
      </div>
    </SectionShell>
  );
}

// React error boundary for WebGL canvas components. Catches context-loss crashes
// (getContextAttributes() → null) that originate from EffectComposer.addPass() inside
// @react-three/postprocessing's useLayoutEffect. In React 18, useLayoutEffect errors
// are re-thrown and caught by the nearest error boundary, so this prevents a
// full-renderer crash when a WebGL context is lost.
type CanvasCrashBoundaryProps = { children: ReactNode; fallback: ReactNode };
type CanvasCrashBoundaryState = { crashed: boolean };

class CanvasCrashBoundary extends Component<CanvasCrashBoundaryProps, CanvasCrashBoundaryState> {
  constructor(props: CanvasCrashBoundaryProps) {
    super(props);
    this.state = { crashed: false };
  }

  static getDerivedStateFromError(): CanvasCrashBoundaryState {
    return { crashed: true };
  }

  override render() {
    return this.state.crashed ? this.props.fallback : this.props.children;
  }
}

export function WorldDashboardSection({
  world,
}: {
  world: XianxiaWorldData;
}) {
  const { t } = useTranslation();
  const hasChronology = Boolean(resolveChronologyValue(world));

  return (
    <section
      data-testid="world-detail-dashboard"
      className="relative overflow-hidden rounded-[24px] border border-[#4ECCA3]/16 bg-[#101813]/82 backdrop-blur-sm"
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/45 to-transparent" />
      <div className="absolute inset-y-0 right-0 w-[30%] bg-[radial-gradient(circle_at_center,rgba(78,204,163,0.12),transparent_68%)] opacity-70" />
      <div className="relative grid gap-5 p-5">
        <div className="grid gap-5 xl:grid-cols-12">
          <div className="col-span-12 xl:col-span-8">
            <section
              data-testid="world-detail-score-matrix-card"
              className="h-full overflow-hidden rounded-[22px] border border-[#4ECCA3]/15 bg-[#0f1612]/82 backdrop-blur-sm"
            >
              <CanvasCrashBoundary
                fallback={
                  <div className="flex min-h-[620px] flex-col gap-4 p-6">
                    <div className="text-xs font-semibold uppercase tracking-widest text-[#4ECCA3]">
                      {t('WorldDetail.section.scores', { defaultValue: 'World Scoring Matrix' })}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {([
                        { label: t('WorldDetail.activity', { defaultValue: 'Activity' }), value: world.scoreA },
                        { label: t('WorldDetail.consensus', { defaultValue: 'Consensus' }), value: world.scoreC },
                        { label: t('WorldDetail.quality', { defaultValue: 'Quality' }), value: world.scoreQ },
                        { label: t('WorldDetail.engagement', { defaultValue: 'Engagement' }), value: world.scoreE },
                      ] as Array<{ label: string; value: number }>).map(({ label, value }) => (
                        <div key={label} className="rounded-xl border border-[#4ECCA3]/18 bg-[#0a1210]/60 p-4 text-center">
                          <div className="text-2xl font-bold text-[#4ECCA3]">{(value ?? 0).toFixed(0)}</div>
                          <div className="mt-1 text-[10px] uppercase tracking-widest text-[#86f0ca]/60">{label}</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-auto rounded-xl border border-[#4ECCA3]/10 bg-[#0a1210]/40 p-4">
                      <div className="text-[10px] uppercase tracking-widest text-[#4ECCA3]/70">
                        {t('WorldDetail.comprehensiveIndex', { defaultValue: 'Comprehensive Index' })}
                      </div>
                      <div className="mt-1 text-2xl font-bold text-[#4ECCA3]">
                        {(world.scoreEwma ?? 0).toFixed(2)}
                      </div>
                    </div>
                  </div>
                }
              >
                <WorldScoringMatrix
                  data={{
                    scoreA: world.scoreA,
                    scoreC: world.scoreC,
                    scoreQ: world.scoreQ,
                    scoreE: world.scoreE,
                    scoreEwma: world.scoreEwma,
                  }}
                  className="min-h-[620px]"
                />
              </CanvasCrashBoundary>
            </section>
          </div>

          <div className="col-span-12 xl:col-span-4">
            <div className={`grid gap-5 ${hasChronology ? 'xl:grid-rows-[300px_300px]' : ''}`}>
              <SectionShell
                title={t('WorldDetail.xianxia.v2.visuals.timeFlowTitle')}
                subtitle={t('WorldDetail.xianxia.v2.visuals.timeFlowSubtitle')}
                className="h-full min-h-[300px]"
                dataTestId="world-detail-time-flow-card"
              >
                <div className="flex h-full min-h-[220px] items-center justify-center">
                  <CanvasCrashBoundary
                    fallback={
                      <div className="flex h-[200px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-[#4ECCA3]/15 bg-[#0f1612]/40">
                        <span className="font-mono text-4xl font-black text-[#4ECCA3]">
                          {(world.flowRatio || 1).toFixed(1)}x
                        </span>
                        <span className="text-xs uppercase tracking-widest text-[#86f0ca]/50">
                          {t('WorldDetail.xianxia.v2.visuals.timeFlowTitle')}
                        </span>
                      </div>
                    }
                  >
                    <TimeFlowDynamics ratio={world.flowRatio || 1} className="h-[200px] w-full" />
                  </CanvasCrashBoundary>
                </div>
              </SectionShell>
              {hasChronology ? <WorldChronologyCard world={world} /> : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function WorldRecommendedEntrySection({
  world,
  onSelectAgent,
}: {
  world: XianxiaWorldData;
  onSelectAgent?: (agentId: string) => void;
}) {
  const recommendedAgents = world.recommendedAgents?.slice(0, 4) ?? [];
  if (!recommendedAgents.length) {
    return null;
  }

  return <WorldRecommendedAgentsCard agents={recommendedAgents} onSelectAgent={onSelectAgent} />;
}
