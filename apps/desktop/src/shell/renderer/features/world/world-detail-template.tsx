import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WorldCharacterQuickSheet, WorldSceneQuickSheet } from './world-detail-quick-sheets.js';
import { worldPublicHighlightImages } from './world-detail-queries.js';
import { IconArrowLeft } from './world-detail-glass-primitives';
import { CharacterGallery, DetailHero, HeroStats, LorePanel, ScenesPanel, SourceDiscoveryPanel, TimelinePanel } from './world-detail-glass-sections';
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
  // Chat is materialized only after a public source is connected into a localAgent.
  onViewCharacter?: (character: WorldCharacter) => void;
  onConnectSource?: (character: WorldCharacter) => Promise<void> | void;
};

export type XianxiaWorldTemplateProps = WorldDetailPageProps;
export type XianxiaWorldData = WorldDetailData;

function WorldDetailLoadingState() {
  return (
    <div className="px-5 py-6">
      <div className="mx-auto max-w-[1540px] space-y-5">
        <div className="h-[390px] animate-pulse rounded-[24px] bg-white/55" />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <div className="h-20 animate-pulse rounded-2xl bg-white/55" />
            <div className="h-80 animate-pulse rounded-[20px] bg-white/55" />
          </div>
          <div className="h-[620px] animate-pulse rounded-[24px] bg-white/55" />
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

  const selectedCharacter = selectedCharacterId
    ? props.characters.find((character) => character.id === selectedCharacterId) ?? null
    : null;

  const scenes = useMemo(
    () => derivedScenes(props.publicAssets, props.semantic),
    [props.publicAssets, props.semantic],
  );
  const highlightImages = useMemo(
    () => worldPublicHighlightImages(props.publicAssets),
    [props.publicAssets],
  );

  const selectedScene = selectedSceneId
    ? scenes.find((scene) => scene.id === selectedSceneId) ?? null
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

  return (
    <>
      <style>
        {`
          .world-detail-glass-grid {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(320px, 360px);
            gap: 22px;
            align-items: start;
          }
          @media (max-width: 1180px) {
            .world-detail-glass-grid {
              grid-template-columns: minmax(0, 1fr);
            }
            .world-detail-side-panel {
              position: static !important;
            }
          }
          @media (max-width: 900px) {
            .world-detail-main-grid,
            .world-detail-secondary-grid {
              grid-template-columns: minmax(0, 1fr) !important;
            }
          }
        `}
      </style>
      <div className="relative font-sans" data-testid="world-detail-glass-layout">
        <div className="mx-auto grid w-full max-w-[1540px] gap-5 px-5 py-6">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#64748b', fontSize: 12, fontWeight: 850 }}>
            <button
              type="button"
              onClick={props.onBack}
              style={{
                border: 0,
                background: 'rgba(255,255,255,0.56)',
                color: '#1f8f69',
                width: 38,
                height: 38,
                borderRadius: 999,
                display: 'grid',
                placeItems: 'center',
                boxShadow: '0 10px 22px rgba(54,80,125,0.08)',
                cursor: 'pointer',
              }}
              aria-label={t('WorldDetail.glass.backToAtlas')}
            >
              <IconArrowLeft />
            </button>
            <span>{t('WorldDetail.studioTitle')}</span>
            <span>/</span>
            <span style={{ color: '#111827' }}>{world.name}</span>
          </div>

          <div className="world-detail-glass-grid">
            <main style={{ minWidth: 0, display: 'grid', gap: 18 }}>
              <DetailHero
                world={world}
                characters={props.characters}
                onBack={props.onBack}
                onScrollTo={scrollToSection}
              />
              <HeroStats world={world} characters={props.characters} history={props.history} />
              <div className="world-detail-main-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.08fr) minmax(0,0.92fr)', gap: 18 }}>
                <LorePanel world={world} semantic={props.semantic} />
                <CharacterGallery
                  characters={props.characters}
                  loading={props.charactersLoading}
                  onSelect={setSelectedCharacterId}
                  onConnectSource={props.onConnectSource}
                />
              </div>
              <div className="world-detail-secondary-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,0.88fr) minmax(0,1.12fr)', gap: 18 }}>
                <ScenesPanel scenes={scenes} highlightImages={highlightImages} onSelectScene={setSelectedSceneId} />
                <TimelinePanel history={props.history} loading={props.historyLoading} />
              </div>
            </main>
            <SourceDiscoveryPanel
              world={world}
              characters={props.characters}
              highlightImages={highlightImages}
              onSelectCharacter={setSelectedCharacterId}
              onConnectSource={props.onConnectSource}
            />
          </div>
        </div>
      </div>

      {selectedCharacter ? (
        <WorldCharacterQuickSheet
          character={selectedCharacter}
          onClose={() => setSelectedCharacterId(null)}
          onViewCharacter={props.onViewCharacter}
          onConnectSource={props.onConnectSource}
        />
      ) : null}

      {selectedScene ? (
        <WorldSceneQuickSheet
          isOasisWorld={world.type === 'OASIS'}
          oasisSceneActionLabel={t('WorldDetail.glass.scenes.viewRelatedSources')}
          onClose={() => setSelectedSceneId(null)}
          onSelectCharacter={(characterId) => {
            setSelectedSceneId(null);
            setSelectedCharacterId(characterId);
          }}
          onViewCharacters={() => {
            setSelectedSceneId(null);
            scrollToSection('world-detail-characters');
          }}
          onViewEvents={() => {
            setSelectedSceneId(null);
            scrollToSection('world-detail-timeline');
          }}
          relatedCharacters={selectedSceneRelatedCharacters}
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
