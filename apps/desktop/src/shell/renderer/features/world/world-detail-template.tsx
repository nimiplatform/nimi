import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WorldCharacterQuickSheet } from './world-detail-quick-sheets.js';
import { WorldPeopleArchivePage } from './world-detail-people-gallery.js';
import { WorldRelationshipExplorer } from './world-detail-relationship-explorer.js';
import { WorldSceneDetailPage } from './world-detail-scene-detail-page.js';
import { worldPublicHighlightRefs } from './world-detail-queries.js';
import { IconArrowLeft } from './world-detail-glass-primitives';
import { DetailHero } from './world-detail-glass-sections';
import {
  PaperCharactersSection,
  PaperMaterialsSection,
  PaperMetricStrip,
  PaperPathsSection,
  PaperScenesSection,
  PaperTimelineSection,
} from './world-detail-paper-sections';
import {
  PAPER,
  derivedMaterials,
  derivedMetrics,
  derivedPaths,
  type PaperMaterial,
  type PaperMaterialKey,
  type PaperPath,
} from './world-detail-paper-model';
import { derivedScenes } from './world-detail-template-model';
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
};

export type XianxiaWorldTemplateProps = WorldDetailPageProps;
export type XianxiaWorldData = WorldDetailData;
type ActivePaperSubpage = 'root' | 'people-archive' | 'relationship-explorer' | 'scene-detail';

export function resolveWorldMaterialSubpage(materialKey: PaperMaterialKey): ActivePaperSubpage | null {
  if (materialKey === 'people') {
    return 'people-archive';
  }
  return null;
}

export function WorldDetailLoadingState() {
  return (
    <div style={{ position: 'relative', minHeight: '100%' }}>
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', background: PAPER.pageGradient }} />
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 1180, margin: '0 auto', padding: '22px 28px 80px' }}>
        <div className="space-y-[18px]">
          <div className="h-[316px] animate-pulse rounded-[24px] bg-[#fbf8f1]" />
          <div className="h-20 animate-pulse rounded-[16px] bg-[#fbf8f1]" />
          <div className="h-80 animate-pulse rounded-[16px] bg-[#fbf8f1]" />
        </div>
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
  const [activePaperSubpage, setActivePaperSubpage] = useState<ActivePaperSubpage>('root');
  const [pendingRootScrollId, setPendingRootScrollId] = useState<string | null>(null);

  const selectedCharacter = selectedCharacterId
    ? props.characters.find((character) => character.id === selectedCharacterId) ?? null
    : null;

  const scenes = useMemo(
    () => derivedScenes(props.publicAssets, props.semantic),
    [props.publicAssets, props.semantic],
  );
  const highlightRefs = useMemo(
    () => worldPublicHighlightRefs(props.publicAssets),
    [props.publicAssets],
  );

  const materials = useMemo(
    () => derivedMaterials(props.characters, scenes, props.history, props.publicAssets, props.semantic),
    [props.characters, scenes, props.history, props.publicAssets, props.semantic],
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
  const selectedSceneImageRef = selectedSceneIndex >= 0 && highlightRefs.length > 0
    ? highlightRefs[selectedSceneIndex % highlightRefs.length] ?? null
    : null;

  const selectedSceneRelatedCharacters = selectedScene
    ? props.characters.filter((character) => (
      selectedScene.activeEntities.includes(character.name)
      || character.sceneName === selectedScene.name
      || character.location?.includes(selectedScene.name)
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

  useEffect(() => {
    if (activePaperSubpage !== 'root') {
      const subpageTestId = {
        'people-archive': 'world-detail-people-archive-page',
        'relationship-explorer': 'world-relationship-explorer',
        'scene-detail': 'world-detail-scene-detail-page',
      }[activePaperSubpage];
      window.requestAnimationFrame(() => {
        document.querySelector(`[data-testid="${subpageTestId}"]`)?.scrollIntoView({ behavior: 'auto', block: 'start' });
      });
    }
  }, [activePaperSubpage]);

  useEffect(() => {
    if (activePaperSubpage !== 'root' || !pendingRootScrollId) {
      return;
    }
    const targetId = pendingRootScrollId;
    setPendingRootScrollId(null);
    window.requestAnimationFrame(() => {
      scrollToSection(targetId);
    });
  }, [activePaperSubpage, pendingRootScrollId]);

  const nav = {
    onBrowsePeople: () => scrollToSection('world-detail-characters'),
    onViewAllPeople: () => setActivePaperSubpage('people-archive'),
    onOpenLibrary: () => scrollToSection('world-detail-materials'),
    onGoTimeline: () => scrollToSection('world-detail-timeline'),
    onGoScenes: () => scrollToSection('world-detail-scenes'),
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
    nav.onBrowsePeople();
  };

  const handleOpenMaterial = (material: PaperMaterial) => {
    const subpage = resolveWorldMaterialSubpage(material.key);
    if (subpage) {
      setActivePaperSubpage(subpage);
    } else if (material.key === 'scenes') {
      nav.onGoScenes();
    } else if (material.key === 'events') {
      nav.onGoTimeline();
    } else {
      scrollToSection('world-detail-materials');
    }
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
    return (
      <>
        <WorldRelationshipExplorer
          world={world}
          characters={props.characters}
          history={props.history}
          onBack={() => setActivePaperSubpage('root')}
          onSelectCharacter={setSelectedCharacterId}
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

  if (activePaperSubpage === 'scene-detail' && selectedScene) {
    return (
      <>
        <WorldSceneDetailPage
          isOasisWorld={world.type === 'OASIS'}
          oasisSceneActionLabel={t('WorldDetail.glass.scenes.viewRelatedSources')}
          onBack={returnToRoot}
          onSelectCharacter={setSelectedCharacterId}
          onViewCharacters={() => returnToRootAndScroll('world-detail-characters')}
          onViewEvents={() => returnToRootAndScroll('world-detail-timeline')}
          relatedCharacters={selectedSceneRelatedCharacters}
          relatedEvents={selectedSceneRelatedEvents}
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
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', background: PAPER.pageGradient }} />
        <div style={{ position: 'relative', zIndex: 1, maxWidth: 1180, margin: '0 auto', padding: '22px 28px 80px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
            <DetailHero
              world={world}
              characters={props.characters}
              onBack={props.onBack}
              onScrollTo={scrollToSection}
              onFollowWorld={props.onFollowWorld}
              worldFollowed={props.worldFollowed}
            />
            <PaperMetricStrip metrics={metrics} />
            <PaperPathsSection paths={paths} onEnterPath={handleEnterPath} />
            <PaperCharactersSection
              characters={props.characters}
              loading={props.charactersLoading}
              onSelect={setSelectedCharacterId}
              onViewCharacter={props.onViewCharacter}
              onMaterializeSource={props.onMaterializeSource}
              onViewAll={nav.onViewAllPeople}
            />
            <PaperMaterialsSection
              materials={materials}
              onOpen={handleOpenMaterial}
              onOpenLibrary={nav.onBrowsePeople}
            />
            <PaperTimelineSection history={props.history} loading={props.historyLoading} />
            <PaperScenesSection
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
