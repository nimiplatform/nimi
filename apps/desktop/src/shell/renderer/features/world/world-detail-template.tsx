import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import { CreateAgentDrawer, type CreateAgentInput } from './create-agent-drawer';
import {
  OASIS_WORLD_DETAIL_COMPOSITION,
  NARRATIVE_WORLD_DETAIL_COMPOSITION,
  type WorldDetailComposition,
  type WorldDetailSectionKey,
} from './world-detail-layout.js';
import { WorldExtendedSection, WorldTimelineSection, WorldScenesSection, WorldAgentsSection } from './world-detail-content-sections.js';
import { joinParts, statusGlowStyles, usePrefersReducedMotion } from './world-detail-primitives.js';
import {
  OasisIdentityCard,
  WorldCoreRulesSection,
  WorldDashboardSection,
  WorldHeroSection,
  WorldRecommendedEntrySection,
} from './world-detail-overview-sections.js';
import type {
  WorldAgent,
  WorldAuditItem,
  WorldDetailData,
  WorldHistoryBundle,
  WorldPublicAssetsData,
  WorldSemanticData,
} from './world-detail-types.js';

export type WorldDetailPageProps = {
  world: WorldDetailData;
  agents: WorldAgent[];
  history: WorldHistoryBundle;
  semantic: WorldSemanticData;
  audits: WorldAuditItem[];
  publicAssets: WorldPublicAssetsData;
  loading?: boolean;
  error?: boolean;
  agentsLoading?: boolean;
  historyLoading?: boolean;
  semanticLoading?: boolean;
  auditsLoading?: boolean;
  publicAssetsLoading?: boolean;
  onBack?: () => void;
  onEnterEdit?: () => void;
  onCreateSubWorld?: () => void;
  onChatAgent?: (agent: WorldAgent) => void;
  onVoiceAgent?: (agent: WorldAgent) => void;
  onViewAgent?: (agent: WorldAgent) => void;
  onCreateAgent?: (input: CreateAgentInput) => void;
  createAgentMutating?: boolean;
};

export type XianxiaWorldTemplateProps = WorldDetailPageProps;
export type XianxiaWorldData = WorldDetailData;

type WorldDetailPageBodyProps = WorldDetailPageProps & {
  composition: WorldDetailComposition;
};

function WorldDetailLoadingState() {
  return (
    <div className="px-5 py-6">
      <div className="mx-auto max-w-[1400px] space-y-5">
        <div className="h-[360px] animate-pulse rounded-[28px] bg-slate-200/40" />
        <div className="h-[520px] animate-pulse rounded-[24px] bg-slate-200/40" />
        <div className="h-[520px] animate-pulse rounded-[22px] bg-slate-200/40" />
      </div>
    </div>
  );
}

function WorldDetailErrorState({ onBack }: { onBack?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="relative flex flex-1 items-center justify-center px-6 py-12">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="absolute left-6 top-6 flex h-10 w-10 items-center justify-center rounded-full border border-[#4ECCA3]/20 bg-white/70 text-[#1f8f69] backdrop-blur-md transition-all hover:border-[#4ECCA3]/40 hover:bg-white/90"
          aria-label={t('WorldDetail.xianxia.v2.hero.back')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
      ) : null}
      <span className="text-sm text-red-500">{t('WorldDetail.error')}</span>
    </div>
  );
}

function WorldDetailSurface({
  children,
}: {
  children: ReactNode;
  prefersReducedMotion: boolean;
}) {
  return (
    <>
      <style>{statusGlowStyles}</style>
      <div className="relative font-sans" data-testid="world-detail-root">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-5 py-6">
          {children}
        </div>
      </div>
    </>
  );
}

function WorldDetailPageBody({
  composition,
  ...props
}: WorldDetailPageBodyProps) {
  const { t } = useTranslation();
  const world = props.world;
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const isOasisWorld = world.type === 'OASIS';

  const selectedAgent = selectedAgentId
    ? props.agents.find((agent) => agent.id === selectedAgentId) ?? null
    : null;
  const selectedScene = selectedSceneId
    ? props.publicAssets.scenes.find((scene) => scene.id === selectedSceneId) ?? null
    : null;
  const selectedSceneRelatedAgents = selectedScene
    ? props.agents.filter((agent) => (
      selectedScene.activeEntities.includes(agent.name)
      || agent.sceneName === selectedScene.name
      || agent.location?.includes(selectedScene.name)
    )).slice(0, 4)
    : [];
  const selectedSceneRelatedEvents = selectedScene
    ? props.history.items.filter((event) => (
      event.locationRefs.includes(selectedScene.name)
      || event.description.includes(selectedScene.name)
      || (event.summary?.includes(selectedScene.name) ?? false)
    )).slice(0, 4)
    : [];

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const oasisSceneActionKeyById: Record<string, string> = {
    'oasis-scene-plaza': 'oasisPlaza',
    'oasis-scene-transit-hub': 'oasisTransitHub',
    'oasis-scene-creator-forge': 'oasisCreatorForge',
    'oasis-scene-chat-core': 'oasisChatCore',
    'oasis-scene-notice-spire': 'oasisNoticeSpire',
  };
  const oasisSceneActionLabel = selectedScene && isOasisWorld
    ? t(`WorldDetail.xianxia.v2.scenes.oasisActionLabels.${oasisSceneActionKeyById[selectedScene.id] ?? 'default'}`)
    : t('WorldDetail.xianxia.v2.scenes.quickSheetEnter');

  const quickNavItems = useMemo(
    () => composition.sections
      .filter((section) => section.showInQuickNav && section.anchorId && section.quickNavLabelKey)
      .map((section) => ({
        id: section.anchorId!,
        label: t(section.quickNavLabelKey!),
      })),
    [composition.sections, t],
  );

  const sectionContentByKey: Record<WorldDetailSectionKey, ReactNode> = {
    hero: (
      <WorldHeroSection
        world={world}
        onBack={props.onBack}
        onEnterEdit={props.onEnterEdit}
        onCreateSubWorld={props.onCreateSubWorld}
        quickNavItems={quickNavItems}
        onQuickNavSelect={scrollToSection}
      />
    ),
    'oasis-identity': (
      <OasisIdentityCard
        world={world}
        semantic={props.semantic}
        publicAssets={props.publicAssets}
      />
    ),
    dashboard: <WorldDashboardSection world={world} />,
    'core-rules': props.semantic.hasContent ? (
      <WorldCoreRulesSection semantic={props.semantic} world={world} />
    ) : null,
    recommended: (
      <WorldRecommendedEntrySection
        world={world}
        onSelectAgent={setSelectedAgentId}
      />
    ),
    scenes: (
      <WorldScenesSection
        scenes={props.publicAssets.scenes}
        onSelectScene={(sceneId) => setSelectedSceneId(sceneId)}
        title={isOasisWorld ? t('WorldDetail.xianxia.v2.scenes.oasisTitle') : undefined}
        subtitle={isOasisWorld ? t('WorldDetail.xianxia.v2.scenes.oasisSubtitle') : undefined}
      />
    ),
    timeline: (
      <WorldTimelineSection
        history={props.history}
        loading={props.historyLoading}
        onSelectAgentName={(name) => {
          const agent = props.agents.find((item) => item.name === name);
          if (agent) {
            setSelectedAgentId(agent.id);
          }
        }}
        onSelectSceneName={(name) => {
          const scene = props.publicAssets.scenes.find((item) => item.name === name);
          if (scene) {
            setSelectedSceneId(scene.id);
          }
        }}
        compact={isOasisWorld}
        title={isOasisWorld ? t('WorldDetail.xianxia.v2.timeline.oasisTitle') : undefined}
        subtitle={isOasisWorld ? t('WorldDetail.xianxia.v2.timeline.oasisSubtitle') : undefined}
      />
    ),
    agents: (
      <WorldAgentsSection
        agents={props.agents}
        agentsLoading={props.agentsLoading}
        onCreateAgent={props.onCreateAgent ? () => setShowCreateAgent(true) : undefined}
        onSelectAgent={(agent) => setSelectedAgentId(agent.id)}
        onChatAgent={props.onChatAgent}
        onVoiceAgent={props.onVoiceAgent}
      />
    ),
    extended: (
      <WorldExtendedSection
        world={world}
        semantic={props.semantic}
        audits={props.audits}
        publicAssets={props.publicAssets}
        auditsLoading={props.auditsLoading}
      />
    ),
  };

  const renderedSections = composition.sections.map((section) => {
    const content = sectionContentByKey[section.key];
    if (!content) {
      return null;
    }
    return section.anchorId ? (
      <div key={section.key} id={section.anchorId}>
        {content}
      </div>
    ) : (
      <div key={section.key}>
        {content}
      </div>
    );
  });

  return (
    <>
      <WorldDetailSurface prefersReducedMotion={prefersReducedMotion}>
        {renderedSections}
      </WorldDetailSurface>

      {selectedAgent ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 px-5 py-6 backdrop-blur-sm">
          <button
            type="button"
            className="absolute inset-0"
            aria-label={t('WorldDetail.xianxia.v2.agents.quickSheetClose')}
            onClick={() => setSelectedAgentId(null)}
          />
          <div className="relative flex items-center justify-center">
            <section className="relative z-10 w-full max-w-[620px] max-h-[calc(100vh-3rem)] overflow-hidden rounded-[28px] border border-[#4ECCA3]/20 bg-[#0d1511]/96 shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/50 to-transparent" />
              <ScrollArea className="max-h-[calc(100vh-3rem-2px)]" viewportClassName="px-6 pb-6 pt-5">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.16em] text-[#86f0ca]/76">
                    {t('WorldDetail.xianxia.v2.agents.quickSheetTitle')}
                  </div>
                  <h3 className="mt-2 text-2xl font-semibold text-[#effff8]">{selectedAgent.name}</h3>
                  <div className="mt-1 text-sm text-[#86f0ca]">{selectedAgent.handle}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedAgentId(null)}
                  className="rounded-full border border-[#4ECCA3]/18 bg-black/18 px-3 py-1.5 text-xs text-[#d8efe4]/72 transition-colors hover:border-[#4ECCA3]/28 hover:text-[#effff8]"
                >
                  {t('WorldDetail.xianxia.v2.agents.quickSheetClose')}
                </button>
              </div>

              <div className="grid gap-5 md:grid-cols-[120px_minmax(0,1fr)]">
                <div className="flex justify-center md:justify-start">
                  <EntityAvatar
                    imageUrl={selectedAgent.avatarUrl}
                    name={selectedAgent.name}
                    kind="agent"
                    sizeClassName="h-28 w-28"
                    radiusClassName="rounded-[20px]"
                    innerRadiusClassName="rounded-[16px]"
                    textClassName="text-3xl font-serif"
                  />
                </div>

                <div className="grid gap-3">
                  {joinParts([selectedAgent.role, selectedAgent.faction, selectedAgent.rank]) ? (
                    <div className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">
                        {t('WorldDetail.xianxia.v2.agents.quickSheetIdentity')}
                      </div>
                      <div className="mt-2 text-sm leading-relaxed text-[#effff8]">
                        {joinParts([selectedAgent.role, selectedAgent.faction, selectedAgent.rank])}
                      </div>
                    </div>
                  ) : null}

                  {joinParts([selectedAgent.sceneName, selectedAgent.location]) ? (
                    <div className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">
                        {t('WorldDetail.xianxia.v2.agents.quickSheetLocation')}
                      </div>
                      <div className="mt-2 text-sm leading-relaxed text-[#effff8]">
                        {joinParts([selectedAgent.sceneName, selectedAgent.location])}
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">
                      {t('WorldDetail.xianxia.v2.agents.quickSheetBio')}
                    </div>
                    <div className="mt-2 text-sm leading-relaxed text-[#d8efe4]/72">
                      {selectedAgent.bio || t('WorldDetail.noDescription')}
                    </div>
                  </div>

                  {selectedAgent.stats?.vitalityScore != null ? (
                    <div className="rounded-2xl border border-[#4ECCA3]/10 bg-black/16 px-4 py-3 text-sm text-[#d8efe4]/72">
                      {t('WorldDetail.xianxia.v2.agents.vitality')} {selectedAgent.stats.vitalityScore}
                    </div>
                  ) : null}
                </div>
              </div>

              {(props.onChatAgent || props.onVoiceAgent) ? (
                <div className="mt-5 flex flex-wrap gap-2">
                  {props.onChatAgent ? (
                    <button
                      type="button"
                      onClick={() => props.onChatAgent?.(selectedAgent)}
                      className="rounded-full border border-[#4ECCA3]/18 bg-[#4ECCA3]/10 px-4 py-2 text-sm text-[#dffdf2] transition-colors hover:bg-[#4ECCA3]/16"
                    >
                      {t('WorldDetail.xianxia.v2.agents.chat')}
                    </button>
                  ) : null}
                  {props.onVoiceAgent ? (
                    <button
                      type="button"
                      onClick={() => props.onVoiceAgent?.(selectedAgent)}
                      className="rounded-full border border-[#4ECCA3]/18 bg-black/18 px-4 py-2 text-sm text-[#d8efe4]/72 transition-colors hover:border-[#4ECCA3]/28 hover:text-[#effff8]"
                    >
                      {t('WorldDetail.xianxia.v2.agents.voice')}
                    </button>
                  ) : null}
                  {props.onViewAgent ? (
                    <button
                      type="button"
                      onClick={() => props.onViewAgent?.(selectedAgent)}
                      className="rounded-full border border-[#4ECCA3]/18 bg-black/18 px-4 py-2 text-sm text-[#d8efe4]/72 transition-colors hover:border-[#4ECCA3]/28 hover:text-[#effff8]"
                    >
                      {t('WorldDetail.xianxia.v2.agents.quickSheetViewProfile')}
                    </button>
                  ) : null}
                </div>
              ) : null}
              </ScrollArea>
            </section>
          </div>
        </div>
      ) : null}

      {selectedScene ? (
        <div className="fixed inset-0 z-40 bg-black/55 px-5 py-6 backdrop-blur-sm">
          <button
            type="button"
            className="absolute inset-0"
            aria-label={t('WorldDetail.xianxia.v2.scenes.quickSheetClose')}
            onClick={() => setSelectedSceneId(null)}
          />
          <div className="relative flex min-h-full items-start justify-center sm:items-center">
            <section className="relative z-10 w-full max-w-[760px] max-h-[calc(100vh-3rem)] overflow-hidden rounded-[28px] border border-[#4ECCA3]/20 bg-[#0d1511]/96 shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/50 to-transparent" />
              <ScrollArea className="max-h-[calc(100vh-3rem-2px)]" viewportClassName="px-6 pb-6 pt-5">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.16em] text-[#86f0ca]/76">
                    {t('WorldDetail.xianxia.v2.scenes.quickSheetTitle')}
                  </div>
                  <h3 className="mt-2 text-2xl font-semibold text-[#effff8]">{selectedScene.name}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSceneId(null)}
                  className="rounded-full border border-[#4ECCA3]/18 bg-black/18 px-3 py-1.5 text-xs text-[#d8efe4]/72 transition-colors hover:border-[#4ECCA3]/28 hover:text-[#effff8]"
                >
                  {t('WorldDetail.xianxia.v2.scenes.quickSheetClose')}
                </button>
              </div>

              <div className="grid gap-4">
                <div className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">
                    {t('WorldDetail.xianxia.v2.scenes.quickSheetDescription')}
                  </div>
                  <div className="mt-2 text-sm leading-relaxed text-[#d8efe4]/72">
                    {selectedScene.description || t('WorldDetail.xianxia.v2.scenes.noDescription')}
                  </div>
                </div>

                {selectedScene.activeEntities.length ? (
                  <div className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">
                      {t('WorldDetail.xianxia.v2.scenes.quickSheetActiveEntities')}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedScene.activeEntities.map((entity) => (
                        <button
                          key={`${selectedScene.id}-${entity}`}
                          type="button"
                          onClick={() => {
                            const agent = props.agents.find((item) => item.name === entity);
                            if (agent) {
                              setSelectedSceneId(null);
                              setSelectedAgentId(agent.id);
                            }
                          }}
                          className="rounded-full border border-[#4ECCA3]/16 bg-[#4ECCA3]/10 px-3 py-1 text-xs text-[#dffdf2]"
                        >
                          {entity}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {selectedSceneRelatedAgents.length ? (
                  <div className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">
                      {t('WorldDetail.xianxia.v2.scenes.quickSheetViewAgents')}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedSceneRelatedAgents.map((agent) => (
                        <button
                          key={`${selectedScene.id}-related-${agent.id}`}
                          type="button"
                          onClick={() => {
                            setSelectedSceneId(null);
                            setSelectedAgentId(agent.id);
                          }}
                          className="rounded-full border border-[#4ECCA3]/16 bg-black/16 px-3 py-1 text-xs text-[#dffdf2] transition-colors hover:bg-[#4ECCA3]/12"
                        >
                          {agent.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {selectedSceneRelatedEvents.length ? (
                  <div className="rounded-2xl border border-[#4ECCA3]/10 bg-[#0a0f0c]/56 p-4">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-[#86f0ca]/74">
                      {t('WorldDetail.xianxia.v2.scenes.quickSheetRelatedEvents')}
                    </div>
                    <div className="mt-3 grid gap-2">
                      {selectedSceneRelatedEvents.map((event) => (
                        <div key={event.id} className="rounded-xl border border-[#4ECCA3]/10 bg-black/16 p-3">
                          <div className="text-sm font-semibold text-[#effff8]">{event.title}</div>
                          <div className="mt-1 text-sm text-[#d8efe4]/66">{event.summary || event.description}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isOasisWorld}
                  className="rounded-full border border-[#4ECCA3]/18 bg-[#4ECCA3]/10 px-4 py-2 text-sm text-[#dffdf2] opacity-70"
                >
                  {oasisSceneActionLabel}
                </button>
                {isOasisWorld ? (
                  <span className="inline-flex items-center rounded-full border border-[#4ECCA3]/12 bg-black/16 px-3 py-1 text-[11px] text-[#86f0ca]/78">
                    {t('WorldDetail.xianxia.v2.scenes.comingSoon')}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSceneId(null);
                    scrollToSection('world-detail-agents');
                  }}
                  className="rounded-full border border-[#4ECCA3]/18 bg-black/18 px-4 py-2 text-sm text-[#d8efe4]/72 transition-colors hover:border-[#4ECCA3]/28 hover:text-[#effff8]"
                >
                  {t('WorldDetail.xianxia.v2.scenes.quickSheetViewAgents')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSceneId(null);
                    scrollToSection('world-detail-timeline');
                  }}
                  className="rounded-full border border-[#4ECCA3]/18 bg-black/18 px-4 py-2 text-sm text-[#d8efe4]/72 transition-colors hover:border-[#4ECCA3]/28 hover:text-[#effff8]"
                >
                  {t('WorldDetail.xianxia.v2.scenes.quickSheetViewEvents')}
                </button>
              </div>
              </ScrollArea>
            </section>
          </div>
        </div>
      ) : null}

      <CreateAgentDrawer
        isOpen={showCreateAgent && Boolean(props.onCreateAgent)}
        onClose={() => setShowCreateAgent(false)}
        onSubmit={(input) => {
          props.onCreateAgent?.(input);
          setShowCreateAgent(false);
        }}
        worldName={world.name}
        worldBannerUrl={world.bannerUrl}
        worldDescription={world.description}
        submitting={props.createAgentMutating}
      />
    </>
  );
}

export function NarrativeWorldDetailPage(props: WorldDetailPageProps) {
  if (props.loading) {
    return <WorldDetailLoadingState />;
  }
  if (props.error || !props.world) {
    return <WorldDetailErrorState onBack={props.onBack} />;
  }
  return (
    <WorldDetailPageBody
      {...props}
      composition={NARRATIVE_WORLD_DETAIL_COMPOSITION}
    />
  );
}

export function OasisWorldDetailPage(props: WorldDetailPageProps) {
  if (props.loading) {
    return <WorldDetailLoadingState />;
  }
  if (props.error || !props.world) {
    return <WorldDetailErrorState onBack={props.onBack} />;
  }
  return (
    <WorldDetailPageBody
      {...props}
      composition={OASIS_WORLD_DETAIL_COMPOSITION}
    />
  );
}

export function XianxiaWorldTemplate(props: XianxiaWorldTemplateProps) {
  return props.world.type === 'OASIS'
    ? <OasisWorldDetailPage {...props} />
    : <NarrativeWorldDetailPage {...props} />;
}
