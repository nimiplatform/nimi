import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { getSemanticAgentPalette } from '@renderer/components/agent-theme.js';
import {
  displayValue,
  formatSemanticValue,
  formatStatus,
  HeroTag,
  joinParts,
  MetricPill,
  SectionShell,
  usePrefersReducedMotion,
  type XianxiaWorldData,
} from './world-detail-primitives.js';
import type {
  WorldPublicAssetsData,
  WorldRecommendedAgent,
  WorldSemanticData,
} from './world-detail-types.js';

export { WorldCoreRulesSection } from './world-detail-core-rules-section.js';
export { WorldDashboardSection } from './world-detail-dashboard-section.js';

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
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-[#4ECCA3]/20 bg-black/45 text-[#4ECCA3] transition-all hover:border-[#4ECCA3]/40 hover:bg-black/65"
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
                      className="rounded-full border border-[#4ECCA3]/16 bg-black/38 px-3 py-1.5 text-xs text-[#dffdf2] transition-colors hover:bg-[#4ECCA3]/16"
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
                  className="rounded-full border border-[#4ECCA3]/20 bg-black/40 px-4 py-2 text-xs font-medium text-[#dffdf2] transition-colors hover:bg-black/60"
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
              <h1
                className="mb-2 text-[40px] leading-tight tracking-wide text-white"
                style={{ fontFamily: 'var(--nimi-font-display)', fontWeight: 700 }}
              >
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
