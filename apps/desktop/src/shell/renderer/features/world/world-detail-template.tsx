import { useEffect, useLayoutEffect, useMemo, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { WorldCharacterQuickSheet } from './world-detail-quick-sheets.js';
import { WorldLoreLibraryPage } from './world-detail-lore-library.js';
import { WorldPeopleArchivePage } from './world-detail-people-gallery.js';
import { WorldRelationshipExplorer } from './world-detail-relationship-explorer.js';
import { WorldResourceReferencesPage } from './world-detail-resource-references.js';
import { WorldSceneDetailPage } from './world-detail-scene-detail-page.js';
import { worldPublicHighlightRefs } from './world-detail-queries.js';
import { IconArrowLeft } from './world-detail-glass-primitives';
import { DetailHero } from './world-detail-glass-sections';
import { worldDetailPaperContentFrameStyle } from './world-detail-layout.js';
import {
  PaperCharactersSection,
  PaperLoreOverviewSection,
  PaperMetricStrip,
  PaperPathsSection,
  PaperScenesSection,
} from './world-detail-paper-sections';
import {
  derivedMaterials,
  derivedMetrics,
  derivedPaths,
  type PaperPath,
} from './world-detail-paper-model';
import { derivedScenes, sceneImageRef } from './world-detail-template-model';
import {
  WorldDetailPageSkeleton,
  WorldLoreLibrarySkeleton,
  WorldPeopleArchiveSkeleton,
  WorldRelationshipExplorerSkeleton,
  WorldResourceReferencesSkeleton,
} from './world-detail-skeletons';
import type { WorldCharacter, WorldAuditItem, WorldDetailData, WorldHistoryBundle, WorldPublicAssetsData, WorldSemanticData } from './world-detail-types.js';

export type WorldDetailPageProps = {
  world: WorldDetailData;
  characters: WorldCharacter[];
  history: WorldHistoryBundle;
  semantic: WorldSemanticData;
  audits: WorldAuditItem[];
  publicAssets: WorldPublicAssetsData;
  loading?: boolean;
  error?: boolean;
  charactersLoading?: boolean;
  historyLoading?: boolean;
  semanticLoading?: boolean;
  auditsLoading?: boolean;
  publicAssetsLoading?: boolean;
  onBack?: () => void;
  // Chat is materialized only after Runtime creates a device-local LocalAgent.
  onViewCharacter?: (character: WorldCharacter) => void;
  onMaterializeSource?: (character: WorldCharacter) => Promise<void> | void;
  onFollowWorld?: (world: WorldDetailData) => Promise<void> | void;
  worldFollowed?: boolean;
  initialSubpage?: InitialPaperSubpage | null;
  rootScrollViewportRef?: RefObject<HTMLDivElement | null>;
};

export type XianxiaWorldTemplateProps = WorldDetailPageProps;
export type XianxiaWorldData = WorldDetailData;
type ActivePaperSubpage = 'root' | 'people-archive' | 'relationship-explorer' | 'scene-detail' | 'lore-library' | 'resource-references';
type InitialPaperSubpage = Extract<ActivePaperSubpage, 'people-archive' | 'relationship-explorer'>;

const WORLD_DETAIL_SCENES_SECTION_ID = 'world-detail-scenes';

type RootSectionScrollPlacement = 'start' | 'center';

type WorldDetailRootSectionScrollGeometry = {
  placement: RootSectionScrollPlacement;
  viewportScrollTop: number;
  viewportTop: number;
  viewportHeight: number;
  targetTop: number;
  targetHeight: number;
};

function resolveInitialPaperSubpage(value: InitialPaperSubpage | null | undefined): ActivePaperSubpage {
  return value === 'people-archive' || value === 'relationship-explorer' ? value : 'root';
}

function rootSectionScrollPlacement(id: string): RootSectionScrollPlacement {
  return id === WORLD_DETAIL_SCENES_SECTION_ID ? 'center' : 'start';
}

export function worldDetailRootSectionScrollTop(input: WorldDetailRootSectionScrollGeometry): number {
  const targetTopInScrollContent = input.viewportScrollTop + input.targetTop - input.viewportTop;
  const scrollTop = input.placement === 'center'
    ? targetTopInScrollContent - ((input.viewportHeight - input.targetHeight) / 2)
    : targetTopInScrollContent;
  return Math.max(0, scrollTop);
}

function scrollRootSectionIntoView(id: string, scrollViewport: HTMLDivElement | null | undefined) {
  if (!scrollViewport) {
    return;
  }
  const target = scrollViewport.querySelector<HTMLElement>(`#${id}`);
  if (!target) return;
  const placement = rootSectionScrollPlacement(id);
  const targetRect = target.getBoundingClientRect();
  const viewportRect = scrollViewport.getBoundingClientRect();
  scrollViewport.scrollTo({
    top: worldDetailRootSectionScrollTop({
      placement,
      viewportScrollTop: scrollViewport.scrollTop,
      viewportTop: viewportRect.top,
      viewportHeight: viewportRect.height,
      targetTop: targetRect.top,
      targetHeight: targetRect.height,
    }),
    behavior: 'smooth',
  });
}

export function WorldDetailLoadingState() {
  return <WorldDetailPageSkeleton />;
}

function WorldDetailErrorState({ onBack }: { onBack?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="relative flex flex-1 items-center justify-center px-6 py-12">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="absolute left-6 top-6 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--nimi-action-primary-bg)]/20 bg-white/70 text-[var(--nimi-action-primary-bg-hover)] transition-[background-color,border-color,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] hover:border-[var(--nimi-action-primary-bg)]/40 hover:bg-white/90 active:scale-[var(--nimi-motion-pressed-scale)]"
          aria-label={t('WorldDetail.glass.backToAtlas')}
        >
          <IconArrowLeft />
        </button>
      ) : null}
      <span className="text-sm text-red-500">{t('WorldDetail.error')}</span>
    </div>
  );
}

function WorldDetailPageBody(props: WorldDetailPageProps) {
  const { t } = useTranslation();
  const world = props.world;
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [activePaperSubpage, setActivePaperSubpage] = useState<ActivePaperSubpage>(() => resolveInitialPaperSubpage(props.initialSubpage));
  const [pendingRootScrollId, setPendingRootScrollId] = useState<string | null>(null);

  const selectedCharacter = selectedCharacterId
    ? props.characters.find((character) => character.id === selectedCharacterId) ?? null
    : null;

  const scenes = useMemo(
    () => derivedScenes(props.publicAssets, props.semantic, props.characters),
    [props.publicAssets, props.semantic, props.characters],
  );
  const highlightRefs = useMemo(
    () => worldPublicHighlightRefs(props.publicAssets),
    [props.publicAssets],
  );

  const materials = useMemo(
    () => derivedMaterials(props.characters, scenes, props.publicAssets, props.semantic),
    [props.characters, scenes, props.publicAssets, props.semantic],
  );
  const metrics = useMemo(
    () => derivedMetrics(props.characters, scenes, props.history, materials),
    [props.characters, scenes, props.history, materials],
  );
  const paths = useMemo(
    () => derivedPaths(props.characters, scenes),
    [props.characters, scenes],
  );

  const selectedScene = selectedSceneId
    ? scenes.find((scene) => scene.id === selectedSceneId) ?? null
    : null;
  const selectedSceneIndex = selectedScene
    ? scenes.findIndex((scene) => scene.id === selectedScene.id)
    : -1;
  const selectedSceneImageRef = selectedScene && selectedSceneIndex >= 0
    ? sceneImageRef(selectedScene, highlightRefs, selectedSceneIndex)
    : null;

  useEffect(() => {
    setSelectedCharacterId(null);
    setSelectedSceneId(null);
    setPendingRootScrollId(null);
    setActivePaperSubpage(resolveInitialPaperSubpage(props.initialSubpage));
  }, [props.initialSubpage, world.id]);

  const scrollToSection = (id: string) => {
    scrollRootSectionIntoView(id, props.rootScrollViewportRef?.current);
  };

  useEffect(() => {
    if (activePaperSubpage !== 'root') {
      const subpageTestId = {
        'people-archive': 'world-detail-people-archive-page',
        'relationship-explorer': 'world-relationship-explorer',
        'scene-detail': 'world-detail-scene-detail-page',
        'lore-library': 'world-detail-lore-library-page',
        'resource-references': 'world-detail-resource-references-page',
      }[activePaperSubpage];
      props.rootScrollViewportRef?.current
        ?.querySelector<HTMLElement>(`[data-testid="${subpageTestId}"]`)
        ?.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  }, [activePaperSubpage, props.rootScrollViewportRef]);

  useLayoutEffect(() => {
    if (activePaperSubpage !== 'root' || !pendingRootScrollId) {
      return;
    }
    const targetId = pendingRootScrollId;
    setPendingRootScrollId(null);
    scrollRootSectionIntoView(targetId, props.rootScrollViewportRef?.current);
  }, [activePaperSubpage, pendingRootScrollId, props.rootScrollViewportRef]);

  const nav = {
    onBrowsePeople: () => scrollToSection('world-detail-characters'),
    onViewAllPeople: () => setActivePaperSubpage('people-archive'),
    onGoScenes: () => scrollToSection(WORLD_DETAIL_SCENES_SECTION_ID),
  };

  const handleEnterPath = (path: PaperPath) => {
    if (path.key === 'relations') {
      setActivePaperSubpage('relationship-explorer');
      return;
    }
    if (path.key === 'scenes') {
      nav.onGoScenes();
      return;
    }
    const lead = path.leadId
      ? props.characters.find((character) => character.id === path.leadId) ?? null
      : null;
    if (lead) {
      if (props.onViewCharacter) {
        props.onViewCharacter(lead);
      } else {
        setSelectedCharacterId(lead.id);
      }
      return;
    }
    nav.onBrowsePeople();
  };

  const openSceneDetail = (sceneId: string) => {
    setSelectedSceneId(sceneId);
    setActivePaperSubpage('scene-detail');
  };

  const returnToRoot = () => {
    setSelectedSceneId(null);
    setActivePaperSubpage('root');
  };

  const returnToRootAndScroll = (targetId: string) => {
    setPendingRootScrollId(targetId);
    returnToRoot();
  };

  if (activePaperSubpage === 'relationship-explorer') {
    if (props.charactersLoading || props.historyLoading) {
      return <WorldRelationshipExplorerSkeleton />;
    }
    return (
      <>
        <WorldRelationshipExplorer
          world={world}
          characters={props.characters}
          history={props.history}
          onBack={() => setActivePaperSubpage('root')}
          onSelectCharacter={setSelectedCharacterId}
          onViewCharacter={props.onViewCharacter}
        />

        {selectedCharacter ? (
          <WorldCharacterQuickSheet
            character={selectedCharacter}
            onClose={() => setSelectedCharacterId(null)}
            onViewCharacter={props.onViewCharacter}
            onMaterializeSource={props.onMaterializeSource}
          />
        ) : null}
      </>
    );
  }

  if (activePaperSubpage === 'people-archive') {
    if (props.charactersLoading) {
      return <WorldPeopleArchiveSkeleton />;
    }
    return (
      <>
        <WorldPeopleArchivePage
          characters={props.characters}
          onBack={() => setActivePaperSubpage('root')}
          onSelect={setSelectedCharacterId}
          onViewCharacter={props.onViewCharacter}
          onMaterializeSource={props.onMaterializeSource}
        />

        {selectedCharacter ? (
          <WorldCharacterQuickSheet
            character={selectedCharacter}
            onClose={() => setSelectedCharacterId(null)}
            onViewCharacter={props.onViewCharacter}
            onMaterializeSource={props.onMaterializeSource}
          />
        ) : null}
      </>
    );
  }

  if (activePaperSubpage === 'lore-library') {
    if (props.semanticLoading) {
      return <WorldLoreLibrarySkeleton />;
    }
    return (
      <WorldLoreLibraryPage
        world={world}
        semantic={props.semantic}
        onBack={() => setActivePaperSubpage('root')}
      />
    );
  }

  if (activePaperSubpage === 'resource-references') {
    if (props.publicAssetsLoading) {
      return <WorldResourceReferencesSkeleton />;
    }
    return (
      <WorldResourceReferencesPage
        world={world}
        publicAssets={props.publicAssets}
        onBack={() => setActivePaperSubpage('root')}
      />
    );
  }

  if (activePaperSubpage === 'scene-detail' && selectedScene) {
    return (
      <>
        <WorldSceneDetailPage
          isOasisWorld={world.type === 'OASIS'}
          oasisSceneActionLabel={t('WorldDetail.glass.scenes.viewRelatedSources')}
          onBack={returnToRoot}
          onSelectCharacter={setSelectedCharacterId}
          onViewCharacters={() => returnToRootAndScroll('world-detail-characters')}
          scene={selectedScene}
          sceneImageRef={selectedSceneImageRef}
        />

        {selectedCharacter ? (
          <WorldCharacterQuickSheet
            character={selectedCharacter}
            onClose={() => setSelectedCharacterId(null)}
            onViewCharacter={props.onViewCharacter}
            onMaterializeSource={props.onMaterializeSource}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <div style={{ position: 'relative', minHeight: '100%', fontFamily: 'var(--nimi-font-sans)' }} data-testid="world-detail-paper-layout">
        <div style={worldDetailPaperContentFrameStyle()}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
            <div data-nimi-density="expressive">
              <DetailHero
                world={world}
                characters={props.characters}
                onBack={props.onBack}
                onFollowWorld={props.onFollowWorld}
                worldFollowed={props.worldFollowed}
              />
            </div>
            <PaperMetricStrip metrics={metrics} />
            <PaperLoreOverviewSection
              semantic={props.semantic}
              loading={props.semanticLoading}
            />
            <PaperPathsSection paths={paths} onEnterPath={handleEnterPath} />
            <PaperCharactersSection
              characters={props.characters}
              loading={props.charactersLoading}
              onSelect={setSelectedCharacterId}
              onViewCharacter={props.onViewCharacter}
              onMaterializeSource={props.onMaterializeSource}
              onViewAll={nav.onViewAllPeople}
            />
            <PaperScenesSection
              sectionId={WORLD_DETAIL_SCENES_SECTION_ID}
              scenes={scenes}
              highlightRefs={highlightRefs}
              onSelectScene={openSceneDetail}
              onGoScenes={nav.onGoScenes}
            />
          </div>
        </div>
      </div>

      {selectedCharacter ? (
        <WorldCharacterQuickSheet
          character={selectedCharacter}
          onClose={() => setSelectedCharacterId(null)}
          onViewCharacter={props.onViewCharacter}
          onMaterializeSource={props.onMaterializeSource}
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
  return <WorldDetailPageBody {...props} />;
}

export function OasisWorldDetailPage(props: WorldDetailPageProps) {
  if (props.loading) {
    return <WorldDetailLoadingState />;
  }
  if (props.error || !props.world) {
    return <WorldDetailErrorState onBack={props.onBack} />;
  }
  return <WorldDetailPageBody {...props} />;
}

export function XianxiaWorldTemplate(props: XianxiaWorldTemplateProps) {
  return props.world.type === 'OASIS'
    ? <OasisWorldDetailPage {...props} />
    : <NarrativeWorldDetailPage {...props} />;
}
