import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  OASIS_WORLD_DETAIL_COMPOSITION,
  NARRATIVE_WORLD_DETAIL_COMPOSITION,
  type WorldDetailComposition,
  type WorldDetailSectionKey,
} from './world-detail-layout.js';
import { WorldExtendedSection, WorldTimelineSection, WorldScenesSection, WorldAgentsSection } from './world-detail-content-sections.js';
import { statusGlowStyles, usePrefersReducedMotion } from './world-detail-primitives.js';
import {
  OasisIdentityCard,
  WorldCoreRulesSection,
  WorldDashboardSection,
  WorldHeroSection,
  WorldRecommendedEntrySection,
} from './world-detail-overview-sections.js';
import { WorldAgentQuickSheet, WorldSceneQuickSheet } from './world-detail-quick-sheets.js';
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
  // No onChatAgent / onVoiceAgent: a WorldCharacter offers View profile only.
  // Chat is materialized only after RuntimeSourceSnapshot handoff.
  onViewAgent?: (agent: WorldAgent) => void;
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
          className="absolute left-6 top-6 flex h-10 w-10 items-center justify-center rounded-full border border-[#4ECCA3]/20 bg-white/70 text-[#1f8f69] transition-all hover:border-[#4ECCA3]/40 hover:bg-white/90"
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
    'oasis-scene-creator-studio': 'oasisCreatorStudio',
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
        onSelectAgent={(agent) => setSelectedAgentId(agent.id)}
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
        <WorldAgentQuickSheet
          agent={selectedAgent}
          onClose={() => setSelectedAgentId(null)}
          onViewAgent={props.onViewAgent}
        />
      ) : null}

      {selectedScene ? (
        <WorldSceneQuickSheet
          isOasisWorld={isOasisWorld}
          oasisSceneActionLabel={oasisSceneActionLabel}
          onClose={() => setSelectedSceneId(null)}
          onSelectAgent={(agentId) => {
            setSelectedSceneId(null);
            setSelectedAgentId(agentId);
          }}
          onViewAgents={() => {
            setSelectedSceneId(null);
            scrollToSection('world-detail-agents');
          }}
          onViewEvents={() => {
            setSelectedSceneId(null);
            scrollToSection('world-detail-timeline');
          }}
          relatedAgents={selectedSceneRelatedAgents}
          relatedEvents={selectedSceneRelatedEvents}
          scene={selectedScene}
        />
      ) : null}
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
