import { useEffect, useMemo, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState } from '@nimiplatform/kit/ui';
import { ArrowLeft } from 'lucide-react';
import { WorldCharacterQuickSheet } from './world-detail-quick-sheets.js';
import { WorldRelationshipExplorer } from './world-detail-relationship-explorer.js';
import { WorldDetailDiscovery } from './world-detail-discovery.js';
import { derivedScenes } from './world-detail-template-model.js';
import { WorldDetailPageSkeleton } from './world-detail-skeletons.js';
import type { WorldCharacter, WorldAuditItem, WorldDetailData, WorldHistoryBundle, WorldPeopleCatalogState, WorldPublicAssetsData, WorldSemanticData } from './world-detail-types.js';

export type WorldDetailPageProps = {
  world: WorldDetailData;
  characters: WorldCharacter[];
  peopleCharacters: WorldCharacter[];
  peopleCatalog: WorldPeopleCatalogState;
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
  readingIncomplete?: boolean;
  publicAssetsIncomplete?: boolean;
  onRetryReading?: () => void;
  onBack?: () => void;
  onViewCharacter?: (character: WorldCharacter) => void;
  onFollowWorld?: (world: WorldDetailData) => Promise<void> | void;
  worldFollowed?: boolean;
  initialSubpage?: 'relationship-explorer' | null;
  rootScrollViewportRef?: RefObject<HTMLDivElement | null>;
};

type Subpage = 'root' | 'relationship-explorer';

export function worldDetailRootSectionScrollTop(input: {
  placement: 'start' | 'center'; viewportScrollTop: number; viewportTop: number;
  viewportHeight: number; targetTop: number; targetHeight: number;
}): number {
  const top = input.viewportScrollTop + input.targetTop - input.viewportTop;
  return Math.max(0, input.placement === 'center' ? top - ((input.viewportHeight - input.targetHeight) / 2) : top);
}

export function WorldDetailLoadingState() {
  return <WorldDetailPageSkeleton />;
}

function WorldDetailPageBody(props: WorldDetailPageProps) {
  const [subpage, setSubpage] = useState<Subpage>(props.initialSubpage ?? 'root');
  const [selectedCharacter, setSelectedCharacter] = useState<WorldCharacter | null>(null);
  const scenes = useMemo(() => derivedScenes(props.publicAssets, props.semantic), [props.publicAssets, props.semantic]);

  useEffect(() => {
    setSubpage(props.initialSubpage ?? 'root');
    setSelectedCharacter(null);
  }, [props.world.id, props.initialSubpage]);
  useEffect(() => {
    props.rootScrollViewportRef?.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [subpage, props.rootScrollViewportRef]);

  const viewCharacter = (character: WorldCharacter) => {
    if (props.onViewCharacter) props.onViewCharacter(character);
    else setSelectedCharacter(character);
  };
  const selectCharacter = (id: string) => {
    const character = [...props.peopleCharacters, ...props.characters, ...scenes.flatMap((scene) => scene.relatedCharacters)].find((person) => person.id === id);
    if (character) viewCharacter(character);
  };
  const backToWorld = () => setSubpage('root');
  let content;
  if (subpage === 'relationship-explorer') {
    content = <WorldRelationshipExplorer world={props.world} characters={props.peopleCharacters} catalog={props.peopleCatalog} onBack={backToWorld} onSelectCharacter={selectCharacter} onViewCharacter={viewCharacter} />;
  } else {
    content = <WorldDetailDiscovery key={props.world.id} props={props} scenes={scenes} onViewCharacter={viewCharacter} />;
  }
  return <>{content}{selectedCharacter ? <WorldCharacterQuickSheet character={selectedCharacter} onClose={() => setSelectedCharacter(null)} onViewCharacter={props.onViewCharacter} /> : null}</>;
}

export function WorldDetailPage(props: WorldDetailPageProps) {
  const { t } = useTranslation();
  if (props.loading) return <WorldDetailLoadingState />;
  if (props.error || !props.world) return <EmptyState title={t('WorldDetail.error')} action={props.onBack ? <Button tone="secondary" leadingIcon={<ArrowLeft size={16} />} onClick={props.onBack}>{t('WorldDetail.backToList')}</Button> : undefined} />;
  return <WorldDetailPageBody {...props} />;
}
